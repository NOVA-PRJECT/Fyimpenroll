BEGIN;
-- Aggregate at the database so a semester report need not load every daily mark.
CREATE OR REPLACE FUNCTION public.attendance_student_course_counts(
  p_student_ids uuid[], p_campus_id uuid, p_academic_year text, p_semester int
) RETURNS TABLE(student_id uuid, course_id uuid, conducted bigint, present bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.student_id, a.course_id,
    count(DISTINCT (a.timetable_slot_id,a.attendance_date)) FILTER (WHERE a.status IN ('present','absent')),
    count(DISTINCT (a.timetable_slot_id,a.attendance_date)) FILTER (WHERE a.status = 'present')
  FROM period_attendance a JOIN timetable_entries e ON e.id = a.timetable_slot_id
  WHERE a.student_id = ANY(p_student_ids) AND e.campus_id = p_campus_id
    AND e.academic_year = p_academic_year AND e.semester = p_semester AND e.status = 'published'
  GROUP BY a.student_id,a.course_id;
$$;
REVOKE ALL ON FUNCTION public.attendance_student_course_counts(uuid[],uuid,text,int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_student_course_counts(uuid[],uuid,text,int) TO service_role;

CREATE OR REPLACE FUNCTION public.production_readiness()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('ready',
    to_regprocedure('public.publish_timetable_cohort(uuid,text,integer)') IS NOT NULL
    AND to_regprocedure('public.atomic_replace_timetable_draft(uuid,text,integer,jsonb,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.update_timetable_worker(uuid,uuid,text,integer,text)') IS NOT NULL
    AND to_regprocedure('public.recover_expired_timetable_workers()') IS NOT NULL
    AND NOT has_table_privilege('authenticated','public.period_attendance_sessions','SELECT')
    AND NOT has_function_privilege('authenticated','public.publish_timetable_cohort(uuid,text,integer)','EXECUTE'));
$$;
REVOKE ALL ON FUNCTION public.production_readiness() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.production_readiness() TO service_role;
INSERT INTO schema_migrations(version,name) VALUES ('20261010090000_production_attendance_summary','Production attendance aggregation and readiness') ON CONFLICT(version) DO NOTHING;

COMMIT;
