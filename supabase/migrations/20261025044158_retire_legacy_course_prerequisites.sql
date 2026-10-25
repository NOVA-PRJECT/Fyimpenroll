-- Release only with the matching backend/frontend after the compatible JSON field has been added.
-- Existing plain-English prerequisite lists, including Semester 4 guidance, are preserved.
BEGIN;
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.courses, public.course_prerequisite_rules IN ACCESS EXCLUSIVE MODE;

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
    FOR i IN 1..6 LOOP
      IF row_data->>('slot_'||i||'_rule') IN ('FIXED','CAMPUS_FIXED','AEC_ELECT') THEN
        tokens := array_append(tokens, row_data->>('slot_'||i||'_target'));
      END IF;
    END LOOP;
    FOR pathway IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(row_data->'pathways')='array' THEN row_data->'pathways' ELSE '[]'::jsonb END) LOOP
      FOR slot IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pathway->'slots')='array' THEN pathway->'slots' ELSE '[]'::jsonb END) LOOP
        IF slot->>'rule' IN ('FIXED','CAMPUS_FIXED','AEC_ELECT') THEN tokens := array_append(tokens, slot->>'target'); END IF;
      END LOOP;
    END LOOP;
  WHEN 'courses' THEN tokens := ARRAY[]::text[];
  WHEN 'student_registrations' THEN
    FOR i IN 1..8 LOOP tokens := array_append(tokens, row_data->>('slot_'||i||'_course_id')); END LOOP;
    tokens := tokens || public.course_reference_tokens(jsonb_build_array(row_data->'preferences', row_data->'selections', row_data->'selected_courses'));
  WHEN 'registration_preferences' THEN tokens := public.course_reference_tokens(row_data->'preferences');
  ELSE tokens := ARRAY[row_data->>'course_id', row_data->>'blocking_course_id'];
  END CASE;
  RETURN ARRAY(SELECT c.id FROM public.courses c WHERE c.id::text = ANY(tokens) OR c.course_code = ANY(tokens) ORDER BY c.id);
END $function$;

CREATE OR REPLACE FUNCTION public.course_usage_types(course_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE used text[] := ARRAY[]::text[]; item record; item_found boolean;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('student_registrations','registrations'), ('registration_preferences','ranked preferences'),
    ('semester_blueprints','explicit blueprint references'), ('teacher_course_assignments','teacher assignments'),
    ('timetable_entries','timetable records'), ('timetable_conflicts','timetable conflicts'),
    ('period_attendance','attendance records')
  ) AS types(table_name, label) LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=item.table_name) THEN
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I r WHERE $1 = ANY(public.course_row_references($2, to_jsonb(r))))', item.table_name)
      INTO item_found USING course_id, item.table_name;
      IF item_found AND NOT item.label = ANY(used) THEN used := array_append(used, item.label); END IF;
    END IF;
  END LOOP;
  RETURN used;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_course_reference_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE row_data jsonb; ref_ids uuid[]; target_sem int; invalid boolean;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(76102618164035::bigint);
  row_data := to_jsonb(NEW);
  ref_ids := public.course_row_references(TG_TABLE_NAME, row_data);
  IF row_data ? 'semester' THEN
    target_sem := (row_data->>'semester')::int;
    SELECT EXISTS (SELECT 1 FROM public.courses WHERE id = ANY(ref_ids) AND semester <> target_sem) INTO invalid;
    IF invalid THEN RAISE EXCEPTION 'A referenced course has changed semester; refresh the catalogue and retry' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.guard_course_semester_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE blockers text[];
BEGIN
  IF NEW.semester IS DISTINCT FROM OLD.semester THEN
    PERFORM pg_advisory_xact_lock(76102618164035::bigint);
    blockers := public.course_usage_types(OLD.id);
    IF cardinality(blockers) > 0 THEN
      RAISE EXCEPTION 'Course semester cannot change: %', array_to_string(blockers, ', ')
        USING ERRCODE = 'P4090', DETAIL = to_json(blockers)::text;
    END IF;

  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.update_hod_course_guarded(p_id uuid, p_department_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE saved public.courses; destination int;
BEGIN
  PERFORM pg_advisory_xact_lock(76102618164035::bigint);
  SELECT * INTO saved FROM public.courses WHERE id = p_id AND department_id = p_department_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Course not found in your department' USING ERRCODE = 'P4040'; END IF;
  destination := coalesce((p_patch->>'semester')::int, saved.semester);
  IF destination NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Semester must be between 1 and 10' USING ERRCODE='23514'; END IF;
  UPDATE public.courses SET
    course_code = coalesce(p_patch->>'course_code', saved.course_code), title = coalesce(p_patch->>'title', saved.title),
    credits = coalesce((p_patch->>'credits')::int, saved.credits), category = coalesce(p_patch->>'category', saved.category),
    theory_hours_per_week = coalesce((p_patch->>'theory_hours_per_week')::smallint, saved.theory_hours_per_week),
    practical_hours_per_week = coalesce((p_patch->>'practical_hours_per_week')::smallint, saved.practical_hours_per_week),
    seat_limit = coalesce((p_patch->>'seat_limit')::int, saved.seat_limit), semester = destination,
    prerequisites = CASE WHEN p_patch ? 'prerequisites' THEN p_patch->'prerequisites' ELSE saved.prerequisites END
    WHERE id = p_id AND department_id = p_department_id RETURNING * INTO saved;
  RETURN jsonb_build_object('id',saved.id,'semester',saved.semester);
END $function$;

CREATE OR REPLACE FUNCTION public.execute_student_course_change(p_student_id uuid, p_campus_id uuid, p_semester smallint, p_academic_year text, p_slot_key text, p_new_course_id uuid, p_client_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    SELECT id, course_code, title, credits, semester, seat_limit, prerequisites INTO v_target_course
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
            'prerequisites', v_target_course.prerequisites,
            'course_code', v_target_course.course_code,
            'title', v_target_course.title,
            'credits', v_target_course.credits
        )
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

    -- 10. Synchronize registration_preferences allocation_metadata if present
    UPDATE registration_preferences
    SET allocation_metadata = jsonb_set(
            COALESCE(allocation_metadata, '{}'::jsonb),
            ARRAY[p_slot_key],
            v_alloc_meta,
            true
        ),
        updated_at = now()
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
            'prerequisites', v_target_course.prerequisites,
            'course_code', v_target_course.course_code,
            'title', v_target_course.title,
            'credits', v_target_course.credits
        )
    );
END;
$function$;

DROP TRIGGER course_reference_guard ON public.courses;
DROP TABLE public.course_prerequisite_rules;
ALTER TABLE public.courses DROP COLUMN prerequisite_course_ids;

-- CREATE OR REPLACE preserves existing permissions; reassert the backend boundary explicitly.
REVOKE ALL ON FUNCTION public.course_row_references(text,jsonb), public.course_usage_types(uuid),
  public.guard_course_reference_write(), public.guard_course_semester_change(),
  public.update_hod_course_guarded(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.course_row_references(text,jsonb), public.course_usage_types(uuid),
  public.update_hod_course_guarded(uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
