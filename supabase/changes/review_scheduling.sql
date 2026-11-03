-- Owner-run after review_operations.sql. Retains the global write lock.
BEGIN;
SET LOCAL lock_timeout='10s';
CREATE TABLE public.cohort_schedule_outcomes (
 campus_id uuid NOT NULL REFERENCES public.campuses(id) ON DELETE CASCADE,
 academic_year text NOT NULL, semester integer NOT NULL CHECK(semester BETWEEN 1 AND 10), term_version integer NOT NULL,
 outcome text NOT NULL CHECK(outcome='not_required'), finalized_by uuid NOT NULL, finalized_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(campus_id,academic_year,semester,term_version)
);
ALTER TABLE public.cohort_schedule_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cohort_schedule_outcomes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.cohort_schedule_outcomes TO service_role;

CREATE FUNCTION public.finalize_research_cohort(p_campus uuid,p_year text,p_semester integer,p_actor uuid,p_term integer,p_job uuid,p_fence uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE course_ids uuid[];
BEGIN
 PERFORM pg_advisory_xact_lock(76102622134917::bigint);
 IF NOT EXISTS(SELECT 1 FROM public.faculty WHERE id=p_actor AND campus_id=p_campus AND role='campus_director')
 OR NOT EXISTS(SELECT 1 FROM public.campus_settings WHERE campus_id=p_campus AND term_version=p_term AND academic_year=p_year AND deadline<=now())
 THEN RAISE EXCEPTION 'Current director and closed registration required' USING ERRCODE='P4030'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.current_system_logs WHERE log_type='allocation_run' AND campus_id=p_campus AND academic_year=p_year AND semester=p_semester AND status='completed')
 THEN RAISE EXCEPTION 'Completed allocation required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.current_system_logs WHERE id=p_job AND log_type='timetable_job' AND campus_id=p_campus
  AND academic_year=p_year AND semester=p_semester AND status='running' AND metadata->>'fencing_token'=p_fence::text
  AND updated_at>now()-(coalesce((metadata->>'lease_seconds')::int,600)*interval '1 second')) THEN RAISE EXCEPTION 'Stale worker'; END IF;
 SELECT array_agg(DISTINCT cid) INTO course_ids FROM public.current_student_registrations r
 CROSS JOIN LATERAL unnest(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,
  r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id]) cid
 WHERE r.campus_id=p_campus AND r.academic_year=p_year AND r.semester=p_semester AND cid IS NOT NULL;
 IF coalesce(cardinality(course_ids),0)=0 OR EXISTS(SELECT 1 FROM unnest(course_ids) AS selected(course_id) LEFT JOIN public.courses c ON c.id=selected.course_id
 WHERE c.id IS NULL OR c.theory_hours_per_week IS NULL OR c.practical_hours_per_week IS NULL
 OR c.theory_hours_per_week<>0 OR c.practical_hours_per_week<>0) THEN RAISE EXCEPTION 'Cohort contains classroom components or has no allocated courses'; END IF;
 IF EXISTS(SELECT 1 FROM public.current_timetable_entries WHERE campus_id=p_campus AND academic_year=p_year AND semester=p_semester)
 THEN RAISE EXCEPTION 'Cohort already contains timetable entries'; END IF;
 INSERT INTO public.cohort_schedule_outcomes VALUES(p_campus,p_year,p_semester,p_term,'not_required',p_actor,now());
 UPDATE public.system_logs SET status='completed',progress=100,completed_at=now(),updated_at=now(),
 metadata=metadata||jsonb_build_object('schedulingStatus','not_required','classroomTimetableRequired',false)
 WHERE id=p_job AND metadata->>'fencing_token'=p_fence::text;
 INSERT INTO public.system_logs(log_type,event_type,user_id,user_role,campus_id,academic_year,semester,action,status,metadata)
 VALUES('audit_event','research_schedule_finalized',p_actor,'campus_director',p_campus,p_year,p_semester,'finalized zero-contact cohort','success',jsonb_build_object('jobId',p_job));
 RETURN true;
END $$;

CREATE FUNCTION public.guard_research_finalization() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE row_data jsonb; cid uuid; yr text; sem integer; term integer;
BEGIN
 row_data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 cid:=(row_data->>'campus_id')::uuid; yr:=row_data->>'academic_year'; sem:=(row_data->>'semester')::int; term:=(row_data->>'term_version')::int;
 IF EXISTS(SELECT 1 FROM public.cohort_schedule_outcomes o JOIN public.campus_settings s ON s.campus_id=o.campus_id AND s.term_version=o.term_version
 WHERE o.campus_id=cid AND o.academic_year=yr AND o.semester=sem AND (term IS NULL OR term=o.term_version)) THEN
  IF TG_TABLE_NAME='system_logs' AND row_data->>'log_type' NOT IN('allocation_run','timetable_job') THEN RETURN coalesce(NEW,OLD); END IF;
  RAISE EXCEPTION 'Research-only cohort scheduling is finalized' USING ERRCODE='P4090';
 END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER review_research_registration BEFORE INSERT OR UPDATE ON public.student_registrations FOR EACH ROW EXECUTE FUNCTION public.guard_research_finalization();
CREATE TRIGGER review_research_preferences BEFORE INSERT OR UPDATE ON public.registration_preferences FOR EACH ROW EXECUTE FUNCTION public.guard_research_finalization();
CREATE TRIGGER review_research_schedule BEFORE INSERT OR UPDATE ON public.timetable_entries FOR EACH ROW EXECUTE FUNCTION public.guard_research_finalization();
-- Prevent another allocation/generation claim after finalization without blocking the completion update itself.
CREATE TRIGGER review_research_job BEFORE INSERT ON public.system_logs FOR EACH ROW EXECUTE FUNCTION public.guard_research_finalization();

CREATE FUNCTION public.guard_research_contact_hours() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF (NEW.theory_hours_per_week,NEW.practical_hours_per_week) IS DISTINCT FROM (OLD.theory_hours_per_week,OLD.practical_hours_per_week)
 AND EXISTS(SELECT 1 FROM public.cohort_schedule_outcomes o JOIN public.campus_settings s ON s.campus_id=o.campus_id AND s.term_version=o.term_version
  JOIN public.current_student_registrations r ON r.campus_id=o.campus_id AND r.academic_year=o.academic_year AND r.semester=o.semester
  WHERE NEW.id=ANY(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id]))
 THEN RAISE EXCEPTION 'Contact hours of a finalized research-only cohort cannot change' USING ERRCODE='P4090'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_research_course BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.guard_research_contact_hours();

CREATE TABLE public.schedule_dependency_revisions (key text PRIMARY KEY, revision bigint NOT NULL DEFAULT 1);
ALTER TABLE public.schedule_dependency_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schedule_dependency_revisions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.schedule_dependency_revisions TO service_role;
CREATE FUNCTION public.bump_schedule_dependency() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE oldrow jsonb; newrow jsonb; r jsonb; keys text[]:=ARRAY[]::text[]; k text;
BEGIN
 IF TG_OP<>'INSERT' THEN oldrow:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN newrow:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='departments' AND TG_OP='UPDATE' AND (oldrow-ARRAY['name','updated_at'])=(newrow-ARRAY['name','updated_at']) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='faculty' AND TG_OP='UPDATE' AND
  (oldrow-ARRAY['full_name','email','updated_at'])=(newrow-ARRAY['full_name','email','updated_at']) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='students' AND TG_OP='UPDATE' AND
  oldrow->'campus_id'=newrow->'campus_id' AND oldrow->'department_id'=newrow->'department_id' AND oldrow->'current_semester'=newrow->'current_semester' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='courses' AND TG_OP='UPDATE' AND
  (oldrow-ARRAY['title','prerequisites','updated_at'])=(newrow-ARRAY['title','prerequisites','updated_at']) THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='campus_settings' AND TG_OP='UPDATE' AND
  oldrow->'academic_year'=newrow->'academic_year' AND oldrow->'deadline' IS NOT DISTINCT FROM newrow->'deadline'
  AND oldrow->'term_version'=newrow->'term_version' THEN RETURN NEW; END IF;
 FOREACH r IN ARRAY ARRAY[oldrow,newrow] LOOP
  IF r IS NULL THEN CONTINUE; END IF;
  IF TG_TABLE_NAME IN('student_registrations','teacher_course_assignments','timetable_entries','system_logs') THEN
   IF TG_TABLE_NAME='system_logs' AND r->>'log_type' NOT IN('timetable_job','allocation_run') THEN CONTINUE; END IF;
   keys:=array_append(keys,'cohort:'||(r->>'campus_id')||':'||(r->>'academic_year')||':'||(r->>'semester')||':'||(r->>'term_version'));
  END IF;
  IF TG_TABLE_NAME IN('teacher_course_assignments','timetable_entries') THEN keys:=array_append(keys,'teacher:'||(r->>'teacher_id')); END IF;
  IF TG_TABLE_NAME='courses' THEN keys:=array_append(keys,'course:'||(r->>'id')); END IF;
  IF TG_TABLE_NAME='faculty' THEN keys:=array_append(keys,'teacher:'||(r->>'id')); END IF;
  IF TG_TABLE_NAME='students' THEN keys:=array_append(keys,'student:'||(r->>'id')); END IF;
  IF TG_TABLE_NAME='departments' THEN keys:=array_append(keys,'department:'||(r->>'id')); END IF;
  IF TG_TABLE_NAME='campus_settings' THEN keys:=array_append(keys,'settings:'||(r->>'campus_id')); END IF;
  IF TG_TABLE_NAME='time_slots' THEN keys:=array_append(keys,'slots'); END IF;
  IF TG_TABLE_NAME='semester_blueprints' THEN keys:=array_append(keys,'blueprint:'||(r->>'department_id')||':'||(r->>'semester')); END IF;
 END LOOP;
 FOR k IN SELECT DISTINCT x FROM unnest(keys) x WHERE x IS NOT NULL ORDER BY x LOOP
  INSERT INTO public.schedule_dependency_revisions VALUES(k,1) ON CONFLICT(key) DO UPDATE SET revision=schedule_dependency_revisions.revision+1;
 END LOOP;
 RETURN coalesce(NEW,OLD);
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['student_registrations','teacher_course_assignments','timetable_entries','system_logs','courses','faculty','students','departments','campus_settings','time_slots','semester_blueprints'] LOOP
 EXECUTE format('CREATE TRIGGER review_revision AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_schedule_dependency()',tab);
 END LOOP;
END $$;
CREATE FUNCTION public.manual_dependency_vector(p_campus uuid,p_year text,p_semester integer,p_term integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
 WITH regs AS (SELECT * FROM public.current_student_registrations WHERE campus_id=p_campus AND academic_year=p_year AND semester=p_semester),
 ids AS (SELECT DISTINCT unnest(ARRAY[slot_1_course_id,slot_2_course_id,slot_3_course_id,slot_4_course_id,slot_5_course_id,slot_6_course_id,slot_7_course_id,slot_8_course_id]) id FROM regs),
 teachers AS (SELECT DISTINCT teacher_id id FROM public.current_teacher_course_assignments WHERE campus_id=p_campus AND academic_year=p_year AND semester=p_semester),
 depts AS (SELECT department_id id FROM public.students WHERE id IN(SELECT student_id FROM regs) UNION SELECT department_id FROM public.courses WHERE id IN(SELECT id FROM ids)),
 keys AS (SELECT 'cohort:'||p_campus||':'||p_year||':'||p_semester||':'||p_term key UNION SELECT 'settings:'||p_campus UNION SELECT 'slots'
 UNION SELECT 'course:'||id FROM ids WHERE id IS NOT NULL UNION SELECT 'teacher:'||id FROM teachers WHERE id IS NOT NULL
 UNION SELECT 'student:'||student_id FROM regs UNION SELECT 'department:'||id FROM depts WHERE id IS NOT NULL
 UNION SELECT 'blueprint:'||id||':'||p_semester FROM depts WHERE id IS NOT NULL)
 SELECT coalesce(jsonb_object_agg(k.key,coalesce(r.revision,0) ORDER BY k.key),'{}'::jsonb) FROM keys k LEFT JOIN public.schedule_dependency_revisions r USING(key);
$$;

CREATE OR REPLACE FUNCTION public.timetable_manual_context(p_campus_id uuid,p_academic_year text,p_semester integer,
  p_actor_id uuid,p_expected_term integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.system_logs; version integer; deadline timestamptz; year text; published boolean; revision text; entries jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.faculty WHERE id=p_actor_id AND role='campus_director' AND campus_id=p_campus_id) THEN
    RAISE EXCEPTION 'Campus director affiliation required' USING ERRCODE='P4030'; END IF;
  SELECT s.term_version,s.deadline,s.academic_year INTO version,deadline,year FROM public.campus_settings s WHERE campus_id=p_campus_id;
  IF version IS NULL OR p_expected_term IS DISTINCT FROM version OR p_academic_year IS DISTINCT FROM year THEN
    RAISE EXCEPTION 'Campus term changed; reload the portal' USING ERRCODE='P4090'; END IF;
  IF p_semester IS NULL OR p_semester NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Invalid semester'; END IF;
  SELECT * INTO job FROM public.current_system_logs WHERE log_type='timetable_job' AND campus_id=p_campus_id
    AND academic_year=p_academic_year AND semester=p_semester ORDER BY created_at DESC,id DESC LIMIT 1;
  IF job.id IS NULL THEN RAISE EXCEPTION 'Run timetable generation before using the manual fallback'; END IF;
  IF job.status IN ('queued','running') OR EXISTS(SELECT 1 FROM public.current_system_logs WHERE campus_id=p_campus_id
    AND academic_year=p_academic_year AND semester=p_semester AND log_type IN ('allocation_run','timetable_job') AND status IN ('queued','running')) THEN
    RAISE EXCEPTION 'Wait for active allocation and timetable jobs to finish' USING ERRCODE='P4090'; END IF;
  IF job.status<>'failed' AND NOT(job.metadata ? 'reviewDraft') AND NOT(job.metadata ? 'manualDraft') THEN
    RAISE EXCEPTION 'Manual fallback is available after failed or incomplete generation'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.current_timetable_entries e LEFT JOIN public.departments d ON d.id=e.department_id
    WHERE coalesce(e.campus_id,d.campus_id)=p_campus_id AND e.academic_year=p_academic_year AND e.semester=p_semester
    AND e.status='published') INTO published;
  IF NOT published AND (deadline IS NULL OR deadline>clock_timestamp()) THEN
    RAISE EXCEPTION 'Close student registrations before manual scheduling'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('time_slots',to_jsonb(t)) ORDER BY e.id),'[]'::jsonb)
    INTO entries FROM public.current_timetable_entries e JOIN public.time_slots t ON t.id=e.time_slot_id
    WHERE e.campus_id=p_campus_id AND e.academic_year=p_academic_year AND e.semester=p_semester;
  SELECT md5(jsonb_build_object('job',to_jsonb(job),'dependencies',
    public.manual_dependency_vector(p_campus_id,p_academic_year,p_semester,p_expected_term))::text) INTO revision;
  RETURN jsonb_build_object('job',to_jsonb(job),'entries',entries,'published',published,'revision',revision);
END $$;


DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure name FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
 ('guard_research_contact_hours','finalize_research_cohort','guard_research_finalization','bump_schedule_dependency','manual_dependency_vector','timetable_manual_context') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.name);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.name);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
