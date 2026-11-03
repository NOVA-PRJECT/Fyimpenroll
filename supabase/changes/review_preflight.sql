-- Read-only. Review these results before applying the review releases.
SELECT id,full_name,campus_id FROM public.faculty WHERE role='teacher' AND department_id IS NULL;
SELECT * FROM public.period_attendance_sessions
 WHERE total_students<0 OR present_count<0 OR absent_count<0 OR present_count+absent_count<>total_students;
SELECT s.timetable_slot_id,s.attendance_date,s.total_students,count(p.student_id) persisted_marks,
 count(p.student_id) FILTER(WHERE p.status='present') persisted_present,
 count(p.student_id) FILTER(WHERE p.status='absent') persisted_absent
 FROM public.period_attendance_sessions s LEFT JOIN public.period_attendance p USING(timetable_slot_id,attendance_date)
 GROUP BY s.timetable_slot_id,s.attendance_date,s.total_students,s.present_count,s.absent_count
 HAVING s.total_students<>count(p.student_id) OR s.present_count<>count(p.student_id) FILTER(WHERE p.status='present')
  OR s.absent_count<>count(p.student_id) FILTER(WHERE p.status='absent');

-- Run review_prerequisites.sql separately for the feature-to-file mapping.
-- Review compatibility is expected to be absent before the first review release.
SELECT signature,to_regprocedure(signature) IS NOT NULL installed FROM (VALUES
 ('public.timetable_manual_context(uuid,text,integer,uuid,integer)'),('public.display_enrollment_counts(jsonb)'),
 ('public.display_period_status(jsonb,date)'),('public.guard_enrollment_allocation_completion()')) prerequisites(signature);
