-- =============================================================================
-- Migration: 20261007020000_plan05_deterministic_allocation_atomic_jobs.sql
-- Plan: Plan 05 - Deterministic allocation and atomic jobs
-- Primary Findings: F18, F22, F23, F24, F25, F26, F70
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. F22, F23: Atomic Allocation Run Claim RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_allocation_run(
    p_campus_id UUID,
    p_academic_year TEXT,
    p_semester SMALLINT,
    p_user_id UUID,
    p_lease_seconds INT DEFAULT 300
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deadline TIMESTAMPTZ;
    v_published_count INT;
    v_completed_run_id UUID;
    v_active_run_id UUID;
    v_run_id UUID;
BEGIN
    -- A. Verify registration window is closed for this campus (F22)
    SELECT deadline INTO v_deadline
    FROM campus_settings
    WHERE campus_id = p_campus_id;

    IF v_deadline IS NULL OR timezone('utc'::text, now()) < v_deadline THEN
        RAISE EXCEPTION 'Registration window is still open for this campus. Allocation can only be run after registration closes.';
    END IF;

    -- B. Verify cohort timetable is unpublished (F22)
    SELECT count(*) INTO v_published_count
    FROM timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'published';

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'Timetable has already been published for this cohort. Allocation is locked.';
    END IF;

    -- C. Verify allocation has not already been completed for this cohort (F23)
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

    -- D. Cleanup expired running claims beyond lease window (F23)
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

    -- E. Check active running claim within lease window (F23)
    SELECT id INTO v_active_run_id
    FROM system_logs
    WHERE log_type = 'allocation_run'
      AND campus_id = p_campus_id
      AND academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'running'
    LIMIT 1;

    IF v_active_run_id IS NOT NULL THEN
        RAISE EXCEPTION 'An allocation run is already in progress for this academic year and semester.';
    END IF;

    -- F. Atomically insert new running claim
    v_run_id := gen_random_uuid();
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
        '{}'::jsonb,
        timezone('utc'::text, now()),
        timezone('utc'::text, now()),
        timezone('utc'::text, now())
    );

    RETURN v_run_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. F70, F21: Hardened apply_course_allocation RPC with cohort & capacity checks
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_course_allocation(
    p_run_id UUID,
    p_campus_id UUID,
    p_academic_year TEXT,
    p_semester SMALLINT,
    p_allocations JSONB,
    p_unallocated JSONB DEFAULT '[]'::jsonb,
    p_summary JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
BEGIN
    -- 1. Validate run exists, is running, matches cohort (F23, F70)
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

    -- 2. Verify cohort timetable is unpublished (F22, F70)
    SELECT count(*) INTO v_published_count
    FROM timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'published';

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'Timetable has already been published for this cohort. Allocation commit is locked.';
    END IF;

    -- 3. Validate slot keys and student campus membership (F70)
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
              AND academic_year = p_academic_year AND semester = p_semester
        ) THEN
            RAISE EXCEPTION 'Student % does not belong to campus % in academic year % semester %',
                v_student_id, p_campus_id, p_academic_year, p_semester;
        END IF;
    END LOOP;

    FOR item IN SELECT value FROM jsonb_array_elements(p_unallocated)
    LOOP
        v_slot_key := item.value->>'slot_key';
        IF v_slot_key NOT IN ('slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8') THEN
            RAISE EXCEPTION 'Invalid slot_key: % in unallocated', v_slot_key;
        END IF;

        v_student_id := (item.value->>'student_id')::UUID;
        IF NOT EXISTS (
            SELECT 1 FROM student_registrations
            WHERE student_id = v_student_id AND campus_id = p_campus_id
              AND academic_year = p_academic_year AND semester = p_semester
        ) THEN
            RAISE EXCEPTION 'Student % does not belong to campus % in academic year % semester %',
                v_student_id, p_campus_id, p_academic_year, p_semester;
        END IF;
    END LOOP;

    -- 4. Reset elective slots 1 through 8 back to NULL for cohort registrations,
    -- preserving fixed slots (where allocation_metadata->slot_key->>'allocated_by' = 'fixed')
    UPDATE student_registrations sr
    SET
        slot_1_course_id = CASE WHEN sr.allocation_metadata->'slot_1'->>'allocated_by' = 'fixed' THEN sr.slot_1_course_id ELSE NULL END,
        slot_2_course_id = CASE WHEN sr.allocation_metadata->'slot_2'->>'allocated_by' = 'fixed' THEN sr.slot_2_course_id ELSE NULL END,
        slot_3_course_id = CASE WHEN sr.allocation_metadata->'slot_3'->>'allocated_by' = 'fixed' THEN sr.slot_3_course_id ELSE NULL END,
        slot_4_course_id = CASE WHEN sr.allocation_metadata->'slot_4'->>'allocated_by' = 'fixed' THEN sr.slot_4_course_id ELSE NULL END,
        slot_5_course_id = CASE WHEN sr.allocation_metadata->'slot_5'->>'allocated_by' = 'fixed' THEN sr.slot_5_course_id ELSE NULL END,
        slot_6_course_id = CASE WHEN sr.allocation_metadata->'slot_6'->>'allocated_by' = 'fixed' THEN sr.slot_6_course_id ELSE NULL END,
        slot_7_course_id = CASE WHEN sr.allocation_metadata->'slot_7'->>'allocated_by' = 'fixed' THEN sr.slot_7_course_id ELSE NULL END,
        slot_8_course_id = CASE WHEN sr.allocation_metadata->'slot_8'->>'allocated_by' = 'fixed' THEN sr.slot_8_course_id ELSE NULL END,
        allocation_metadata = jsonb_strip_nulls(
            jsonb_build_object(
                'slot_1', CASE WHEN sr.allocation_metadata->'slot_1'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_1' ELSE NULL END,
                'slot_2', CASE WHEN sr.allocation_metadata->'slot_2'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_2' ELSE NULL END,
                'slot_3', CASE WHEN sr.allocation_metadata->'slot_3'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_3' ELSE NULL END,
                'slot_4', CASE WHEN sr.allocation_metadata->'slot_4'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_4' ELSE NULL END,
                'slot_5', CASE WHEN sr.allocation_metadata->'slot_5'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_5' ELSE NULL END,
                'slot_6', CASE WHEN sr.allocation_metadata->'slot_6'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_6' ELSE NULL END,
                'slot_7', CASE WHEN sr.allocation_metadata->'slot_7'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_7' ELSE NULL END,
                'slot_8', CASE WHEN sr.allocation_metadata->'slot_8'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_8' ELSE NULL END
            )
        )
    WHERE sr.campus_id = p_campus_id
      AND sr.academic_year = p_academic_year
      AND sr.semester = p_semester;

    -- 5. Lock candidate courses and enforce global capacity limits (F21, F70)
    IF jsonb_array_length(p_allocations) > 0 THEN
        PERFORM id FROM courses
        WHERE id IN (
            SELECT DISTINCT (value->>'course_id')::UUID
            FROM jsonb_array_elements(p_allocations)
        )
        ORDER BY id
        FOR UPDATE;

        FOR v_course_rec IN (
            SELECT c.id, c.course_code, COALESCE(c.seat_limit, 60) AS seat_limit, count(a.value) AS alloc_count
            FROM jsonb_array_elements(p_allocations) a
            JOIN courses c ON c.id = (a.value->>'course_id')::UUID
            GROUP BY c.id, c.course_code, c.seat_limit
        )
        LOOP
            -- Count remaining enrollments across all campuses (since elective slots for this campus were reset above)
            SELECT count(*) INTO v_existing_count
            FROM student_registrations
            WHERE academic_year = p_academic_year
              AND semester = p_semester
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

            IF (v_existing_count + v_course_rec.alloc_count) > v_course_rec.seat_limit THEN
                RAISE EXCEPTION 'Course % exceeds global seat limit (% allocated + % existing > % limit)',
                    v_course_rec.course_code, v_course_rec.alloc_count, v_existing_count, v_course_rec.seat_limit;
            END IF;
        END LOOP;
    END IF;

    -- 6. Apply winning allocations across slots 1 to 8
    FOR item IN SELECT value FROM jsonb_array_elements(p_allocations)
    LOOP
        v_student_id := (item.value->>'student_id')::UUID;
        v_slot_key   := item.value->>'slot_key';
        v_course_id  := (item.value->>'course_id')::UUID;
        v_meta       := item.value->'metadata';

        SELECT id INTO v_reg_id FROM student_registrations
        WHERE student_id = v_student_id AND academic_year = p_academic_year AND semester = p_semester;

        IF v_reg_id IS NOT NULL THEN
            v_sql := format(
                'UPDATE student_registrations SET %I = $1, allocation_metadata = jsonb_set(COALESCE(allocation_metadata, ''{}''::jsonb), ARRAY[$2], $3, true) WHERE id = $4',
                v_slot_key || '_course_id'
            );
            EXECUTE v_sql USING v_course_id, v_slot_key, v_meta, v_reg_id;
        END IF;

        UPDATE registration_preferences
        SET allocation_metadata = jsonb_set(COALESCE(allocation_metadata, '{}'::jsonb), ARRAY[v_slot_key], v_meta, true),
            updated_at = timezone('utc'::text, now())
        WHERE student_id = v_student_id AND academic_year = p_academic_year AND semester = p_semester;
    END LOOP;

    -- 7. Record unallocated slots across slots 1 to 8
    FOR item IN SELECT value FROM jsonb_array_elements(p_unallocated)
    LOOP
        v_student_id := (item.value->>'student_id')::UUID;
        v_slot_key   := item.value->>'slot_key';
        v_meta       := item.value->'metadata';

        SELECT id INTO v_reg_id FROM student_registrations
        WHERE student_id = v_student_id AND academic_year = p_academic_year AND semester = p_semester;

        IF v_reg_id IS NOT NULL THEN
            v_sql := format(
                'UPDATE student_registrations SET %I = NULL, allocation_metadata = jsonb_set(COALESCE(allocation_metadata, ''{}''::jsonb), ARRAY[$1], $2, true) WHERE id = $3',
                v_slot_key || '_course_id'
            );
            EXECUTE v_sql USING v_slot_key, v_meta, v_reg_id;
        END IF;

        UPDATE registration_preferences
        SET allocation_metadata = jsonb_set(COALESCE(allocation_metadata, '{}'::jsonb), ARRAY[v_slot_key], v_meta, true),
            updated_at = timezone('utc'::text, now())
        WHERE student_id = v_student_id AND academic_year = p_academic_year AND semester = p_semester;
    END LOOP;

    -- 8. Recalculate distinct credit sums across all 8 slots
    UPDATE student_registrations sr
    SET total_credits = COALESCE(
        (SELECT SUM(c.credits)
         FROM courses c
         WHERE c.id IN (
             sr.slot_1_course_id, sr.slot_2_course_id, sr.slot_3_course_id,
             sr.slot_4_course_id, sr.slot_5_course_id, sr.slot_6_course_id,
             sr.slot_7_course_id, sr.slot_8_course_id
         )), 0)
    WHERE sr.campus_id = p_campus_id
      AND sr.academic_year = p_academic_year
      AND sr.semester = p_semester;

    -- 9. Mark allocation run completed in system_logs (F23, F26)
    UPDATE system_logs
    SET status = 'completed',
        completed_at = timezone('utc'::text, now()),
        metadata = jsonb_build_object(
            'total_students', COALESCE((p_summary->>'total_students')::int, 0),
            'fully_allocated', COALESCE((p_summary->>'fully_allocated')::int, 0),
            'partially_allocated', COALESCE((p_summary->>'partially_allocated')::int, 0),
            'unallocated', COALESCE((p_summary->>'unallocated')::int, 0),
            'summary', jsonb_build_object(
                'allocated_slots_count', jsonb_array_length(p_allocations),
                'unallocated_slots_count', jsonb_array_length(p_unallocated),
                'unresolved_core_slots', COALESCE((p_summary->'summary'->>'unresolved_core_slots')::int, 0),
                'unresolved_optional_slots', COALESCE((p_summary->'summary'->>'unresolved_optional_slots')::int, 0)
            )
        ),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_run_id AND log_type = 'allocation_run';

    RETURN jsonb_build_object(
        'success', true,
        'run_id', p_run_id,
        'allocated_slots_applied', jsonb_array_length(p_allocations),
        'unallocated_slots_recorded', jsonb_array_length(p_unallocated)
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Record migration in schema_migrations
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('20261007020000_plan05_deterministic_allocation_atomic_jobs', 'Plan 05: Deterministic allocation and atomic jobs')
ON CONFLICT (version) DO NOTHING;
