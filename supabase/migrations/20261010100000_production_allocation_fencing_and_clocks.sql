BEGIN;
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
COMMIT;
