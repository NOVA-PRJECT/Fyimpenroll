-- User-confirmed catalogue correction: Semester 1 MDC = 3 theory hours, 0 practicals.
-- Apply manually in Supabase SQL Editor after reviewing the three course codes.
-- No migrations, registrations, credits, allocations or timetable entries are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.courses, public.system_logs, public.timetable_entries IN SHARE ROW EXCLUSIVE MODE;
DO $repair$
DECLARE
  target_codes text[] := ARRAY['KU01MDCCSE101','KU01MDCPSY101','KU01MDCSTA101'];
BEGIN
  IF (SELECT count(*) FROM public.courses WHERE course_code = ANY(target_codes)
      AND category = 'MDC' AND semester = 1) <> 3 THEN
    RAISE EXCEPTION 'Expected exactly the three Semester 1 MDC catalogue courses. No changes applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.courses WHERE course_code = ANY(target_codes)
      AND (theory_hours_per_week IS NULL OR practical_hours_per_week IS NULL
           OR (theory_hours_per_week, practical_hours_per_week) NOT IN ((2,2),(3,0)))) THEN
    RAISE EXCEPTION 'MDC hours differ from the reviewed 2+2 or already corrected 3+0 values. No changes applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_logs WHERE log_type IN ('allocation_run','timetable_job')
      AND status IN ('queued','running')) THEN
    RAISE EXCEPTION 'Allocation or timetable jobs are active. Complete or recover them before correcting hours.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.timetable_entries e JOIN public.courses c ON c.id=e.course_id
      WHERE c.course_code = ANY(target_codes) AND e.status='published') THEN
    RAISE EXCEPTION 'A target MDC course has published timetable entries. Review the published schedule before changing catalogue hours.';
  END IF;
  UPDATE public.courses SET theory_hours_per_week=3, practical_hours_per_week=0
    WHERE course_code = ANY(target_codes) AND category='MDC' AND semester=1
      AND (theory_hours_per_week, practical_hours_per_week) = (2,2);
END $repair$;
COMMIT;

SELECT course_code, theory_hours_per_week, practical_hours_per_week
FROM public.courses
WHERE course_code IN ('KU01MDCCSE101','KU01MDCPSY101','KU01MDCSTA101')
ORDER BY course_code;
