
-- ============================================================
-- Fix: function_search_path_mutable security warnings
-- Adds SET search_path = public to all flagged functions
-- ============================================================

-- 1. delete_graduated_student
CREATE OR REPLACE FUNCTION public.delete_graduated_student()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  IF NEW.current_semester > 10 THEN
    DELETE FROM student_registrations WHERE student_id = OLD.id;
    DELETE FROM attendance WHERE student_id = OLD.id;
    DELETE FROM marks WHERE student_id = OLD.id;
    DELETE FROM students WHERE id = OLD.id;
    PERFORM auth.users_delete(OLD.id);
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. set_marks_updated_at
CREATE OR REPLACE FUNCTION public.set_marks_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- 3. trg_insert_timetable_generation_jobs
CREATE OR REPLACE FUNCTION public.trg_insert_timetable_generation_jobs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    INSERT INTO system_logs (
        id, log_type, academic_year, semester, campus_id, status, progress,
        error_message, user_id, started_at, completed_at, created_at, updated_at
    ) VALUES (
        COALESCE(NEW.id, gen_random_uuid()),
        'timetable_job',
        NEW.academic_year,
        NEW.semester,
        NEW.campus_id,
        COALESCE(NEW.status, 'queued'),
        COALESCE(NEW.progress, 0),
        NEW.error_message,
        NEW.triggered_by,
        NEW.started_at,
        NEW.completed_at,
        COALESCE(NEW.created_at, timezone('utc'::text, now())),
        COALESCE(NEW.updated_at, timezone('utc'::text, now()))
    )
    RETURNING id INTO NEW.id;
    RETURN NEW;
END;
$function$;

-- 4. trg_update_timetable_generation_jobs
CREATE OR REPLACE FUNCTION public.trg_update_timetable_generation_jobs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    UPDATE system_logs
    SET
        status = COALESCE(NEW.status, status),
        progress = COALESCE(NEW.progress, progress),
        error_message = NEW.error_message,
        started_at = COALESCE(NEW.started_at, started_at),
        completed_at = COALESCE(NEW.completed_at, completed_at),
        updated_at = timezone('utc'::text, now())
    WHERE id = OLD.id AND log_type = 'timetable_job';
    RETURN NEW;
END;
$function$;

-- 5. trg_insert_allocation_runs
CREATE OR REPLACE FUNCTION public.trg_insert_allocation_runs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    INSERT INTO system_logs (
        id, log_type, academic_year, semester, campus_id, user_id,
        status, started_at, completed_at, error_message, created_at, updated_at
    ) VALUES (
        COALESCE(NEW.id, gen_random_uuid()),
        'allocation_run',
        NEW.academic_year,
        NEW.semester,
        NEW.campus_id,
        NEW.triggered_by,
        COALESCE(NEW.status, 'running'),
        COALESCE(NEW.triggered_at, timezone('utc'::text, now())),
        NEW.completed_at,
        NEW.error_message,
        COALESCE(NEW.triggered_at, timezone('utc'::text, now())),
        timezone('utc'::text, now())
    )
    RETURNING id INTO NEW.id;
    RETURN NEW;
END;
$function$;

-- 6. trg_update_allocation_runs
CREATE OR REPLACE FUNCTION public.trg_update_allocation_runs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    UPDATE system_logs
    SET
        status = COALESCE(NEW.status, status),
        completed_at = COALESCE(NEW.completed_at, completed_at),
        error_message = NEW.error_message,
        updated_at = timezone('utc'::text, now())
    WHERE id = OLD.id AND log_type = 'allocation_run';
    RETURN NEW;
END;
$function$;

-- 7. trg_insert_audit_logs
CREATE OR REPLACE FUNCTION public.trg_insert_audit_logs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    INSERT INTO system_logs (
        id, log_type, event_type, user_id, user_role, action,
        resource_type, resource_id, status, error_message, metadata,
        ip_address, user_agent, created_at, updated_at
    ) VALUES (
        COALESCE(NEW.id, gen_random_uuid()),
        'audit_event',
        NEW.event_type,
        NEW.user_id,
        NEW.user_role,
        NEW.action,
        NEW.resource_type,
        NEW.resource_id,
        NEW.status,
        NEW.error_message,
        COALESCE(NEW.metadata, '{}'::jsonb),
        NEW.ip_address,
        NEW.user_agent,
        COALESCE(NEW.created_at, timezone('utc'::text, now())),
        COALESCE(NEW.created_at, timezone('utc'::text, now()))
    )
    RETURNING id INTO NEW.id;
    RETURN NEW;
END;
$function$;

-- 8. trg_allocation_runs_io
CREATE OR REPLACE FUNCTION public.trg_allocation_runs_io()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO system_logs (
            id, log_type, campus_id, academic_year, semester, status, user_id,
            error_message, metadata, started_at, completed_at, created_at, updated_at
        ) VALUES (
            COALESCE(NEW.id, gen_random_uuid()),
            'allocation_run', NEW.campus_id, NEW.academic_year, NEW.semester, NEW.status,
            COALESCE(NEW.triggered_by, auth.uid()),
            NEW.error_message,
            jsonb_build_object(
                'total_students', NEW.total_students,
                'fully_allocated', NEW.fully_allocated,
                'partially_allocated', NEW.partially_allocated,
                'unallocated', NEW.unallocated,
                'summary', NEW.summary
            ),
            COALESCE(NEW.started_at, clock_timestamp()), NEW.completed_at,
            COALESCE(NEW.created_at, clock_timestamp()), clock_timestamp()
        ) RETURNING id INTO NEW.id;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE system_logs SET
            status = NEW.status,
            error_message = NEW.error_message,
            completed_at = NEW.completed_at,
            metadata = jsonb_build_object(
                'total_students', NEW.total_students,
                'fully_allocated', NEW.fully_allocated,
                'partially_allocated', NEW.partially_allocated,
                'unallocated', NEW.unallocated,
                'summary', NEW.summary
            ),
            updated_at = clock_timestamp()
        WHERE id = OLD.id AND log_type = 'allocation_run';
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$function$;

-- 9. trg_timetable_jobs_io
CREATE OR REPLACE FUNCTION public.trg_timetable_jobs_io()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO system_logs (
            id, log_type, campus_id, academic_year, semester, status, progress, user_id,
            error_message, metadata, started_at, completed_at, created_at, updated_at
        ) VALUES (
            COALESCE(NEW.id, gen_random_uuid()),
            'timetable_job', NEW.campus_id, NEW.academic_year, NEW.semester, NEW.status,
            COALESCE(NEW.progress, 0),
            COALESCE(NEW.triggered_by, auth.uid()),
            NEW.error_message,
            jsonb_build_object('config', COALESCE(NEW.config, '{}'::jsonb)),
            COALESCE(NEW.started_at, clock_timestamp()), NEW.completed_at,
            COALESCE(NEW.created_at, clock_timestamp()), clock_timestamp()
        ) RETURNING id INTO NEW.id;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE system_logs SET
            status = NEW.status,
            progress = NEW.progress,
            error_message = NEW.error_message,
            completed_at = NEW.completed_at,
            metadata = jsonb_build_object('config', COALESCE(NEW.config, '{}'::jsonb)),
            updated_at = clock_timestamp()
        WHERE id = OLD.id AND log_type = 'timetable_job';
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$function$;

-- 10. apply_course_allocation (original 5-param signature)
CREATE OR REPLACE FUNCTION public.apply_course_allocation(p_run_id uuid, p_campus_id uuid, p_academic_year text, p_semester smallint, p_allocations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    item JSONB;
    v_reg_id UUID;
    v_slot_key TEXT;
    v_course_id UUID;
    v_meta JSONB;
    v_sql TEXT;
BEGIN
    -- Step A: Reset elective slots back to NULL for registrations in this campus, academic_year, and semester
    UPDATE student_registrations sr
    SET
        slot_1_course_id = CASE WHEN sr.allocation_metadata->'slot_1'->>'allocated_by' = 'fixed' THEN sr.slot_1_course_id ELSE NULL END,
        slot_2_course_id = CASE WHEN sr.allocation_metadata->'slot_2'->>'allocated_by' = 'fixed' THEN sr.slot_2_course_id ELSE NULL END,
        slot_3_course_id = CASE WHEN sr.allocation_metadata->'slot_3'->>'allocated_by' = 'fixed' THEN sr.slot_3_course_id ELSE NULL END,
        slot_4_course_id = CASE WHEN sr.allocation_metadata->'slot_4'->>'allocated_by' = 'fixed' THEN sr.slot_4_course_id ELSE NULL END,
        slot_5_course_id = CASE WHEN sr.allocation_metadata->'slot_5'->>'allocated_by' = 'fixed' THEN sr.slot_5_course_id ELSE NULL END,
        slot_6_course_id = CASE WHEN sr.allocation_metadata->'slot_6'->>'allocated_by' = 'fixed' THEN sr.slot_6_course_id ELSE NULL END,
        allocation_metadata = jsonb_strip_nulls(
            jsonb_build_object(
                'slot_1', CASE WHEN sr.allocation_metadata->'slot_1'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_1' ELSE NULL END,
                'slot_2', CASE WHEN sr.allocation_metadata->'slot_2'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_2' ELSE NULL END,
                'slot_3', CASE WHEN sr.allocation_metadata->'slot_3'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_3' ELSE NULL END,
                'slot_4', CASE WHEN sr.allocation_metadata->'slot_4'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_4' ELSE NULL END,
                'slot_5', CASE WHEN sr.allocation_metadata->'slot_5'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_5' ELSE NULL END,
                'slot_6', CASE WHEN sr.allocation_metadata->'slot_6'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_6' ELSE NULL END
            )
        )
    WHERE sr.campus_id = p_campus_id
      AND sr.academic_year = p_academic_year
      AND sr.semester = p_semester;

    -- Step B: Iterate through winning elective allocations and apply them
    FOR item IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_reg_id := (item->>'registration_id')::UUID;
        v_slot_key := item->>'slot_key';
        v_course_id := (item->>'course_id')::UUID;
        v_meta := item->'metadata';

        IF v_slot_key IN ('slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6') THEN
            v_sql := format(
                'UPDATE student_registrations SET %I = $1, allocation_metadata = COALESCE(allocation_metadata, ''{}''::jsonb) || jsonb_build_object($2, $3) WHERE id = $4',
                v_slot_key || '_course_id'
            );
            EXECUTE v_sql USING v_course_id, v_slot_key, v_meta, v_reg_id;
        END IF;
    END LOOP;

    -- Step C: Mark the allocation run as completed in system_logs
    UPDATE system_logs
    SET status = 'completed',
        completed_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now())
    WHERE id = p_run_id AND log_type = 'allocation_run';

    RETURN jsonb_build_object(
        'success', true,
        'run_id', p_run_id,
        'allocated_count', jsonb_array_length(p_allocations)
    );
END;
$function$;

-- 11. apply_course_allocation (6-param signature with p_unallocated)
CREATE OR REPLACE FUNCTION public.apply_course_allocation(p_run_id uuid, p_campus_id uuid, p_academic_year text, p_semester smallint, p_allocations jsonb, p_unallocated jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    item JSONB;
    v_student_id UUID;
    v_reg_id UUID;
    v_slot_key TEXT;
    v_course_id UUID;
    v_meta JSONB;
    v_sql TEXT;
BEGIN
    -- Reset non-fixed elective slots back to NULL for this cohort
    UPDATE student_registrations sr
    SET
        slot_1_course_id = CASE WHEN sr.allocation_metadata->'slot_1'->>'allocated_by' = 'fixed' THEN sr.slot_1_course_id ELSE NULL END,
        slot_2_course_id = CASE WHEN sr.allocation_metadata->'slot_2'->>'allocated_by' = 'fixed' THEN sr.slot_2_course_id ELSE NULL END,
        slot_3_course_id = CASE WHEN sr.allocation_metadata->'slot_3'->>'allocated_by' = 'fixed' THEN sr.slot_3_course_id ELSE NULL END,
        slot_4_course_id = CASE WHEN sr.allocation_metadata->'slot_4'->>'allocated_by' = 'fixed' THEN sr.slot_4_course_id ELSE NULL END,
        slot_5_course_id = CASE WHEN sr.allocation_metadata->'slot_5'->>'allocated_by' = 'fixed' THEN sr.slot_5_course_id ELSE NULL END,
        slot_6_course_id = CASE WHEN sr.allocation_metadata->'slot_6'->>'allocated_by' = 'fixed' THEN sr.slot_6_course_id ELSE NULL END,
        allocation_metadata = jsonb_strip_nulls(
            jsonb_build_object(
                'slot_1', CASE WHEN sr.allocation_metadata->'slot_1'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_1' ELSE NULL END,
                'slot_2', CASE WHEN sr.allocation_metadata->'slot_2'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_2' ELSE NULL END,
                'slot_3', CASE WHEN sr.allocation_metadata->'slot_3'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_3' ELSE NULL END,
                'slot_4', CASE WHEN sr.allocation_metadata->'slot_4'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_4' ELSE NULL END,
                'slot_5', CASE WHEN sr.allocation_metadata->'slot_5'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_5' ELSE NULL END,
                'slot_6', CASE WHEN sr.allocation_metadata->'slot_6'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_6' ELSE NULL END
            )
        )
    WHERE sr.campus_id = p_campus_id
      AND sr.academic_year = p_academic_year
      AND sr.semester = p_semester;

    -- Apply allocated slots
    FOR item IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_student_id := (item->>'student_id')::UUID;
        v_slot_key   := item->>'slot_key';
        v_course_id  := (item->>'course_id')::UUID;
        v_meta       := item->'metadata';

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

    -- Apply unallocated metadata
    FOR item IN SELECT * FROM jsonb_array_elements(p_unallocated)
    LOOP
        v_student_id := (item->>'student_id')::UUID;
        v_slot_key   := item->>'slot_key';
        v_meta       := item->'metadata';

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

    -- Recalculate credit sums on student_registrations
    UPDATE student_registrations sr
    SET total_credits = COALESCE(
        (SELECT SUM(c.credits)
         FROM courses c
         WHERE c.id IN (
             sr.slot_1_course_id, sr.slot_2_course_id, sr.slot_3_course_id,
             sr.slot_4_course_id, sr.slot_5_course_id, sr.slot_6_course_id
         )), 0)
    WHERE sr.campus_id = p_campus_id
      AND sr.academic_year = p_academic_year
      AND sr.semester = p_semester;

    RETURN jsonb_build_object(
        'success', true,
        'allocated_slots_applied', jsonb_array_length(p_allocations),
        'unallocated_slots_applied', jsonb_array_length(p_unallocated)
    );
END;
$function$;

-- 12. trg_audit_logs_io
CREATE OR REPLACE FUNCTION public.trg_audit_logs_io()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO system_logs (
            id, log_type, event_type, user_id, user_role, action, resource_type,
            resource_id, status, error_message, metadata, ip_address, created_at, updated_at
        ) VALUES (
            COALESCE(NEW.id, gen_random_uuid()),
            'audit_event', NEW.event_type, NEW.user_id, NEW.user_role, NEW.action,
            NEW.resource_type, NEW.resource_id, NEW.status, NEW.error_message,
            COALESCE(NEW.metadata, '{}'::jsonb), NEW.ip_address,
            COALESCE(NEW.created_at, clock_timestamp()), clock_timestamp()
        ) RETURNING id INTO NEW.id;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$function$;

-- 13. delete_campus_cascade
CREATE OR REPLACE FUNCTION public.delete_campus_cascade(p_campus_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
    DELETE FROM campuses WHERE id = p_campus_id;
END;
$function$;

-- 14. delete_department_cascade
CREATE OR REPLACE FUNCTION public.delete_department_cascade(p_dept_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
    DELETE FROM departments WHERE id = p_dept_id;
END;
$function$;

-- 15. promote_campus_students
CREATE OR REPLACE FUNCTION public.promote_campus_students(p_campus_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE students
    SET current_semester = current_semester + 1
    WHERE campus_id = p_campus_id AND current_semester < 10;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;

    UPDATE campus_settings
    SET last_promoted_at = timezone('utc'::text, now())
    WHERE campus_id = p_campus_id;

    RETURN jsonb_build_object('success', true, 'promoted_count', v_count);
END;
$function$;
