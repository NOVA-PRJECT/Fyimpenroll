-- Coordinated application release only. Take and verify the cleanup export first.
-- This migration deliberately discards the legacy registration preferences column.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='60s';
LOCK TABLE public.student_registrations, public.registration_preferences, public.semester_blueprints,
  public.courses, public.time_slots, public.graduation_operations, public.graduation_candidates,
  public.system_logs IN ACCESS EXCLUSIVE MODE;
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.system_logs WHERE log_type IN ('allocation_run','timetable_job') AND status IN ('queued','running')) THEN
    RAISE EXCEPTION 'Drain allocation and timetable workers before schema cleanup';
  END IF;
  IF EXISTS (SELECT 1 FROM public.graduation_operations WHERE status NOT IN ('completed','failed')) THEN
    RAISE EXCEPTION 'Finish or resolve graduation operations before schema cleanup';
  END IF;
END $preflight$;

-- Existing JSON pathways win; old-only blueprints receive their previous default ID.
DO $backfill$
DECLARE b record; slots jsonb; item jsonb; last_slot integer; i integer;
BEGIN
  FOR b IN SELECT id,to_jsonb(t) AS data FROM public.semester_blueprints t WHERE pathways IS NULL OR pathways='[]'::jsonb LOOP
    last_slot := 0;
    FOR i IN 1..6 LOOP
      IF coalesce(b.data->>('slot_'||i||'_rule'),'') <> '' THEN last_slot := i; END IF;
    END LOOP;
    slots := '[]'::jsonb;
    FOR i IN 1..last_slot LOOP
      item := jsonb_build_object('rule',coalesce(b.data->>('slot_'||i||'_rule'),''),
        'target',coalesce(b.data->>('slot_'||i||'_target'),''),
        'name',coalesce(b.data->>('slot_'||i||'_name'),'Paper '||i));
      slots := slots || jsonb_build_array(item);
    END LOOP;
    UPDATE public.semester_blueprints SET pathways=CASE WHEN last_slot=0 THEN '[]'::jsonb ELSE
      jsonb_build_array(jsonb_build_object('id','legacy-default','name','Default','slots',slots)) END WHERE id=b.id;
  END LOOP;
END $backfill$;

CREATE OR REPLACE FUNCTION public.course_row_references(table_name text, row_data jsonb)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE tokens text[] := ARRAY[]::text[]; slot jsonb; pathway jsonb; i int;
BEGIN
  CASE table_name
  WHEN 'semester_blueprints' THEN
    FOR pathway IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(row_data->'pathways')='array' THEN row_data->'pathways' ELSE '[]'::jsonb END) LOOP
      FOR slot IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pathway->'slots')='array' THEN pathway->'slots' ELSE '[]'::jsonb END) LOOP
        IF slot->>'rule' IN ('FIXED','CAMPUS_FIXED','AEC_ELECT') THEN tokens := array_append(tokens, slot->>'target'); END IF;
      END LOOP;
    END LOOP;
  WHEN 'courses' THEN tokens := ARRAY[]::text[];
  WHEN 'student_registrations' THEN
    FOR i IN 1..8 LOOP tokens := array_append(tokens, row_data->>('slot_'||i||'_course_id')); END LOOP;
    tokens := tokens || public.course_reference_tokens(row_data->'selections');
  WHEN 'registration_preferences' THEN tokens := public.course_reference_tokens(row_data->'preferences');
  ELSE tokens := ARRAY[row_data->>'course_id', row_data->>'blocking_course_id'];
  END CASE;
  RETURN ARRAY(SELECT c.id FROM public.courses c WHERE c.id::text = ANY(tokens) OR c.course_code = ANY(tokens) ORDER BY c.id);
END $function$;

CREATE OR REPLACE FUNCTION public.submit_student_registration(p_student_id uuid, p_campus_id uuid, p_semester smallint, p_academic_year text, p_pathway_id text, p_preferences jsonb, p_allocation_metadata jsonb, p_fixed_assignments jsonb, p_total_credits numeric, p_submitted_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

    IF v_deadline IS NOT NULL AND now() >= v_deadline THEN
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

            IF v_already_enrolled IS NOT TRUE THEN
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
        preferences, submitted_at, updated_at
    )
    VALUES (
        p_student_id, p_campus_id, p_semester, p_academic_year, p_pathway_id,
        p_preferences, v_final_submitted_at, now()
    )
    ON CONFLICT (student_id, semester, academic_year)
    DO UPDATE SET
        campus_id = EXCLUDED.campus_id,
        pathway_id = EXCLUDED.pathway_id,
        preferences = EXCLUDED.preferences,
        updated_at = now();

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
$function$;

CREATE OR REPLACE FUNCTION public.execute_manual_course_allocation(p_student_id uuid, p_campus_id uuid, p_semester smallint, p_academic_year text, p_slot_key text, p_course_id uuid, p_actor_id uuid, p_actor_role text, p_allocated_by text DEFAULT 'hod_override'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_student RECORD;
    v_target_course RECORD;
    v_reg public.student_registrations%ROWTYPE;
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
    SELECT id, course_code, title, credits, department_id, semester, seat_limit, category, prerequisites INTO v_target_course
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
        'updated_at', now(),
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
            v_total_credits, v_meta, now(),
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
            'prerequisites', v_target_course.prerequisites,
            'course_code', v_target_course.course_code,
            'title', v_target_course.title,
            'credits', v_target_course.credits
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_graduation(p_campus_id uuid, p_student_ids uuid[], p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  INSERT INTO graduation_operations (idempotency_key, campus_id, academic_year, initiated_by, total_candidates)
  VALUES ('grad:' || p_campus_id::text || ':' || md5(v_ids::text), p_campus_id,
    COALESCE((SELECT academic_year FROM campus_settings WHERE campus_id = p_campus_id), 'unknown'),
    p_actor_id, cardinality(v_ids))
  ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now() RETURNING id INTO v_operation;
  INSERT INTO graduation_candidates(operation_id, student_id, campus_id)
    SELECT v_operation, id, p_campus_id FROM unnest(v_ids) id ON CONFLICT (student_id) DO NOTHING;
  RETURN (SELECT jsonb_agg(to_jsonb(c) ORDER BY student_id) FROM graduation_candidates c WHERE student_id = ANY(v_ids));
END $function$;

CREATE OR REPLACE FUNCTION public.finish_graduation_candidate(p_campus_id uuid, p_student_id uuid, p_error_stage text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE graduation_candidates SET stage = CASE WHEN p_error_stage IS NULL AND stage = 'database_deleted' THEN 'completed' ELSE stage END,
    last_error_stage = p_error_stage, updated_at = now()
    WHERE student_id = p_student_id AND campus_id = p_campus_id;
  UPDATE graduation_operations o SET
    graduated_count = (SELECT count(*) FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage = 'completed'),
    auth_deleted_count = (SELECT count(*) FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage = 'completed'),
    db_deleted_count = (SELECT count(*) FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage <> 'pending'),
    failed_count = (SELECT count(*) FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage <> 'completed'),
    status = CASE WHEN EXISTS(SELECT 1 FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage <> 'completed') THEN 'partially_failed' ELSE 'completed' END,
    updated_at = now()
    WHERE o.id = (SELECT operation_id FROM graduation_candidates WHERE student_id = p_student_id);
END $function$;

-- Lock the full application schema during the retained-data comparison.
CREATE TEMP TABLE schema_cleanup_fingerprints (table_name text PRIMARY KEY, fingerprint jsonb) ON COMMIT DROP;
CREATE FUNCTION pg_temp.schema_cleanup_digest(relation_name text) RETURNS jsonb
LANGUAGE plpgsql AS $digest$
DECLARE result jsonb; omitted text[]; projection text;
BEGIN
  omitted := CASE relation_name
    WHEN 'courses' THEN ARRAY['tag']
    WHEN 'student_registrations' THEN ARRAY['preferences','selected_courses']
    WHEN 'registration_preferences' THEN ARRAY['allocation_metadata','legacy_allocation_metadata_snapshot']
    WHEN 'time_slots' THEN ARRAY['is_lab_block','lab_pair_with']
    WHEN 'graduation_operations' THEN ARRAY['candidate_student_ids','completed_student_ids','failed_student_ids','stage_details']
    WHEN 'semester_blueprints' THEN ARRAY['slot_1_rule','slot_1_target','slot_1_name','slot_2_rule','slot_2_target','slot_2_name','slot_3_rule','slot_3_target','slot_3_name','slot_4_rule','slot_4_target','slot_4_name','slot_5_rule','slot_5_target','slot_5_name','slot_6_rule','slot_6_target','slot_6_name']
    ELSE ARRAY[]::text[] END;
  projection := format('(to_jsonb(t) - %L::text[])', omitted);
  IF relation_name='registration_preferences' THEN
    projection := projection || ' || jsonb_build_object(''metadata_snapshot'',coalesce(to_jsonb(t)->''allocation_metadata'',to_jsonb(t)->''legacy_allocation_metadata_snapshot''))';
  END IF;
  EXECUTE format($query$SELECT jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5((%s)::text),'' ORDER BY md5((%s)::text)),''))) FROM public.%I t$query$,projection,projection,relation_name) INTO result;
  RETURN result;
END $digest$;
DO $capture$
DECLARE item record;
BEGIN
  FOR item IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',item.relname);
    INSERT INTO schema_cleanup_fingerprints VALUES(item.relname,pg_temp.schema_cleanup_digest(item.relname));
  END LOOP;
END $capture$;

-- Rename the historical copy, but never read or update it as current allocation state.
ALTER TABLE public.registration_preferences RENAME COLUMN allocation_metadata TO legacy_allocation_metadata_snapshot;
-- Future submissions do not acquire a historical snapshot.
ALTER TABLE public.registration_preferences ALTER COLUMN legacy_allocation_metadata_snapshot DROP DEFAULT;

DROP TRIGGER trg_graduate_student ON public.students;
DROP FUNCTION public.delete_graduated_student() RESTRICT;
DROP VIEW public.allocation_runs RESTRICT;
DROP VIEW public.audit_logs RESTRICT;
DROP VIEW public.timetable_generation_jobs RESTRICT;
DROP FUNCTION public.trg_allocation_runs_io() RESTRICT;
DROP FUNCTION public.trg_audit_logs_io() RESTRICT;
DROP FUNCTION public.trg_timetable_jobs_io() RESTRICT;

ALTER TABLE public.student_registrations DROP COLUMN preferences RESTRICT, DROP COLUMN selected_courses RESTRICT;
ALTER TABLE public.courses DROP COLUMN tag RESTRICT;
ALTER TABLE public.time_slots DROP COLUMN is_lab_block RESTRICT, DROP COLUMN lab_pair_with RESTRICT;
ALTER TABLE public.graduation_operations DROP COLUMN candidate_student_ids RESTRICT,
  DROP COLUMN completed_student_ids RESTRICT, DROP COLUMN failed_student_ids RESTRICT, DROP COLUMN stage_details RESTRICT;
ALTER TABLE public.semester_blueprints DROP COLUMN slot_1_rule RESTRICT, DROP COLUMN slot_1_target RESTRICT, DROP COLUMN slot_1_name RESTRICT;
ALTER TABLE public.semester_blueprints DROP COLUMN slot_2_rule RESTRICT, DROP COLUMN slot_2_target RESTRICT, DROP COLUMN slot_2_name RESTRICT;
ALTER TABLE public.semester_blueprints DROP COLUMN slot_3_rule RESTRICT, DROP COLUMN slot_3_target RESTRICT, DROP COLUMN slot_3_name RESTRICT;
ALTER TABLE public.semester_blueprints DROP COLUMN slot_4_rule RESTRICT, DROP COLUMN slot_4_target RESTRICT, DROP COLUMN slot_4_name RESTRICT;
ALTER TABLE public.semester_blueprints DROP COLUMN slot_5_rule RESTRICT, DROP COLUMN slot_5_target RESTRICT, DROP COLUMN slot_5_name RESTRICT;
ALTER TABLE public.semester_blueprints DROP COLUMN slot_6_rule RESTRICT, DROP COLUMN slot_6_target RESTRICT, DROP COLUMN slot_6_name RESTRICT;

CREATE OR REPLACE FUNCTION public.production_readiness()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object('ready',
    to_regclass('public.course_prerequisite_rules') IS NULL
    AND to_regclass('public.allocation_runs') IS NULL
    AND to_regclass('public.audit_logs') IS NULL
    AND to_regclass('public.timetable_generation_jobs') IS NULL
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND
      ((table_name='student_registrations' AND column_name IN ('preferences','selected_courses'))
       OR (table_name='courses' AND column_name IN ('prerequisite_course_ids','tag'))
       OR (table_name='semester_blueprints' AND column_name ~ '^slot_[1-6]_(rule|target|name)$')
       OR (table_name='registration_preferences' AND column_name='allocation_metadata')
       OR (table_name='time_slots' AND column_name IN ('is_lab_block','lab_pair_with'))
       OR (table_name='graduation_operations' AND column_name IN ('candidate_student_ids','completed_student_ids','failed_student_ids','stage_details'))))
    AND to_regprocedure('public.delete_graduated_student()') IS NULL
    AND
    to_regprocedure('public.mutate_teacher_assignments(uuid,text,jsonb,uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.publish_timetable_cohort(uuid,text,integer)') IS NOT NULL
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
$function$;

-- Replacements preserve the existing backend-only grants.
REVOKE ALL ON FUNCTION public.course_row_references(text,jsonb), public.production_readiness() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.course_row_references(text,jsonb), public.production_readiness() TO service_role;
DO $verify$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM schema_cleanup_fingerprints LOOP
    IF item.fingerprint IS DISTINCT FROM pg_temp.schema_cleanup_digest(item.table_name) THEN
      RAISE EXCEPTION 'Schema cleanup changed retained records in %',item.table_name;
    END IF;
  END LOOP;
END $verify$;
DROP FUNCTION pg_temp.schema_cleanup_digest(text);
NOTIFY pgrst,'reload schema';
COMMIT;
