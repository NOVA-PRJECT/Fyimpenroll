-- Owner-run SQL, after semester_lifecycle.sql. Apply once before deploying this feature.
-- No application records or teacher-course assignments are removed by this change.
BEGIN;
SELECT pg_advisory_xact_lock(76102622134917::bigint);

-- Keep the existing transactional HOD mutation logic, narrowing its actor gate.
DO $$ DECLARE definition text; BEGIN
  SELECT pg_get_functiondef('public.mutate_teacher_assignments(uuid,text,jsonb,uuid,uuid,uuid)'::regprocedure) INTO definition;
  IF position('actor_role NOT IN (''superadmin'',''hod'',''campus_director'')' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected teacher mutation definition; review before applying this change';
  END IF;
  definition:=replace(definition,'actor_role NOT IN (''superadmin'',''hod'',''campus_director'')','actor_role <> ''hod''');
  EXECUTE definition;
END $$;

-- Teacher identity remains enforced even when scheduling clashes are explicitly overridden.
CREATE OR REPLACE FUNCTION public.validate_timetable_teacher() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE teacher_role text;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
  IF NEW.teacher_id IS NULL THEN RETURN NEW; END IF;
  SELECT role INTO teacher_role FROM public.faculty WHERE id=NEW.teacher_id FOR SHARE;
  IF teacher_role IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Only faculty with the teacher role can instruct courses' USING ERRCODE='23514';
  END IF;
  IF current_setting('app.manual_timetable_override',true) IS DISTINCT FROM 'on' AND EXISTS (
    SELECT 1 FROM public.current_timetable_entries e WHERE e.id<>NEW.id AND e.teacher_id=NEW.teacher_id
    AND e.academic_year=NEW.academic_year AND e.time_slot_id=NEW.time_slot_id
    AND ROW(e.course_id,e.campus_id,e.semester) IS DISTINCT FROM ROW(NEW.course_id,NEW.campus_id,NEW.semester)) THEN
    RAISE EXCEPTION 'Teacher already has a class scheduled in this period' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.timetable_manual_context(p_campus_id uuid,p_academic_year text,p_semester integer,
  p_actor_id uuid,p_expected_term integer) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE job public.system_logs; version integer; deadline timestamptz; year text; published boolean; revision text; entries jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
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
  -- A stale input set can never be committed after server-side validation. Include
  -- other-campus published occupancy, HOD changes, catalogue, enrollment and term state.
  SELECT md5(jsonb_build_object('job',to_jsonb(job),'entries',entries,
    'registrations',(SELECT md5(string_agg(r::text,',' ORDER BY r.id)) FROM public.current_student_registrations r WHERE r.campus_id=p_campus_id AND r.academic_year=p_academic_year AND r.semester=p_semester),
    'students',(SELECT md5(string_agg(ROW(s.id,s.department_id,s.current_semester)::text,',' ORDER BY s.id)) FROM public.students s WHERE s.campus_id=p_campus_id),
    'courses',(SELECT md5(string_agg(c::text,',' ORDER BY c.id)) FROM public.courses c WHERE c.semester=p_semester),
    'assignments',(SELECT md5(string_agg(a::text,',' ORDER BY a.id)) FROM public.current_teacher_course_assignments a WHERE a.academic_year=p_academic_year),
    'occupancy',(SELECT md5(string_agg(e::text,',' ORDER BY e.id)) FROM public.current_timetable_entries e WHERE e.academic_year=p_academic_year),
    'slots',(SELECT md5(string_agg(t::text,',' ORDER BY t.id)) FROM public.time_slots t),
    'departments',(SELECT md5(string_agg(d::text,',' ORDER BY d.id)) FROM public.departments d),
    'faculty',(SELECT md5(string_agg(ROW(f.id,f.role,f.department_id,f.campus_id)::text,',' ORDER BY f.id)) FROM public.faculty f),
    'settings',(SELECT md5(string_agg(s::text,',' ORDER BY s.campus_id)) FROM public.campus_settings s),
    'allocation',(SELECT md5(string_agg(l::text,',' ORDER BY l.id)) FROM public.current_system_logs l WHERE l.log_type='allocation_run' AND l.campus_id=p_campus_id AND l.semester=p_semester)
  )::text) INTO revision;
  RETURN jsonb_build_object('job',to_jsonb(job),'entries',entries,'published',published,'revision',revision);
END $$;

CREATE FUNCTION public.commit_manual_timetable(p_campus_id uuid,p_academic_year text,p_semester integer,
  p_actor_id uuid,p_expected_term integer,p_revision text,p_draft jsonb,p_publish boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE context jsonb; job_id uuid; mode text; entry jsonb; course public.courses; slot uuid; teacher uuid;
  saved integer; published_time timestamptz:=clock_timestamp(); previous_override text; result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
  context:=public.timetable_manual_context(p_campus_id,p_academic_year,p_semester,p_actor_id,p_expected_term);
  IF (context->>'published')::boolean THEN RAISE EXCEPTION 'Published timetables cannot be edited' USING ERRCODE='P4090'; END IF;
  IF p_revision IS DISTINCT FROM context->>'revision' THEN
    RAISE EXCEPTION 'Timetable or inputs changed; reload the manual editor' USING ERRCODE='P4090'; END IF;
  job_id:=(context->'job'->>'id')::uuid; mode:=p_draft->>'mode';
  IF mode IS NULL OR mode NOT IN ('follow_rules','allow_overrides') OR jsonb_typeof(p_draft->'entries') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid manual timetable'; END IF;
  IF mode='allow_overrides' AND coalesce(btrim(p_draft->>'reason'),'')='' THEN RAISE EXCEPTION 'An override reason is required'; END IF;
  IF jsonb_typeof(p_draft->'report'->'blockingViolations') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_draft->'report'->'violations') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'A server validation report is required'; END IF;
  IF mode='follow_rules' AND jsonb_array_length(p_draft->'report'->'blockingViolations')>0 THEN RAISE EXCEPTION 'Resolve scheduling violations before saving'; END IF;
  IF p_publish THEN
    IF jsonb_array_length(p_draft->'entries')=0 THEN RAISE EXCEPTION 'An empty timetable cannot be published'; END IF;
    IF mode='follow_rules' AND jsonb_array_length(p_draft->'report'->'violations')>0 THEN RAISE EXCEPTION 'Complete the timetable before publication'; END IF;
    IF (p_draft->'entries') IS DISTINCT FROM (context->'job'->'metadata'->'manualDraft'->'entries')
      OR (p_draft->'rules') IS DISTINCT FROM (context->'job'->'metadata'->'manualDraft'->'rules')
      OR mode IS DISTINCT FROM (context->'job'->'metadata'->'manualDraft'->>'mode')
      OR p_draft->>'reason' IS DISTINCT FROM (context->'job'->'metadata'->'manualDraft'->>'reason') THEN
      RAISE EXCEPTION 'Save this manual draft before publishing' USING ERRCODE='P4090'; END IF;
  END IF;
  -- Validate identities even for saved previews; scheduling overrides never authorize arbitrary courses.
  FOR entry IN SELECT value FROM jsonb_array_elements(p_draft->'entries') LOOP
    SELECT * INTO course FROM public.courses WHERE id=(entry->>'courseId')::uuid AND semester=p_semester;
    IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.current_student_registrations r WHERE r.campus_id=p_campus_id
      AND r.academic_year=p_academic_year AND r.semester=p_semester AND course.id=ANY(ARRAY[r.slot_1_course_id,r.slot_2_course_id,
      r.slot_3_course_id,r.slot_4_course_id,r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id])) THEN
      RAISE EXCEPTION 'Course is outside this registered campus cohort' USING ERRCODE='P4030'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.time_slots t WHERE t.day_of_week=(entry->>'day')::int AND t.period_number=(entry->>'period')::int
      AND t.day_of_week BETWEEN 1 AND 5 AND t.period_number BETWEEN 1 AND 6) THEN RAISE EXCEPTION 'Invalid timetable slot'; END IF;
  END LOOP;
  IF p_publish THEN
    previous_override:=current_setting('app.manual_timetable_override',true);
    PERFORM set_config('app.manual_timetable_override',CASE WHEN mode='allow_overrides' THEN 'on' ELSE 'off' END,true);
    DELETE FROM public.current_timetable_entries WHERE campus_id=p_campus_id AND academic_year=p_academic_year AND semester=p_semester AND status='draft';
    FOR entry IN SELECT value FROM jsonb_array_elements(p_draft->'entries') LOOP
      SELECT * INTO course FROM public.courses WHERE id=(entry->>'courseId')::uuid;
      SELECT id INTO slot FROM public.time_slots WHERE day_of_week=(entry->>'day')::int AND period_number=(entry->>'period')::int;
      -- Identical deterministic selection to the generation loader. Never accept a teacher from the client.
      SELECT a.teacher_id INTO teacher FROM public.current_teacher_course_assignments a WHERE a.campus_id=p_campus_id
        AND a.academic_year=p_academic_year AND a.semester=p_semester AND a.course_id=course.id ORDER BY a.id DESC LIMIT 1;
      INSERT INTO public.timetable_entries(campus_id,academic_year,semester,course_id,department_id,time_slot_id,session_type,is_lab_block,teacher_id,status,generated_by)
        VALUES(p_campus_id,p_academic_year,p_semester,course.id,course.department_id,slot,entry->>'sessionType',(entry->>'isLabBlock')::boolean,teacher,'draft',p_actor_id);
    END LOOP;
    UPDATE public.timetable_entries SET status='published',published_at=published_time WHERE campus_id=p_campus_id
      AND academic_year=p_academic_year AND semester=p_semester AND term_version=p_expected_term AND status='draft';
    GET DIAGNOSTICS saved=ROW_COUNT;
    PERFORM set_config('app.manual_timetable_override',coalesce(previous_override,''),true);
    IF saved<>jsonb_array_length(p_draft->'entries') THEN RAISE EXCEPTION 'Incomplete publication; transaction rolled back'; END IF;
    p_draft:=p_draft||jsonb_build_object('publishedAt',published_time,'publishedBy',p_actor_id,'publishedCount',saved);
  END IF;
  UPDATE public.system_logs SET metadata=metadata||jsonb_build_object('manualDraft',p_draft),updated_at=clock_timestamp() WHERE id=job_id;
  INSERT INTO public.system_logs(log_type,status,campus_id,academic_year,semester,term_version,user_id,user_role,event_type,action,resource_type,resource_id,metadata)
    VALUES('audit_event','success',p_campus_id,p_academic_year,p_semester,p_expected_term,p_actor_id,'campus_director',
    CASE WHEN p_publish THEN 'manual_timetable_published' ELSE 'manual_timetable_saved' END,
    CASE WHEN p_publish THEN 'Published manual timetable' ELSE 'Saved manual timetable' END,'timetable',job_id,
    jsonb_build_object('mode',mode,'reason',p_draft->>'reason','previousRevision',p_revision,'draft',p_draft));
  result:=public.timetable_manual_context(p_campus_id,p_academic_year,p_semester,p_actor_id,p_expected_term);
  RETURN jsonb_build_object('success',true,'revision',result->>'revision','publishedCount',saved,'publishedAt',CASE WHEN p_publish THEN published_time END);
END $$;

REVOKE ALL ON FUNCTION public.timetable_manual_context(uuid,text,integer,uuid,integer),
  public.commit_manual_timetable(uuid,text,integer,uuid,integer,text,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.timetable_manual_context(uuid,text,integer,uuid,integer),
  public.commit_manual_timetable(uuid,text,integer,uuid,integer,text,jsonb,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
