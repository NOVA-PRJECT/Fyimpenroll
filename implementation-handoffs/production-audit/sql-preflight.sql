-- Apply to staging first. This bundle contains no credentials or test records.
-- Requires the existing follow-up 03/06/07 schema and enrollment/allocation RPCs.
-- Only missing public migration receipts are applied; any error rolls back ALL
-- pending repairs in this run. Do not use the historical master upsert script.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(hashtext('fyimp:web-production-repairs'));
DO $preflight$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['public.schema_migrations','public.students','public.campuses','public.campus_settings',
   'public.courses','public.student_registrations','public.system_logs','public.period_attendance_sessions','public.retired_cohorts'] LOOP
  IF to_regclass(name) IS NULL THEN RAISE EXCEPTION 'Missing schema prerequisite: %',name; END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY[
 'public.claim_allocation_run(uuid,text,smallint,uuid,integer,uuid)',
 'public.apply_course_allocation(uuid,uuid,text,smallint,jsonb,jsonb,jsonb,uuid)',
 'public.submit_student_registration(uuid,uuid,smallint,text,text,jsonb,jsonb,jsonb,numeric,timestamptz)',
 'public.execute_student_course_change(uuid,uuid,smallint,text,text,uuid,text)',
 'public.execute_manual_course_allocation(uuid,uuid,smallint,text,text,uuid,uuid,text,text)',
 'public.cleanup_concluded_semester_attendance(uuid,text,smallint)',
 'public.promote_campus_students_atomic(uuid,uuid,text)'] LOOP
  IF to_regprocedure(name) IS NULL THEN RAISE EXCEPTION 'Missing function prerequisite: %',name; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.system_logs WHERE log_type IN ('allocation_run','timetable_job') AND status IN ('queued','running')) THEN
  RAISE EXCEPTION 'Allocation or timetable jobs are active. Complete or recover them before applying these repairs.';
 END IF;
END $preflight$;
