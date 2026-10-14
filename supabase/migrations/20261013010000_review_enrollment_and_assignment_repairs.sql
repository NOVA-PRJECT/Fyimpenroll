BEGIN;

-- Preserve subsequent locking, clock and security repairs to these functions.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.execute_manual_course_allocation(uuid,uuid,smallint,text,text,uuid,uuid,text,text)'::regprocedure) INTO definition;
  IF position('v_reg RECORD;' IN definition) > 0 THEN
    EXECUTE replace(definition, 'v_reg RECORD;', 'v_reg public.student_registrations%ROWTYPE;');
  ELSIF position('v_reg public.student_registrations%ROWTYPE;' IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected manual allocation function definition';
  END IF;

  SELECT pg_get_functiondef('public.submit_student_registration(uuid,uuid,smallint,text,text,jsonb,jsonb,jsonb,numeric,timestamptz)'::regprocedure) INTO definition;
  IF position('IF NOT v_already_enrolled THEN' IN definition) > 0 THEN
    EXECUTE replace(definition, 'IF NOT v_already_enrolled THEN', 'IF v_already_enrolled IS NOT TRUE THEN');
  ELSIF position('IF v_already_enrolled IS NOT TRUE THEN' IN definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected registration function definition';
  END IF;
END $$;

-- A deleted assignment must revoke direct timetable authority in the same
-- transaction, without deleting timetable identities or attendance history.
CREATE OR REPLACE FUNCTION public.revoke_deleted_assignment_authority()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.timetable_entries e SET teacher_id = NULL
  WHERE e.teacher_id = OLD.teacher_id AND e.course_id = OLD.course_id
    AND (OLD.academic_year IS NULL OR e.academic_year = OLD.academic_year)
    AND (OLD.semester IS NULL OR e.semester = OLD.semester)
    AND (OLD.campus_id IS NULL OR COALESCE(e.campus_id,
      (SELECT d.campus_id FROM public.departments d WHERE d.id = e.department_id)) = OLD.campus_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.teacher_course_assignments a
      WHERE a.teacher_id = e.teacher_id AND a.course_id = e.course_id
        AND (a.academic_year IS NULL OR a.academic_year = e.academic_year)
        AND (a.semester IS NULL OR a.semester = e.semester)
        AND (a.campus_id IS NULL OR a.campus_id = COALESCE(e.campus_id,
          (SELECT d.campus_id FROM public.departments d WHERE d.id = e.department_id)))
    );
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.revoke_deleted_assignment_authority() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS revoke_deleted_assignment_authority ON public.teacher_course_assignments;
CREATE TRIGGER revoke_deleted_assignment_authority AFTER DELETE ON public.teacher_course_assignments
FOR EACH ROW EXECUTE FUNCTION public.revoke_deleted_assignment_authority();

-- Aggregate globally in PostgreSQL: PostgREST row limits must not affect seats.
CREATE OR REPLACE FUNCTION public.course_enrollment_counts(p_course_ids uuid[], p_academic_year text, p_semester integer)
RETURNS TABLE(course_id uuid, enrolled bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.id, count(r.id)
  FROM public.courses c LEFT JOIN public.student_registrations r
    ON r.academic_year = p_academic_year AND r.semester = p_semester
    AND c.id = ANY(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,
      r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id])
  WHERE c.id = ANY(p_course_ids) GROUP BY c.id;
$$;
REVOKE ALL ON FUNCTION public.course_enrollment_counts(uuid[],text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.course_enrollment_counts(uuid[],text,integer) TO service_role;
INSERT INTO public.schema_migrations(version,name)
VALUES ('20261013010000_review_enrollment_and_assignment_repairs','Review: atomic enrollment and assignment authority')
ON CONFLICT(version) DO NOTHING;
COMMIT;
