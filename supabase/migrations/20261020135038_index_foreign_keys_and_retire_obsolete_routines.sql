-- Add full FK lookup indexes on the small application tables, retaining useful partial indexes.
-- Retire obsolete, unreferenced interfaces; no table, column, or application row is dropped.
DO $retire$
DECLARE
  r record;
  relation_name text;
  signature text;
  before_rows jsonb := '{}'::jsonb;
  after_rows jsonb := '{}'::jsonb;
  fingerprint jsonb;
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  PERFORM set_config('search_path','pg_catalog, public, pg_temp',true);
  IF EXISTS (SELECT 1 FROM public.system_logs WHERE log_type IN ('allocation_run','timetable_job') AND status IN ('queued','running')) THEN
    RAISE EXCEPTION 'Wait for active allocation/timetable workers before retiring old interfaces';
  END IF;
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname
  LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',r.relname);
    EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''hash'',
      md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'''' ORDER BY md5(to_jsonb(t)::text)),''''))) FROM public.%I t',r.relname) INTO fingerprint;
    before_rows := before_rows || jsonb_build_object(r.relname,fingerprint);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.period_attendance_sessions'::regclass AND conname='period_attendance_sessions_marked_by_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK period_attendance_sessions_marked_by_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS period_attendance_sessions_marked_by_fk_idx ON public.period_attendance_sessions (marked_by);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.departments'::regclass AND conname='departments_campus_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK departments_campus_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS departments_campus_id_fk_idx ON public.departments (campus_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.faculty'::regclass AND conname='faculty_campus_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK faculty_campus_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS faculty_campus_id_fk_idx ON public.faculty (campus_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.retired_cohorts'::regclass AND conname='retired_cohorts_retired_by_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK retired_cohorts_retired_by_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS retired_cohorts_retired_by_fk_idx ON public.retired_cohorts (retired_by);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.graduation_operations'::regclass AND conname='graduation_operations_initiated_by_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK graduation_operations_initiated_by_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS graduation_operations_initiated_by_fk_idx ON public.graduation_operations (initiated_by);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.graduation_candidates'::regclass AND conname='graduation_candidates_operation_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK graduation_candidates_operation_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS graduation_candidates_operation_id_fk_idx ON public.graduation_candidates (operation_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.graduation_candidates'::regclass AND conname='graduation_candidates_campus_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK graduation_candidates_campus_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS graduation_candidates_campus_id_fk_idx ON public.graduation_candidates (campus_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.student_registrations'::regclass AND conname='student_registrations_slot_1_course_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK student_registrations_slot_1_course_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS student_registrations_slot_1_course_id_fk_idx ON public.student_registrations (slot_1_course_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.student_registrations'::regclass AND conname='student_registrations_slot_2_course_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK student_registrations_slot_2_course_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS student_registrations_slot_2_course_id_fk_idx ON public.student_registrations (slot_2_course_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.student_registrations'::regclass AND conname='student_registrations_slot_3_course_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK student_registrations_slot_3_course_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS student_registrations_slot_3_course_id_fk_idx ON public.student_registrations (slot_3_course_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.student_registrations'::regclass AND conname='student_registrations_slot_4_course_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK student_registrations_slot_4_course_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS student_registrations_slot_4_course_id_fk_idx ON public.student_registrations (slot_4_course_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.student_registrations'::regclass AND conname='student_registrations_slot_5_course_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK student_registrations_slot_5_course_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS student_registrations_slot_5_course_id_fk_idx ON public.student_registrations (slot_5_course_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.student_registrations'::regclass AND conname='student_registrations_slot_6_course_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK student_registrations_slot_6_course_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS student_registrations_slot_6_course_id_fk_idx ON public.student_registrations (slot_6_course_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.department_notices'::regclass AND conname='department_notices_department_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK department_notices_department_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS department_notices_department_id_fk_idx ON public.department_notices (department_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.department_notices'::regclass AND conname='department_notices_created_by_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK department_notices_created_by_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS department_notices_created_by_fk_idx ON public.department_notices (created_by);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.time_slots'::regclass AND conname='time_slots_lab_pair_with_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK time_slots_lab_pair_with_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS time_slots_lab_pair_with_fk_idx ON public.time_slots (lab_pair_with);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.timetable_entries'::regclass AND conname='timetable_entries_course_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK timetable_entries_course_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS timetable_entries_course_id_fk_idx ON public.timetable_entries (course_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.timetable_entries'::regclass AND conname='timetable_entries_department_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK timetable_entries_department_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS timetable_entries_department_id_fk_idx ON public.timetable_entries (department_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.timetable_entries'::regclass AND conname='timetable_entries_time_slot_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK timetable_entries_time_slot_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS timetable_entries_time_slot_id_fk_idx ON public.timetable_entries (time_slot_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.timetable_entries'::regclass AND conname='timetable_entries_generated_by_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK timetable_entries_generated_by_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS timetable_entries_generated_by_fk_idx ON public.timetable_entries (generated_by);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.timetable_conflicts'::regclass AND conname='timetable_conflicts_course_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK timetable_conflicts_course_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS timetable_conflicts_course_id_fk_idx ON public.timetable_conflicts (course_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.timetable_conflicts'::regclass AND conname='timetable_conflicts_blocking_course_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK timetable_conflicts_blocking_course_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS timetable_conflicts_blocking_course_id_fk_idx ON public.timetable_conflicts (blocking_course_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.period_attendance'::regclass AND conname='period_attendance_unlocked_by_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK period_attendance_unlocked_by_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS period_attendance_unlocked_by_fk_idx ON public.period_attendance (unlocked_by);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.period_unlock_requests'::regclass AND conname='period_unlock_requests_unlocked_by_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK period_unlock_requests_unlocked_by_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS period_unlock_requests_unlocked_by_fk_idx ON public.period_unlock_requests (unlocked_by);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.system_logs'::regclass AND conname='system_logs_campus_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK system_logs_campus_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS system_logs_campus_id_fk_idx ON public.system_logs (campus_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.student_registrations'::regclass AND conname='student_registrations_slot_7_course_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK student_registrations_slot_7_course_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS student_registrations_slot_7_course_id_fk_idx ON public.student_registrations (slot_7_course_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.student_registrations'::regclass AND conname='student_registrations_slot_8_course_id_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK student_registrations_slot_8_course_id_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS student_registrations_slot_8_course_id_fk_idx ON public.student_registrations (slot_8_course_id);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.period_attendance'::regclass AND conname='period_attendance_marked_by_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK period_attendance_marked_by_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS period_attendance_marked_by_fk_idx ON public.period_attendance (marked_by);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.teacher_course_assignments'::regclass AND conname='teacher_course_assignments_assigned_by_fkey' AND contype='f') THEN
    RAISE EXCEPTION 'Expected FK teacher_course_assignments_assigned_by_fkey is missing';
  END IF;
  CREATE INDEX IF NOT EXISTS teacher_course_assignments_assigned_by_fk_idx ON public.teacher_course_assignments (assigned_by);
  -- Each older overload has been replaced by the application's token-checked variant.
  -- RESTRICT prevents removing any routine that acquired a database dependency.
  DROP FUNCTION IF EXISTS public.apply_course_allocation(uuid,uuid,text,smallint,jsonb) RESTRICT;
  DROP FUNCTION IF EXISTS public.apply_course_allocation(uuid,uuid,text,smallint,jsonb,jsonb) RESTRICT;
  DROP FUNCTION IF EXISTS public.apply_course_allocation(uuid,uuid,text,smallint,jsonb,jsonb,jsonb) RESTRICT;
  DROP FUNCTION IF EXISTS public.claim_allocation_run(uuid,text,smallint,uuid,integer) RESTRICT;
  DROP FUNCTION IF EXISTS public.claim_timetable_generation_job(uuid,text,integer,uuid,jsonb,integer) RESTRICT;
  DROP FUNCTION IF EXISTS public.replace_timetable_draft(uuid,uuid,text,integer,jsonb,jsonb,jsonb) RESTRICT;
  DROP FUNCTION IF EXISTS public.heartbeat_timetable_generation_job(uuid) RESTRICT;
  DROP FUNCTION IF EXISTS public.promote_campus_students(uuid) RESTRICT;
  DROP FUNCTION IF EXISTS public.atomic_graduate_candidates_db(uuid,uuid[]) RESTRICT;
  DROP FUNCTION IF EXISTS public.set_marks_updated_at() RESTRICT;
  DROP FUNCTION IF EXISTS public.set_campus_sign_in_date() RESTRICT;
  DROP FUNCTION IF EXISTS public.trg_prevent_published_timetable_mutation() RESTRICT;
  DROP FUNCTION IF EXISTS public.trg_insert_timetable_generation_jobs() RESTRICT;
  DROP FUNCTION IF EXISTS public.trg_update_timetable_generation_jobs() RESTRICT;
  DROP FUNCTION IF EXISTS public.trg_insert_allocation_runs() RESTRICT;
  DROP FUNCTION IF EXISTS public.trg_update_allocation_runs() RESTRICT;
  DROP FUNCTION IF EXISTS public.trg_insert_audit_logs() RESTRICT;
  DROP VIEW IF EXISTS public.audit_logs_legacy RESTRICT;
  DROP VIEW IF EXISTS public.allocation_runs_legacy RESTRICT;
  DROP VIEW IF EXISTS public.timetable_generation_jobs_legacy RESTRICT;

  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''hash'',
      md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'''' ORDER BY md5(to_jsonb(t)::text)),''''))) FROM public.%I t',r.relname) INTO fingerprint;
    after_rows := after_rows || jsonb_build_object(r.relname,fingerprint);
  END LOOP;
  IF before_rows IS DISTINCT FROM after_rows THEN RAISE EXCEPTION 'Interface retirement changed application rows'; END IF;
  PERFORM pg_notify('pgrst','reload schema');
END
$retire$;

-- Readiness now also verifies access boundaries and current worker-token signatures.
CREATE OR REPLACE FUNCTION public.production_readiness()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $ready$
  SELECT jsonb_build_object('ready',
    to_regprocedure('public.publish_timetable_cohort(uuid,text,integer)') IS NOT NULL
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
$ready$;
REVOKE ALL ON FUNCTION public.production_readiness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_readiness() TO service_role;
