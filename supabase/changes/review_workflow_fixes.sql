-- Owner-run for databases with the November review release. Fresh releases include this file.
BEGIN;
SET LOCAL lock_timeout='10s';
SELECT pg_advisory_xact_lock(76102622134917::bigint);
-- Resolve every original signature before replacing it, including on a standalone upgrade.
SELECT 'public.finish_review_job(uuid,uuid,text)'::regprocedure,
       'public.cancel_review_job(uuid,uuid)'::regprocedure,
       'public.review_delete_accounts(text,uuid,uuid)'::regprocedure;

CREATE OR REPLACE FUNCTION public.finish_review_job(p_id uuid,p_fence uuid,p_error text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE complete boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 SELECT status='completed' INTO complete FROM public.system_logs WHERE id=p_id;
 UPDATE public.review_jobs SET status=CASE WHEN complete THEN 'completed' ELSE 'failed' END,
 error=CASE WHEN complete THEN NULL ELSE left(p_error,2000) END,lease_until=NULL,updated_at=clock_timestamp() WHERE id=p_id AND fence=p_fence AND status='running' AND lease_until>clock_timestamp();
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT coalesce(complete,false) THEN UPDATE public.system_logs SET status='failed',completed_at=clock_timestamp(),updated_at=clock_timestamp(),
 error_message=coalesce(left(p_error,2000),error_message,'Worker did not complete') WHERE id=p_id AND metadata->>'fencing_token'=p_fence::text; END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_review_job(p_id uuid,p_actor uuid) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 IF NOT EXISTS(SELECT 1 FROM public.review_jobs q JOIN public.faculty f ON f.campus_id=q.campus_id
   WHERE q.id=p_id AND f.id=p_actor AND f.role='campus_director') THEN
   RAISE EXCEPTION 'Job unavailable in your campus' USING ERRCODE='P4030';
 END IF;
 -- A terminal domain write wins even if its worker has not acknowledged it yet.
 UPDATE public.system_logs SET status='failed',error_message='Cancelled by director',completed_at=clock_timestamp(),updated_at=clock_timestamp(),
 metadata=metadata||jsonb_build_object('fencing_token',gen_random_uuid()) WHERE id=p_id AND status IN('queued','running');
 IF NOT FOUND THEN RAISE EXCEPTION 'Job has already finished. Refresh its status.' USING ERRCODE='P4090'; END IF;
 UPDATE public.review_jobs SET status='cancelled',fence=gen_random_uuid(),lease_until=NULL,updated_at=clock_timestamp()
 WHERE id=p_id AND status IN('queued','running');
 IF NOT FOUND THEN RAISE EXCEPTION 'Job is no longer active. Refresh its status.' USING ERRCODE='P4090'; END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.review_delete_accounts(p_scope text,p_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
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
     AND (campus_id IS DISTINCT FROM CASE WHEN p_scope='campus' THEN p_id ELSE (SELECT campus_id FROM public.departments WHERE id=p_id) END
          OR (p_scope='department' AND NOT (course_id=ANY(course_ids)))))
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

COMMIT;
