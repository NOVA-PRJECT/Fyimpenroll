-- Owner-run after review_integrity.sql. No existing accounts or academic records are repaired.
BEGIN;
SET LOCAL lock_timeout='10s';
CREATE TABLE public.review_jobs (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN('allocation','timetable')),
 campus_id uuid NOT NULL, actor_id uuid NOT NULL, academic_year text NOT NULL, semester integer NOT NULL,
 term_version integer NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'queued'
 CHECK(status IN('queued','running','completed','failed','cancelled')),
 fence uuid NOT NULL DEFAULT gen_random_uuid(), attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), error text
);
CREATE UNIQUE INDEX review_jobs_active_cohort ON public.review_jobs(kind,campus_id,academic_year,semester,term_version) WHERE status IN('queued','running');
CREATE INDEX review_jobs_ready ON public.review_jobs(status,created_at);
ALTER TABLE public.review_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.review_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.review_jobs TO service_role;

CREATE TABLE public.review_worker_state (id boolean PRIMARY KEY DEFAULT true CHECK(id),last_seen timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE public.review_worker_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.review_worker_state FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.review_worker_state TO service_role;
CREATE FUNCTION public.guard_review_worker_completion() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed'
 AND EXISTS(SELECT 1 FROM public.review_jobs WHERE id=NEW.id)
 AND NOT EXISTS(SELECT 1 FROM public.review_jobs q JOIN public.faculty f ON f.id=q.actor_id AND f.role='campus_director' AND f.campus_id=q.campus_id
 JOIN public.campus_settings c ON c.campus_id=q.campus_id AND c.term_version=q.term_version
 WHERE q.id=NEW.id AND q.status='running' AND q.lease_until>clock_timestamp() AND q.fence::text=NEW.metadata->>'fencing_token') THEN
 RAISE EXCEPTION 'Worker authority, term or lease changed before completion' USING ERRCODE='P4030'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_worker_completion BEFORE UPDATE ON public.system_logs FOR EACH ROW EXECUTE FUNCTION public.guard_review_worker_completion();

CREATE FUNCTION public.enqueue_review_job(p_kind text,p_campus uuid,p_actor uuid,p_term integer,p_year text,p_semester integer,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job uuid; claim jsonb; token uuid:=gen_random_uuid();
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 IF NOT EXISTS(SELECT 1 FROM public.faculty WHERE id=p_actor AND role='campus_director' AND campus_id=p_campus) THEN
 RAISE EXCEPTION 'Campus director required' USING ERRCODE='P4030'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campus_settings WHERE campus_id=p_campus AND term_version=p_term AND academic_year=p_year) THEN
 RAISE EXCEPTION 'Campus term changed; reload' USING ERRCODE='P4090'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>2097152 THEN RAISE EXCEPTION 'Invalid job payload'; END IF;
 SELECT id INTO job FROM public.review_jobs WHERE kind=p_kind AND campus_id=p_campus AND academic_year=p_year AND semester=p_semester
 AND term_version=p_term AND status IN('queued','running');
 IF FOUND THEN RETURN jsonb_build_object('runId',job,'jobId',job,'status','queued'); END IF;
 IF p_kind='allocation' THEN
  job:=public.claim_allocation_run(p_campus,p_year,p_semester::smallint,p_actor,600,token);
 ELSIF p_kind='timetable' THEN
  claim:=public.claim_timetable_generation_job(p_campus,p_year,p_semester::smallint,p_actor,600,token); job:=(claim->>'job_id')::uuid;
 ELSE RAISE EXCEPTION 'Unsupported job kind'; END IF;
 INSERT INTO public.review_jobs(id,kind,campus_id,actor_id,academic_year,semester,term_version,payload,fence)
 VALUES(job,p_kind,p_campus,p_actor,p_year,p_semester,p_term,p_payload,token);
 UPDATE public.system_logs SET status='queued',updated_at=clock_timestamp() WHERE id=job;
 RETURN jsonb_build_object('runId',job,'jobId',job,'status','queued','success',true);
END $$;

CREATE FUNCTION public.claim_review_job() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE j public.review_jobs; token uuid:=gen_random_uuid();
BEGIN
 -- One shared expensive-job slot across every worker/API instance.
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 PERFORM pg_advisory_xact_lock(76102622134918::bigint);
 INSERT INTO public.review_worker_state VALUES(true,clock_timestamp()) ON CONFLICT(id) DO UPDATE SET last_seen=clock_timestamp();
 IF EXISTS(SELECT 1 FROM public.review_jobs WHERE status='running' AND lease_until>clock_timestamp()) THEN RETURN NULL; END IF;
 UPDATE public.review_jobs q SET status='completed',updated_at=clock_timestamp() FROM public.system_logs l
 WHERE q.id=l.id AND q.status IN('queued','running') AND l.status='completed';
 UPDATE public.review_jobs SET status='failed',error='Worker retry limit reached',updated_at=clock_timestamp()
 WHERE status='running' AND lease_until<=clock_timestamp() AND attempts>=3;
 UPDATE public.system_logs l SET status='failed',error_message=q.error,updated_at=clock_timestamp(),completed_at=clock_timestamp()
 FROM public.review_jobs q WHERE q.id=l.id AND q.status='failed' AND l.status IN('queued','running');
 SELECT * INTO j FROM public.review_jobs WHERE status='queued' OR (status='running' AND lease_until<=clock_timestamp())
 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.campus_settings WHERE campus_id=j.campus_id AND term_version=j.term_version AND academic_year=j.academic_year)
 OR NOT EXISTS(SELECT 1 FROM public.faculty WHERE id=j.actor_id AND role='campus_director' AND campus_id=j.campus_id) THEN
  UPDATE public.review_jobs SET status='failed',error='Authority or term changed',updated_at=clock_timestamp() WHERE id=j.id;
  UPDATE public.system_logs SET status='failed',error_message='Authority or term changed',completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=j.id;
  RETURN NULL;
 END IF;
 UPDATE public.review_jobs SET status='running',fence=token,attempts=attempts+1,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
 WHERE id=j.id RETURNING * INTO j;
 UPDATE public.system_logs SET status='running',started_at=clock_timestamp(),updated_at=clock_timestamp(),completed_at=NULL,error_message=NULL,
 metadata=metadata||jsonb_build_object('fencing_token',token,'lease_seconds',600) WHERE id=j.id;
 RETURN to_jsonb(j);
END $$;

CREATE FUNCTION public.renew_review_job(p_id uuid,p_fence uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 INSERT INTO public.review_worker_state VALUES(true,clock_timestamp()) ON CONFLICT(id) DO UPDATE SET last_seen=clock_timestamp();
 UPDATE public.review_jobs q SET lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
 WHERE q.id=p_id AND q.fence=p_fence AND q.status='running' AND q.lease_until>clock_timestamp()
 AND EXISTS(SELECT 1 FROM public.campus_settings s WHERE s.campus_id=q.campus_id AND s.term_version=q.term_version)
 AND EXISTS(SELECT 1 FROM public.faculty f WHERE f.id=q.actor_id AND f.role='campus_director' AND f.campus_id=q.campus_id);
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.system_logs SET started_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=p_id AND metadata->>'fencing_token'=p_fence::text AND status='running';
 RETURN true;
END $$;
CREATE FUNCTION public.finish_review_job(p_id uuid,p_fence uuid,p_error text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE complete boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 SELECT status='completed' INTO complete FROM public.system_logs WHERE id=p_id;
 UPDATE public.review_jobs SET status=CASE WHEN complete AND p_error IS NULL THEN 'completed' ELSE 'failed' END,
 error=left(p_error,2000),lease_until=NULL,updated_at=clock_timestamp() WHERE id=p_id AND fence=p_fence AND status='running' AND lease_until>clock_timestamp();
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT coalesce(complete,false) THEN UPDATE public.system_logs SET status='failed',completed_at=clock_timestamp(),updated_at=clock_timestamp(),
 error_message=coalesce(left(p_error,2000),error_message,'Worker did not complete') WHERE id=p_id AND metadata->>'fencing_token'=p_fence::text; END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.cancel_review_job(p_id uuid,p_actor uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 UPDATE public.review_jobs q SET status='cancelled',fence=gen_random_uuid(),lease_until=NULL,updated_at=clock_timestamp()
 WHERE id=p_id AND status IN('queued','running') AND EXISTS(SELECT 1 FROM public.faculty f WHERE f.id=p_actor AND role='campus_director' AND f.campus_id=q.campus_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'Active job unavailable in your campus' USING ERRCODE='P4030'; END IF;
 UPDATE public.system_logs SET status='failed',error_message='Cancelled by director',completed_at=clock_timestamp(),updated_at=clock_timestamp(),
 metadata=metadata||jsonb_build_object('fencing_token',gen_random_uuid()) WHERE id=p_id;
 RETURN true;
END $$;

CREATE TABLE public.auth_cleanup_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL, user_id uuid NOT NULL,
 actor_id uuid NOT NULL, scope text NOT NULL, resource_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','running','completed','failed')),
 attempts integer NOT NULL DEFAULT 0, next_attempt timestamptz NOT NULL DEFAULT clock_timestamp(), lease_until timestamptz,
 fence uuid, error text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(request_id,user_id)
);
CREATE INDEX auth_cleanup_ready ON public.auth_cleanup_tasks(status,next_attempt);
ALTER TABLE public.auth_cleanup_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_cleanup_tasks FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.auth_cleanup_tasks TO service_role;
CREATE FUNCTION public.review_delete_accounts(p_scope text,p_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request uuid:=gen_random_uuid(); users uuid[]; depts uuid[]; course_ids uuid[]; student_ids uuid[]; result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 IF NOT EXISTS(SELECT 1 FROM public.admins WHERE id=p_actor) THEN RAISE EXCEPTION 'Superadmin required' USING ERRCODE='P4030'; END IF;
 IF p_scope='campus' THEN
  SELECT array_agg(id) INTO users FROM (SELECT id FROM public.students WHERE campus_id=p_id UNION SELECT id FROM public.faculty WHERE campus_id=p_id) u;
 ELSIF p_scope='department' THEN
  SELECT array_agg(id) INTO users FROM (SELECT id FROM public.students WHERE department_id=p_id UNION SELECT id FROM public.faculty WHERE department_id=p_id) u;
 ELSIF p_scope='faculty' THEN
  IF NOT EXISTS(SELECT 1 FROM public.faculty WHERE id=p_id AND role<>'teacher') THEN RAISE EXCEPTION 'Teachers remain HOD-managed'; END IF;
  users:=ARRAY[p_id];
 ELSE RAISE EXCEPTION 'Invalid cleanup scope'; END IF;
 INSERT INTO public.auth_cleanup_tasks(request_id,user_id,actor_id,scope,resource_id) SELECT request,id,p_actor,p_scope,p_id FROM unnest(users) id;
 IF p_scope IN('campus','department') THEN
  SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO depts FROM public.departments WHERE CASE WHEN p_scope='campus' THEN campus_id=p_id ELSE id=p_id END;
  SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO course_ids FROM public.courses WHERE department_id=ANY(depts);
  SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO student_ids FROM public.students WHERE id=ANY(users);
  IF EXISTS(SELECT 1 FROM public.review_jobs WHERE status IN('queued','running') AND (campus_id=p_id OR actor_id=ANY(users))) THEN
    RAISE EXCEPTION 'Cancel active campus work before deletion'; END IF;
  IF EXISTS(SELECT 1 FROM public.student_registrations r WHERE NOT r.student_id=ANY(student_ids)
    AND ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id] && course_ids)
   OR EXISTS(SELECT 1 FROM public.timetable_entries WHERE (course_id=ANY(course_ids) OR teacher_id=ANY(users))
     AND CASE WHEN p_scope='campus' THEN campus_id IS DISTINCT FROM p_id ELSE NOT department_id=ANY(depts) END)
   OR EXISTS(SELECT 1 FROM public.teacher_course_assignments WHERE (course_id=ANY(course_ids) OR teacher_id=ANY(users))
     AND campus_id IS DISTINCT FROM CASE WHEN p_scope='campus' THEN p_id ELSE (SELECT campus_id FROM public.departments WHERE id=p_id) END)
  THEN RAISE EXCEPTION 'Shared courses or visiting teachers are still required outside the deletion scope'; END IF;
  DELETE FROM public.timetable_entries WHERE department_id=ANY(depts) OR (p_scope='campus' AND campus_id=p_id);
  DELETE FROM public.teacher_course_assignments WHERE course_id=ANY(course_ids) OR teacher_id=ANY(users) OR (p_scope='campus' AND campus_id=p_id);
  DELETE FROM public.students WHERE id=ANY(student_ids);
  DELETE FROM public.timetable_conflicts WHERE course_id=ANY(course_ids) OR blocking_course_id=ANY(course_ids);
  DELETE FROM public.semester_blueprints WHERE department_id=ANY(depts);
  DELETE FROM public.courses WHERE id=ANY(course_ids);
  DELETE FROM public.faculty WHERE id=ANY(users);
  DELETE FROM public.departments WHERE id=ANY(depts);
  IF p_scope='campus' THEN
   DELETE FROM public.campus_settings WHERE campus_id=p_id;
   DELETE FROM public.campuses WHERE id=p_id;
  END IF;
 ELSE DELETE FROM public.faculty WHERE id=p_id; END IF;
 INSERT INTO public.system_logs(log_type,event_type,user_id,user_role,action,resource_type,resource_id,status,metadata)
 VALUES('audit_event','accounts_deleted',p_actor,'superadmin','deleted domain records; Auth cleanup queued',p_scope,p_id,'success',
 jsonb_build_object('request_id',request,'auth_accounts',coalesce(cardinality(users),0)));
 RETURN jsonb_build_object('success',true,'cleanupRequestId',request,'cleanupStatus',CASE WHEN cardinality(users)>0 THEN 'pending' ELSE 'completed' END,
 'pendingAuthAccounts',coalesce(cardinality(users),0));
END $$;
CREATE FUNCTION public.claim_auth_cleanup() RETURNS SETOF public.auth_cleanup_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE task public.auth_cleanup_tasks; available integer;
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134919::bigint);
 SELECT greatest(0,5-count(*)) INTO available FROM public.auth_cleanup_tasks WHERE status='running' AND lease_until>clock_timestamp();
 FOR task IN SELECT * FROM public.auth_cleanup_tasks WHERE (status='pending' AND next_attempt<=clock_timestamp()) OR (status='running' AND lease_until<=clock_timestamp())
 ORDER BY created_at,id LIMIT available FOR UPDATE SKIP LOCKED LOOP
  UPDATE public.auth_cleanup_tasks SET status='running',fence=gen_random_uuid(),attempts=attempts+1,lease_until=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp()
  WHERE id=task.id RETURNING * INTO task;
  IF to_regclass('auth.sessions') IS NOT NULL THEN EXECUTE 'DELETE FROM auth.sessions WHERE user_id=$1' USING task.user_id; END IF;
  RETURN NEXT task;
 END LOOP;
END $$;
CREATE FUNCTION public.finish_auth_cleanup(p_id uuid,p_fence uuid,p_error text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 UPDATE public.auth_cleanup_tasks SET status=CASE WHEN p_error IS NULL THEN 'completed' WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,
 error=left(p_error,2000),next_attempt=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::int)),lease_until=NULL,updated_at=clock_timestamp()
 WHERE id=p_id AND fence=p_fence AND status='running' AND lease_until>clock_timestamp();
END $$;

CREATE FUNCTION public.retry_auth_cleanup(p_request uuid,p_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.admins WHERE id=p_actor) THEN RAISE EXCEPTION 'Superadmin required'; END IF;
 UPDATE public.auth_cleanup_tasks SET status='pending',attempts=0,next_attempt=clock_timestamp(),updated_at=clock_timestamp() WHERE request_id=p_request AND status='failed';
END $$;
CREATE FUNCTION public.review_worker_health() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.review_worker_state WHERE last_seen>clock_timestamp()-interval '60 seconds');
$$;

-- Preserve legacy recovery for jobs that were not admitted through the durable queue.
CREATE OR REPLACE FUNCTION public.recover_expired_timetable_workers() RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE affected integer;
BEGIN
 UPDATE public.system_logs l SET status='failed',error_message='Legacy worker lease expired',completed_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE log_type='timetable_job' AND status IN('queued','running') AND updated_at<=clock_timestamp()-(coalesce((metadata->>'lease_seconds')::int,600)*interval '1 second')
 AND NOT EXISTS(SELECT 1 FROM public.review_jobs q WHERE q.id=l.id AND q.status IN('queued','running'));
 GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected;
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure name FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('guard_review_worker_completion','enqueue_review_job','claim_review_job','renew_review_job','finish_review_job','cancel_review_job','review_delete_accounts','claim_auth_cleanup','finish_auth_cleanup','retry_auth_cleanup','review_worker_health','recover_expired_timetable_workers') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.name);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.name);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
