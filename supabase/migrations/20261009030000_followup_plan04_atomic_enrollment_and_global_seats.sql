-- =============================================================================
-- Migration: 20261009030000_followup_plan04_atomic_enrollment_and_global_seats.sql
-- Plan: Follow-up Plan 04 (Findings R09, R10, R11, R12, R14)
-- Description:
--   1. Harden submit_student_registration with deterministic course locking,
--      strict global capacity enforcement on fixed courses across all campuses,
--      pathway reconciliation to release removed fixed course seats on pathway change,
--      obsolete fixed metadata clearing, and original submitted_at preservation.
--   2. Harden execute_student_course_change with idempotency key payload verification
--      and safe replay, deterministic locking, and quota/capacity protection.
--   3. Create execute_manual_course_allocation RPC with strict semester verification,
--      deterministic course locking, global seat limits, and credit breakdown stored
--      in allocation_metadata without non-existent table columns.
--   4. Apply Plan 01 privileges: revoke from PUBLIC/anon/authenticated and grant to
--      service_role and postgres; pin search_path = public, pg_temp.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Upgrade submit_student_registration (R10, R14, Plan 01 security)
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
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deadline TIMESTAMPTZ;
    v_published_count INT;
    v_existing_submitted_at TIMESTAMPTZ;
    v_final_submitted_at TIMESTAMPTZ;
    v_existing_reg RECORD;
    v_s1 UUID;
    v_s2 UUID;
    v_s3 UUID;
    v_s4 UUID;
    v_s5 UUID;
    v_s6 UUID;
    v_s7 UUID;
    v_s8 UUID;
    v_res_s1 UUID;
    v_res_s2 UUID;
    v_res_s3 UUID;
    v_res_s4 UUID;
    v_res_s5 UUID;
    v_res_s6 UUID;
    v_res_s7 UUID;
    v_res_s8 UUID;
    v_fixed_ids UUID[];
    v_cid UUID;
    v_enrolled_count INT;
    v_course_rec RECORD;
    v_already_enrolled BOOLEAN;
    v_cleaned_meta JSONB;
BEGIN
    -- 1. Validate registration window
    SELECT deadline INTO v_deadline
    FROM campus_settings
    WHERE campus_id = p_campus_id;

    IF v_deadline IS NOT NULL AND timezone('utc'::text, now()) >= v_deadline THEN
        RAISE EXCEPTION 'Registration window is closed for this campus';
    END IF;

    -- 2. Verify cohort timetable is unpublished
    SELECT count(*) INTO v_published_count
    FROM timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND campus_id = p_campus_id
      AND status = 'published';

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'Timetable has already been published for this cohort. Registrations are locked.';
    END IF;

    -- 3. Check prior submission timestamp to preserve first tiebreaker timestamp
    SELECT submitted_at INTO v_existing_submitted_at
    FROM registration_preferences
    WHERE student_id = p_student_id AND semester = p_semester AND academic_year = p_academic_year;

    IF v_existing_submitted_at IS NULL THEN
        SELECT submitted_at INTO v_existing_submitted_at
        FROM student_registrations
        WHERE student_id = p_student_id AND semester = p_semester AND academic_year = p_academic_year;
    END IF;

    v_final_submitted_at := COALESCE(v_existing_submitted_at, p_submitted_at);

    -- 4. Lock existing student registration if it exists
    SELECT * INTO v_existing_reg
    FROM student_registrations
    WHERE student_id = p_student_id AND semester = p_semester AND academic_year = p_academic_year
    FOR UPDATE;

    -- 5. Extract fixed course UUIDs safely
    v_s1 := (p_fixed_assignments->>'slot_1')::UUID;
    v_s2 := (p_fixed_assignments->>'slot_2')::UUID;
    v_s3 := (p_fixed_assignments->>'slot_3')::UUID;
    v_s4 := (p_fixed_assignments->>'slot_4')::UUID;
    v_s5 := (p_fixed_assignments->>'slot_5')::UUID;
    v_s6 := (p_fixed_assignments->>'slot_6')::UUID;
    v_s7 := (p_fixed_assignments->>'slot_7')::UUID;
    v_s8 := (p_fixed_assignments->>'slot_8')::UUID;

    -- 6. Validate distinct fixed courses
    IF NOT check_unique_course_slots(v_s1, v_s2, v_s3, v_s4, v_s5, v_s6, v_s7, v_s8) THEN
        RAISE EXCEPTION 'Duplicate course assigned among fixed slots';
    END IF;

    -- 7. Deterministically lock candidate fixed courses and enforce global capacity (R10)
    v_fixed_ids := ARRAY[]::UUID[];
    IF v_s1 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s1); END IF;
    IF v_s2 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s2); END IF;
    IF v_s3 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s3); END IF;
    IF v_s4 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s4); END IF;
    IF v_s5 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s5); END IF;
    IF v_s6 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s6); END IF;
    IF v_s7 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s7); END IF;
    IF v_s8 IS NOT NULL THEN v_fixed_ids := array_append(v_fixed_ids, v_s8); END IF;

    IF array_length(v_fixed_ids, 1) > 0 THEN
        PERFORM id FROM courses
        WHERE id = ANY(v_fixed_ids)
        ORDER BY id
        FOR UPDATE;

        FOREACH v_cid IN ARRAY v_fixed_ids
        LOOP
            -- Check if student was already enrolled in this course in their previous registration
            v_already_enrolled := (
                v_existing_reg.id IS NOT NULL AND (
                    v_existing_reg.slot_1_course_id = v_cid OR
                    v_existing_reg.slot_2_course_id = v_cid OR
                    v_existing_reg.slot_3_course_id = v_cid OR
                    v_existing_reg.slot_4_course_id = v_cid OR
                    v_existing_reg.slot_5_course_id = v_cid OR
                    v_existing_reg.slot_6_course_id = v_cid OR
                    v_existing_reg.slot_7_course_id = v_cid OR
                    v_existing_reg.slot_8_course_id = v_cid
                )
            );

            IF NOT v_already_enrolled THEN
                SELECT count(*) INTO v_enrolled_count
                FROM student_registrations
                WHERE academic_year = p_academic_year
                  AND semester = p_semester
                  AND student_id <> p_student_id
                  AND (
                      slot_1_course_id = v_cid OR
                      slot_2_course_id = v_cid OR
                      slot_3_course_id = v_cid OR
                      slot_4_course_id = v_cid OR
                      slot_5_course_id = v_cid OR
                      slot_6_course_id = v_cid OR
                      slot_7_course_id = v_cid OR
                      slot_8_course_id = v_cid
                  );

                SELECT course_code, title, COALESCE(seat_limit, 60) AS seat_limit INTO v_course_rec
                FROM courses WHERE id = v_cid;

                IF v_enrolled_count >= v_course_rec.seat_limit THEN
                    RAISE EXCEPTION 'Fixed course % (%) has reached maximum global capacity (%/% seats)',
                        v_course_rec.course_code, v_course_rec.title, v_course_rec.seat_limit, v_course_rec.seat_limit;
                END IF;
            END IF;
        END LOOP;
    END IF;

    -- 8. Pathway slot reconciliation: release removed fixed courses on pathway change (R14)
    v_res_s1 := CASE
        WHEN v_s1 IS NOT NULL THEN v_s1
        WHEN (v_existing_reg.allocation_metadata->'slot_1'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_1_course_id
    END;

    v_res_s2 := CASE
        WHEN v_s2 IS NOT NULL THEN v_s2
        WHEN (v_existing_reg.allocation_metadata->'slot_2'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_2_course_id
    END;

    v_res_s3 := CASE
        WHEN v_s3 IS NOT NULL THEN v_s3
        WHEN (v_existing_reg.allocation_metadata->'slot_3'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_3_course_id
    END;

    v_res_s4 := CASE
        WHEN v_s4 IS NOT NULL THEN v_s4
        WHEN (v_existing_reg.allocation_metadata->'slot_4'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_4_course_id
    END;

    v_res_s5 := CASE
        WHEN v_s5 IS NOT NULL THEN v_s5
        WHEN (v_existing_reg.allocation_metadata->'slot_5'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_5_course_id
    END;

    v_res_s6 := CASE
        WHEN v_s6 IS NOT NULL THEN v_s6
        WHEN (v_existing_reg.allocation_metadata->'slot_6'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_6_course_id
    END;

    v_res_s7 := CASE
        WHEN v_s7 IS NOT NULL THEN v_s7
        WHEN (v_existing_reg.allocation_metadata->'slot_7'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_7_course_id
    END;

    v_res_s8 := CASE
        WHEN v_s8 IS NOT NULL THEN v_s8
        WHEN (v_existing_reg.allocation_metadata->'slot_8'->>'allocated_by') = 'fixed' THEN NULL
        WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL
        ELSE v_existing_reg.slot_8_course_id
    END;

    -- Clean obsolete fixed metadata from p_allocation_metadata
    v_cleaned_meta := p_allocation_metadata;
    IF v_s1 IS NULL AND (v_cleaned_meta->'slot_1'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_1';
    END IF;
    IF v_s2 IS NULL AND (v_cleaned_meta->'slot_2'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_2';
    END IF;
    IF v_s3 IS NULL AND (v_cleaned_meta->'slot_3'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_3';
    END IF;
    IF v_s4 IS NULL AND (v_cleaned_meta->'slot_4'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_4';
    END IF;
    IF v_s5 IS NULL AND (v_cleaned_meta->'slot_5'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_5';
    END IF;
    IF v_s6 IS NULL AND (v_cleaned_meta->'slot_6'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_6';
    END IF;
    IF v_s7 IS NULL AND (v_cleaned_meta->'slot_7'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_7';
    END IF;
    IF v_s8 IS NULL AND (v_cleaned_meta->'slot_8'->>'allocated_by') = 'fixed' THEN
        v_cleaned_meta := v_cleaned_meta - 'slot_8';
    END IF;

    -- 9. Upsert registration_preferences
    INSERT INTO registration_preferences (
        student_id, campus_id, semester, academic_year, pathway_id,
        preferences, allocation_metadata, submitted_at, updated_at
    )
    VALUES (
        p_student_id, p_campus_id, p_semester, p_academic_year, p_pathway_id,
        p_preferences, v_cleaned_meta, v_final_submitted_at, timezone('utc'::text, now())
    )
    ON CONFLICT (student_id, semester, academic_year)
    DO UPDATE SET
        campus_id = EXCLUDED.campus_id,
        pathway_id = EXCLUDED.pathway_id,
        preferences = EXCLUDED.preferences,
        allocation_metadata = EXCLUDED.allocation_metadata,
        updated_at = timezone('utc'::text, now());

    -- 10. Upsert student_registrations
    INSERT INTO student_registrations (
        student_id, campus_id, semester, academic_year, pathway_id,
        total_credits, allocation_metadata, submitted_at,
        slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id,
        slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id
    )
    VALUES (
        p_student_id, p_campus_id, p_semester, p_academic_year, p_pathway_id,
        p_total_credits, v_cleaned_meta, v_final_submitted_at,
        v_res_s1, v_res_s2, v_res_s3, v_res_s4, v_res_s5, v_res_s6, v_res_s7, v_res_s8
    )
    ON CONFLICT (student_id, semester, academic_year)
    DO UPDATE SET
        campus_id = EXCLUDED.campus_id,
        pathway_id = EXCLUDED.pathway_id,
        total_credits = EXCLUDED.total_credits,
        allocation_metadata = EXCLUDED.allocation_metadata,
        slot_1_course_id = v_res_s1,
        slot_2_course_id = v_res_s2,
        slot_3_course_id = v_res_s3,
        slot_4_course_id = v_res_s4,
        slot_5_course_id = v_res_s5,
        slot_6_course_id = v_res_s6,
        slot_7_course_id = v_res_s7,
        slot_8_course_id = v_res_s8;

    RETURN jsonb_build_object(
        'success', true,
        'submitted_at', v_final_submitted_at,
        'preserved_first_submission', (v_existing_submitted_at IS NOT NULL)
    );
END;
$$;

-- Privileges for submit_student_registration
REVOKE ALL ON FUNCTION public.submit_student_registration(UUID, UUID, SMALLINT, TEXT, TEXT, JSONB, JSONB, JSONB, NUMERIC, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_student_registration(UUID, UUID, SMALLINT, TEXT, TEXT, JSONB, JSONB, JSONB, NUMERIC, TIMESTAMPTZ) TO service_role, postgres;

-- -----------------------------------------------------------------------------
-- 2. Upgrade execute_student_course_change (R11, Idempotency, Plan 01 security)
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

    -- 2. Verify registration window is open
    SELECT deadline INTO v_deadline
    FROM campus_settings
    WHERE campus_id = p_campus_id;

    IF v_deadline IS NULL OR timezone('utc'::text, now()) >= v_deadline THEN
        RAISE EXCEPTION 'Registration window is closed for this campus';
    END IF;

    -- 3. Verify cohort timetable is unpublished
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
    v_now_ms := (EXTRACT(EPOCH FROM timezone('utc'::text, now())) * 1000)::BIGINT;
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

    -- 12. Update registration slot and recalculate credits
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

-- Privileges for execute_student_course_change
REVOKE ALL ON FUNCTION public.execute_student_course_change(UUID, UUID, SMALLINT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_student_course_change(UUID, UUID, SMALLINT, TEXT, TEXT, UUID, TEXT) TO service_role, postgres;

-- -----------------------------------------------------------------------------
-- 3. Atomic execute_manual_course_allocation RPC (R09, R10, R12)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION execute_manual_course_allocation(
    p_student_id UUID,
    p_campus_id UUID,
    p_semester SMALLINT,
    p_academic_year TEXT,
    p_slot_key TEXT,
    p_course_id UUID,
    p_actor_id UUID,
    p_actor_role TEXT,
    p_allocated_by TEXT DEFAULT 'hod_override'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_student RECORD;
    v_target_course RECORD;
    v_reg RECORD;
    v_prev_course_id UUID;
    v_meta JSONB;
    v_enrolled_count INT;
    v_core_credits NUMERIC := 0;
    v_add_credits NUMERIC := 0;
    v_total_credits NUMERIC := 0;
    v_slot_num INT;
    v_c_id UUID;
    v_c_credits NUMERIC;
    v_alloc_meta JSONB;
    v_reg_exists BOOLEAN;
BEGIN
    -- 1. Validate slot_key
    IF p_slot_key NOT IN ('slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8') THEN
        RAISE EXCEPTION 'Invalid slot_key: %', p_slot_key;
    END IF;

    -- 2. Validate student exists and active semester matches (R12)
    SELECT id, campus_id, department_id, current_semester INTO v_student
    FROM students
    WHERE id = p_student_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student not found';
    END IF;

    IF v_student.current_semester <> p_semester THEN
        RAISE EXCEPTION 'Target semester % does not match student active semester %', p_semester, v_student.current_semester;
    END IF;

    -- 3. Fetch target course and verify semester match
    SELECT id, course_code, title, credits, department_id, semester, seat_limit, category INTO v_target_course
    FROM courses
    WHERE id = p_course_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target course not found';
    END IF;

    IF v_target_course.semester <> p_semester THEN
        RAISE EXCEPTION 'Course % is for semester %, but student is active in semester %',
            v_target_course.course_code, v_target_course.semester, p_semester;
    END IF;

    -- 4. Lock existing registration row if present
    SELECT * INTO v_reg
    FROM student_registrations
    WHERE student_id = p_student_id
      AND semester = p_semester
      AND academic_year = p_academic_year
    FOR UPDATE;

    v_reg_exists := FOUND;

    IF v_reg_exists THEN
        v_meta := COALESCE(v_reg.allocation_metadata, '{}'::jsonb);
        IF (v_meta->p_slot_key->>'allocated_by') = 'fixed' THEN
            RAISE EXCEPTION 'Cannot manually override a fixed core course slot';
        END IF;

        EXECUTE format('SELECT ($1).%I', p_slot_key || '_course_id') USING v_reg INTO v_prev_course_id;

        -- Duplicate check across other slots
        IF (p_slot_key <> 'slot_1' AND v_reg.slot_1_course_id = p_course_id) OR
           (p_slot_key <> 'slot_2' AND v_reg.slot_2_course_id = p_course_id) OR
           (p_slot_key <> 'slot_3' AND v_reg.slot_3_course_id = p_course_id) OR
           (p_slot_key <> 'slot_4' AND v_reg.slot_4_course_id = p_course_id) OR
           (p_slot_key <> 'slot_5' AND v_reg.slot_5_course_id = p_course_id) OR
           (p_slot_key <> 'slot_6' AND v_reg.slot_6_course_id = p_course_id) OR
           (p_slot_key <> 'slot_7' AND v_reg.slot_7_course_id = p_course_id) OR
           (p_slot_key <> 'slot_8' AND v_reg.slot_8_course_id = p_course_id) THEN
            RAISE EXCEPTION 'Course % is already assigned to student in another slot', v_target_course.course_code;
        END IF;
    ELSE
        v_meta := '{}'::jsonb;
        v_prev_course_id := NULL;
    END IF;

    -- 5. Deterministically lock courses (R10)
    PERFORM id FROM courses
    WHERE id IN (v_prev_course_id, p_course_id)
    ORDER BY id
    FOR UPDATE;

    -- 6. Enforce global capacity across all campuses (R10)
    SELECT count(*) INTO v_enrolled_count
    FROM student_registrations
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND student_id <> p_student_id
      AND (
          slot_1_course_id = p_course_id OR
          slot_2_course_id = p_course_id OR
          slot_3_course_id = p_course_id OR
          slot_4_course_id = p_course_id OR
          slot_5_course_id = p_course_id OR
          slot_6_course_id = p_course_id OR
          slot_7_course_id = p_course_id OR
          slot_8_course_id = p_course_id
      );

    IF v_enrolled_count >= COALESCE(v_target_course.seat_limit, 60) THEN
        RAISE EXCEPTION 'Course % has reached maximum capacity (%/% seats)',
            v_target_course.course_code, COALESCE(v_target_course.seat_limit, 60), COALESCE(v_target_course.seat_limit, 60);
    END IF;

    -- 7. Calculate credits across all slots 1..8 with the new course
    FOR v_slot_num IN 1..8
    LOOP
        IF ('slot_' || v_slot_num) = p_slot_key THEN
            v_c_id := p_course_id;
        ELSIF v_reg_exists THEN
            EXECUTE format('SELECT ($1).%I', 'slot_' || v_slot_num || '_course_id') USING v_reg INTO v_c_id;
        ELSE
            v_c_id := NULL;
        END IF;

        IF v_c_id IS NOT NULL THEN
            SELECT COALESCE(credits, 0) INTO v_c_credits FROM courses WHERE id = v_c_id;
            IF v_slot_num <= 6 THEN
                v_core_credits := v_core_credits + v_c_credits;
            ELSE
                v_add_credits := v_add_credits + v_c_credits;
            END IF;
        END IF;
    END LOOP;
    v_total_credits := v_core_credits + v_add_credits;

    -- 8. Prepare updated metadata (credit_breakdown in metadata, NOT table columns - R09)
    v_alloc_meta := jsonb_build_object(
        'allocated_by', p_allocated_by,
        'allocated_by_user_id', p_actor_id,
        'allocated_by_role', p_actor_role,
        'updated_at', timezone('utc'::text, now()),
        'course_id', p_course_id,
        'previous_course_id', v_prev_course_id
    );

    v_meta := jsonb_set(v_meta, ARRAY[p_slot_key], v_alloc_meta, true);
    v_meta := jsonb_set(v_meta, ARRAY['credit_breakdown'], jsonb_build_object(
        'core_credits', v_core_credits,
        'additional_credits', v_add_credits,
        'total_credits', v_total_credits
    ), true);

    -- 9. Upsert student_registrations without core_credits/additional_credits columns (R09)
    IF NOT v_reg_exists THEN
        INSERT INTO student_registrations (
            student_id, campus_id, semester, academic_year,
            total_credits, allocation_metadata, submitted_at,
            slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id,
            slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id
        )
        VALUES (
            p_student_id, p_campus_id, p_semester, p_academic_year,
            v_total_credits, v_meta, timezone('utc'::text, now()),
            CASE WHEN p_slot_key = 'slot_1' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_2' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_3' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_4' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_5' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_6' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_7' THEN p_course_id ELSE NULL END,
            CASE WHEN p_slot_key = 'slot_8' THEN p_course_id ELSE NULL END
        );
    ELSE
        EXECUTE format(
            'UPDATE student_registrations SET %I = $1, allocation_metadata = $2, total_credits = $3 WHERE id = $4',
            p_slot_key || '_course_id'
        ) USING p_course_id, v_meta, v_total_credits, v_reg.id;
    END IF;

    -- 10. Synchronize registration_preferences allocation_metadata if present
    UPDATE registration_preferences
    SET allocation_metadata = jsonb_set(
            COALESCE(allocation_metadata, '{}'::jsonb),
            ARRAY[p_slot_key],
            v_alloc_meta,
            true
        ),
        updated_at = timezone('utc'::text, now())
    WHERE student_id = p_student_id
      AND semester = p_semester
      AND academic_year = p_academic_year;

    RETURN jsonb_build_object(
        'success', true,
        'message', format('Manually allocated %s (%s) to %s', v_target_course.course_code, v_target_course.title, p_slot_key),
        'slot_key', p_slot_key,
        'course_id', p_course_id,
        'core_credits', v_core_credits,
        'additional_credits', v_add_credits,
        'total_credits', v_total_credits,
        'course', jsonb_build_object(
            'id', v_target_course.id,
            'course_code', v_target_course.course_code,
            'title', v_target_course.title,
            'credits', v_target_course.credits
        )
    );
END;
$$;

-- Privileges for execute_manual_course_allocation
REVOKE ALL ON FUNCTION public.execute_manual_course_allocation(UUID, UUID, SMALLINT, TEXT, TEXT, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_manual_course_allocation(UUID, UUID, SMALLINT, TEXT, TEXT, UUID, UUID, TEXT, TEXT) TO service_role, postgres;
