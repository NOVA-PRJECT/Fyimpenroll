BEGIN;
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
COMMIT;
