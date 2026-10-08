-- =============================================================================
-- Migration: 20261007010000_plan04_enrollment_capacity_transactions.sql
-- Plan: Plan 04 - Registration, eligibility, credits and global seats
-- Primary Findings: F13, F14, F15, F16, F17, F19, F20, F21, F27, F28, F29, F30, F31, F32
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. F20: Duplicate course slot prevention constraint helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_unique_course_slots(
    s1 UUID, s2 UUID, s3 UUID, s4 UUID, s5 UUID, s6 UUID, s7 UUID, s8 UUID
)
RETURNS BOOLEAN
IMMUTABLE
LANGUAGE plpgsql
AS $$
DECLARE
    arr UUID[];
    filtered UUID[];
BEGIN
    arr := ARRAY[s1, s2, s3, s4, s5, s6, s7, s8];
    SELECT array_agg(elem) INTO filtered FROM unnest(arr) elem WHERE elem IS NOT NULL;
    IF filtered IS NULL THEN
        RETURN TRUE;
    END IF;
    RETURN cardinality(filtered) = (SELECT count(DISTINCT elem) FROM unnest(filtered) elem);
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'student_registrations'
          AND constraint_name = 'chk_student_registrations_unique_slots'
    ) THEN
        ALTER TABLE student_registrations
            ADD CONSTRAINT chk_student_registrations_unique_slots
            CHECK (check_unique_course_slots(
                slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id,
                slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id
            ));
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. F15: Upgrade apply_course_allocation to support all 8 slots
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_course_allocation(
    p_run_id UUID,
    p_campus_id UUID,
    p_academic_year TEXT,
    p_semester SMALLINT,
    p_allocations JSONB,
    p_unallocated JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    item RECORD;
    v_student_id UUID;
    v_reg_id UUID;
    v_slot_key TEXT;
    v_course_id UUID;
    v_meta JSONB;
    v_sql TEXT;
BEGIN
    -- Step A: Reset elective slots 1 through 8 back to NULL for cohort registrations,
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

    -- Step B: Apply winning allocations across slots 1 to 8
    FOR item IN SELECT value FROM jsonb_array_elements(p_allocations)
    LOOP
        v_student_id := (item.value->>'student_id')::UUID;
        v_slot_key   := item.value->>'slot_key';
        v_course_id  := (item.value->>'course_id')::UUID;
        v_meta       := item.value->'metadata';

        IF v_slot_key IN ('slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8') THEN
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
        END IF;
    END LOOP;

    -- Step C: Record unallocated slots across slots 1 to 8
    FOR item IN SELECT value FROM jsonb_array_elements(p_unallocated)
    LOOP
        v_student_id := (item.value->>'student_id')::UUID;
        v_slot_key   := item.value->>'slot_key';
        v_meta       := item.value->'metadata';

        IF v_slot_key IN ('slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8') THEN
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
        END IF;
    END LOOP;

    -- Step D: Recalculate distinct credit sums across all 8 slots
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

    RETURN jsonb_build_object(
        'success', true,
        'allocated_slots_applied', jsonb_array_length(p_allocations),
        'unallocated_slots_recorded', jsonb_array_length(p_unallocated)
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. F17: Atomic Registration Submission RPC (preserving original submitted_at)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_student_registration(
    p_student_id UUID,
    p_campus_id UUID,
    p_semester SMALLINT,
    p_academic_year TEXT,
    p_pathway_id TEXT,
    p_preferences JSONB,
    p_allocation_metadata JSONB,
    p_fixed_assignments JSONB,
    p_total_credits NUMERIC,
    p_submitted_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing_submitted_at TIMESTAMPTZ;
    v_final_submitted_at TIMESTAMPTZ;
    v_s1 UUID;
    v_s2 UUID;
    v_s3 UUID;
    v_s4 UUID;
    v_s5 UUID;
    v_s6 UUID;
    v_s7 UUID;
    v_s8 UUID;
BEGIN
    -- Check if prior submission exists to preserve initial submitted_at
    SELECT submitted_at INTO v_existing_submitted_at
    FROM registration_preferences
    WHERE student_id = p_student_id AND semester = p_semester AND academic_year = p_academic_year;

    IF v_existing_submitted_at IS NULL THEN
        SELECT submitted_at INTO v_existing_submitted_at
        FROM student_registrations
        WHERE student_id = p_student_id AND semester = p_semester AND academic_year = p_academic_year;
    END IF;

    v_final_submitted_at := COALESCE(v_existing_submitted_at, p_submitted_at);

    -- Extract fixed course IDs safely
    v_s1 := (p_fixed_assignments->>'slot_1')::UUID;
    v_s2 := (p_fixed_assignments->>'slot_2')::UUID;
    v_s3 := (p_fixed_assignments->>'slot_3')::UUID;
    v_s4 := (p_fixed_assignments->>'slot_4')::UUID;
    v_s5 := (p_fixed_assignments->>'slot_5')::UUID;
    v_s6 := (p_fixed_assignments->>'slot_6')::UUID;
    v_s7 := (p_fixed_assignments->>'slot_7')::UUID;
    v_s8 := (p_fixed_assignments->>'slot_8')::UUID;

    -- Validate no duplicate courses among fixed slots
    IF NOT check_unique_course_slots(v_s1, v_s2, v_s3, v_s4, v_s5, v_s6, v_s7, v_s8) THEN
        RAISE EXCEPTION 'Duplicate course assigned among fixed slots';
    END IF;

    -- Upsert registration_preferences
    INSERT INTO registration_preferences (
        student_id, campus_id, semester, academic_year, pathway_id,
        preferences, allocation_metadata, submitted_at, updated_at
    )
    VALUES (
        p_student_id, p_campus_id, p_semester, p_academic_year, p_pathway_id,
        p_preferences, p_allocation_metadata, v_final_submitted_at, timezone('utc'::text, now())
    )
    ON CONFLICT (student_id, semester, academic_year)
    DO UPDATE SET
        campus_id = EXCLUDED.campus_id,
        pathway_id = EXCLUDED.pathway_id,
        preferences = EXCLUDED.preferences,
        allocation_metadata = EXCLUDED.allocation_metadata,
        updated_at = timezone('utc'::text, now());

    -- Upsert student_registrations
    INSERT INTO student_registrations (
        student_id, campus_id, semester, academic_year, pathway_id,
        total_credits, allocation_metadata, submitted_at,
        slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id,
        slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id
    )
    VALUES (
        p_student_id, p_campus_id, p_semester, p_academic_year, p_pathway_id,
        p_total_credits, p_allocation_metadata, v_final_submitted_at,
        v_s1, v_s2, v_s3, v_s4, v_s5, v_s6, v_s7, v_s8
    )
    ON CONFLICT (student_id, semester, academic_year)
    DO UPDATE SET
        campus_id = EXCLUDED.campus_id,
        pathway_id = EXCLUDED.pathway_id,
        total_credits = EXCLUDED.total_credits,
        allocation_metadata = EXCLUDED.allocation_metadata,
        slot_1_course_id = COALESCE(EXCLUDED.slot_1_course_id, student_registrations.slot_1_course_id),
        slot_2_course_id = COALESCE(EXCLUDED.slot_2_course_id, student_registrations.slot_2_course_id),
        slot_3_course_id = COALESCE(EXCLUDED.slot_3_course_id, student_registrations.slot_3_course_id),
        slot_4_course_id = COALESCE(EXCLUDED.slot_4_course_id, student_registrations.slot_4_course_id),
        slot_5_course_id = COALESCE(EXCLUDED.slot_5_course_id, student_registrations.slot_5_course_id),
        slot_6_course_id = COALESCE(EXCLUDED.slot_6_course_id, student_registrations.slot_6_course_id),
        slot_7_course_id = COALESCE(EXCLUDED.slot_7_course_id, student_registrations.slot_7_course_id),
        slot_8_course_id = COALESCE(EXCLUDED.slot_8_course_id, student_registrations.slot_8_course_id);

    RETURN jsonb_build_object(
        'success', true,
        'submitted_at', v_final_submitted_at,
        'preserved_first_submission', (v_existing_submitted_at IS NOT NULL)
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. F21, F30, F31: Atomic Course Change & Global Capacity RPC
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
BEGIN
    -- 1. Validate slot_key
    IF p_slot_key NOT IN ('slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8') THEN
        RAISE EXCEPTION 'Invalid slot_key: %', p_slot_key;
    END IF;

    -- 2. Verify registration window is open (campus_settings)
    SELECT deadline INTO v_deadline
    FROM campus_settings
    WHERE campus_id = p_campus_id;

    IF v_deadline IS NULL OR timezone('utc'::text, now()) >= v_deadline THEN
        RAISE EXCEPTION 'Registration window is closed for this campus';
    END IF;

    -- 3. Verify cohort timetable is unpublished (F30)
    SELECT count(*) INTO v_published_count
    FROM timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
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

    -- Check if course is already assigned to this slot (idempotent success)
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

    -- 5. Lock candidate courses in deterministic order to prevent deadlocks (F21)
    PERFORM id FROM courses
    WHERE id IN (v_prev_course_id, p_new_course_id)
    ORDER BY id
    FOR UPDATE;

    -- 6. Fetch target course and verify semester
    SELECT id, course_code, title, credits, semester, seat_limit INTO v_target_course
    FROM courses
    WHERE id = p_new_course_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target course not found';
    END IF;

    IF v_target_course.semester <> p_semester THEN
        RAISE EXCEPTION 'Course belongs to semester %, but student is in semester %', v_target_course.semester, p_semester;
    END IF;

    -- 7. Check distinct slot assignment for the student (F20)
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

    -- 8. Enforce 3-per-27-hour rolling change quota (F31)
    v_history := COALESCE(v_meta->'slot_change_history', '[]'::jsonb);
    v_now_ms := (EXTRACT(EPOCH FROM timezone('utc'::text, now())) * 1000)::BIGINT;
    v_recent_count := 0;

    SELECT count(*) INTO v_recent_count
    FROM jsonb_array_elements(v_history) AS elem
    WHERE (elem->>'at') IS NOT NULL
      AND (v_now_ms - (EXTRACT(EPOCH FROM (elem->>'at')::TIMESTAMPTZ) * 1000)::BIGINT) < v_window_ms;

    IF v_recent_count >= 3 THEN
        RAISE EXCEPTION 'Rate limit exceeded: maximum 3 course changes allowed per 27 hours';
    END IF;

    -- 9. Check global capacity across all campuses for active academic year (F21)
    SELECT count(*) INTO v_enrolled_count
    FROM student_registrations
    WHERE academic_year = p_academic_year
      AND semester = p_semester
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

    -- 10. Record change in metadata history
    v_new_history_entry := jsonb_build_object(
        'slot_key', p_slot_key,
        'previous_course_id', v_prev_course_id,
        'new_course_id', p_new_course_id,
        'course_code', v_target_course.course_code,
        'at', timezone('utc'::text, now()),
        'idempotency_key', p_client_idempotency_key
    );

    v_meta := jsonb_set(
        v_meta,
        ARRAY[p_slot_key],
        jsonb_build_object(
            'allocated_by', 'student_direct',
            'updated_at', timezone('utc'::text, now()),
            'previous_course_id', v_prev_course_id,
            'course_id', p_new_course_id
        ),
        true
    );
    v_meta := jsonb_set(v_meta, ARRAY['slot_change_history'], v_history || jsonb_build_array(v_new_history_entry), true);

    -- 11. Update registration slot and recalculate credits
    EXECUTE format(
        'UPDATE student_registrations SET %I = $1, allocation_metadata = $2 WHERE id = $3',
        p_slot_key || '_course_id'
    ) USING p_new_course_id, v_meta, v_reg.id;

    SELECT COALESCE(SUM(c.credits), 0) INTO v_updated_credits
    FROM courses c
    WHERE c.id IN (
        SELECT unnest(ARRAY[
            CASE WHEN p_slot_key = 'slot_1' THEN p_new_course_id ELSE v_reg.slot_1_course_id END,
            CASE WHEN p_slot_key = 'slot_2' THEN p_new_course_id ELSE v_reg.slot_2_course_id END,
            CASE WHEN p_slot_key = 'slot_3' THEN p_new_course_id ELSE v_reg.slot_3_course_id END,
            CASE WHEN p_slot_key = 'slot_4' THEN p_new_course_id ELSE v_reg.slot_4_course_id END,
            CASE WHEN p_slot_key = 'slot_5' THEN p_new_course_id ELSE v_reg.slot_5_course_id END,
            CASE WHEN p_slot_key = 'slot_6' THEN p_new_course_id ELSE v_reg.slot_6_course_id END,
            CASE WHEN p_slot_key = 'slot_7' THEN p_new_course_id ELSE v_reg.slot_7_course_id END,
            CASE WHEN p_slot_key = 'slot_8' THEN p_new_course_id ELSE v_reg.slot_8_course_id END
        ])
    );

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

-- -----------------------------------------------------------------------------
-- 5. Term identity and query performance indexes (F32)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_student_registrations_term_campus
    ON student_registrations (academic_year, semester, campus_id);

CREATE INDEX IF NOT EXISTS idx_student_registrations_student_term
    ON student_registrations (student_id, academic_year, semester);

CREATE INDEX IF NOT EXISTS idx_reg_pref_student_term
    ON registration_preferences (student_id, academic_year, semester);

-- -----------------------------------------------------------------------------
-- 6. Record migration in schema_migrations
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('20261007010000_plan04_enrollment_capacity_transactions', 'Plan 04: Registration, eligibility, credits and global seats')
ON CONFLICT (version) DO NOTHING;
