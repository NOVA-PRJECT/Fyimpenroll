-- Owner-run, additive functions only. Do not rerun semester_lifecycle.sql.
BEGIN;
CREATE OR REPLACE FUNCTION public.display_enrollment_counts(p_deliveries jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF jsonb_typeof(p_deliveries)<>'array' OR jsonb_array_length(p_deliveries)>200 THEN RAISE EXCEPTION 'Provide at most 200 delivery keys'; END IF;
 WITH deliveries AS (
  SELECT * FROM jsonb_to_recordset(p_deliveries) AS d(key text,course_id uuid,campus_id uuid,academic_year text,semester integer,term_version integer)
 ), totals AS (
  SELECT d.key,count(DISTINCT r.id) AS enrolled FROM deliveries d
  LEFT JOIN public.current_student_registrations r ON r.academic_year=d.academic_year AND r.semester=d.semester
   AND (d.campus_id IS NULL OR r.campus_id=d.campus_id)
   AND (d.term_version IS NULL OR r.term_version=d.term_version)
   AND d.course_id=ANY(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,
     r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id])
  GROUP BY d.key
 ) SELECT coalesce(jsonb_object_agg(key,enrolled),'{}'::jsonb) INTO result FROM totals;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.display_period_status(p_slots jsonb,p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF jsonb_typeof(p_slots)<>'array' OR jsonb_array_length(p_slots)>200 THEN RAISE EXCEPTION 'Provide at most 200 slots'; END IF;
 WITH slots AS (
  SELECT * FROM jsonb_to_recordset(p_slots) AS d(id uuid,course_id uuid,campus_id uuid,academic_year text,semester integer)
 ), deliveries AS (SELECT DISTINCT course_id,campus_id,academic_year,semester FROM slots), rosters AS (
  SELECT d.course_id,d.campus_id,d.academic_year,d.semester,count(DISTINCT s.id) AS total
  FROM deliveries d LEFT JOIN public.current_student_registrations r ON r.campus_id=d.campus_id
   AND r.academic_year=d.academic_year AND r.semester=d.semester
   AND d.course_id=ANY(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,
      r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id])
  LEFT JOIN public.students s ON s.id=r.student_id AND s.campus_id=d.campus_id
  GROUP BY d.course_id,d.campus_id,d.academic_year,d.semester
 ), marks AS (
  SELECT a.timetable_slot_id,count(*) FILTER(WHERE a.status='present') AS present,
   count(*) FILTER(WHERE a.status='absent') AS absent,count(*) AS total,max(a.marked_at) AS marked_at
  FROM public.period_attendance a JOIN slots d ON d.id=a.timetable_slot_id
  WHERE a.attendance_date=p_date GROUP BY a.timetable_slot_id
 ) SELECT coalesce(jsonb_object_agg(d.id,jsonb_build_object('total_enrolled',coalesce(r.total,0),
    'present',coalesce(m.present,0),'absent',coalesce(m.absent,0),'is_marked',coalesce(m.total,0)>0,
    'marked_at',m.marked_at,'revision',coalesce(s.revision,CASE WHEN coalesce(m.total,0)>0 THEN 1 ELSE 0 END),
    'revision_token',coalesce(s.revision_token,CASE WHEN coalesce(m.total,0)>0 THEN '1' ELSE '0' END))), '{}') INTO result
 FROM slots d LEFT JOIN rosters r USING(course_id,campus_id,academic_year,semester)
 LEFT JOIN marks m ON m.timetable_slot_id=d.id
 LEFT JOIN public.period_attendance_sessions s ON s.timetable_slot_id=d.id AND s.attendance_date=p_date;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.display_enrollment_counts(jsonb),public.display_period_status(jsonb,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.display_enrollment_counts(jsonb),public.display_period_status(jsonb,date) TO service_role;
COMMIT;
