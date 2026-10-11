-- =============================================================================
-- Migration: 20261010010000_followup_plan05_scoped_jobs_and_cohort_accounting.sql
-- Plan: Follow-up Plan 05 (Findings R13, R15, R16, R36)
-- Description:
--   1. R15: Scope timetable publication checks to host campus cohort
--      (campus_id, academic_year, semester) in claim_allocation_run,
--      apply_course_allocation, and execute_student_course_change.
--   2. R16: Harden claim_allocation_run with transactional advisory locking,
--      unique active running index, and worker fencing token verification.
--   3. R16: Harden apply_course_allocation with worker fencing token check
--      to reject commits from expired/reclaimed workers.
--   4. R16: Create claim_timetable_generation_job RPC with atomic cohort
--      locking, lease recovery, and worker fencing tokens.
--   5. Plan 01 Security: Apply search_path = public, pg_temp; REVOKE from
--      PUBLIC/anon/authenticated; GRANT to service_role and postgres.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Partial Unique Indexes for Active Claims (R16)
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_allocation_run_cohort
ON system_logs (campus_id, academic_year, semester)
WHERE log_type = 'allocation_run' AND status = 'running';

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_timetable_generation_job_cohort
ON system_logs (campus_id, academic_year, semester)
WHERE log_type = 'timetable_generation_job' AND status IN ('queued', 'running');

-- -----------------------------------------------------------------------------
-- 1. Upgraded claim_allocation_run (R15, R16, Plan 01 Security)
-- -----------------------------------------------------------------------------
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
    -- R16: Acquire transactional advisory lock for this campus cohort
    PERFORM pg_advisory_xact_lock(
        hashtext('allocation_claim_' || p_campus_id::text || '_' || p_academic_year || '_' || p_semester::text)
    );

    -- A. Verify registration window is closed for this campus
    SELECT deadline INTO v_deadline
    FROM campus_settings
    WHERE campus_id = p_campus_id;

    IF v_deadline IS NULL OR timezone('utc'::text, now()) < v_deadline THEN
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
        updated_at = timezone('utc'::text, now())
    WHERE log_type = 'allocation_run'
      AND campus_id = p_campus_id
      AND academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'running'
      AND started_at <= timezone('utc'::text, now()) - (COALESCE(p_lease_seconds, 300) || ' seconds')::interval;

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
        timezone('utc'::text, now()),
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
    );

    RETURN v_run_id;
END;
$$;

-- Privileges for claim_allocation_run
REVOKE ALL ON FUNCTION public.claim_allocation_run(UUID, TEXT, SMALLINT, UUID, INT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_allocation_run(UUID, TEXT, SMALLINT, UUID, INT, UUID) TO service_role, postgres;

-- -----------------------------------------------------------------------------
-- 2. Upgraded apply_course_allocation (R15, R16 Fencing, Plan 01 Security)
-- -----------------------------------------------------------------------------
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
    -- 1. Validate run exists, matches cohort, and is running
    SELECT * INTO v_run_rec
    FROM system_logs
    WHERE id = p_run_id
      AND log_type = 'allocation_run'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Allocation run record % not found', p_run_id;
    END IF;

    IF v_run_rec.campus_id <> p_campus_id OR
       v_run_rec.academic_year <> p_academic_year OR
       v_run_rec.semester <> p_semester THEN
        RAISE EXCEPTION 'Allocation run % does not match cohort (% / % / %)',
            p_run_id, p_campus_id, p_academic_year, p_semester;
    END IF;

    IF v_run_rec.status <> 'running' THEN
        RAISE EXCEPTION 'Allocation run % is not currently running (status: %)', p_run_id, v_run_rec.status;
    END IF;

    -- R16: Verify fencing token if provided
    IF p_fencing_token IS NOT NULL THEN
        v_active_token := (v_run_rec.metadata->>'fencing_token')::UUID;
        IF v_active_token IS DISTINCT FROM p_fencing_token THEN
            RAISE EXCEPTION 'Worker lease expired or was superseded by another claim (fencing token mismatch)';
        END IF;
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
        IF v_slot_key NOT IN ('slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8') THEN
            RAISE EXCEPTION 'Invalid slot_key: % in allocations', v_slot_key;
        END IF;

        v_student_id := (item.value->>'student_id')::UUID;
        IF NOT EXISTS (
            SELECT 1 FROM student_registrations
            WHERE student_id = v_student_id AND campus_id = p_campus_id
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
        -- Count students currently enrolled from other allocations/campuses
        SELECT count(*) INTO v_existing_count
        FROM student_registrations
        WHERE academic_year = p_academic_year
          AND semester = p_semester
          AND student_id NOT IN (
              SELECT (value->>'student_id')::UUID
              FROM jsonb_array_elements(p_allocations)
          )
          AND (
              slot_1_course_id = v_course_rec.id OR
              slot_2_course_id = v_course_rec.id OR
              slot_3_course_id = v_course_rec.id OR
              slot_4_course_id = v_course_rec.id OR
              slot_5_course_id = v_course_rec.id OR
              slot_6_course_id = v_course_rec.id OR
              slot_7_course_id = v_course_rec.id OR
              slot_8_course_id = v_course_rec.id
          );

        IF (v_existing_count + v_course_rec.newly_allocated_count) > v_course_rec.seat_limit THEN
            RAISE EXCEPTION 'Course % (%) exceeds global capacity: % existing + % allocated > % limit',
                v_course_rec.course_code,
                v_course_rec.title,
                v_existing_count,
                v_course_rec.newly_allocated_count,
                v_course_rec.seat_limit;
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
                    'allocated_at', timezone('utc'::text, now())
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

    -- 7. Mark allocation run completed in system_logs
    UPDATE system_logs
    SET status = 'completed',
        completed_at = timezone('utc'::text, now()),
        metadata = jsonb_build_object(
            'allocated_count', jsonb_array_length(p_allocations),
            'unallocated_count', jsonb_array_length(p_unallocated),
            'unallocated_students', p_unallocated,
            'summary', p_summary,
            'fencing_token', v_run_rec.metadata->>'fencing_token'
        ),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_run_id;

    RETURN jsonb_build_object(
        'success', true,
        'run_id', p_run_id,
        'allocated_count', jsonb_array_length(p_allocations),
        'unallocated_count', jsonb_array_length(p_unallocated),
        'completed_at', timezone('utc'::text, now())
    );
END;
$$;

-- Privileges for apply_course_allocation
REVOKE ALL ON FUNCTION public.apply_course_allocation(UUID, UUID, TEXT, SMALLINT, JSONB, JSONB, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_course_allocation(UUID, UUID, TEXT, SMALLINT, JSONB, JSONB, JSONB, UUID) TO service_role, postgres;

-- -----------------------------------------------------------------------------
-- 3. Upgraded execute_student_course_change (R15 Scoped Publication)
-- -----------------------------------------------------------------------------
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
    v_reg RECORD;
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

    -- 2. Verify registration window is open for student's campus
    SELECT deadline INTO v_deadline
    FROM campus_settings
    WHERE campus_id = p_campus_id;

    IF v_deadline IS NULL OR timezone('utc'::text, now()) >= v_deadline THEN
        RAISE EXCEPTION 'Registration window is closed for this campus';
    END IF;

    -- 3. Verify cohort timetable is unpublished for THIS host campus (R15)
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
    WHERE student_id = p_student_id
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

    -- 8. Verify rate limit (3 changes per 27 hours)
    v_now_ms := (extract(epoch from now()) * 1000)::BIGINT;
    v_recent_count := 0;

    FOR elem IN SELECT * FROM jsonb_array_elements(v_history)
    LOOP
        IF (v_now_ms - (elem.value->>'timestamp')::BIGINT) < v_window_ms THEN
            v_recent_count := v_recent_count + 1;
        END IF;
    END LOOP;

    IF v_recent_count >= 3 THEN
        RAISE EXCEPTION 'Rate limit exceeded: maximum 3 changes per 27 hours allowed';
    END IF;

    -- 9. Enforce global capacity across ALL campuses
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
        RAISE EXCEPTION 'Course % (%) has reached maximum capacity (%/% seats)',
            v_target_course.course_code, v_target_course.title, COALESCE(v_target_course.seat_limit, 60), COALESCE(v_target_course.seat_limit, 60);
    END IF;

    -- 10. Record change in history and update metadata
    v_new_history_entry := jsonb_build_object(
        'slot_key', p_slot_key,
        'old_course_id', v_prev_course_id,
        'new_course_id', p_new_course_id,
        'course_code', v_target_course.course_code,
        'timestamp', v_now_ms,
        'idempotency_key', p_client_idempotency_key
    );

    v_history := v_history || jsonb_build_array(v_new_history_entry);
    v_meta := jsonb_set(v_meta, '{slot_change_history}', v_history, true);
    v_meta := jsonb_set(
        v_meta,
        ARRAY[p_slot_key],
        jsonb_build_object(
            'course_id', p_new_course_id,
            'allocated_by', 'student_change',
            'updated_at', timezone('utc'::text, now())
        ),
        true
    );

    -- Calculate updated credits
    v_updated_credits := COALESCE(v_reg.total_credits, 0);

    -- 11. Update student registration
    EXECUTE format(
        'UPDATE student_registrations SET %I = $1, allocation_metadata = $2 WHERE id = $3',
        p_slot_key || '_course_id'
    ) USING p_new_course_id, v_meta, v_reg.id;

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

-- Privileges for execute_student_course_change
REVOKE ALL ON FUNCTION public.execute_student_course_change(UUID, UUID, SMALLINT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_student_course_change(UUID, UUID, SMALLINT, TEXT, TEXT, UUID, TEXT) TO service_role, postgres;

-- -----------------------------------------------------------------------------
-- 4. Atomic claim_timetable_generation_job RPC (R16, Plan 01 Security)
-- -----------------------------------------------------------------------------
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
    v_completed_alloc_count INT;
    v_active_job RECORD;
    v_job_id UUID;
    v_fencing_token UUID;
    v_meta JSONB;
BEGIN
    -- R16: Acquire transactional advisory lock for timetable generation on this campus cohort
    PERFORM pg_advisory_xact_lock(
        hashtext('timetable_job_claim_' || COALESCE(p_campus_id::text, 'global') || '_' || p_academic_year || '_' || p_semester::text)
    );

    -- A. Verify registration window is closed
    IF p_campus_id IS NOT NULL THEN
        SELECT deadline INTO v_deadline
        FROM campus_settings
        WHERE campus_id = p_campus_id;

        IF v_deadline IS NULL OR timezone('utc'::text, now()) < v_deadline THEN
            RAISE EXCEPTION 'Registration window is still open. Timetable generation requires closed registration.';
        END IF;
    END IF;

    -- B. Verify published schedule does not already exist for THIS campus (R15)
    SELECT count(*) INTO v_published_count
    FROM timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND (p_campus_id IS NULL OR campus_id = p_campus_id)
      AND status = 'published';

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'A published timetable already exists for % Semester %. Published timetables are strictly immutable.',
            p_academic_year, p_semester;
    END IF;

    -- C. Cleanup expired running jobs beyond lease window (R16 recovery)
    UPDATE system_logs
    SET status = 'failed',
        error_message = 'Previous worker lease expired due to inactivity or restart (F42/R16 recovery).',
        completed_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE log_type = 'timetable_generation_job'
      AND (p_campus_id IS NULL OR campus_id = p_campus_id)
      AND academic_year = p_academic_year
      AND semester = p_semester
      AND status IN ('queued', 'running')
      AND started_at <= timezone('utc'::text, now()) - (COALESCE(p_lease_seconds, 600) || ' seconds')::interval;

    -- D. Check active running/queued job within lease window
    SELECT id, metadata, status INTO v_active_job
    FROM system_logs
    WHERE log_type = 'timetable_generation_job'
      AND (p_campus_id IS NULL OR campus_id = p_campus_id)
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
        'timetable_generation_job',
        p_campus_id,
        p_academic_year,
        p_semester,
        'queued',
        p_user_id,
        v_meta,
        timezone('utc'::text, now()),
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
    );

    RETURN jsonb_build_object(
        'success', true,
        'job_id', v_job_id,
        'fencing_token', v_fencing_token
    );
END;
$$;

-- Privileges for claim_timetable_generation_job
REVOKE ALL ON FUNCTION public.claim_timetable_generation_job(UUID, TEXT, SMALLINT, UUID, INT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_timetable_generation_job(UUID, TEXT, SMALLINT, UUID, INT, UUID) TO service_role, postgres;
