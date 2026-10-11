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

DO $apply$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='20261010040000_followup_plan08_recoverable_graduation_and_retention') THEN
  EXECUTE $migration_0$
-- =============================================================================
-- Migration: 20261010040000_followup_plan08_recoverable_graduation_and_retention.sql
-- Description: Follow-up Plan 08: Recoverable graduation and current-semester cleanup
-- Findings: R27 (High - graduation deletes Auth first which students_id_fkey forbids)
-- Target Schema: public
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Ensure students_id_fkey has ON DELETE CASCADE
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    -- Drop existing foreign key constraint if it exists without cascade
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'students' AND constraint_name = 'students_id_fkey'
    ) THEN
        ALTER TABLE students DROP CONSTRAINT students_id_fkey;
    END IF;

    -- Recreate constraint with ON DELETE CASCADE to allow Auth deletions to cascade cleanly
    ALTER TABLE students
        ADD CONSTRAINT students_id_fkey
        FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Graduation Operations & Recovery Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS graduation_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT UNIQUE NOT NULL,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    initiated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'partially_failed', 'failed')),
    total_candidates INTEGER NOT NULL DEFAULT 0,
    graduated_count INTEGER NOT NULL DEFAULT 0,
    db_deleted_count INTEGER NOT NULL DEFAULT 0,
    auth_deleted_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    candidate_student_ids UUID[] NOT NULL DEFAULT '{}',
    completed_student_ids UUID[] NOT NULL DEFAULT '{}',
    failed_student_ids UUID[] NOT NULL DEFAULT '{}',
    stage_details JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_grad_ops_campus ON graduation_operations(campus_id);
CREATE INDEX IF NOT EXISTS idx_grad_ops_status ON graduation_operations(status);
CREATE INDEX IF NOT EXISTS idx_grad_ops_idempotency ON graduation_operations(idempotency_key);

COMMENT ON TABLE graduation_operations IS 'Tracks recoverable graduation cleanup operations, immutable candidate sets, and staged DB/Auth progress.';

-- Enable RLS on graduation_operations
ALTER TABLE graduation_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Directors can read campus graduation operations" ON graduation_operations;
CREATE POLICY "Directors can read campus graduation operations"
    ON graduation_operations
    FOR SELECT
    TO authenticated
    USING (
        campus_id = (auth.jwt() -> 'app_metadata' ->> 'campus_id')::UUID
        OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'superadmin'
    );

DROP POLICY IF EXISTS "Service role manages graduation operations" ON graduation_operations;
CREATE POLICY "Service role manages graduation operations"
    ON graduation_operations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 3. Atomic Database Stage Graduation RPC (R27)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atomic_graduate_candidates_db(
    p_campus_id UUID,
    p_student_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_valid_ids UUID[];
    v_deleted_count INTEGER := 0;
BEGIN
    -- 1. Explicitly select candidates that belong to this campus AND are strictly semester 10
    SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
    INTO v_valid_ids
    FROM students
    WHERE campus_id = p_campus_id
      AND current_semester = 10
      AND id = ANY(p_student_ids);

    IF v_valid_ids IS NULL OR array_length(v_valid_ids, 1) IS NULL OR array_length(v_valid_ids, 1) = 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'deleted_count', 0,
            'deleted_student_ids', '[]'::jsonb
        );
    END IF;

    -- 2. Delete candidates from database. Dependent registrations, preferences,
    -- and marks cascade cleanly through foreign key CASCADE definitions.
    DELETE FROM students
    WHERE id = ANY(v_valid_ids);

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_count', v_deleted_count,
        'deleted_student_ids', to_jsonb(v_valid_ids)
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Follow-up Plan 01 Security Compliance: Grants and Revocations
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION atomic_graduate_candidates_db(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION atomic_graduate_candidates_db(UUID, UUID[]) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Record Migration
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES (
    '20261010040000_followup_plan08_recoverable_graduation_and_retention',
    'Plan 08: Recoverable graduation and current-semester cleanup'
)
ON CONFLICT (version) DO NOTHING;

$migration_0$;
 END IF;
END $apply$;

DO $apply$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='20261010050000_followup_plan08_durable_graduation_recovery') THEN
  EXECUTE $migration_1$
-- Forward repair for the initial Plan 08 draft. No live cleanup is performed.

REVOKE ALL ON FUNCTION public.atomic_graduate_candidates_db(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_concluded_semester_attendance(uuid, text, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_concluded_semester_attendance(uuid, text, smallint) TO service_role;
DROP POLICY IF EXISTS "Directors can read campus graduation operations" ON public.graduation_operations;
CREATE POLICY "Directors can read campus graduation operations" ON public.graduation_operations
FOR SELECT TO authenticated USING (
  auth.jwt()->'app_metadata'->>'role' = 'superadmin' OR
  (auth.jwt()->'app_metadata'->>'role' = 'campus_director' AND
   campus_id::text = auth.jwt()->'app_metadata'->>'campus_id')
);

CREATE TABLE public.graduation_candidates (
  operation_id uuid NOT NULL REFERENCES public.graduation_operations(id) ON DELETE CASCADE,
  student_id uuid PRIMARY KEY, -- deliberately no student/Auth FK: survives cleanup
  campus_id uuid NOT NULL REFERENCES public.campuses(id),
  stage text NOT NULL DEFAULT 'pending' CHECK (stage IN ('pending','database_deleted','completed')),
  last_error_stage text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.graduation_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.graduation_candidates FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.graduation_candidates TO service_role;

CREATE FUNCTION public.prepare_graduation(p_campus_id uuid, p_student_ids uuid[], p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_operation uuid; v_ids uuid[]; v_student record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('graduation:' || p_campus_id::text));
  SELECT array_agg(DISTINCT id ORDER BY id) INTO v_ids FROM unnest(p_student_ids) id;
  IF v_ids IS NULL THEN RETURN '[]'::jsonb; END IF;
  -- Reject the entire mixed/unknown candidate list before any deletion.
  FOR v_student IN SELECT id FROM unnest(v_ids) id LOOP
    IF EXISTS (SELECT 1 FROM graduation_candidates WHERE student_id = v_student.id AND campus_id <> p_campus_id) THEN
      RAISE EXCEPTION 'Invalid graduation candidate or campus' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM graduation_candidates WHERE student_id = v_student.id AND campus_id = p_campus_id)
       AND NOT EXISTS (SELECT 1 FROM students WHERE id = v_student.id AND campus_id = p_campus_id AND current_semester = 10) THEN
      RAISE EXCEPTION 'Invalid graduation candidate or campus' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_ids) id WHERE NOT EXISTS (SELECT 1 FROM graduation_candidates c WHERE c.student_id = id)) THEN
    RETURN (SELECT jsonb_agg(to_jsonb(c) ORDER BY student_id) FROM graduation_candidates c WHERE student_id = ANY(v_ids));
  END IF;
  IF EXISTS (SELECT 1 FROM graduation_candidates WHERE student_id = ANY(v_ids)) THEN
    RAISE EXCEPTION 'Retry recorded candidates separately from new candidates' USING ERRCODE = '22023';
  END IF;
  INSERT INTO graduation_operations (idempotency_key, campus_id, academic_year, initiated_by, candidate_student_ids, total_candidates)
  VALUES ('grad:' || p_campus_id::text || ':' || md5(v_ids::text), p_campus_id,
    COALESCE((SELECT academic_year FROM campus_settings WHERE campus_id = p_campus_id), 'unknown'),
    p_actor_id, v_ids, cardinality(v_ids))
  ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now() RETURNING id INTO v_operation;
  INSERT INTO graduation_candidates(operation_id, student_id, campus_id)
    SELECT v_operation, id, p_campus_id FROM unnest(v_ids) id ON CONFLICT (student_id) DO NOTHING;
  RETURN (SELECT jsonb_agg(to_jsonb(c) ORDER BY student_id) FROM graduation_candidates c WHERE student_id = ANY(v_ids));
END $$;

CREATE FUNCTION public.graduate_candidate_database(p_campus_id uuid, p_student_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_candidate graduation_candidates;
BEGIN
  SELECT * INTO STRICT v_candidate FROM graduation_candidates
    WHERE student_id = p_student_id AND campus_id = p_campus_id FOR UPDATE;
  IF v_candidate.stage <> 'pending' THEN RETURN; END IF;
  PERFORM 1 FROM students WHERE id = p_student_id AND campus_id = p_campus_id AND current_semester = 10 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Graduation candidate changed'; END IF;
  DELETE FROM students WHERE id = p_student_id;
  UPDATE graduation_candidates SET stage = 'database_deleted', last_error_stage = NULL, updated_at = now()
    WHERE student_id = p_student_id;
END $$;

CREATE FUNCTION public.finish_graduation_candidate(p_campus_id uuid, p_student_id uuid, p_error_stage text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE graduation_candidates SET stage = CASE WHEN p_error_stage IS NULL AND stage = 'database_deleted' THEN 'completed' ELSE stage END,
    last_error_stage = p_error_stage, updated_at = now()
    WHERE student_id = p_student_id AND campus_id = p_campus_id;
  UPDATE graduation_operations o SET
    graduated_count = (SELECT count(*) FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage = 'completed'),
    auth_deleted_count = (SELECT count(*) FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage = 'completed'),
    db_deleted_count = (SELECT count(*) FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage <> 'pending'),
    failed_count = (SELECT count(*) FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage <> 'completed'),
    completed_student_ids = ARRAY(SELECT student_id FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage = 'completed'),
    failed_student_ids = ARRAY(SELECT student_id FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage <> 'completed'),
    status = CASE WHEN EXISTS(SELECT 1 FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage <> 'completed') THEN 'partially_failed' ELSE 'completed' END,
    updated_at = now()
    WHERE o.id = (SELECT operation_id FROM graduation_candidates WHERE student_id = p_student_id);
END $$;
REVOKE ALL ON FUNCTION public.prepare_graduation(uuid, uuid[], uuid),
  public.graduate_candidate_database(uuid, uuid), public.finish_graduation_candidate(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_graduation(uuid, uuid[], uuid),
  public.graduate_candidate_database(uuid, uuid), public.finish_graduation_candidate(uuid, uuid, text) TO service_role;

-- Retain the existing promotion transaction/cooldown, but persist its result for retries.
CREATE TABLE public.promotion_receipts (
  campus_id uuid NOT NULL REFERENCES public.campuses(id), request_key text NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(campus_id, request_key)
);
ALTER TABLE public.promotion_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promotion_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.promotion_receipts TO service_role;
ALTER FUNCTION public.promote_campus_students_atomic(uuid,uuid,text) RENAME TO promote_campus_students_once;
REVOKE ALL ON FUNCTION public.promote_campus_students_once(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.promote_campus_students_atomic(p_campus_id uuid, p_director_id uuid, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF nullif(p_idempotency_key, '') IS NULL THEN RAISE EXCEPTION 'Request key required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('promotion:' || p_campus_id::text));
  SELECT result INTO v_result FROM promotion_receipts WHERE campus_id = p_campus_id AND request_key = p_idempotency_key;
  IF FOUND THEN RETURN v_result; END IF;
  v_result := promote_campus_students_once(p_campus_id, p_director_id, p_idempotency_key);
  INSERT INTO promotion_receipts VALUES (p_campus_id, p_idempotency_key, v_result, now());
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.promote_campus_students_atomic(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_campus_students_atomic(uuid,uuid,text) TO service_role;
INSERT INTO schema_migrations(version,name) VALUES ('20261010050000_followup_plan08_durable_graduation_recovery','Durable graduation and promotion retries') ON CONFLICT DO NOTHING;

$migration_1$;
 END IF;
END $apply$;

DO $apply$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='20261010060000_followup_plan09_registration_snapshots') THEN
  EXECUTE $migration_2$
-- All registration writers use flat slots. Preserve snapshots only for the same
-- slot/course; capture catalogue values only on a new enrollment, never backfill history.

CREATE OR REPLACE FUNCTION public.sync_registration_snapshots() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_slot int; v_course uuid; v_previous uuid; v_snapshot jsonb;
  v_old_selections jsonb := '[]'; v_selections jsonb := '[]';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_selections := CASE WHEN jsonb_typeof(OLD.selections) = 'array' THEN OLD.selections
      WHEN jsonb_typeof(OLD.selections->'courses') = 'array' THEN OLD.selections->'courses' ELSE '[]'::jsonb END;
  END IF;
  FOR v_slot IN 1..8 LOOP
    v_course := (to_jsonb(NEW)->>format('slot_%s_course_id',v_slot))::uuid;
    IF v_course IS NULL THEN CONTINUE; END IF;
    v_previous := CASE WHEN TG_OP = 'UPDATE' THEN (to_jsonb(OLD)->>format('slot_%s_course_id',v_slot))::uuid ELSE NULL END;
    v_snapshot := NULL;
    IF v_previous = v_course THEN
      SELECT item INTO v_snapshot FROM jsonb_array_elements(v_old_selections) item
        WHERE COALESCE(item->>'course_id',item->>'id') = v_course::text
        AND (item->>'slot' = v_slot::text OR item->>'slot' IS NULL) LIMIT 1;
    ELSE
      SELECT jsonb_build_object('credits',credits,'category',category,'academic_level',academic_level,'snapshotted_at',now())
        INTO v_snapshot FROM courses WHERE id = v_course;
    END IF;
    v_selections := v_selections || jsonb_build_array(COALESCE(v_snapshot,'{}'::jsonb) ||
      jsonb_build_object('course_id',v_course,'slot',v_slot));
  END LOOP;
  NEW.selections := v_selections;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS registration_snapshots ON public.student_registrations;
CREATE TRIGGER registration_snapshots BEFORE INSERT OR UPDATE ON public.student_registrations
FOR EACH ROW EXECUTE FUNCTION public.sync_registration_snapshots();
-- Reconcile stale selections; the trigger deliberately does not invent old credits.
UPDATE public.student_registrations SET selections = selections;
INSERT INTO schema_migrations(version,name) VALUES ('20261010060000_followup_plan09_registration_snapshots','Canonical enrollment and registration-time snapshots') ON CONFLICT DO NOTHING;

$migration_2$;
 END IF;
END $apply$;

DO $apply$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='20261010070000_followup_plan10_attendance_rpc_privileges') THEN
  EXECUTE $migration_3$
-- The attendance RPCs accept trusted actor/roster IDs. Resource authorization is
-- performed by the backend; browser-authenticated callers must not bypass it.

REVOKE ALL ON FUNCTION public.atomic_replace_timetable_draft(uuid,text,integer,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_replace_timetable_draft(uuid,text,integer,jsonb,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.atomic_submit_period_attendance(uuid,date,uuid,uuid[],uuid[],uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.atomic_copy_practical_attendance(uuid,uuid,date,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_submit_period_attendance(uuid,date,uuid,uuid[],uuid[],uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.atomic_copy_practical_attendance(uuid,uuid,date,uuid,integer) TO service_role;
INSERT INTO schema_migrations(version,name) VALUES ('20261010070000_followup_plan10_attendance_rpc_privileges','Restrict trusted attendance RPCs to backend callers') ON CONFLICT DO NOTHING;

$migration_3$;
 END IF;
END $apply$;

DO $apply$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='20261010080000_production_timetable_transactions') THEN
  EXECUTE $migration_4$

-- Production audit PA02/PA03: one cohort lock, fenced commit and atomic publication.
CREATE OR REPLACE FUNCTION claim_timetable_generation_job(
    p_campus_id UUID,
    p_academic_year TEXT,
    p_semester SMALLINT,
    p_user_id UUID,
    p_lease_seconds INT DEFAULT 600,
    p_fencing_token UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deadline TIMESTAMPTZ;
    v_published_count INT;
    v_active_job RECORD;
    v_job_id UUID;
    v_fencing_token UUID;
    v_meta JSONB;
BEGIN
    IF p_campus_id IS NULL THEN RAISE EXCEPTION 'An explicit campus is required'; END IF;
    IF p_semester NOT BETWEEN 1 AND 10 OR p_academic_year IS NULL OR btrim(p_academic_year) = ''
      OR p_lease_seconds NOT BETWEEN 60 AND 1800 THEN RAISE EXCEPTION 'Invalid cohort or worker lease'; END IF;
    -- R16: Acquire transactional advisory lock for timetable generation on this campus cohort
    PERFORM pg_advisory_xact_lock(
        hashtext('timetable:' || COALESCE(p_campus_id::text, 'all') || ':' || p_academic_year || ':' || p_semester::text)
    );

    -- A. Verify registration window is closed
    IF p_campus_id IS NOT NULL THEN
        SELECT deadline INTO v_deadline
        FROM campus_settings
        WHERE campus_id = p_campus_id;

        IF v_deadline IS NULL OR now() < v_deadline THEN
            RAISE EXCEPTION 'Registration window is still open. Timetable generation requires closed registration.';
        END IF;
    END IF;

    -- B. Verify published schedule does not already exist for THIS campus (R15)
    SELECT count(*) INTO v_published_count
    FROM timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND campus_id IS NOT DISTINCT FROM p_campus_id
      AND status = 'published';

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'A published timetable already exists for % Semester %. Published timetables are strictly immutable.',
            p_academic_year, p_semester;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM system_logs WHERE log_type = 'allocation_run' AND status = 'completed'
      AND campus_id = p_campus_id AND academic_year = p_academic_year AND semester = p_semester) THEN
      RAISE EXCEPTION 'A completed allocation is required before scheduling';
    END IF;

    -- C. Cleanup expired running jobs beyond lease window (R16 recovery)
    UPDATE system_logs
    SET status = 'failed',
        error_message = 'Previous worker lease expired due to inactivity or restart (F42/R16 recovery).',
        completed_at = now(),
        updated_at = now()
    WHERE log_type = 'timetable_job'
      AND campus_id IS NOT DISTINCT FROM p_campus_id
      AND academic_year = p_academic_year
      AND semester = p_semester
      AND status IN ('queued', 'running')
      AND updated_at <= now() - (COALESCE((metadata->>'lease_seconds')::int, 600) * interval '1 second');

    -- D. Check active running/queued job within lease window
    SELECT id, metadata, status INTO v_active_job
    FROM system_logs
    WHERE log_type = 'timetable_job'
      AND campus_id IS NOT DISTINCT FROM p_campus_id
      AND academic_year = p_academic_year
      AND semester = p_semester
      AND status IN ('queued', 'running')
    LIMIT 1;

    IF v_active_job.id IS NOT NULL THEN
        -- If caller supplies identical fencing token, return existing claim idempotently
        IF p_fencing_token IS NOT NULL AND (v_active_job.metadata->>'fencing_token')::UUID = p_fencing_token THEN
            RETURN jsonb_build_object(
                'success', true,
                'job_id', v_active_job.id,
                'fencing_token', p_fencing_token,
                'idempotent_replay', true
            );
        END IF;
        RAISE EXCEPTION 'A timetable generation job is currently running for this semester.';
    END IF;

    -- E. Generate fencing token and insert new running job claim atomically
    v_job_id := gen_random_uuid();
    v_fencing_token := COALESCE(p_fencing_token, gen_random_uuid());
    v_meta := jsonb_build_object(
        'fencing_token', v_fencing_token,
        'lease_seconds', COALESCE(p_lease_seconds, 600)
    );

    INSERT INTO system_logs (
        id,
        log_type,
        campus_id,
        academic_year,
        semester,
        status,
        user_id,
        metadata,
        started_at,
        created_at,
        updated_at
    )
    VALUES (
        v_job_id,
        'timetable_job',
        p_campus_id,
        p_academic_year,
        p_semester,
        'queued',
        p_user_id,
        v_meta,
        now(),
        now(),
        now()
    );

    RETURN jsonb_build_object(
        'success', true,
        'job_id', v_job_id,
        'fencing_token', v_fencing_token
    );
END;
$$;

DROP INDEX IF EXISTS public.uq_active_timetable_generation_job_cohort;
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_timetable_job_cohort
  ON public.system_logs(campus_id,academic_year,semester)
  WHERE log_type = 'timetable_job' AND status IN ('queued','running');

CREATE OR REPLACE FUNCTION public.recover_expired_timetable_workers()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v record; v_count int := 0; v_changed int;
BEGIN
  FOR v IN SELECT id,campus_id,academic_year,semester FROM system_logs WHERE log_type = 'timetable_job'
    AND status IN ('queued','running') AND updated_at <= now() - (COALESCE((metadata->>'lease_seconds')::int,600) * interval '1 second')
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('timetable:' || v.campus_id::text || ':' || v.academic_year || ':' || v.semester::text));
    UPDATE system_logs SET status = 'failed', error_message = 'Worker interrupted or lease expired. Retry generation with your browser rules.',
      completed_at = now(), updated_at = now()
    WHERE id = v.id AND status IN ('queued','running')
      AND updated_at <= now() - (COALESCE((metadata->>'lease_seconds')::int,600) * interval '1 second');
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    v_count := v_count + v_changed;
  END LOOP;
  RETURN v_count;
END; $$;
REVOKE ALL ON FUNCTION public.recover_expired_timetable_workers() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recover_expired_timetable_workers() TO service_role;


DROP FUNCTION IF EXISTS public.atomic_replace_timetable_draft(uuid,text,int,jsonb,uuid);
CREATE OR REPLACE FUNCTION atomic_replace_timetable_draft(
    p_campus_id UUID,
    p_academic_year TEXT,
    p_semester INT,
    p_entries JSONB,
    p_job_id UUID,
    p_fencing_token UUID
)
RETURNS JSONB AS $$
DECLARE
    v_published_count INT;
    v_inserted_count INT := 0;
    v_entry JSONB;
BEGIN
    -- Acquire transaction-level advisory lock on this cohort
    PERFORM pg_advisory_xact_lock(hashtext('timetable:' || COALESCE(p_campus_id::text, 'all') || ':' || p_academic_year || ':' || p_semester::text));

    -- Check if cohort is already published
    SELECT COUNT(*)
    INTO v_published_count
    FROM timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'published'
      AND (
          (p_campus_id IS NOT NULL AND campus_id = p_campus_id)
          OR (p_campus_id IS NULL AND campus_id IS NULL)
      );

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'Cannot replace draft: cohort % Sem % for campus % is already published (R22)',
            p_academic_year, p_semester, COALESCE(p_campus_id::text, 'all');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM system_logs WHERE id = p_job_id AND log_type = 'timetable_job'
        AND status = 'running' AND campus_id = p_campus_id
        AND academic_year = p_academic_year AND semester = p_semester
        AND metadata->>'fencing_token' = p_fencing_token::text
        AND updated_at > now() - (COALESCE((metadata->>'lease_seconds')::int,600) * interval '1 second')
        FOR UPDATE
    ) THEN RAISE EXCEPTION 'Missing, stale or expired worker claim'; END IF;
    IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 THEN
        RAISE EXCEPTION 'A complete nonempty draft is required';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_entries) e
        WHERE (e->>'campus_id')::uuid IS DISTINCT FROM p_campus_id
        OR e->>'academic_year' IS DISTINCT FROM p_academic_year
        OR (e->>'semester')::int IS DISTINCT FROM p_semester) THEN
        RAISE EXCEPTION 'Draft entries do not match the claimed cohort';
    END IF;

    -- Atomically delete all existing draft entries for this cohort
    DELETE FROM timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'draft'
      AND (
          (p_campus_id IS NOT NULL AND campus_id = p_campus_id)
          OR (p_campus_id IS NULL AND campus_id IS NULL)
      );

    -- Insert all new staged draft entries from JSONB array
    IF p_entries IS NOT NULL AND jsonb_array_length(p_entries) > 0 THEN
        INSERT INTO timetable_entries (
            academic_year,
            semester,
            course_id,
            department_id,
            campus_id,
            time_slot_id,
            session_type,
            is_lab_block,
            teacher_id,
            status
        )
        SELECT
            (e->>'academic_year')::text,
            (e->>'semester')::int,
            (e->>'course_id')::uuid,
            (e->>'department_id')::uuid,
            (CASE WHEN e->>'campus_id' IS NOT NULL THEN (e->>'campus_id')::uuid ELSE NULL END),
            (e->>'time_slot_id')::uuid,
            (e->>'session_type')::text,
            COALESCE((e->>'is_lab_block')::boolean, false),
            (CASE WHEN e->>'teacher_id' IS NOT NULL THEN (e->>'teacher_id')::uuid ELSE NULL END),
            'draft'
        FROM jsonb_array_elements(p_entries) AS e;

        GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    END IF;

    UPDATE system_logs SET status = 'completed', progress = 100, completed_at = now(), updated_at = now(),
        metadata = metadata || jsonb_build_object('draft_hash', (
            SELECT md5(string_agg(e::text, ',' ORDER BY e.id)) FROM timetable_entries e
            WHERE e.campus_id = p_campus_id AND e.academic_year = p_academic_year
            AND e.semester = p_semester AND e.status = 'draft'
        )) WHERE id = p_job_id;
    RETURN jsonb_build_object(
        'success', true,
        'inserted_count', v_inserted_count,
        'academic_year', p_academic_year,
        'semester', p_semester,
        'campus_id', p_campus_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.update_timetable_worker(p_job_id uuid, p_fencing_token uuid, p_status text, p_progress int, p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_job system_logs%ROWTYPE;
BEGIN
    SELECT * INTO v_job FROM system_logs WHERE id = p_job_id AND log_type = 'timetable_job';
    IF NOT FOUND THEN RAISE EXCEPTION 'Missing worker claim'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('timetable:' || v_job.campus_id::text || ':' || v_job.academic_year || ':' || v_job.semester::text));
    IF p_status NOT IN ('running','failed') THEN RAISE EXCEPTION 'Invalid worker transition'; END IF;
    UPDATE system_logs SET status = p_status, progress = p_progress, error_message = p_error,
        updated_at = now(), completed_at = CASE WHEN p_status = 'failed' THEN now() ELSE NULL END
    WHERE id = p_job_id AND status IN ('queued','running')
        AND metadata->>'fencing_token' = p_fencing_token::text
        AND updated_at > now() - (COALESCE((metadata->>'lease_seconds')::int,600) * interval '1 second');
    IF NOT FOUND THEN RAISE EXCEPTION 'Stale or expired worker claim'; END IF;
    RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.publish_timetable_cohort(p_campus_id uuid, p_academic_year text, p_semester int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_hash text; v_expected text; v_count int; v_at timestamptz := now();
BEGIN
    IF p_campus_id IS NULL THEN RAISE EXCEPTION 'An explicit campus is required'; END IF;
    -- All publishers share this lock so visiting teachers cannot be published twice at the same time.
    PERFORM pg_advisory_xact_lock(hashtext('timetable:published-teacher-occupancy'));
    PERFORM pg_advisory_xact_lock(hashtext('timetable:' || p_campus_id::text || ':' || p_academic_year || ':' || p_semester::text));
    IF EXISTS (SELECT 1 FROM system_logs WHERE log_type = 'timetable_job' AND campus_id = p_campus_id
        AND academic_year = p_academic_year AND semester = p_semester AND status IN ('queued','running')) THEN
        RAISE EXCEPTION 'Cannot publish while generation is active; retry generation to recover an expired claim';
    END IF;
    IF EXISTS (SELECT 1 FROM timetable_entries WHERE campus_id = p_campus_id AND academic_year = p_academic_year
        AND semester = p_semester AND status = 'published') THEN RAISE EXCEPTION 'Cohort is already published'; END IF;
    IF EXISTS (SELECT 1 FROM timetable_conflicts c LEFT JOIN courses co ON co.id = c.course_id
        LEFT JOIN departments d ON d.id = co.department_id
        WHERE c.academic_year = p_academic_year AND c.semester = p_semester AND NOT c.resolved
        AND (d.campus_id = p_campus_id OR d.campus_id IS NULL)) THEN
        RAISE EXCEPTION 'Cannot publish with unresolved conflicts';
    END IF;
    -- Lock exactly the rows whose validated fingerprint is being published.
    PERFORM id FROM timetable_entries WHERE campus_id = p_campus_id AND academic_year = p_academic_year
        AND semester = p_semester AND status = 'draft' FOR UPDATE;
    SELECT md5(string_agg(e::text, ',' ORDER BY e.id)) INTO v_hash FROM timetable_entries e
        WHERE e.campus_id = p_campus_id AND e.academic_year = p_academic_year AND e.semester = p_semester AND e.status = 'draft';
    SELECT metadata->>'draft_hash' INTO v_expected FROM system_logs WHERE log_type = 'timetable_job'
        AND campus_id = p_campus_id AND academic_year = p_academic_year AND semester = p_semester
        AND status = 'completed' ORDER BY completed_at DESC LIMIT 1;
    IF v_hash IS NULL OR v_hash IS DISTINCT FROM v_expected THEN
        RAISE EXCEPTION 'No verified current draft; generate again before publication';
    END IF;
    IF EXISTS (
        SELECT 1 FROM timetable_entries draft JOIN timetable_entries occupied
          ON occupied.teacher_id = draft.teacher_id AND occupied.time_slot_id = draft.time_slot_id
          AND occupied.academic_year = draft.academic_year AND occupied.status = 'published'
        WHERE draft.campus_id = p_campus_id AND draft.academic_year = p_academic_year
          AND draft.semester = p_semester AND draft.status = 'draft' AND draft.teacher_id IS NOT NULL
    ) THEN RAISE EXCEPTION 'Assigned teacher is already occupied in a published class'; END IF;
    UPDATE timetable_entries SET status = 'published', published_at = v_at WHERE campus_id = p_campus_id
        AND academic_year = p_academic_year AND semester = p_semester AND status = 'draft';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('success',true,'published_count',v_count,'published_at',v_at);
END; $$;

REVOKE ALL ON FUNCTION public.claim_timetable_generation_job(uuid,text,smallint,uuid,int,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_timetable_generation_job(uuid,text,smallint,uuid,int,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.atomic_replace_timetable_draft(uuid,text,int,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_timetable_worker(uuid,uuid,text,int,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.publish_timetable_cohort(uuid,text,int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_replace_timetable_draft(uuid,text,int,jsonb,uuid,uuid),
    public.update_timetable_worker(uuid,uuid,text,int,text), public.publish_timetable_cohort(uuid,text,int) TO service_role;

-- All consumers of these operational tables use the scoped backend APIs.
REVOKE ALL ON public.period_attendance_sessions, public.retired_cohorts FROM anon, authenticated;
DROP POLICY IF EXISTS "Authenticated users can view period attendance sessions" ON public.period_attendance_sessions;
DROP POLICY IF EXISTS "Authenticated users can view retired cohorts" ON public.retired_cohorts;

-- Remove only non-constraint indexes that duplicate the named UNIQUE constraint.
DO $$ DECLARE v record; BEGIN
  FOR v IN SELECT extra.indexrelid::regclass AS name FROM pg_index extra
    JOIN pg_index required ON required.indrelid = extra.indrelid AND required.indkey = extra.indkey
      AND required.indclass = extra.indclass AND required.indcollation = extra.indcollation
    JOIN pg_constraint c ON c.conindid = required.indexrelid
    WHERE extra.indexrelid IN (to_regclass('public.idx_period_attendance_sessions_slot_date'),to_regclass('public.idx_retired_cohorts_lookup'))
      AND c.conname IN ('uq_period_attendance_sessions','uq_retired_cohorts')
      AND extra.indpred IS NULL AND extra.indexprs IS NULL AND NOT extra.indisunique
  LOOP EXECUTE format('DROP INDEX %s', v.name); END LOOP;
END; $$;


INSERT INTO schema_migrations(version,name) VALUES ('20261010080000_production_timetable_transactions','Production fenced timetable transactions and attendance ACLs') ON CONFLICT(version) DO NOTHING;

$migration_4$;
 END IF;
END $apply$;

DO $apply$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='20261010090000_production_attendance_summary') THEN
  EXECUTE $migration_5$

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


$migration_5$;
 END IF;
END $apply$;

DO $apply$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='20261010100000_production_allocation_fencing_and_clocks') THEN
  EXECUTE $migration_6$

-- Correct instant comparisons while retaining the existing enrollment/replay contracts.
DO $clock$ DECLARE signature text; definition text; BEGIN
 FOREACH signature IN ARRAY ARRAY[
 'public.submit_student_registration(uuid,uuid,smallint,text,text,jsonb,jsonb,jsonb,numeric,timestamptz)',
 'public.execute_manual_course_allocation(uuid,uuid,smallint,text,text,uuid,uuid,text,text)',
 'public.promote_campus_students_once(uuid,uuid,text)'] LOOP
  IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'Missing prerequisite function: %',signature; END IF;
  definition:=pg_get_functiondef(to_regprocedure(signature));
  definition:=replace(definition,'timezone(''utc''::text, now())','now()');
  EXECUTE definition;
 END LOOP;
END $clock$;

CREATE OR REPLACE FUNCTION claim_allocation_run(
    p_campus_id UUID,
    p_academic_year TEXT,
    p_semester SMALLINT,
    p_user_id UUID,
    p_lease_seconds INT DEFAULT 300,
    p_fencing_token UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deadline TIMESTAMPTZ;
    v_published_count INT;
    v_completed_run_id UUID;
    v_active_run RECORD;
    v_run_id UUID;
    v_fencing_token UUID;
    v_meta JSONB;
BEGIN
    IF p_campus_id IS NULL OR p_academic_year IS NULL OR btrim(p_academic_year) = '' OR p_semester IS NULL OR p_semester NOT BETWEEN 1 AND 10
       OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 60 AND 1800 THEN RAISE EXCEPTION 'Invalid allocation cohort or lease'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('timetable:' || p_campus_id::text || ':' || p_academic_year || ':' || p_semester::text));
    -- R16: Acquire transactional advisory lock for this campus cohort
    PERFORM pg_advisory_xact_lock(
        hashtext('allocation_claim_' || p_campus_id::text || '_' || p_academic_year || '_' || p_semester::text)
    );

    -- A. Verify registration window is closed for this campus
    SELECT deadline INTO v_deadline
    FROM campus_settings
    WHERE campus_id = p_campus_id;

    IF v_deadline IS NULL OR now() < v_deadline THEN
        RAISE EXCEPTION 'Registration window is still open for this campus. Allocation can only be run after registration closes.';
    END IF;

    -- B. Verify cohort timetable is unpublished for THIS host campus (R15)
    SELECT count(*) INTO v_published_count
    FROM timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND campus_id = p_campus_id
      AND status = 'published';

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'Timetable has already been published for this cohort. Allocation is locked.';
    END IF;

    -- C. Verify allocation has not already been completed for this cohort
    SELECT id INTO v_completed_run_id
    FROM system_logs
    WHERE log_type = 'allocation_run'
      AND campus_id = p_campus_id
      AND academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'completed'
    LIMIT 1;

    IF v_completed_run_id IS NOT NULL THEN
        RAISE EXCEPTION 'Allocation has already been completed for Semester % (%). In production, allocation can only be executed once per semester per academic year.',
            p_semester, p_academic_year;
    END IF;

    -- D. Cleanup expired running claims beyond lease window (R16 recovery)
    UPDATE system_logs
    SET status = 'failed',
        error_message = 'Allocation run abandoned or lease expired',
        updated_at = now()
    WHERE log_type = 'allocation_run'
      AND campus_id = p_campus_id
      AND academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'running'
      AND started_at <= now() - (COALESCE((metadata->>'lease_seconds')::int, 300) || ' seconds')::interval;

    -- E. Check active running claim within lease window (R16)
    SELECT id, metadata INTO v_active_run
    FROM system_logs
    WHERE log_type = 'allocation_run'
      AND campus_id = p_campus_id
      AND academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'running'
    LIMIT 1;

    IF v_active_run.id IS NOT NULL THEN
        -- If caller supplies identical fencing token, return existing claim idempotently
        IF p_fencing_token IS NOT NULL AND (v_active_run.metadata->>'fencing_token')::UUID = p_fencing_token THEN
            RETURN v_active_run.id;
        END IF;
        RAISE EXCEPTION 'An allocation run is already in progress for this academic year and semester.';
    END IF;

    -- F. Generate fencing token and insert new running claim atomically
    v_run_id := gen_random_uuid();
    v_fencing_token := COALESCE(p_fencing_token, gen_random_uuid());
    v_meta := jsonb_build_object(
        'fencing_token', v_fencing_token,
        'lease_seconds', COALESCE(p_lease_seconds, 300)
    );

    INSERT INTO system_logs (
        id,
        log_type,
        campus_id,
        academic_year,
        semester,
        status,
        user_id,
        metadata,
        started_at,
        created_at,
        updated_at
    )
    VALUES (
        v_run_id,
        'allocation_run',
        p_campus_id,
        p_academic_year,
        p_semester,
        'running',
        p_user_id,
        v_meta,
        now(),
        now(),
        now()
    );

    RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION apply_course_allocation(
    p_run_id UUID,
    p_campus_id UUID,
    p_academic_year TEXT,
    p_semester SMALLINT,
    p_allocations JSONB,
    p_unallocated JSONB DEFAULT '[]'::jsonb,
    p_summary JSONB DEFAULT '{}'::jsonb,
    p_fencing_token UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    item RECORD;
    v_run_rec RECORD;
    v_published_count INT;
    v_student_id UUID;
    v_reg_id UUID;
    v_slot_key TEXT;
    v_course_id UUID;
    v_meta JSONB;
    v_sql TEXT;
    v_course_rec RECORD;
    v_existing_count INT;
    v_active_token UUID;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('timetable:' || p_campus_id::text || ':' || p_academic_year || ':' || p_semester::text));
    PERFORM pg_advisory_xact_lock(hashtext('allocation_claim_' || p_campus_id::text || '_' || p_academic_year || '_' || p_semester::text));
    IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR p_unallocated IS NULL OR jsonb_typeof(p_unallocated) <> 'array'
      OR p_summary IS NULL OR jsonb_typeof(p_summary) <> 'object' THEN RAISE EXCEPTION 'Invalid allocation payload'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) a GROUP BY a->>'student_id',a->>'slot_key' HAVING count(*)>1) THEN
      RAISE EXCEPTION 'Duplicate allocation for a student slot'; END IF;
    -- 1. Validate run exists, matches cohort, and is running
    SELECT * INTO v_run_rec
    FROM system_logs
    WHERE id = p_run_id
      AND log_type = 'allocation_run'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Allocation run record % not found', p_run_id;
    END IF;

    IF v_run_rec.campus_id IS DISTINCT FROM p_campus_id OR
       v_run_rec.academic_year IS DISTINCT FROM p_academic_year OR
       v_run_rec.semester IS DISTINCT FROM p_semester THEN
        RAISE EXCEPTION 'Allocation run % does not match cohort (% / % / %)',
            p_run_id, p_campus_id, p_academic_year, p_semester;
    END IF;

    IF v_run_rec.status <> 'running' THEN
        RAISE EXCEPTION 'Allocation run % is not currently running (status: %)', p_run_id, v_run_rec.status;
    END IF;

    v_active_token := (v_run_rec.metadata->>'fencing_token')::uuid;
    IF p_fencing_token IS NULL OR v_active_token IS DISTINCT FROM p_fencing_token
       OR v_run_rec.started_at IS NULL OR v_run_rec.started_at <= now() - (COALESCE((v_run_rec.metadata->>'lease_seconds')::int,300) * interval '1 second') THEN
      RAISE EXCEPTION 'Missing, stale or expired allocation worker claim';
    END IF;

    -- 2. Verify cohort timetable is unpublished for THIS host campus (R15)
    SELECT count(*) INTO v_published_count
    FROM timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND campus_id = p_campus_id
      AND status = 'published';

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'Timetable has already been published for this cohort. Allocation commit is locked.';
    END IF;

    -- 3. Validate slot keys and student campus membership
    FOR item IN SELECT value FROM jsonb_array_elements(p_allocations)
    LOOP
        v_slot_key := item.value->>'slot_key';
        IF v_slot_key IS NULL OR v_slot_key NOT IN ('slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8') THEN
            RAISE EXCEPTION 'Invalid slot_key: % in allocations', v_slot_key;
        END IF;

        v_course_id := (item.value->>'course_id')::UUID;
        IF v_course_id IS NULL OR NOT EXISTS (SELECT 1 FROM courses WHERE id = v_course_id) THEN
            RAISE EXCEPTION 'Allocation must reference an existing course';
        END IF;

        v_student_id := (item.value->>'student_id')::UUID;
        IF NOT EXISTS (
            SELECT 1 FROM student_registrations
            WHERE student_id = v_student_id AND campus_id = p_campus_id AND academic_year = p_academic_year AND semester = p_semester
        ) THEN
            RAISE EXCEPTION 'Student % does not belong to campus %', v_student_id, p_campus_id;
        END IF;
    END LOOP;

    -- 4. Deterministically lock all courses involved in this allocation
    PERFORM id FROM courses
    WHERE id IN (
        SELECT DISTINCT (value->>'course_id')::UUID
        FROM jsonb_array_elements(p_allocations)
        WHERE (value->>'course_id') IS NOT NULL
    )
    ORDER BY id
    FOR UPDATE;

    -- 5. Enforce global capacity across ALL campuses
    FOR v_course_rec IN (
        SELECT
            c.id,
            c.course_code,
            c.title,
            COALESCE(c.seat_limit, 60) AS seat_limit,
            count(a.value) AS newly_allocated_count
        FROM jsonb_array_elements(p_allocations) a
        JOIN courses c ON c.id = (a.value->>'course_id')::UUID
        GROUP BY c.id, c.course_code, c.title, c.seat_limit
    )
    LOOP
        -- Count the resulting distinct enrollments, including fixed slots of students
        -- receiving other allocations; excluding all affected students undercounts seats.
        SELECT count(DISTINCT r.student_id) INTO v_existing_count FROM student_registrations r
        CROSS JOIN LATERAL (VALUES ('slot_1',r.slot_1_course_id),('slot_2',r.slot_2_course_id),('slot_3',r.slot_3_course_id),
          ('slot_4',r.slot_4_course_id),('slot_5',r.slot_5_course_id),('slot_6',r.slot_6_course_id),('slot_7',r.slot_7_course_id),('slot_8',r.slot_8_course_id)) old(slot_key,course_id)
        LEFT JOIN LATERAL (SELECT (a->>'course_id')::uuid course_id FROM jsonb_array_elements(p_allocations) a
          WHERE (a->>'student_id')::uuid=r.student_id AND a->>'slot_key'=old.slot_key) incoming ON true
        WHERE r.academic_year=p_academic_year AND r.semester=p_semester AND COALESCE(incoming.course_id,old.course_id)=v_course_rec.id;
        IF v_existing_count > v_course_rec.seat_limit THEN
          RAISE EXCEPTION 'Course % (%) exceeds global capacity: % resulting students > % limit',
            v_course_rec.course_code,v_course_rec.title,v_existing_count,v_course_rec.seat_limit;
        END IF;
    END LOOP;

    -- 6. Apply individual allocations atomically to student_registrations
    FOR item IN SELECT value FROM jsonb_array_elements(p_allocations)
    LOOP
        v_student_id := (item.value->>'student_id')::UUID;
        v_slot_key   := item.value->>'slot_key';
        v_course_id  := (item.value->>'course_id')::UUID;

        SELECT id, allocation_metadata INTO v_reg_id, v_meta
        FROM student_registrations
        WHERE student_id = v_student_id
          AND campus_id = p_campus_id
          AND academic_year = p_academic_year
          AND semester = p_semester;

        IF v_reg_id IS NOT NULL THEN
            v_meta := COALESCE(v_meta, '{}'::jsonb);
            v_meta := jsonb_set(
                v_meta,
                ARRAY[v_slot_key],
                jsonb_build_object(
                    'course_id', v_course_id,
                    'allocated_by', COALESCE(item.value->>'allocated_by', 'elective_run'),
                    'run_id', p_run_id,
                    'allocated_at', now()
                ),
                true
            );

            v_sql := format(
                'UPDATE student_registrations SET %I = $1, allocation_metadata = $2 WHERE id = $3',
                v_slot_key || '_course_id'
            );
            EXECUTE v_sql USING v_course_id, v_meta, v_reg_id;
        END IF;
    END LOOP;

    -- Update the credit total from the resulting snapshot-backed enrollment.
    UPDATE student_registrations r SET total_credits=(
      SELECT COALESCE(sum(COALESCE((snapshot.value->>'credits')::numeric,c.credits)),0)
      FROM unnest(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id]) selected(course_id)
      JOIN courses c ON c.id=selected.course_id LEFT JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.selections)='array' THEN r.selections ELSE '[]'::jsonb END)
        WHERE value->>'course_id'=c.id::text LIMIT 1) snapshot ON true)
      WHERE r.campus_id=p_campus_id AND r.academic_year=p_academic_year AND r.semester=p_semester
        AND r.student_id IN (SELECT (a->>'student_id')::uuid FROM jsonb_array_elements(p_allocations) a);
    -- 7. Mark allocation run completed in system_logs
    UPDATE system_logs
    SET status = 'completed',
        completed_at = now(),
        metadata = jsonb_build_object(
            'allocated_count', jsonb_array_length(p_allocations),
            'unallocated_count', jsonb_array_length(p_unallocated),
            'unallocated_students', p_unallocated,
            'summary', p_summary,
            'fencing_token', v_run_rec.metadata->>'fencing_token'
        ) || p_summary,
        updated_at = now()
    WHERE id = p_run_id;

    RETURN jsonb_build_object(
        'success', true,
        'run_id', p_run_id,
        'allocated_count', jsonb_array_length(p_allocations),
        'unallocated_count', jsonb_array_length(p_unallocated),
        'completed_at', now()
    );
END;
$$;

CREATE OR REPLACE FUNCTION execute_student_course_change(
    p_student_id UUID,
    p_campus_id UUID,
    p_semester SMALLINT,
    p_academic_year TEXT,
    p_slot_key TEXT,
    p_new_course_id UUID,
    p_client_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deadline TIMESTAMPTZ;
    v_published_count INT;
    v_reg student_registrations%ROWTYPE;
    v_target_course RECORD;
    v_prev_course_id UUID;
    v_enrolled_count INT;
    v_meta JSONB;
    v_history JSONB;
    v_now_ms BIGINT;
    v_recent_count INT;
    v_window_ms BIGINT := 27 * 60 * 60 * 1000;
    v_new_history_entry JSONB;
    v_updated_credits NUMERIC;
    elem RECORD;
BEGIN
    -- 1. Validate slot_key
    IF p_slot_key NOT IN ('slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8') THEN
        RAISE EXCEPTION 'Invalid slot_key: %', p_slot_key;
    END IF;

    -- 2. Verify registration window is open
    SELECT deadline INTO v_deadline
    FROM campus_settings
    WHERE campus_id = p_campus_id;

    IF v_deadline IS NULL OR now() >= v_deadline THEN
        RAISE EXCEPTION 'Registration window is closed for this campus';
    END IF;

    -- 3. Verify cohort timetable is unpublished
    SELECT count(*) INTO v_published_count
    FROM timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND campus_id = p_campus_id
      AND status = 'published';

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'Timetable has already been published for this cohort. Course changes are locked.';
    END IF;

    -- 4. Fetch existing registration
    SELECT * INTO v_reg
    FROM student_registrations
    WHERE student_id = p_student_id AND campus_id = p_campus_id
      AND semester = p_semester
      AND academic_year = p_academic_year
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student registration record not found';
    END IF;

    -- Ensure slot is not fixed
    v_meta := COALESCE(v_reg.allocation_metadata, '{}'::jsonb);
    IF (v_meta->p_slot_key->>'allocated_by') = 'fixed' THEN
        RAISE EXCEPTION 'Cannot modify a fixed core course slot';
    END IF;

    -- 5. Check idempotency key replay vs conflict (R11)
    v_history := COALESCE(v_meta->'slot_change_history', '[]'::jsonb);
    IF p_client_idempotency_key IS NOT NULL AND trim(p_client_idempotency_key) <> '' THEN
        FOR elem IN SELECT * FROM jsonb_array_elements(v_history)
        LOOP
            IF elem.value->>'idempotency_key' = p_client_idempotency_key THEN
                IF elem.value->>'slot_key' = p_slot_key AND (elem.value->>'new_course_id')::UUID = p_new_course_id THEN
                    -- Idempotent return of prior committed result
                    RETURN jsonb_build_object(
                        'success', true,
                        'message', format('Successfully updated %s to %s (idempotent replay)', p_slot_key, elem.value->>'course_code'),
                        'slot_key', p_slot_key,
                        'course_id', p_new_course_id,
                        'total_credits', v_reg.total_credits,
                        'idempotent_replay', true
                    );
                ELSE
                    RAISE EXCEPTION 'Idempotency key % already used for a different request payload', p_client_idempotency_key;
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- Check if course is already assigned to this slot
    EXECUTE format('SELECT ($1).%I', p_slot_key || '_course_id') USING v_reg INTO v_prev_course_id;
    IF v_prev_course_id = p_new_course_id THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Course is already assigned to this slot',
            'course_id', p_new_course_id,
            'slot_key', p_slot_key,
            'total_credits', v_reg.total_credits
        );
    END IF;

    -- 6. Lock candidate courses in deterministic order
    PERFORM id FROM courses
    WHERE id IN (v_prev_course_id, p_new_course_id)
    ORDER BY id
    FOR UPDATE;

    -- 7. Fetch target course and verify semester
    SELECT id, course_code, title, credits, semester, seat_limit INTO v_target_course
    FROM courses
    WHERE id = p_new_course_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target course not found';
    END IF;

    IF v_target_course.semester <> p_semester THEN
        RAISE EXCEPTION 'Course belongs to semester %, but student is in semester %', v_target_course.semester, p_semester;
    END IF;

    -- 8. Check distinct slot assignment for the student
    IF (p_slot_key <> 'slot_1' AND v_reg.slot_1_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_2' AND v_reg.slot_2_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_3' AND v_reg.slot_3_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_4' AND v_reg.slot_4_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_5' AND v_reg.slot_5_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_6' AND v_reg.slot_6_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_7' AND v_reg.slot_7_course_id = p_new_course_id) OR
       (p_slot_key <> 'slot_8' AND v_reg.slot_8_course_id = p_new_course_id) THEN
        RAISE EXCEPTION 'Course is already assigned in another paper for this student';
    END IF;

    -- 9. Enforce 3-per-27-hour rolling change quota
    v_now_ms := (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT;
    v_recent_count := 0;

    SELECT count(*) INTO v_recent_count
    FROM jsonb_array_elements(v_history) AS h_elem
    WHERE (h_elem->>'at') IS NOT NULL
      AND (v_now_ms - (EXTRACT(EPOCH FROM (h_elem->>'at')::TIMESTAMPTZ) * 1000)::BIGINT) < v_window_ms;

    IF v_recent_count >= 3 THEN
        RAISE EXCEPTION 'Rate limit exceeded: maximum 3 course changes allowed per 27 hours';
    END IF;

    -- 10. Check global capacity across all campuses (R10)
    SELECT count(*) INTO v_enrolled_count
    FROM student_registrations
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND student_id <> p_student_id
      AND (
          slot_1_course_id = p_new_course_id OR
          slot_2_course_id = p_new_course_id OR
          slot_3_course_id = p_new_course_id OR
          slot_4_course_id = p_new_course_id OR
          slot_5_course_id = p_new_course_id OR
          slot_6_course_id = p_new_course_id OR
          slot_7_course_id = p_new_course_id OR
          slot_8_course_id = p_new_course_id
      );

    IF v_enrolled_count >= COALESCE(v_target_course.seat_limit, 60) THEN
        RAISE EXCEPTION 'Course % has reached maximum capacity (%/% seats)',
            v_target_course.course_code, COALESCE(v_target_course.seat_limit, 60), COALESCE(v_target_course.seat_limit, 60);
    END IF;

    -- 11. Record change in metadata history
    v_new_history_entry := jsonb_build_object(
        'slot_key', p_slot_key,
        'previous_course_id', v_prev_course_id,
        'new_course_id', p_new_course_id,
        'course_code', v_target_course.course_code,
        'at', now(),
        'idempotency_key', p_client_idempotency_key
    );

    v_meta := jsonb_set(
        v_meta,
        ARRAY[p_slot_key],
        jsonb_build_object(
            'allocated_by', 'student_direct',
            'updated_at', now(),
            'previous_course_id', v_prev_course_id,
            'course_id', p_new_course_id
        ),
        true
    );
    v_meta := jsonb_set(v_meta, ARRAY['slot_change_history'], v_history || jsonb_build_array(v_new_history_entry), true);

    -- 12. Update registration slot and recalculate credits
    EXECUTE format(
        'UPDATE student_registrations SET %I = $1, allocation_metadata = $2 WHERE id = $3',
        p_slot_key || '_course_id'
    ) USING p_new_course_id, v_meta, v_reg.id;

    SELECT COALESCE(sum(COALESCE((snapshot.value->>'credits')::numeric,c.credits)),0) INTO v_updated_credits
    FROM student_registrations r CROSS JOIN LATERAL
      unnest(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id]) selected(course_id)
    JOIN courses c ON c.id=selected.course_id LEFT JOIN LATERAL (
      SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.selections)='array' THEN r.selections ELSE '[]'::jsonb END)
      WHERE value->>'course_id'=c.id::text LIMIT 1) snapshot ON true WHERE r.id=v_reg.id;

    UPDATE student_registrations
    SET total_credits = v_updated_credits
    WHERE id = v_reg.id;

    RETURN jsonb_build_object(
        'success', true,
        'message', format('Successfully updated %s to %s - %s', p_slot_key, v_target_course.course_code, v_target_course.title),
        'slot_key', p_slot_key,
        'course_id', p_new_course_id,
        'total_credits', v_updated_credits,
        'slot_changes_remaining', GREATEST(0, 3 - (v_recent_count + 1)),
        'course', jsonb_build_object(
            'id', v_target_course.id,
            'course_code', v_target_course.course_code,
            'title', v_target_course.title,
            'credits', v_target_course.credits
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_student_course_change(uuid,uuid,smallint,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_student_course_change(uuid,uuid,smallint,text,text,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.claim_allocation_run(uuid,text,smallint,uuid,int,uuid),public.apply_course_allocation(uuid,uuid,text,smallint,jsonb,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_allocation_run(uuid,text,smallint,uuid,int,uuid),public.apply_course_allocation(uuid,uuid,text,smallint,jsonb,jsonb,jsonb,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.fail_allocation_worker(p_run_id uuid,p_fencing_token uuid,p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE system_logs SET status='failed',error_message=left(p_error,2000),completed_at=now(),updated_at=now()
 WHERE id=p_run_id AND log_type='allocation_run' AND status='running' AND metadata->>'fencing_token'=p_fencing_token::text;
 RETURN FOUND;
END; $$;
REVOKE ALL ON FUNCTION public.fail_allocation_worker(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_allocation_worker(uuid,uuid,text) TO service_role;
INSERT INTO schema_migrations(version,name) VALUES ('20261010100000_production_allocation_fencing_and_clocks','Allocation fencing, projected seats and transaction clocks') ON CONFLICT(version) DO NOTHING;
-- Retain the existing readiness checks, and require this forward repair too.
CREATE OR REPLACE FUNCTION public.production_readiness()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('ready',
  to_regprocedure('public.publish_timetable_cohort(uuid,text,integer)') IS NOT NULL
  AND to_regprocedure('public.atomic_replace_timetable_draft(uuid,text,integer,jsonb,uuid,uuid)') IS NOT NULL
  AND to_regprocedure('public.update_timetable_worker(uuid,uuid,text,integer,text)') IS NOT NULL
  AND to_regprocedure('public.recover_expired_timetable_workers()') IS NOT NULL
  AND to_regprocedure('public.fail_allocation_worker(uuid,uuid,text)') IS NOT NULL
  AND EXISTS(SELECT 1 FROM schema_migrations WHERE version='20261010100000_production_allocation_fencing_and_clocks')
  AND NOT has_table_privilege('authenticated','public.period_attendance_sessions','SELECT')
  AND NOT has_function_privilege('authenticated','public.publish_timetable_cohort(uuid,text,integer)','EXECUTE'));
$$;
REVOKE ALL ON FUNCTION public.production_readiness() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.production_readiness() TO service_role;

$migration_6$;
 END IF;
END $apply$;

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT public.production_readiness() AS readiness;
SELECT version,name FROM public.schema_migrations WHERE version LIKE '20261010%' ORDER BY version;
