BEGIN;

-- All assignment/timetable writers acquire the same lock before row locks.
-- This also serializes generation/publication with a simultaneous teacher change.
CREATE OR REPLACE FUNCTION public.lock_teacher_schedule_writes() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
  RETURN NULL;
END $$;

CREATE TRIGGER teacher_schedule_write_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.timetable_entries FOR EACH STATEMENT EXECUTE FUNCTION public.lock_teacher_schedule_writes();
CREATE TRIGGER teacher_assignment_write_lock BEFORE INSERT OR UPDATE OR DELETE
ON public.teacher_course_assignments FOR EACH STATEMENT EXECUTE FUNCTION public.lock_teacher_schedule_writes();

CREATE OR REPLACE FUNCTION public.validate_timetable_teacher() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE teacher_role text;
BEGIN
  IF NEW.teacher_id IS NULL THEN RETURN NEW; END IF;
  SELECT role INTO teacher_role FROM public.faculty WHERE id = NEW.teacher_id FOR SHARE;
  IF teacher_role IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Only faculty with the teacher role can instruct courses' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.timetable_entries e
    WHERE e.id <> NEW.id AND e.teacher_id = NEW.teacher_id
      AND e.academic_year = NEW.academic_year AND e.time_slot_id = NEW.time_slot_id
      AND ROW(e.course_id,e.campus_id,e.semester) IS DISTINCT FROM ROW(NEW.course_id,NEW.campus_id,NEW.semester)) THEN
    RAISE EXCEPTION 'Teacher already has a class scheduled in this period' USING ERRCODE='23P01';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER teacher_role_and_clash_guard BEFORE INSERT OR UPDATE OF teacher_id,academic_year,time_slot_id,campus_id,course_id,semester
ON public.timetable_entries FOR EACH ROW EXECUTE FUNCTION public.validate_timetable_teacher();

CREATE OR REPLACE FUNCTION public.mutate_teacher_assignments(
  p_actor_id uuid, p_operation text, p_items jsonb DEFAULT '[]'::jsonb,
  p_assignment_id uuid DEFAULT NULL, p_entry_id uuid DEFAULT NULL, p_teacher_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  actor_role text; actor_department uuid; actor_campus uuid;
  old_assignment public.teacher_course_assignments;
  saved public.teacher_course_assignments;
  entry public.timetable_entries;
  item jsonb; items jsonb := p_items; results jsonb := '[]'::jsonb;
  course public.courses; target_teacher uuid; host_campus uuid; term text; term_semester integer;
  old_teacher uuid; target_role text;
BEGIN
  PERFORM pg_advisory_xact_lock(76102622134917::bigint);
  IF EXISTS (SELECT 1 FROM public.admins WHERE id=p_actor_id) THEN actor_role := 'superadmin';
  ELSE
    SELECT role,department_id,campus_id INTO actor_role,actor_department,actor_campus
    FROM public.faculty WHERE id=p_actor_id FOR SHARE;
  END IF;
  IF actor_role IS NULL OR actor_role NOT IN ('superadmin','hod','campus_director') THEN
    RAISE EXCEPTION 'Teacher administration is not permitted for this account' USING ERRCODE='P4030';
  END IF;
  IF actor_role='hod' AND (actor_department IS NULL OR actor_campus IS NULL) THEN
    RAISE EXCEPTION 'HOD affiliation is required' USING ERRCODE='P4030';
  END IF;
  IF p_operation NOT IN ('assign','batch','reassign','remove','substitute') OR p_operation IS NULL THEN
    RAISE EXCEPTION 'Invalid teacher operation' USING ERRCODE='22023';
  END IF;
  IF p_operation <> 'substitute' AND actor_role='campus_director' THEN
    RAISE EXCEPTION 'Only HODs and superadmins manage course assignments' USING ERRCODE='P4030';
  END IF;

  IF p_operation='substitute' THEN
    SELECT * INTO entry FROM public.timetable_entries WHERE id=p_entry_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Timetable entry not found' USING ERRCODE='P4040'; END IF;
    host_campus := COALESCE(entry.campus_id,(SELECT campus_id FROM public.departments WHERE id=entry.department_id));
    IF actor_role='campus_director' AND (actor_campus IS NULL OR host_campus IS DISTINCT FROM actor_campus) THEN
      RAISE EXCEPTION 'Entry is outside your campus' USING ERRCODE='P4030';
    END IF;
    IF actor_role='hod' AND entry.department_id IS DISTINCT FROM actor_department THEN
      RAISE EXCEPTION 'Entry is outside your department' USING ERRCODE='P4030';
    END IF;
    IF host_campus IS NULL THEN RAISE EXCEPTION 'Entry has no host campus' USING ERRCODE='23514'; END IF;
    old_teacher := entry.teacher_id;
    -- The row trigger validates the target role and clashes in this transaction.
    UPDATE public.timetable_entries SET teacher_id=p_teacher_id WHERE id=entry.id;
    IF p_teacher_id IS NOT NULL THEN
      INSERT INTO public.teacher_course_assignments (teacher_id,course_id,campus_id,academic_year,semester,assigned_by)
      VALUES (p_teacher_id,entry.course_id,host_campus,entry.academic_year,entry.semester,p_actor_id)
      ON CONFLICT (teacher_id,course_id,campus_id,academic_year,semester)
      DO UPDATE SET assigned_by=EXCLUDED.assigned_by,assigned_at=now();
    END IF;
    IF old_teacher IS NOT NULL AND old_teacher IS DISTINCT FROM p_teacher_id AND NOT EXISTS (
      SELECT 1 FROM public.timetable_entries e WHERE e.teacher_id=old_teacher AND e.course_id=entry.course_id
        AND e.campus_id IS NOT DISTINCT FROM entry.campus_id AND e.academic_year=entry.academic_year AND e.semester=entry.semester
    ) THEN
      DELETE FROM public.teacher_course_assignments WHERE teacher_id=old_teacher AND course_id=entry.course_id
        AND campus_id=host_campus AND academic_year=entry.academic_year AND semester=entry.semester;
    END IF;
    RETURN jsonb_build_object('success',true,'entryId',entry.id,'teacherId',p_teacher_id);
  END IF;

  IF p_operation IN ('reassign','remove') THEN
    SELECT * INTO old_assignment FROM public.teacher_course_assignments WHERE id=p_assignment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found' USING ERRCODE='P4040'; END IF;
    SELECT * INTO course FROM public.courses WHERE id=old_assignment.course_id;
    IF actor_role='hod' AND course.department_id IS DISTINCT FROM actor_department THEN
      RAISE EXCEPTION 'Assignment is outside your department' USING ERRCODE='P4030';
    END IF;
    IF p_operation='remove' THEN
      -- Existing deletion trigger revokes timetable authority in the same transaction.
      DELETE FROM public.teacher_course_assignments WHERE id=old_assignment.id;
      RETURN jsonb_build_object('success',true);
    END IF;
    items := jsonb_build_array(jsonb_build_object('teacher_id',p_teacher_id,'course_id',old_assignment.course_id,
      'campus_id',old_assignment.campus_id,'academic_year',old_assignment.academic_year,'semester',old_assignment.semester));
  END IF;
  IF jsonb_typeof(items) IS DISTINCT FROM 'array' OR jsonb_array_length(items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Provide between 1 and 100 assignments' USING ERRCODE='22023';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
    SELECT * INTO course FROM public.courses WHERE id=(item->>'course_id')::uuid FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Course not found' USING ERRCODE='P4040'; END IF;
    IF actor_role='hod' AND course.department_id IS DISTINCT FROM actor_department THEN
      RAISE EXCEPTION 'Course is outside your department' USING ERRCODE='P4030';
    END IF;
    target_teacher := (item->>'teacher_id')::uuid;
    SELECT role INTO target_role FROM public.faculty WHERE id=target_teacher FOR SHARE;
    IF target_role IS DISTINCT FROM 'teacher' THEN
      RAISE EXCEPTION 'Only faculty with the teacher role can instruct courses' USING ERRCODE='23514';
    END IF;
    host_campus := COALESCE((item->>'campus_id')::uuid,actor_campus);
    term := COALESCE(NULLIF(btrim(item->>'academic_year'),''),(SELECT academic_year FROM public.campus_settings WHERE campus_id=host_campus));
    term_semester := COALESCE((item->>'semester')::integer,course.semester);
    IF host_campus IS NULL OR term IS NULL OR term_semester IS DISTINCT FROM course.semester THEN
      RAISE EXCEPTION 'A valid host campus, academic year and course semester are required' USING ERRCODE='23514';
    END IF;
    IF p_operation='reassign' THEN
      UPDATE public.teacher_course_assignments SET teacher_id=target_teacher,assigned_by=p_actor_id,assigned_at=now()
        WHERE id=old_assignment.id RETURNING * INTO saved;
    ELSE
      INSERT INTO public.teacher_course_assignments (teacher_id,course_id,campus_id,academic_year,semester,assigned_by)
      VALUES (target_teacher,course.id,host_campus,term,term_semester,p_actor_id)
      ON CONFLICT (teacher_id,course_id,campus_id,academic_year,semester)
      DO UPDATE SET assigned_by=EXCLUDED.assigned_by,assigned_at=now() RETURNING * INTO saved;
    END IF;
    UPDATE public.timetable_entries SET teacher_id=target_teacher
      WHERE course_id=course.id AND campus_id=host_campus AND academic_year=term
        AND semester=term_semester AND status='published';
    results := results || jsonb_build_array(to_jsonb(saved));
  END LOOP;
  RETURN jsonb_build_object('success',true,'assignment',results->0,'assignments',results,'count',jsonb_array_length(results));
END $$;

REVOKE ALL ON FUNCTION public.lock_teacher_schedule_writes(),public.validate_timetable_teacher(),
  public.mutate_teacher_assignments(uuid,text,jsonb,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lock_teacher_schedule_writes(),public.validate_timetable_teacher(),
  public.mutate_teacher_assignments(uuid,text,jsonb,uuid,uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.production_readiness()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object('ready',
    to_regprocedure('public.mutate_teacher_assignments(uuid,text,jsonb,uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.publish_timetable_cohort(uuid,text,integer)') IS NOT NULL
    AND to_regprocedure('public.atomic_replace_timetable_draft(uuid,text,integer,jsonb,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.update_timetable_worker(uuid,uuid,text,integer,text)') IS NOT NULL
    AND to_regprocedure('public.recover_expired_timetable_workers()') IS NOT NULL
    AND to_regprocedure('public.fail_allocation_worker(uuid,uuid,text)') IS NOT NULL
    AND to_regprocedure('public.claim_allocation_run(uuid,text,smallint,uuid,integer,uuid)') IS NOT NULL
    AND to_regprocedure('public.apply_course_allocation(uuid,uuid,text,smallint,jsonb,jsonb,jsonb,uuid)') IS NOT NULL
    AND to_regprocedure('public.claim_timetable_generation_job(uuid,text,smallint,uuid,integer,uuid)') IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='20261010100000_production_allocation_fencing_and_clocks')
    AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v')
        AND (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR (c.relkind IN ('r','p') AND NOT c.relrowsecurity)))
    AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind='f'
        AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))));
$function$;
REVOKE ALL ON FUNCTION public.production_readiness() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.production_readiness() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
