-- Application schema snapshot, 2026-10-22. Restore into a fresh Supabase database as postgres.

-- Historical migrations through 20261020135038 are already represented; do not replay them.

-- This contains schema and migration receipts only. Account/business backups are separate.

BEGIN;

SET LOCAL check_function_bodies = false;

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public."admins" (
  "id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "role" text NOT NULL
);

CREATE TABLE public."campus_settings" (
  "id" uuid NOT NULL,
  "campus_id" uuid NOT NULL,
  "deadline" timestamp with time zone,
  "academic_year" text NOT NULL,
  "min_credits" integer NOT NULL,
  "max_credits" integer NOT NULL,
  "last_promoted_at" timestamp with time zone,
  "timetable_constraints" jsonb
);

CREATE TABLE public."campus_sign_ins" (
  "id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "campus_id" uuid NOT NULL,
  "session_type" text NOT NULL,
  "signed_in_at" timestamp with time zone NOT NULL,
  "signed_in_date" date GENERATED ALWAYS AS (((signed_in_at AT TIME ZONE 'Asia/Kolkata'::text))::date) STORED,
  "location_accuracy_meters" numeric NOT NULL,
  "status" text NOT NULL,
  "source" text NOT NULL
);

CREATE TABLE public."campuses" (
  "id" uuid NOT NULL,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "center_latitude" numeric,
  "center_longitude" numeric,
  "radius_meters" integer,
  "morning_cutoff_time" time without time zone,
  "midday_split_time" time without time zone,
  "evening_cutoff_time" time without time zone,
  "day_end_time" time without time zone
);

CREATE TABLE public."consent_records" (
  "id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "policy_version" text NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL
);

CREATE TABLE public."course_prerequisite_rules" (
  "id" uuid NOT NULL,
  "course_id" uuid NOT NULL,
  "rule" text NOT NULL,
  "target" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);

CREATE TABLE public."courses" (
  "id" uuid NOT NULL,
  "course_code" text NOT NULL,
  "title" text NOT NULL,
  "department_id" uuid NOT NULL,
  "semester" integer NOT NULL,
  "credits" integer NOT NULL,
  "category" text NOT NULL,
  "tag" text,
  "theory_hours_per_week" smallint NOT NULL,
  "practical_hours_per_week" smallint NOT NULL,
  "seat_limit" integer,
  "prerequisite_course_ids" uuid[],
  "academic_level" character varying(10)
);

CREATE TABLE public."department_notices" (
  "id" uuid NOT NULL,
  "campus_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "created_by" uuid,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);

CREATE TABLE public."departments" (
  "id" uuid NOT NULL,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "campus_id" uuid NOT NULL
);

CREATE TABLE public."faculty" (
  "id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "role" text NOT NULL,
  "department_id" uuid,
  "campus_id" uuid NOT NULL
);

CREATE TABLE public."graduation_candidates" (
  "operation_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "campus_id" uuid NOT NULL,
  "stage" text NOT NULL,
  "last_error_stage" text,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE public."graduation_operations" (
  "id" uuid NOT NULL,
  "idempotency_key" text NOT NULL,
  "campus_id" uuid NOT NULL,
  "academic_year" text NOT NULL,
  "initiated_by" uuid NOT NULL,
  "status" text NOT NULL,
  "total_candidates" integer NOT NULL,
  "graduated_count" integer NOT NULL,
  "db_deleted_count" integer NOT NULL,
  "auth_deleted_count" integer NOT NULL,
  "failed_count" integer NOT NULL,
  "candidate_student_ids" uuid[] NOT NULL,
  "completed_student_ids" uuid[] NOT NULL,
  "failed_student_ids" uuid[] NOT NULL,
  "stage_details" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE public."period_attendance" (
  "id" uuid NOT NULL,
  "timetable_slot_id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "course_id" uuid NOT NULL,
  "marked_by" uuid,
  "status" text NOT NULL,
  "marked_at" timestamp with time zone NOT NULL,
  "is_late_entry" boolean NOT NULL,
  "unlocked_by" uuid,
  "attendance_date" date NOT NULL
);

CREATE TABLE public."period_attendance_sessions" (
  "id" uuid NOT NULL,
  "timetable_slot_id" uuid NOT NULL,
  "attendance_date" date NOT NULL,
  "revision" integer NOT NULL,
  "revision_token" text NOT NULL,
  "marked_by" uuid,
  "last_marked_at" timestamp with time zone NOT NULL,
  "total_students" integer NOT NULL,
  "present_count" integer NOT NULL,
  "absent_count" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE public."period_unlock_requests" (
  "id" uuid NOT NULL,
  "timetable_slot_id" uuid NOT NULL,
  "unlocked_by" uuid NOT NULL,
  "unlocked_at" timestamp with time zone NOT NULL,
  "reason" text NOT NULL
);

CREATE TABLE public."promotion_receipts" (
  "campus_id" uuid NOT NULL,
  "request_key" text NOT NULL,
  "result" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);

CREATE TABLE public."registration_preferences" (
  "id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "campus_id" uuid NOT NULL,
  "semester" smallint NOT NULL,
  "academic_year" text NOT NULL,
  "pathway_id" text,
  "preferences" jsonb NOT NULL,
  "allocation_metadata" jsonb,
  "submitted_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE public."retired_cohorts" (
  "id" uuid NOT NULL,
  "campus_id" uuid NOT NULL,
  "academic_year" text NOT NULL,
  "semester" smallint NOT NULL,
  "retired_at" timestamp with time zone NOT NULL,
  "retired_by" uuid,
  "reason" text
);

CREATE TABLE public."schema_migrations" (
  "version" character varying(255) NOT NULL,
  "name" character varying(255) NOT NULL,
  "applied_at" timestamp with time zone NOT NULL
);

CREATE TABLE public."semester_blueprints" (
  "id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "semester" integer NOT NULL,
  "min_credits" integer NOT NULL,
  "max_credits" integer NOT NULL,
  "slot_1_rule" text,
  "slot_1_target" text,
  "slot_2_rule" text,
  "slot_2_target" text,
  "slot_3_rule" text,
  "slot_3_target" text,
  "slot_4_rule" text,
  "slot_4_target" text,
  "slot_5_rule" text,
  "slot_5_target" text,
  "slot_6_rule" text,
  "slot_6_target" text,
  "slot_1_name" text,
  "slot_2_name" text,
  "slot_3_name" text,
  "slot_4_name" text,
  "slot_5_name" text,
  "slot_6_name" text,
  "pathways" jsonb
);

CREATE TABLE public."student_registrations" (
  "id" uuid NOT NULL,
  "student_id" uuid NOT NULL,
  "campus_id" uuid NOT NULL,
  "semester" integer NOT NULL,
  "academic_year" text NOT NULL,
  "slot_1_course_id" uuid,
  "slot_2_course_id" uuid,
  "slot_3_course_id" uuid,
  "slot_4_course_id" uuid,
  "slot_5_course_id" uuid,
  "slot_6_course_id" uuid,
  "total_credits" integer NOT NULL,
  "submitted_at" timestamp with time zone NOT NULL,
  "pathway_id" text,
  "selections" jsonb,
  "preferences" jsonb,
  "allocation_metadata" jsonb,
  "selected_courses" jsonb,
  "slot_7_course_id" uuid,
  "slot_8_course_id" uuid
);

CREATE TABLE public."students" (
  "id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "department_id" uuid NOT NULL,
  "campus_id" uuid NOT NULL,
  "current_semester" integer NOT NULL,
  "cap_application_number" text NOT NULL,
  "academic_year_joined" text NOT NULL,
  "must_change_password" boolean NOT NULL
);

CREATE TABLE public."system_logs" (
  "id" uuid NOT NULL,
  "log_type" text NOT NULL,
  "status" text NOT NULL,
  "progress" smallint,
  "error_message" text,
  "error_stack" text,
  "campus_id" uuid,
  "academic_year" text,
  "semester" smallint,
  "user_id" uuid,
  "user_role" text,
  "event_type" text,
  "action" text,
  "resource_type" text,
  "resource_id" uuid,
  "ip_address" inet,
  "user_agent" text,
  "route" text,
  "metadata" jsonb,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE TABLE public."teacher_course_assignments" (
  "id" uuid NOT NULL,
  "teacher_id" uuid NOT NULL,
  "course_id" uuid NOT NULL,
  "assigned_by" uuid,
  "assigned_at" timestamp with time zone NOT NULL,
  "campus_id" uuid,
  "academic_year" text,
  "semester" integer
);

CREATE TABLE public."time_slots" (
  "id" uuid NOT NULL,
  "day_of_week" smallint NOT NULL,
  "period_number" smallint NOT NULL,
  "start_time" time without time zone NOT NULL,
  "end_time" time without time zone NOT NULL,
  "is_lab_block" boolean NOT NULL,
  "lab_pair_with" uuid
);

CREATE TABLE public."timetable_conflicts" (
  "id" uuid NOT NULL,
  "academic_year" text NOT NULL,
  "semester" smallint NOT NULL,
  "course_id" uuid NOT NULL,
  "blocking_course_id" uuid,
  "reason" text NOT NULL,
  "conflicting_student_count" integer,
  "resolved" boolean NOT NULL,
  "created_at" timestamp with time zone
);

CREATE TABLE public."timetable_entries" (
  "id" uuid NOT NULL,
  "academic_year" text NOT NULL,
  "semester" smallint NOT NULL,
  "course_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "time_slot_id" uuid NOT NULL,
  "is_lab_block" boolean NOT NULL,
  "status" text NOT NULL,
  "generated_by" uuid,
  "generated_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "session_type" text NOT NULL,
  "teacher_id" uuid,
  "class_id" uuid,
  "campus_id" uuid
);

CREATE OR REPLACE FUNCTION public.apply_course_allocation(p_run_id uuid, p_campus_id uuid, p_academic_year text, p_semester smallint, p_allocations jsonb, p_unallocated jsonb DEFAULT '[]'::jsonb, p_summary jsonb DEFAULT '{}'::jsonb, p_fencing_token uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.atomic_copy_practical_attendance(p_source_slot_id uuid, p_target_slot_id uuid, p_attendance_date date, p_user_id uuid, p_expected_target_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_src RECORD;
    v_tgt RECORD;
    v_src_campus_id UUID;
    v_tgt_campus_id UUID;
    v_src_period INTEGER;
    v_tgt_period INTEGER;
    v_tgt_session RECORD;
    v_current_tgt_rev INTEGER := 0;
    v_new_tgt_rev INTEGER := 1;
    v_tgt_rev_token TEXT;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_copied_count INTEGER := 0;
    v_present_count INTEGER := 0;
    v_absent_count INTEGER := 0;
    v_lock_key BIGINT;
    v_mark RECORD;
BEGIN
    -- A. Transactional advisory lock on target session
    v_lock_key := ('x' || substr(md5(p_target_slot_id::text || '_' || p_attendance_date::text), 1, 15))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- B. Query source timetable entry
    SELECT 
        te.id, te.course_id, te.department_id, te.campus_id, te.academic_year,
        te.semester, te.status, te.session_type, te.is_lab_block,
        ts.day_of_week, ts.period_number,
        d.campus_id AS dept_campus_id
    INTO v_src
    FROM timetable_entries te
    JOIN time_slots ts ON ts.id = te.time_slot_id
    LEFT JOIN departments d ON d.id = te.department_id
    WHERE te.id = p_source_slot_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source timetable entry % not found', p_source_slot_id;
    END IF;

    -- C. Query target timetable entry
    SELECT 
        te.id, te.course_id, te.department_id, te.campus_id, te.academic_year,
        te.semester, te.status, te.session_type, te.is_lab_block,
        ts.day_of_week, ts.period_number,
        d.campus_id AS dept_campus_id
    INTO v_tgt
    FROM timetable_entries te
    JOIN time_slots ts ON ts.id = te.time_slot_id
    LEFT JOIN departments d ON d.id = te.department_id
    WHERE te.id = p_target_slot_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target timetable entry % not found', p_target_slot_id;
    END IF;

    -- D. R03: Validate publication status
    IF v_src.status != 'published' OR v_tgt.status != 'published' THEN
        RAISE EXCEPTION 'Both practical periods must be published (R03/F43)';
    END IF;

    -- E. R03: Validate matching course and cohort identity
    IF v_src.course_id != v_tgt.course_id THEN
        RAISE EXCEPTION 'Cannot copy practical attendance between different courses (R03)';
    END IF;

    IF v_src.department_id != v_tgt.department_id THEN
        RAISE EXCEPTION 'Cannot copy practical attendance between different departments (R03)';
    END IF;

    v_src_campus_id := COALESCE(v_src.campus_id, v_src.dept_campus_id);
    v_tgt_campus_id := COALESCE(v_tgt.campus_id, v_tgt.dept_campus_id);

    IF v_src_campus_id != v_tgt_campus_id THEN
        RAISE EXCEPTION 'Cannot copy practical attendance between different campuses (R03)';
    END IF;

    IF v_src.academic_year != v_tgt.academic_year OR v_src.semester != v_tgt.semester THEN
        RAISE EXCEPTION 'Cannot copy practical attendance between different academic years or semesters (R03)';
    END IF;

    -- F. R28: Verify cohort is not retired
    IF EXISTS (
        SELECT 1 FROM retired_cohorts rc
        WHERE rc.campus_id = v_src_campus_id
          AND rc.academic_year = v_src.academic_year
          AND rc.semester = v_src.semester
    ) THEN
        RAISE EXCEPTION 'Cannot copy attendance: cohort is retired or concluded (R28)';
    END IF;

    -- G. R03: Validate both are practical sessions
    IF NOT (v_src.is_lab_block = true OR v_src.session_type = 'practical') OR
       NOT (v_tgt.is_lab_block = true OR v_tgt.session_type = 'practical') THEN
        RAISE EXCEPTION 'Practical attendance copying is only allowed between practical / lab sessions (R03)';
    END IF;

    -- H. R03: Validate matching day of week and consecutive practical pair
    IF v_src.day_of_week != v_tgt.day_of_week THEN
        RAISE EXCEPTION 'Cannot copy practical attendance between different days of the week (R03)';
    END IF;

    v_src_period := v_src.period_number;
    v_tgt_period := v_tgt.period_number;

    -- Strictly forbid lunch-crossing pair (Period 3 to Period 4)
    IF v_src_period = 3 AND v_tgt_period = 4 THEN
        RAISE EXCEPTION 'Cannot copy practical attendance across lunch boundary (Period 3 to Period 4 is forbidden) (R03)';
    END IF;

    -- Validate adjacent consecutive lab pair in domain: (1, 2), (2, 3), (4, 5), (5, 6)
    IF NOT (
        (v_src_period = 1 AND v_tgt_period = 2) OR
        (v_src_period = 2 AND v_tgt_period = 3) OR
        (v_src_period = 4 AND v_tgt_period = 5) OR
        (v_src_period = 5 AND v_tgt_period = 6)
    ) THEN
        RAISE EXCEPTION 'Invalid practical period pair (Period % to %). Practical copying requires an adjacent consecutive lab pair (R03)',
            v_src_period, v_tgt_period;
    END IF;

    -- I. Fetch source marks
    IF NOT EXISTS (
        SELECT 1 FROM period_attendance
        WHERE timetable_slot_id = p_source_slot_id
          AND attendance_date = p_attendance_date
    ) THEN
        RAISE EXCEPTION 'Source practical period has no attendance recorded for % (R03)', p_attendance_date;
    END IF;

    -- J. R29: Query target session revision
    SELECT * INTO v_tgt_session
    FROM period_attendance_sessions
    WHERE timetable_slot_id = p_target_slot_id
      AND attendance_date = p_attendance_date
    FOR UPDATE;

    IF FOUND THEN
        v_current_tgt_rev := v_tgt_session.revision;
        IF p_expected_target_revision IS NOT NULL AND p_expected_target_revision > 0 THEN
            IF p_expected_target_revision != v_current_tgt_rev THEN
                RAISE EXCEPTION 'ATTENDANCE_CONFLICT: Target session revision mismatch. Current revision is %, expected % (R29)',
                    v_current_tgt_rev, p_expected_target_revision;
            END IF;
        ELSIF p_expected_target_revision = 0 THEN
            RAISE EXCEPTION 'ATTENDANCE_CONFLICT: Target period already marked at revision %. Provide expected revision to overwrite (R29)',
                v_current_tgt_rev;
        END IF;

        v_new_tgt_rev := v_current_tgt_rev + 1;
    ELSE
        IF p_expected_target_revision IS NOT NULL AND p_expected_target_revision > 0 THEN
            RAISE EXCEPTION 'ATTENDANCE_CONFLICT: Expected target revision % but target session is unmarked (R29)',
                p_expected_target_revision;
        END IF;
        v_new_tgt_rev := 1;
    END IF;

    v_tgt_rev_token := md5(p_target_slot_id::text || '_' || p_attendance_date::text || '_' || v_new_tgt_rev::text);

    -- K. Atomically duplicate marks into target period
    FOR v_mark IN (
        SELECT student_id, course_id, status
        FROM period_attendance
        WHERE timetable_slot_id = p_source_slot_id
          AND attendance_date = p_attendance_date
    ) LOOP
        INSERT INTO period_attendance (
            timetable_slot_id,
            student_id,
            course_id,
            marked_by,
            status,
            marked_at,
            attendance_date,
            is_late_entry
        )
        VALUES (
            p_target_slot_id,
            v_mark.student_id,
            v_mark.course_id,
            p_user_id,
            v_mark.status,
            v_now,
            p_attendance_date,
            false
        )
        ON CONFLICT (timetable_slot_id, student_id, attendance_date)
        DO UPDATE SET
            status = EXCLUDED.status,
            marked_by = EXCLUDED.marked_by,
            marked_at = EXCLUDED.marked_at;

        v_copied_count := v_copied_count + 1;
        IF v_mark.status = 'present' THEN
            v_present_count := v_present_count + 1;
        ELSE
            v_absent_count := v_absent_count + 1;
        END IF;
    END LOOP;

    -- L. Upsert target session revision
    INSERT INTO period_attendance_sessions (
        timetable_slot_id,
        attendance_date,
        revision,
        revision_token,
        marked_by,
        last_marked_at,
        total_students,
        present_count,
        absent_count,
        updated_at
    )
    VALUES (
        p_target_slot_id,
        p_attendance_date,
        v_new_tgt_rev,
        v_tgt_rev_token,
        p_user_id,
        v_now,
        v_copied_count,
        v_present_count,
        v_absent_count,
        v_now
    )
    ON CONFLICT (timetable_slot_id, attendance_date)
    DO UPDATE SET
        revision = v_new_tgt_rev,
        revision_token = v_tgt_rev_token,
        marked_by = EXCLUDED.marked_by,
        last_marked_at = EXCLUDED.last_marked_at,
        total_students = EXCLUDED.total_students,
        present_count = EXCLUDED.present_count,
        absent_count = EXCLUDED.absent_count,
        updated_at = v_now;

    RETURN jsonb_build_object(
        'success', true,
        'copied_count', v_copied_count,
        'present_count', v_present_count,
        'absent_count', v_absent_count,
        'target_revision', v_new_tgt_rev,
        'target_revision_token', v_tgt_rev_token,
        'attendance_date', p_attendance_date,
        'marked_at', v_now
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.atomic_replace_timetable_draft(p_campus_id uuid, p_academic_year text, p_semester integer, p_entries jsonb, p_job_id uuid, p_fencing_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_published_count INT;
    v_inserted_count INT := 0;
    v_entry JSONB;
BEGIN
    IF p_campus_id IS NULL THEN RAISE EXCEPTION 'An explicit campus is required'; END IF;
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
          campus_id = p_campus_id
          OR (campus_id IS NULL AND department_id IN (
              SELECT d.id FROM public.departments d WHERE d.campus_id = p_campus_id
          ))
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
          campus_id = p_campus_id
          OR (campus_id IS NULL AND department_id IN (
              SELECT d.id FROM public.departments d WHERE d.campus_id = p_campus_id
          ))
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
$function$;

CREATE OR REPLACE FUNCTION public.atomic_submit_period_attendance(p_slot_id uuid, p_attendance_date date, p_user_id uuid, p_absent_student_ids uuid[], p_all_roster_ids uuid[], p_course_id uuid, p_expected_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_entry RECORD;
    v_host_campus_id UUID;
    v_existing_session RECORD;
    v_current_rev INTEGER := 0;
    v_new_rev INTEGER := 1;
    v_rev_token TEXT;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
    v_total_students INTEGER := cardinality(p_all_roster_ids);
    v_absent_count INTEGER := cardinality(p_absent_student_ids);
    v_present_count INTEGER;
    v_stu_id UUID;
    v_stu_status TEXT;
    v_lock_key BIGINT;
BEGIN
    -- A. Transactional advisory lock on (slot_id, attendance_date)
    v_lock_key := ('x' || substr(md5(p_slot_id::text || '_' || p_attendance_date::text), 1, 15))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- B. Verify published timetable entry exists
    SELECT te.id, te.status, te.academic_year, te.semester, te.campus_id, d.campus_id AS dept_campus_id
    INTO v_entry
    FROM timetable_entries te
    LEFT JOIN departments d ON d.id = te.department_id
    WHERE te.id = p_slot_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Timetable entry % not found', p_slot_id;
    END IF;

    IF v_entry.status != 'published' THEN
        RAISE EXCEPTION 'Attendance requires a published schedule (status: %) (F43)', v_entry.status;
    END IF;

    v_host_campus_id := COALESCE(v_entry.campus_id, v_entry.dept_campus_id);

    -- C. R28: Verify cohort is active (not retired)
    IF EXISTS (
        SELECT 1 FROM retired_cohorts rc
        WHERE rc.campus_id = v_host_campus_id
          AND rc.academic_year = v_entry.academic_year
          AND rc.semester = v_entry.semester
    ) THEN
        RAISE EXCEPTION 'Cannot record attendance: cohort (% / Sem %) is retired or concluded (R28)',
            v_entry.academic_year, v_entry.semester;
    END IF;

    -- D. R29: Query existing dated-session with FOR UPDATE
    SELECT * INTO v_existing_session
    FROM period_attendance_sessions
    WHERE timetable_slot_id = p_slot_id
      AND attendance_date = p_attendance_date
    FOR UPDATE;

    IF FOUND THEN
        v_current_rev := v_existing_session.revision;
        -- If client provided an expected revision, strictly require match
        IF p_expected_revision IS NOT NULL AND p_expected_revision > 0 THEN
            IF p_expected_revision != v_current_rev THEN
                RAISE EXCEPTION 'ATTENDANCE_CONFLICT: Session revision mismatch. Current revision is %, expected % (R29)',
                    v_current_rev, p_expected_revision;
            END IF;
        ELSIF p_expected_revision = 0 THEN
            -- Client expected first submission, but session already exists
            RAISE EXCEPTION 'ATTENDANCE_CONFLICT: Session already marked at revision % (R29)', v_current_rev;
        END IF;

        v_new_rev := v_current_rev + 1;
    ELSE
        -- No session exists: if client expected an existing revision, conflict
        IF p_expected_revision IS NOT NULL AND p_expected_revision > 0 THEN
            RAISE EXCEPTION 'ATTENDANCE_CONFLICT: Expected revision % but session is unmarked (R29)', p_expected_revision;
        END IF;
        v_new_rev := 1;
    END IF;

    v_present_count := v_total_students - v_absent_count;
    v_rev_token := md5(p_slot_id::text || '_' || p_attendance_date::text || '_' || v_new_rev::text);

    -- E. Upsert student marks atomically
    FOREACH v_stu_id IN ARRAY p_all_roster_ids
    LOOP
        IF v_stu_id = ANY(p_absent_student_ids) THEN
            v_stu_status := 'absent';
        ELSE
            v_stu_status := 'present';
        END IF;

        INSERT INTO period_attendance (
            timetable_slot_id,
            student_id,
            course_id,
            marked_by,
            status,
            marked_at,
            attendance_date,
            is_late_entry
        )
        VALUES (
            p_slot_id,
            v_stu_id,
            p_course_id,
            p_user_id,
            v_stu_status,
            v_now,
            p_attendance_date,
            false
        )
        ON CONFLICT (timetable_slot_id, student_id, attendance_date)
        DO UPDATE SET
            status = EXCLUDED.status,
            marked_by = EXCLUDED.marked_by,
            marked_at = EXCLUDED.marked_at;
    END LOOP;

    -- F. Upsert session revision
    INSERT INTO period_attendance_sessions (
        timetable_slot_id,
        attendance_date,
        revision,
        revision_token,
        marked_by,
        last_marked_at,
        total_students,
        present_count,
        absent_count,
        updated_at
    )
    VALUES (
        p_slot_id,
        p_attendance_date,
        v_new_rev,
        v_rev_token,
        p_user_id,
        v_now,
        v_total_students,
        v_present_count,
        v_absent_count,
        v_now
    )
    ON CONFLICT (timetable_slot_id, attendance_date)
    DO UPDATE SET
        revision = v_new_rev,
        revision_token = v_rev_token,
        marked_by = EXCLUDED.marked_by,
        last_marked_at = EXCLUDED.last_marked_at,
        total_students = EXCLUDED.total_students,
        present_count = EXCLUDED.present_count,
        absent_count = EXCLUDED.absent_count,
        updated_at = v_now;

    RETURN jsonb_build_object(
        'success', true,
        'revision', v_new_rev,
        'revision_token', v_rev_token,
        'attendance_date', p_attendance_date,
        'marked_at', v_now,
        'total_students', v_total_students,
        'present_count', v_present_count,
        'absent_count', v_absent_count
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_student_course_counts(p_student_ids uuid[], p_campus_id uuid, p_academic_year text, p_semester integer)
 RETURNS TABLE(student_id uuid, course_id uuid, conducted bigint, present bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.student_id, a.course_id,
    count(DISTINCT (a.timetable_slot_id,a.attendance_date)) FILTER (WHERE a.status IN ('present','absent')),
    count(DISTINCT (a.timetable_slot_id,a.attendance_date)) FILTER (WHERE a.status = 'present')
  FROM period_attendance a JOIN timetable_entries e ON e.id = a.timetable_slot_id
  WHERE a.student_id = ANY(p_student_ids) AND e.campus_id = p_campus_id
    AND e.academic_year = p_academic_year AND e.semester = p_semester AND e.status = 'published'
  GROUP BY a.student_id,a.course_id;
$function$;

CREATE OR REPLACE FUNCTION public.check_faculty_campus()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.role = 'hod' AND NOT EXISTS (SELECT 1 FROM public.departments WHERE id = NEW.department_id AND campus_id = NEW.campus_id) THEN
    RAISE EXCEPTION 'Department must belong to the selected campus' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.check_unique_course_slots(s1 uuid, s2 uuid, s3 uuid, s4 uuid, s5 uuid, s6 uuid, s7 uuid, s8 uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.claim_allocation_run(p_campus_id uuid, p_academic_year text, p_semester smallint, p_user_id uuid, p_lease_seconds integer DEFAULT 300, p_fencing_token uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.claim_timetable_generation_job(p_campus_id uuid, p_academic_year text, p_semester smallint, p_user_id uuid, p_lease_seconds integer DEFAULT 600, p_fencing_token uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_concluded_semester_attendance(p_campus_id uuid, p_academic_year text, p_semester smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_deleted_count INTEGER := 0;
    v_deleted_sessions INTEGER := 0;
BEGIN
    -- 1. Record cohort in retired_cohorts to permanently lock out new submissions / copies
    INSERT INTO retired_cohorts (campus_id, academic_year, semester, retired_at)
    VALUES (p_campus_id, p_academic_year, p_semester, timezone('utc'::text, now()))
    ON CONFLICT (campus_id, academic_year, semester) DO UPDATE
    SET retired_at = timezone('utc'::text, now());

    -- 2. Delete attendance marks for concluded cohort
    WITH deleted_attendance AS (
        DELETE FROM period_attendance
        WHERE timetable_slot_id IN (
            SELECT te.id
            FROM timetable_entries te
            LEFT JOIN departments d ON d.id = te.department_id
            WHERE COALESCE(te.campus_id, d.campus_id) = p_campus_id
              AND te.academic_year = p_academic_year
              AND te.semester = p_semester
        )
        RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted_attendance;

    -- 3. Delete attendance sessions for concluded cohort
    WITH deleted_sessions AS (
        DELETE FROM period_attendance_sessions
        WHERE timetable_slot_id IN (
            SELECT te.id
            FROM timetable_entries te
            LEFT JOIN departments d ON d.id = te.department_id
            WHERE COALESCE(te.campus_id, d.campus_id) = p_campus_id
              AND te.academic_year = p_academic_year
              AND te.semester = p_semester
        )
        RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_sessions FROM deleted_sessions;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_attendance_records', v_deleted_count,
        'deleted_sessions', v_deleted_sessions,
        'campus_id', p_campus_id,
        'academic_year', p_academic_year,
        'semester', p_semester
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.course_enrollment_counts(p_course_ids uuid[], p_academic_year text, p_semester integer)
 RETURNS TABLE(course_id uuid, enrolled bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT c.id, count(r.id)
  FROM public.courses c LEFT JOIN public.student_registrations r
    ON r.academic_year = p_academic_year AND r.semester = p_semester
    AND c.id = ANY(ARRAY[r.slot_1_course_id,r.slot_2_course_id,r.slot_3_course_id,r.slot_4_course_id,
      r.slot_5_course_id,r.slot_6_course_id,r.slot_7_course_id,r.slot_8_course_id])
  WHERE c.id = ANY(p_course_ids) GROUP BY c.id;
$function$;

CREATE OR REPLACE FUNCTION public.course_reference_tokens(value jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(array_agg(DISTINCT token #>> '{}'), ARRAY[]::text[])
  FROM jsonb_path_query(coalesce(value, 'null'::jsonb), 'strict $.** ? (@.type() == "string")') AS token;
$function$;

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
  WHEN 'courses' THEN tokens := public.course_reference_tokens(row_data->'prerequisite_course_ids');
  WHEN 'course_prerequisite_rules' THEN
    IF row_data->>'rule' = 'COMPLETED_COURSE' THEN tokens := regexp_split_to_array(upper(row_data->>'target'), '\s*,\s*'); END IF;
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
    ('period_attendance','attendance records'), ('courses','prerequisite dependencies'),
    ('course_prerequisite_rules','prerequisite dependencies')
  ) AS types(table_name, label) LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=item.table_name) THEN
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I r WHERE $1 = ANY(public.course_row_references($2, to_jsonb(r))))', item.table_name)
      INTO item_found USING course_id, item.table_name;
      IF item_found AND NOT item.label = ANY(used) THEN used := array_append(used, item.label); END IF;
    END IF;
  END LOOP;
  RETURN used;
END $function$;

CREATE OR REPLACE FUNCTION public.delete_campus_cascade(p_campus_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    DELETE FROM campuses WHERE id = p_campus_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_department_cascade(p_dept_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    DELETE FROM departments WHERE id = p_dept_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_graduated_student()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
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
            'course_code', v_target_course.course_code,
            'title', v_target_course.title,
            'credits', v_target_course.credits
        )
    );
END;
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.fail_allocation_worker(p_run_id uuid, p_fencing_token uuid, p_error text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 UPDATE system_logs SET status='failed',error_message=left(p_error,2000),completed_at=now(),updated_at=now()
 WHERE id=p_run_id AND log_type='allocation_run' AND status='running' AND metadata->>'fencing_token'=p_fencing_token::text;
 RETURN FOUND;
END; $function$;

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
    completed_student_ids = ARRAY(SELECT student_id FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage = 'completed'),
    failed_student_ids = ARRAY(SELECT student_id FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage <> 'completed'),
    status = CASE WHEN EXISTS(SELECT 1 FROM graduation_candidates c WHERE c.operation_id = o.id AND c.stage <> 'completed') THEN 'partially_failed' ELSE 'completed' END,
    updated_at = now()
    WHERE o.id = (SELECT operation_id FROM graduation_candidates WHERE student_id = p_student_id);
END $function$;

CREATE OR REPLACE FUNCTION public.graduate_candidate_database(p_campus_id uuid, p_student_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF TG_TABLE_NAME IN ('courses', 'course_prerequisite_rules') THEN
    IF TG_TABLE_NAME = 'courses' THEN
      target_sem := NEW.semester;
      IF cardinality(ref_ids) <> jsonb_array_length(coalesce(nullif(row_data->'prerequisite_course_ids', 'null'::jsonb),'[]'::jsonb)) THEN
        RAISE EXCEPTION 'Unknown prerequisite course' USING ERRCODE='23514';
      END IF;
    ELSE SELECT semester INTO target_sem FROM public.courses WHERE id = NEW.course_id; END IF;
    SELECT EXISTS (SELECT 1 FROM public.courses WHERE id = ANY(ref_ids) AND semester >= target_sem) INTO invalid;
    IF invalid THEN RAISE EXCEPTION 'Prerequisites must be from an earlier semester' USING ERRCODE = '23514'; END IF;
  ELSIF row_data ? 'semester' THEN
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
DECLARE blockers text[]; rule_row record;
BEGIN
  IF NEW.semester IS DISTINCT FROM OLD.semester THEN
    PERFORM pg_advisory_xact_lock(76102618164035::bigint);
    blockers := public.course_usage_types(OLD.id);
    IF cardinality(blockers) > 0 THEN
      RAISE EXCEPTION 'Course semester cannot change: %', array_to_string(blockers, ', ')
        USING ERRCODE = 'P4090', DETAIL = to_json(blockers)::text;
    END IF;
    FOR rule_row IN SELECT * FROM public.course_prerequisite_rules WHERE course_id = OLD.id AND rule = 'COMPLETED_COURSE' LOOP
      IF EXISTS (SELECT 1 FROM public.courses WHERE id = ANY(public.course_row_references('course_prerequisite_rules',to_jsonb(rule_row))) AND semester >= NEW.semester) THEN
        RAISE EXCEPTION 'Prerequisites must be from an earlier semester' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.normalize_department_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.code := upper(btrim(NEW.code));
  RETURN NEW;
END $function$;

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
  INSERT INTO graduation_operations (idempotency_key, campus_id, academic_year, initiated_by, candidate_student_ids, total_candidates)
  VALUES ('grad:' || p_campus_id::text || ':' || md5(v_ids::text), p_campus_id,
    COALESCE((SELECT academic_year FROM campus_settings WHERE campus_id = p_campus_id), 'unknown'),
    p_actor_id, v_ids, cardinality(v_ids))
  ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now() RETURNING id INTO v_operation;
  INSERT INTO graduation_candidates(operation_id, student_id, campus_id)
    SELECT v_operation, id, p_campus_id FROM unnest(v_ids) id ON CONFLICT (student_id) DO NOTHING;
  RETURN (SELECT jsonb_agg(to_jsonb(c) ORDER BY student_id) FROM graduation_candidates c WHERE student_id = ANY(v_ids));
END $function$;

CREATE OR REPLACE FUNCTION public.production_readiness()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object('ready',
    to_regprocedure('public.publish_timetable_cohort(uuid,text,integer)') IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.promote_campus_students_atomic(p_campus_id uuid, p_director_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  IF nullif(p_idempotency_key, '') IS NULL THEN RAISE EXCEPTION 'Request key required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('promotion:' || p_campus_id::text));
  SELECT result INTO v_result FROM promotion_receipts WHERE campus_id = p_campus_id AND request_key = p_idempotency_key;
  IF FOUND THEN RETURN v_result; END IF;
  v_result := promote_campus_students_once(p_campus_id, p_director_id, p_idempotency_key);
  INSERT INTO promotion_receipts VALUES (p_campus_id, p_idempotency_key, v_result, now());
  RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.promote_campus_students_once(p_campus_id uuid, p_director_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    v_last_promoted TIMESTAMPTZ;
    v_academic_year TEXT;
    v_promoted_count INTEGER := 0;
    v_graduating_ids JSONB;
BEGIN
    -- 1. Lock campus_settings row FOR UPDATE (F54: fails closed if missing)
    SELECT last_promoted_at, academic_year
    INTO v_last_promoted, v_academic_year
    FROM campus_settings
    WHERE campus_id = p_campus_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Campus settings record not found for campus % (F54)', p_campus_id;
    END IF;

    -- 2. Enforce 90-day cooldown within the transaction (F56)
    IF v_last_promoted IS NOT NULL AND v_last_promoted > (now() - interval '90 days') THEN
        RAISE EXCEPTION 'Promotion is locked: students were already promoted on %. A minimum of 90 days must pass before next promotion (F56).', v_last_promoted;
    END IF;

    -- 3. Collect graduating semester-10 student IDs for this campus (F55)
    SELECT COALESCE(jsonb_agg(id), '[]'::jsonb)
    INTO v_graduating_ids
    FROM students
    WHERE campus_id = p_campus_id AND current_semester = 10;

    -- 4. Promote semesters 1 through 9 strictly (< 10) to prevent setting semester to 11 (F55)
    UPDATE students
    SET current_semester = current_semester + 1
    WHERE campus_id = p_campus_id AND current_semester >= 1 AND current_semester < 10;

    GET DIAGNOSTICS v_promoted_count = ROW_COUNT;

    -- 5. Update last_promoted_at timestamp
    UPDATE campus_settings
    SET last_promoted_at = now()
    WHERE campus_id = p_campus_id;

    -- 6. Record promotion event in system_logs
    INSERT INTO system_logs (
        log_type,
        status,
        campus_id,
        user_id,
        event_type,
        action,
        resource_type,
        resource_id,
        metadata
    ) VALUES (
        'audit_event',
        'success',
        p_campus_id,
        p_director_id,
        'student_promoted',
        format('promoted %s students for campus %s', v_promoted_count, p_campus_id),
        'campus',
        p_campus_id,
        jsonb_build_object(
            'promoted_count', v_promoted_count,
            'graduating_count', jsonb_array_length(v_graduating_ids),
            'idempotency_key', p_idempotency_key
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'promoted_count', v_promoted_count,
        'graduating_student_ids', v_graduating_ids
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_timetable_cohort(p_campus_id uuid, p_academic_year text, p_semester integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  draft_hash text;
  expected_hash text;
  expected_count int;
  changed_count int;
  saved_count int;
  generation_id uuid;
  published_time timestamptz := clock_timestamp();
BEGIN
  IF p_campus_id IS NULL OR p_academic_year IS NULL OR btrim(p_academic_year) = ''
      OR p_semester IS NULL OR p_semester NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'An explicit campus, academic year and valid semester are required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('timetable:published-teacher-occupancy'));
  PERFORM pg_advisory_xact_lock(hashtext('timetable:' || p_campus_id::text || ':' || p_academic_year || ':' || p_semester::text));

  IF EXISTS (SELECT 1 FROM public.system_logs WHERE log_type = 'timetable_job' AND campus_id = p_campus_id
    AND academic_year = p_academic_year AND semester = p_semester AND status IN ('queued','running')) THEN
    RAISE EXCEPTION 'Cannot publish while timetable generation is active';
  END IF;
  IF EXISTS (SELECT 1 FROM public.timetable_entries e LEFT JOIN public.departments d ON d.id = e.department_id
    WHERE COALESCE(e.campus_id, d.campus_id) = p_campus_id AND e.academic_year = p_academic_year
      AND e.semester = p_semester AND e.status = 'published') THEN
    RAISE EXCEPTION 'This campus timetable is already published for the selected year and semester';
  END IF;
  IF EXISTS (SELECT 1 FROM public.timetable_conflicts c LEFT JOIN public.courses co ON co.id = c.course_id
    LEFT JOIN public.departments d ON d.id = co.department_id
    WHERE c.academic_year = p_academic_year AND c.semester = p_semester AND NOT c.resolved
      AND (d.campus_id = p_campus_id OR d.campus_id IS NULL)) THEN
    RAISE EXCEPTION 'Resolve timetable conflicts before publication';
  END IF;

  PERFORM id FROM public.timetable_entries WHERE campus_id = p_campus_id AND academic_year = p_academic_year
    AND semester = p_semester AND status = 'draft' FOR UPDATE;
  SELECT count(*), md5(string_agg(e::text, ',' ORDER BY e.id)) INTO expected_count, draft_hash
    FROM public.timetable_entries e WHERE e.campus_id = p_campus_id AND e.academic_year = p_academic_year
      AND e.semester = p_semester AND e.status = 'draft';
  SELECT id, metadata->>'draft_hash' INTO generation_id, expected_hash FROM public.system_logs
    WHERE log_type = 'timetable_job' AND campus_id = p_campus_id AND academic_year = p_academic_year
      AND semester = p_semester AND status = 'completed' ORDER BY completed_at DESC LIMIT 1;
  IF expected_count = 0 OR draft_hash IS NULL OR draft_hash IS DISTINCT FROM expected_hash THEN
    RAISE EXCEPTION 'No verified current draft; generate a complete timetable before publication';
  END IF;
  IF EXISTS (SELECT 1 FROM public.timetable_entries draft JOIN public.timetable_entries occupied
    ON occupied.teacher_id = draft.teacher_id AND occupied.time_slot_id = draft.time_slot_id
      AND occupied.academic_year = draft.academic_year AND occupied.status = 'published'
    WHERE draft.campus_id = p_campus_id AND draft.academic_year = p_academic_year
      AND draft.semester = p_semester AND draft.status = 'draft' AND draft.teacher_id IS NOT NULL) THEN
    RAISE EXCEPTION 'An assigned teacher is already occupied in a published class';
  END IF;

  UPDATE public.timetable_entries SET status = 'published', published_at = published_time
    WHERE campus_id = p_campus_id AND academic_year = p_academic_year AND semester = p_semester AND status = 'draft';
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  SELECT count(*) INTO saved_count FROM public.timetable_entries
    WHERE campus_id = p_campus_id AND academic_year = p_academic_year AND semester = p_semester
      AND status = 'published' AND published_at = published_time;
  IF changed_count <> expected_count OR saved_count <> expected_count
      OR EXISTS (SELECT 1 FROM public.timetable_entries WHERE campus_id = p_campus_id
        AND academic_year = p_academic_year AND semester = p_semester AND status = 'draft') THEN
    RAISE EXCEPTION 'Publication did not persist every verified session; the transaction was rolled back';
  END IF;
  UPDATE public.system_logs SET metadata = metadata || jsonb_build_object('publication',
    jsonb_build_object('published_at', published_time, 'published_count', saved_count)) WHERE id = generation_id;
  RETURN jsonb_build_object('success', true, 'published_count', saved_count, 'published_at', published_time);
END $function$;

CREATE OR REPLACE FUNCTION public.recover_expired_timetable_workers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END; $function$;

CREATE OR REPLACE FUNCTION public.revoke_deleted_assignment_authority()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.timetable_entries e SET teacher_id = NULL
  WHERE e.teacher_id = OLD.teacher_id AND e.course_id = OLD.course_id
    AND (OLD.academic_year IS NULL OR e.academic_year = OLD.academic_year)
    AND (OLD.semester IS NULL OR e.semester = OLD.semester)
    AND (OLD.campus_id IS NULL OR COALESCE(e.campus_id,
      (SELECT d.campus_id FROM public.departments d WHERE d.id = e.department_id)) = OLD.campus_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.teacher_course_assignments a
      WHERE a.teacher_id = e.teacher_id AND a.course_id = e.course_id
        AND (a.academic_year IS NULL OR a.academic_year = e.academic_year)
        AND (a.semester IS NULL OR a.semester = e.semester)
        AND (a.campus_id IS NULL OR a.campus_id = COALESCE(e.campus_id,
          (SELECT d.campus_id FROM public.departments d WHERE d.id = e.department_id)))
    );
  RETURN OLD;
END $function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

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
        preferences, allocation_metadata, submitted_at, updated_at
    )
    VALUES (
        p_student_id, p_campus_id, p_semester, p_academic_year, p_pathway_id,
        p_preferences, v_cleaned_meta, v_final_submitted_at, now()
    )
    ON CONFLICT (student_id, semester, academic_year)
    DO UPDATE SET
        campus_id = EXCLUDED.campus_id,
        pathway_id = EXCLUDED.pathway_id,
        preferences = EXCLUDED.preferences,
        allocation_metadata = EXCLUDED.allocation_metadata,
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

CREATE OR REPLACE FUNCTION public.sync_registration_snapshots()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.trg_allocation_runs_io()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.trg_audit_logs_io()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.trg_guard_published_timetable_entries()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE host_campus uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN RAISE EXCEPTION 'Published timetable entries cannot be deleted'; END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    IF ROW(NEW.id, NEW.academic_year, NEW.semester, NEW.course_id, NEW.department_id,
           NEW.campus_id, NEW.time_slot_id, NEW.session_type, NEW.is_lab_block, NEW.status, NEW.published_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.academic_year, OLD.semester, OLD.course_id, OLD.department_id,
           OLD.campus_id, OLD.time_slot_id, OLD.session_type, OLD.is_lab_block, OLD.status, OLD.published_at) THEN
      RAISE EXCEPTION 'Published timetable structure cannot be changed or unpublished';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(NEW.campus_id, d.campus_id) INTO host_campus
      FROM public.departments d WHERE d.id = NEW.department_id;
    IF EXISTS (SELECT 1 FROM public.timetable_entries e
      LEFT JOIN public.departments d ON d.id = e.department_id
      WHERE e.academic_year = NEW.academic_year AND e.semester = NEW.semester
        AND e.status = 'published' AND COALESCE(e.campus_id, d.campus_id) = host_campus) THEN
      RAISE EXCEPTION 'Cannot add sessions to an already published timetable';
    END IF;
  END IF;

  -- A BEFORE UPDATE trigger must return NEW: returning OLD silently discards
  -- the publication while PostgreSQL still reports a matched/updated row.
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_init_campus_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO campus_settings (
        campus_id,
        academic_year,
        min_credits,
        max_credits
    )
    VALUES (
        NEW.id,
        '2025-26',
        18,
        26
    )
    ON CONFLICT (campus_id) DO NOTHING;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_timetable_jobs_io()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
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
    prerequisite_course_ids = CASE WHEN p_patch ? 'prerequisite_course_ids' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'prerequisite_course_ids')::uuid) ELSE saved.prerequisite_course_ids END
    WHERE id = p_id AND department_id = p_department_id RETURNING * INTO saved;
  RETURN jsonb_build_object('id',saved.id,'semester',saved.semester);
END $function$;

CREATE OR REPLACE FUNCTION public.update_timetable_worker(p_job_id uuid, p_fencing_token uuid, p_status text, p_progress integer, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END; $function$;

ALTER TABLE public."admins" ALTER COLUMN "role" SET DEFAULT 'superadmin'::text;

ALTER TABLE public."campus_settings" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."campus_settings" ALTER COLUMN "min_credits" SET DEFAULT 18;

ALTER TABLE public."campus_settings" ALTER COLUMN "max_credits" SET DEFAULT 26;

ALTER TABLE public."campus_sign_ins" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."campus_sign_ins" ALTER COLUMN "signed_in_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."campus_sign_ins" ALTER COLUMN "source" SET DEFAULT 'gps'::text;

ALTER TABLE public."campuses" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."campuses" ALTER COLUMN "radius_meters" SET DEFAULT 400;

ALTER TABLE public."campuses" ALTER COLUMN "morning_cutoff_time" SET DEFAULT '09:30:00'::time without time zone;

ALTER TABLE public."campuses" ALTER COLUMN "midday_split_time" SET DEFAULT '13:30:00'::time without time zone;

ALTER TABLE public."campuses" ALTER COLUMN "evening_cutoff_time" SET DEFAULT '15:30:00'::time without time zone;

ALTER TABLE public."campuses" ALTER COLUMN "day_end_time" SET DEFAULT '17:00:00'::time without time zone;

ALTER TABLE public."consent_records" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."consent_records" ALTER COLUMN "accepted_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."course_prerequisite_rules" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."course_prerequisite_rules" ALTER COLUMN "created_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."courses" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."courses" ALTER COLUMN "theory_hours_per_week" SET DEFAULT 0;

ALTER TABLE public."courses" ALTER COLUMN "practical_hours_per_week" SET DEFAULT 0;

ALTER TABLE public."courses" ALTER COLUMN "seat_limit" SET DEFAULT 60;

ALTER TABLE public."courses" ALTER COLUMN "prerequisite_course_ids" SET DEFAULT '{}'::uuid[];

ALTER TABLE public."department_notices" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."department_notices" ALTER COLUMN "created_at" SET DEFAULT now();

ALTER TABLE public."departments" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."graduation_candidates" ALTER COLUMN "stage" SET DEFAULT 'pending'::text;

ALTER TABLE public."graduation_candidates" ALTER COLUMN "updated_at" SET DEFAULT now();

ALTER TABLE public."graduation_operations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."graduation_operations" ALTER COLUMN "status" SET DEFAULT 'in_progress'::text;

ALTER TABLE public."graduation_operations" ALTER COLUMN "total_candidates" SET DEFAULT 0;

ALTER TABLE public."graduation_operations" ALTER COLUMN "graduated_count" SET DEFAULT 0;

ALTER TABLE public."graduation_operations" ALTER COLUMN "db_deleted_count" SET DEFAULT 0;

ALTER TABLE public."graduation_operations" ALTER COLUMN "auth_deleted_count" SET DEFAULT 0;

ALTER TABLE public."graduation_operations" ALTER COLUMN "failed_count" SET DEFAULT 0;

ALTER TABLE public."graduation_operations" ALTER COLUMN "candidate_student_ids" SET DEFAULT '{}'::uuid[];

ALTER TABLE public."graduation_operations" ALTER COLUMN "completed_student_ids" SET DEFAULT '{}'::uuid[];

ALTER TABLE public."graduation_operations" ALTER COLUMN "failed_student_ids" SET DEFAULT '{}'::uuid[];

ALTER TABLE public."graduation_operations" ALTER COLUMN "stage_details" SET DEFAULT '[]'::jsonb;

ALTER TABLE public."graduation_operations" ALTER COLUMN "created_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."graduation_operations" ALTER COLUMN "updated_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."period_attendance" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."period_attendance" ALTER COLUMN "marked_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."period_attendance" ALTER COLUMN "is_late_entry" SET DEFAULT false;

ALTER TABLE public."period_attendance" ALTER COLUMN "attendance_date" SET DEFAULT CURRENT_DATE;

ALTER TABLE public."period_attendance_sessions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."period_attendance_sessions" ALTER COLUMN "revision" SET DEFAULT 1;

ALTER TABLE public."period_attendance_sessions" ALTER COLUMN "last_marked_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."period_attendance_sessions" ALTER COLUMN "total_students" SET DEFAULT 0;

ALTER TABLE public."period_attendance_sessions" ALTER COLUMN "present_count" SET DEFAULT 0;

ALTER TABLE public."period_attendance_sessions" ALTER COLUMN "absent_count" SET DEFAULT 0;

ALTER TABLE public."period_attendance_sessions" ALTER COLUMN "created_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."period_attendance_sessions" ALTER COLUMN "updated_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."period_unlock_requests" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."period_unlock_requests" ALTER COLUMN "unlocked_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."promotion_receipts" ALTER COLUMN "created_at" SET DEFAULT now();

ALTER TABLE public."registration_preferences" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."registration_preferences" ALTER COLUMN "preferences" SET DEFAULT '[]'::jsonb;

ALTER TABLE public."registration_preferences" ALTER COLUMN "allocation_metadata" SET DEFAULT '{}'::jsonb;

ALTER TABLE public."registration_preferences" ALTER COLUMN "submitted_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."registration_preferences" ALTER COLUMN "created_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."registration_preferences" ALTER COLUMN "updated_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."retired_cohorts" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."retired_cohorts" ALTER COLUMN "retired_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."retired_cohorts" ALTER COLUMN "reason" SET DEFAULT 'Term concluded and attendance archived/purged'::text;

ALTER TABLE public."schema_migrations" ALTER COLUMN "applied_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."semester_blueprints" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."semester_blueprints" ALTER COLUMN "min_credits" SET DEFAULT 18;

ALTER TABLE public."semester_blueprints" ALTER COLUMN "max_credits" SET DEFAULT 26;

ALTER TABLE public."student_registrations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."student_registrations" ALTER COLUMN "total_credits" SET DEFAULT 0;

ALTER TABLE public."student_registrations" ALTER COLUMN "submitted_at" SET DEFAULT now();

ALTER TABLE public."student_registrations" ALTER COLUMN "preferences" SET DEFAULT '{}'::jsonb;

ALTER TABLE public."student_registrations" ALTER COLUMN "allocation_metadata" SET DEFAULT '{}'::jsonb;

ALTER TABLE public."students" ALTER COLUMN "current_semester" SET DEFAULT 1;

ALTER TABLE public."students" ALTER COLUMN "must_change_password" SET DEFAULT true;

ALTER TABLE public."system_logs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."system_logs" ALTER COLUMN "progress" SET DEFAULT 0;

ALTER TABLE public."system_logs" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;

ALTER TABLE public."system_logs" ALTER COLUMN "started_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."system_logs" ALTER COLUMN "created_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."system_logs" ALTER COLUMN "updated_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."teacher_course_assignments" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."teacher_course_assignments" ALTER COLUMN "assigned_at" SET DEFAULT timezone('utc'::text, now());

ALTER TABLE public."time_slots" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."time_slots" ALTER COLUMN "is_lab_block" SET DEFAULT false;

ALTER TABLE public."timetable_conflicts" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."timetable_conflicts" ALTER COLUMN "resolved" SET DEFAULT false;

ALTER TABLE public."timetable_conflicts" ALTER COLUMN "created_at" SET DEFAULT now();

ALTER TABLE public."timetable_entries" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE public."timetable_entries" ALTER COLUMN "is_lab_block" SET DEFAULT false;

ALTER TABLE public."timetable_entries" ALTER COLUMN "status" SET DEFAULT 'draft'::text;

ALTER TABLE public."timetable_entries" ALTER COLUMN "session_type" SET DEFAULT 'theory'::text;

ALTER TABLE public."admins" ADD CONSTRAINT "admins_email_key" UNIQUE (email);

ALTER TABLE public."campus_settings" ADD CONSTRAINT "campus_settings_campus_id_key" UNIQUE (campus_id);

ALTER TABLE public."campus_sign_ins" ADD CONSTRAINT "campus_sign_ins_unique" UNIQUE (student_id, campus_id, signed_in_date, session_type);

ALTER TABLE public."campuses" ADD CONSTRAINT "campuses_code_key" UNIQUE (code);

ALTER TABLE public."campuses" ADD CONSTRAINT "campuses_name_key" UNIQUE (name);

ALTER TABLE public."course_prerequisite_rules" ADD CONSTRAINT "unique_course_rule_target" UNIQUE (course_id, rule, target);

ALTER TABLE public."courses" ADD CONSTRAINT "courses_course_code_key" UNIQUE (course_code);

ALTER TABLE public."departments" ADD CONSTRAINT "departments_code_key" UNIQUE (code);

ALTER TABLE public."departments" ADD CONSTRAINT "departments_id_campus_unique" UNIQUE (id, campus_id);

ALTER TABLE public."departments" ADD CONSTRAINT "departments_name_key" UNIQUE (name);

ALTER TABLE public."faculty" ADD CONSTRAINT "faculty_email_key" UNIQUE (email);

ALTER TABLE public."graduation_operations" ADD CONSTRAINT "graduation_operations_idempotency_key_key" UNIQUE (idempotency_key);

ALTER TABLE public."period_attendance" ADD CONSTRAINT "period_attendance_unique" UNIQUE (timetable_slot_id, student_id, attendance_date);

ALTER TABLE public."period_attendance_sessions" ADD CONSTRAINT "uq_period_attendance_sessions" UNIQUE (timetable_slot_id, attendance_date);

ALTER TABLE public."registration_preferences" ADD CONSTRAINT "unique_student_pref" UNIQUE (student_id, semester, academic_year);

ALTER TABLE public."retired_cohorts" ADD CONSTRAINT "uq_retired_cohorts" UNIQUE (campus_id, academic_year, semester);

ALTER TABLE public."semester_blueprints" ADD CONSTRAINT "semester_blueprints_department_id_semester_key" UNIQUE (department_id, semester);

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_student_id_semester_academic_year_key" UNIQUE (student_id, semester, academic_year);

ALTER TABLE public."students" ADD CONSTRAINT "students_cap_application_number_key" UNIQUE (cap_application_number);

ALTER TABLE public."teacher_course_assignments" ADD CONSTRAINT "uq_teacher_course_assignments_term" UNIQUE (teacher_id, course_id, campus_id, academic_year, semester);

ALTER TABLE public."time_slots" ADD CONSTRAINT "time_slots_day_of_week_period_number_key" UNIQUE (day_of_week, period_number);

ALTER TABLE public."admins" ADD CONSTRAINT "admins_pkey" PRIMARY KEY (id);

ALTER TABLE public."campus_settings" ADD CONSTRAINT "campus_settings_pkey" PRIMARY KEY (id);

ALTER TABLE public."campus_sign_ins" ADD CONSTRAINT "campus_sign_ins_pkey" PRIMARY KEY (id);

ALTER TABLE public."campuses" ADD CONSTRAINT "campuses_pkey" PRIMARY KEY (id);

ALTER TABLE public."consent_records" ADD CONSTRAINT "consent_records_pkey" PRIMARY KEY (id);

ALTER TABLE public."course_prerequisite_rules" ADD CONSTRAINT "course_prerequisite_rules_pkey" PRIMARY KEY (id);

ALTER TABLE public."courses" ADD CONSTRAINT "courses_pkey" PRIMARY KEY (id);

ALTER TABLE public."department_notices" ADD CONSTRAINT "department_notices_pkey" PRIMARY KEY (id);

ALTER TABLE public."departments" ADD CONSTRAINT "departments_pkey" PRIMARY KEY (id);

ALTER TABLE public."faculty" ADD CONSTRAINT "faculty_pkey" PRIMARY KEY (id);

ALTER TABLE public."graduation_candidates" ADD CONSTRAINT "graduation_candidates_pkey" PRIMARY KEY (student_id);

ALTER TABLE public."graduation_operations" ADD CONSTRAINT "graduation_operations_pkey" PRIMARY KEY (id);

ALTER TABLE public."period_attendance" ADD CONSTRAINT "period_attendance_pkey" PRIMARY KEY (id);

ALTER TABLE public."period_attendance_sessions" ADD CONSTRAINT "period_attendance_sessions_pkey" PRIMARY KEY (id);

ALTER TABLE public."period_unlock_requests" ADD CONSTRAINT "period_unlock_requests_pkey" PRIMARY KEY (id);

ALTER TABLE public."promotion_receipts" ADD CONSTRAINT "promotion_receipts_pkey" PRIMARY KEY (campus_id, request_key);

ALTER TABLE public."registration_preferences" ADD CONSTRAINT "registration_preferences_pkey" PRIMARY KEY (id);

ALTER TABLE public."retired_cohorts" ADD CONSTRAINT "retired_cohorts_pkey" PRIMARY KEY (id);

ALTER TABLE public."schema_migrations" ADD CONSTRAINT "schema_migrations_pkey" PRIMARY KEY (version);

ALTER TABLE public."semester_blueprints" ADD CONSTRAINT "semester_blueprints_pkey" PRIMARY KEY (id);

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_pkey" PRIMARY KEY (id);

ALTER TABLE public."students" ADD CONSTRAINT "students_pkey" PRIMARY KEY (id);

ALTER TABLE public."system_logs" ADD CONSTRAINT "system_logs_pkey" PRIMARY KEY (id);

ALTER TABLE public."teacher_course_assignments" ADD CONSTRAINT "teacher_course_assignments_pkey" PRIMARY KEY (id);

ALTER TABLE public."time_slots" ADD CONSTRAINT "time_slots_pkey" PRIMARY KEY (id);

ALTER TABLE public."timetable_conflicts" ADD CONSTRAINT "timetable_conflicts_pkey" PRIMARY KEY (id);

ALTER TABLE public."timetable_entries" ADD CONSTRAINT "timetable_entries_pkey" PRIMARY KEY (id);

CREATE INDEX department_notices_created_by_fk_idx ON public.department_notices USING btree (created_by);

CREATE INDEX department_notices_department_id_fk_idx ON public.department_notices USING btree (department_id);

CREATE INDEX department_notices_scope_date ON public.department_notices USING btree (campus_id, department_id, created_at DESC, id DESC);

CREATE INDEX departments_campus_id_fk_idx ON public.departments USING btree (campus_id);

CREATE UNIQUE INDEX departments_code_normalized_key ON public.departments USING btree (upper(btrim(code)));

CREATE UNIQUE INDEX departments_name_normalized_key ON public.departments USING btree (lower(btrim(name)));

CREATE INDEX faculty_campus_id_fk_idx ON public.faculty USING btree (campus_id);

CREATE INDEX faculty_department_campus_idx ON public.faculty USING btree (department_id, campus_id);

CREATE UNIQUE INDEX faculty_one_director_per_campus ON public.faculty USING btree (campus_id) WHERE (role = 'campus_director'::text);

CREATE UNIQUE INDEX faculty_one_hod_per_department ON public.faculty USING btree (department_id) WHERE (role = 'hod'::text);

CREATE UNIQUE INDEX faculty_one_teaching_staff_per_campus ON public.faculty USING btree (campus_id) WHERE (role = 'teaching_staff'::text);

CREATE INDEX graduation_candidates_campus_id_fk_idx ON public.graduation_candidates USING btree (campus_id);

CREATE INDEX graduation_candidates_operation_id_fk_idx ON public.graduation_candidates USING btree (operation_id);

CREATE INDEX graduation_operations_initiated_by_fk_idx ON public.graduation_operations USING btree (initiated_by);

CREATE INDEX idx_campus_sign_ins_date_campus ON public.campus_sign_ins USING btree (signed_in_date, campus_id);

CREATE INDEX idx_consent_records_user_id ON public.consent_records USING btree (user_id);

CREATE INDEX idx_consent_records_user_policy ON public.consent_records USING btree (user_id, policy_version, accepted_at DESC);

CREATE INDEX idx_course_prereq_rules_course_id ON public.course_prerequisite_rules USING btree (course_id);

CREATE INDEX idx_courses_category ON public.courses USING btree (category);

CREATE INDEX idx_courses_department_id ON public.courses USING btree (department_id);

CREATE INDEX idx_courses_dept_sem ON public.courses USING btree (department_id, semester);

CREATE INDEX idx_courses_tag ON public.courses USING btree (tag);

CREATE INDEX idx_csi_campus_date ON public.campus_sign_ins USING btree (campus_id, signed_in_date);

CREATE INDEX idx_csi_student_date ON public.campus_sign_ins USING btree (student_id, signed_in_date);

CREATE INDEX idx_grad_ops_campus ON public.graduation_operations USING btree (campus_id);

CREATE INDEX idx_grad_ops_idempotency ON public.graduation_operations USING btree (idempotency_key);

CREATE INDEX idx_grad_ops_status ON public.graduation_operations USING btree (status);

CREATE INDEX idx_period_att_course_id ON public.period_attendance USING btree (course_id);

CREATE INDEX idx_period_att_slot_id ON public.period_attendance USING btree (timetable_slot_id);

CREATE INDEX idx_period_att_student_id ON public.period_attendance USING btree (student_id);

CREATE INDEX idx_period_attendance_export_lookup ON public.period_attendance USING btree (timetable_slot_id, attendance_date);

CREATE INDEX idx_period_attendance_sessions_date ON public.period_attendance_sessions USING btree (attendance_date);

CREATE INDEX idx_period_attendance_student_date ON public.period_attendance USING btree (student_id, attendance_date);

CREATE INDEX idx_period_unlock_slot_id ON public.period_unlock_requests USING btree (timetable_slot_id);

CREATE INDEX idx_reg_pref_lookup ON public.registration_preferences USING btree (campus_id, academic_year, semester);

CREATE INDEX idx_reg_pref_student ON public.registration_preferences USING btree (student_id, semester, academic_year);

CREATE INDEX idx_reg_pref_student_term ON public.registration_preferences USING btree (student_id, academic_year, semester);

CREATE INDEX idx_student_registrations_campus_id ON public.student_registrations USING btree (campus_id);

CREATE INDEX idx_student_registrations_sem_student ON public.student_registrations USING btree (semester, student_id);

CREATE INDEX idx_student_registrations_student_id ON public.student_registrations USING btree (student_id);

CREATE INDEX idx_student_registrations_student_term ON public.student_registrations USING btree (student_id, academic_year, semester);

CREATE INDEX idx_student_registrations_term_campus ON public.student_registrations USING btree (academic_year, semester, campus_id);

CREATE INDEX idx_students_campus_id ON public.students USING btree (campus_id);

CREATE INDEX idx_students_department_id ON public.students USING btree (department_id);

CREATE INDEX idx_system_logs_audit_events ON public.system_logs USING btree (log_type, event_type, created_at DESC);

CREATE INDEX idx_system_logs_created_at_desc ON public.system_logs USING btree (created_at DESC);

CREATE INDEX idx_system_logs_job_lookup ON public.system_logs USING btree (log_type, campus_id, academic_year, semester, created_at DESC);

CREATE INDEX idx_system_logs_metadata_gin ON public.system_logs USING gin (metadata);

CREATE INDEX idx_system_logs_running_jobs ON public.system_logs USING btree (log_type, campus_id, academic_year, semester) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));

CREATE INDEX idx_system_logs_timetable_jobs_active ON public.system_logs USING btree (log_type, status, updated_at) WHERE (log_type = 'timetable_job'::text);

CREATE INDEX idx_system_logs_type_created ON public.system_logs USING btree (log_type, created_at DESC);

CREATE INDEX idx_system_logs_user_id ON public.system_logs USING btree (user_id) WHERE (user_id IS NOT NULL);

CREATE INDEX idx_tca_campus_term ON public.teacher_course_assignments USING btree (campus_id, academic_year, semester);

CREATE INDEX idx_tca_course_id ON public.teacher_course_assignments USING btree (course_id);

CREATE INDEX idx_tca_teacher_id ON public.teacher_course_assignments USING btree (teacher_id);

CREATE INDEX idx_timetable_entries_campus_course ON public.timetable_entries USING btree (campus_id, course_id, academic_year, semester);

CREATE INDEX idx_timetable_entries_campus_term ON public.timetable_entries USING btree (campus_id, academic_year, semester);

CREATE INDEX idx_timetable_entries_class_id ON public.timetable_entries USING btree (class_id) WHERE (class_id IS NOT NULL);

CREATE INDEX idx_timetable_entries_teacher_slot ON public.timetable_entries USING btree (teacher_id, time_slot_id) WHERE (teacher_id IS NOT NULL);

CREATE INDEX period_attendance_marked_by_fk_idx ON public.period_attendance USING btree (marked_by);

CREATE INDEX period_attendance_sessions_marked_by_fk_idx ON public.period_attendance_sessions USING btree (marked_by);

CREATE INDEX period_attendance_unlocked_by_fk_idx ON public.period_attendance USING btree (unlocked_by);

CREATE INDEX period_unlock_requests_unlocked_by_fk_idx ON public.period_unlock_requests USING btree (unlocked_by);

CREATE INDEX retired_cohorts_retired_by_fk_idx ON public.retired_cohorts USING btree (retired_by);

CREATE INDEX student_registrations_slot_1_course_id_fk_idx ON public.student_registrations USING btree (slot_1_course_id);

CREATE INDEX student_registrations_slot_2_course_id_fk_idx ON public.student_registrations USING btree (slot_2_course_id);

CREATE INDEX student_registrations_slot_3_course_id_fk_idx ON public.student_registrations USING btree (slot_3_course_id);

CREATE INDEX student_registrations_slot_4_course_id_fk_idx ON public.student_registrations USING btree (slot_4_course_id);

CREATE INDEX student_registrations_slot_5_course_id_fk_idx ON public.student_registrations USING btree (slot_5_course_id);

CREATE INDEX student_registrations_slot_6_course_id_fk_idx ON public.student_registrations USING btree (slot_6_course_id);

CREATE INDEX student_registrations_slot_7_course_id_fk_idx ON public.student_registrations USING btree (slot_7_course_id);

CREATE INDEX student_registrations_slot_8_course_id_fk_idx ON public.student_registrations USING btree (slot_8_course_id);

CREATE INDEX system_logs_campus_id_fk_idx ON public.system_logs USING btree (campus_id);

CREATE INDEX teacher_course_assignments_assigned_by_fk_idx ON public.teacher_course_assignments USING btree (assigned_by);

CREATE INDEX time_slots_lab_pair_with_fk_idx ON public.time_slots USING btree (lab_pair_with);

CREATE INDEX timetable_conflicts_blocking_course_id_fk_idx ON public.timetable_conflicts USING btree (blocking_course_id);

CREATE INDEX timetable_conflicts_course_id_fk_idx ON public.timetable_conflicts USING btree (course_id);

CREATE INDEX timetable_entries_course_id_fk_idx ON public.timetable_entries USING btree (course_id);

CREATE UNIQUE INDEX timetable_entries_delivery_unique ON public.timetable_entries USING btree (campus_id, academic_year, semester, course_id, time_slot_id, department_id) NULLS NOT DISTINCT;

CREATE INDEX timetable_entries_department_id_fk_idx ON public.timetable_entries USING btree (department_id);

CREATE INDEX timetable_entries_generated_by_fk_idx ON public.timetable_entries USING btree (generated_by);

CREATE INDEX timetable_entries_time_slot_id_fk_idx ON public.timetable_entries USING btree (time_slot_id);

CREATE UNIQUE INDEX uq_active_allocation_run_cohort ON public.system_logs USING btree (campus_id, academic_year, semester) WHERE ((log_type = 'allocation_run'::text) AND (status = 'running'::text));

CREATE UNIQUE INDEX uq_active_timetable_job_cohort ON public.system_logs USING btree (campus_id, academic_year, semester) WHERE ((log_type = 'timetable_job'::text) AND (status = ANY (ARRAY['queued'::text, 'running'::text])));

ALTER TABLE public."admins" ADD CONSTRAINT "admins_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id);

ALTER TABLE public."campus_settings" ADD CONSTRAINT "campus_settings_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id);

ALTER TABLE public."campus_sign_ins" ADD CONSTRAINT "campus_sign_ins_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE;

ALTER TABLE public."campus_sign_ins" ADD CONSTRAINT "campus_sign_ins_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE public."consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."course_prerequisite_rules" ADD CONSTRAINT "course_prerequisite_rules_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;

ALTER TABLE public."courses" ADD CONSTRAINT "courses_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE public."department_notices" ADD CONSTRAINT "department_notices_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE;

ALTER TABLE public."department_notices" ADD CONSTRAINT "department_notices_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."department_notices" ADD CONSTRAINT "department_notices_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;

ALTER TABLE public."departments" ADD CONSTRAINT "departments_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id);

ALTER TABLE public."faculty" ADD CONSTRAINT "faculty_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id);

ALTER TABLE public."faculty" ADD CONSTRAINT "faculty_department_campus_fk" FOREIGN KEY (department_id, campus_id) REFERENCES departments(id, campus_id);

ALTER TABLE public."faculty" ADD CONSTRAINT "faculty_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE public."faculty" ADD CONSTRAINT "faculty_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id);

ALTER TABLE public."graduation_candidates" ADD CONSTRAINT "graduation_candidates_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id);

ALTER TABLE public."graduation_candidates" ADD CONSTRAINT "graduation_candidates_operation_id_fkey" FOREIGN KEY (operation_id) REFERENCES graduation_operations(id) ON DELETE CASCADE;

ALTER TABLE public."graduation_operations" ADD CONSTRAINT "graduation_operations_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE;

ALTER TABLE public."graduation_operations" ADD CONSTRAINT "graduation_operations_initiated_by_fkey" FOREIGN KEY (initiated_by) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."period_attendance" ADD CONSTRAINT "period_attendance_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;

ALTER TABLE public."period_attendance" ADD CONSTRAINT "period_attendance_marked_by_fkey" FOREIGN KEY (marked_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."period_attendance" ADD CONSTRAINT "period_attendance_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE public."period_attendance" ADD CONSTRAINT "period_attendance_timetable_slot_id_fkey" FOREIGN KEY (timetable_slot_id) REFERENCES timetable_entries(id) ON DELETE CASCADE;

ALTER TABLE public."period_attendance" ADD CONSTRAINT "period_attendance_unlocked_by_fkey" FOREIGN KEY (unlocked_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."period_attendance_sessions" ADD CONSTRAINT "period_attendance_sessions_marked_by_fkey" FOREIGN KEY (marked_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."period_attendance_sessions" ADD CONSTRAINT "period_attendance_sessions_timetable_slot_id_fkey" FOREIGN KEY (timetable_slot_id) REFERENCES timetable_entries(id) ON DELETE CASCADE;

ALTER TABLE public."period_unlock_requests" ADD CONSTRAINT "period_unlock_requests_timetable_slot_id_fkey" FOREIGN KEY (timetable_slot_id) REFERENCES timetable_entries(id) ON DELETE CASCADE;

ALTER TABLE public."period_unlock_requests" ADD CONSTRAINT "period_unlock_requests_unlocked_by_fkey" FOREIGN KEY (unlocked_by) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."promotion_receipts" ADD CONSTRAINT "promotion_receipts_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id);

ALTER TABLE public."registration_preferences" ADD CONSTRAINT "fk_registration_preferences_students" FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE public."registration_preferences" ADD CONSTRAINT "registration_preferences_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE;

ALTER TABLE public."registration_preferences" ADD CONSTRAINT "registration_preferences_student_id_fkey" FOREIGN KEY (student_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."retired_cohorts" ADD CONSTRAINT "retired_cohorts_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE;

ALTER TABLE public."retired_cohorts" ADD CONSTRAINT "retired_cohorts_retired_by_fkey" FOREIGN KEY (retired_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."semester_blueprints" ADD CONSTRAINT "semester_blueprints_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id);

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_slot_1_course_id_fkey" FOREIGN KEY (slot_1_course_id) REFERENCES courses(id);

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_slot_2_course_id_fkey" FOREIGN KEY (slot_2_course_id) REFERENCES courses(id);

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_slot_3_course_id_fkey" FOREIGN KEY (slot_3_course_id) REFERENCES courses(id);

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_slot_4_course_id_fkey" FOREIGN KEY (slot_4_course_id) REFERENCES courses(id);

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_slot_5_course_id_fkey" FOREIGN KEY (slot_5_course_id) REFERENCES courses(id);

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_slot_6_course_id_fkey" FOREIGN KEY (slot_6_course_id) REFERENCES courses(id);

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_slot_7_course_id_fkey" FOREIGN KEY (slot_7_course_id) REFERENCES courses(id) ON DELETE SET NULL;

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_slot_8_course_id_fkey" FOREIGN KEY (slot_8_course_id) REFERENCES courses(id) ON DELETE SET NULL;

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_student_id_fkey" FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE public."students" ADD CONSTRAINT "students_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id);

ALTER TABLE public."students" ADD CONSTRAINT "students_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE public."students" ADD CONSTRAINT "students_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."system_logs" ADD CONSTRAINT "system_logs_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE;

ALTER TABLE public."teacher_course_assignments" ADD CONSTRAINT "teacher_course_assignments_assigned_by_fkey" FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."teacher_course_assignments" ADD CONSTRAINT "teacher_course_assignments_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL;

ALTER TABLE public."teacher_course_assignments" ADD CONSTRAINT "teacher_course_assignments_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;

ALTER TABLE public."teacher_course_assignments" ADD CONSTRAINT "teacher_course_assignments_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."time_slots" ADD CONSTRAINT "time_slots_lab_pair_with_fkey" FOREIGN KEY (lab_pair_with) REFERENCES time_slots(id);

ALTER TABLE public."timetable_conflicts" ADD CONSTRAINT "timetable_conflicts_blocking_course_id_fkey" FOREIGN KEY (blocking_course_id) REFERENCES courses(id);

ALTER TABLE public."timetable_conflicts" ADD CONSTRAINT "timetable_conflicts_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id);

ALTER TABLE public."timetable_entries" ADD CONSTRAINT "timetable_entries_campus_id_fkey" FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE;

ALTER TABLE public."timetable_entries" ADD CONSTRAINT "timetable_entries_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id);

ALTER TABLE public."timetable_entries" ADD CONSTRAINT "timetable_entries_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE public."timetable_entries" ADD CONSTRAINT "timetable_entries_generated_by_fkey" FOREIGN KEY (generated_by) REFERENCES auth.users(id);

ALTER TABLE public."timetable_entries" ADD CONSTRAINT "timetable_entries_teacher_id_fkey" FOREIGN KEY (teacher_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public."timetable_entries" ADD CONSTRAINT "timetable_entries_time_slot_id_fkey" FOREIGN KEY (time_slot_id) REFERENCES time_slots(id);

ALTER TABLE public."admins" ADD CONSTRAINT "admins_role_check" CHECK (role = 'superadmin'::text);

ALTER TABLE public."campus_sign_ins" ADD CONSTRAINT "campus_sign_ins_session_type_check" CHECK (session_type = ANY (ARRAY['morning'::text, 'evening'::text]));

ALTER TABLE public."campus_sign_ins" ADD CONSTRAINT "campus_sign_ins_source_check" CHECK (source = ANY (ARRAY['gps'::text, 'manual_staff'::text]));

ALTER TABLE public."campus_sign_ins" ADD CONSTRAINT "campus_sign_ins_status_check" CHECK (status = ANY (ARRAY['on_time'::text, 'late'::text, 'early_leave'::text]));

ALTER TABLE public."course_prerequisite_rules" ADD CONSTRAINT "course_prerequisite_rules_rule_check" CHECK (rule = ANY (ARRAY['COMPLETED_COURSE'::text, 'COMPLETED_SEMESTER'::text, 'DEPARTMENT'::text]));

ALTER TABLE public."courses" ADD CONSTRAINT "courses_category_check" CHECK (category = ANY (ARRAY['DSS'::text, 'DSC'::text, 'DSE'::text, 'VAC'::text, 'SEC'::text, 'MDC'::text, 'MOOC'::text, 'AEC'::text, 'INT'::text, 'FWD'::text, 'RPH'::text, 'CIP'::text]));

ALTER TABLE public."courses" ADD CONSTRAINT "courses_credits_check" CHECK (credits > 0);

ALTER TABLE public."courses" ADD CONSTRAINT "courses_seat_limit_check" CHECK (seat_limit IS NULL OR seat_limit > 0);

ALTER TABLE public."courses" ADD CONSTRAINT "courses_semester_check" CHECK (semester >= 1 AND semester <= 10);

ALTER TABLE public."department_notices" ADD CONSTRAINT "department_notices_content_check" CHECK (length(btrim(content)) >= 1 AND length(btrim(content)) <= 10000);

ALTER TABLE public."department_notices" ADD CONSTRAINT "department_notices_title_check" CHECK (length(btrim(title)) >= 1 AND length(btrim(title)) <= 200);

ALTER TABLE public."departments" ADD CONSTRAINT "departments_metadata_nonempty" CHECK (length(btrim(name)) > 0 AND length(btrim(code)) > 0);

ALTER TABLE public."faculty" ADD CONSTRAINT "faculty_administrative_assignment" CHECK ((role <> 'hod'::text OR department_id IS NOT NULL AND campus_id IS NOT NULL) AND ((role <> ALL (ARRAY['campus_director'::text, 'teaching_staff'::text])) OR department_id IS NULL AND campus_id IS NOT NULL));

ALTER TABLE public."faculty" ADD CONSTRAINT "faculty_role_check" CHECK (role = ANY (ARRAY['hod'::text, 'campus_director'::text, 'teaching_staff'::text, 'teacher'::text]));

ALTER TABLE public."graduation_candidates" ADD CONSTRAINT "graduation_candidates_stage_check" CHECK (stage = ANY (ARRAY['pending'::text, 'database_deleted'::text, 'completed'::text]));

ALTER TABLE public."graduation_operations" ADD CONSTRAINT "graduation_operations_status_check" CHECK (status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'partially_failed'::text, 'failed'::text]));

ALTER TABLE public."period_attendance" ADD CONSTRAINT "period_attendance_status_check" CHECK (status = ANY (ARRAY['present'::text, 'absent'::text]));

ALTER TABLE public."retired_cohorts" ADD CONSTRAINT "retired_cohorts_semester_check" CHECK (semester >= 1 AND semester <= 10);

ALTER TABLE public."semester_blueprints" ADD CONSTRAINT "semester_blueprints_semester_check" CHECK (semester >= 1 AND semester <= 10);

ALTER TABLE public."semester_blueprints" ADD CONSTRAINT "semester_blueprints_slot_1_rule_check" CHECK (slot_1_rule = ANY (ARRAY['FIXED'::text, 'DEPT_RESTRICTED'::text, 'EXCLUDE_DEPT'::text, 'POOL_RESTRICTED'::text, 'GLOBAL_BASKET'::text]));

ALTER TABLE public."semester_blueprints" ADD CONSTRAINT "semester_blueprints_slot_2_rule_check" CHECK (slot_2_rule = ANY (ARRAY['FIXED'::text, 'DEPT_RESTRICTED'::text, 'EXCLUDE_DEPT'::text, 'POOL_RESTRICTED'::text, 'GLOBAL_BASKET'::text]));

ALTER TABLE public."semester_blueprints" ADD CONSTRAINT "semester_blueprints_slot_3_rule_check" CHECK (slot_3_rule = ANY (ARRAY['FIXED'::text, 'DEPT_RESTRICTED'::text, 'EXCLUDE_DEPT'::text, 'POOL_RESTRICTED'::text, 'GLOBAL_BASKET'::text]));

ALTER TABLE public."semester_blueprints" ADD CONSTRAINT "semester_blueprints_slot_4_rule_check" CHECK (slot_4_rule = ANY (ARRAY['FIXED'::text, 'DEPT_RESTRICTED'::text, 'EXCLUDE_DEPT'::text, 'POOL_RESTRICTED'::text, 'GLOBAL_BASKET'::text]));

ALTER TABLE public."semester_blueprints" ADD CONSTRAINT "semester_blueprints_slot_5_rule_check" CHECK (slot_5_rule = ANY (ARRAY['FIXED'::text, 'DEPT_RESTRICTED'::text, 'EXCLUDE_DEPT'::text, 'POOL_RESTRICTED'::text, 'GLOBAL_BASKET'::text]));

ALTER TABLE public."semester_blueprints" ADD CONSTRAINT "semester_blueprints_slot_6_rule_check" CHECK (slot_6_rule = ANY (ARRAY['FIXED'::text, 'DEPT_RESTRICTED'::text, 'EXCLUDE_DEPT'::text, 'POOL_RESTRICTED'::text, 'GLOBAL_BASKET'::text]));

ALTER TABLE public."student_registrations" ADD CONSTRAINT "chk_student_registrations_unique_slots" CHECK (check_unique_course_slots(slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id));

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_semester_check" CHECK (semester >= 1 AND semester <= 10);

ALTER TABLE public."student_registrations" ADD CONSTRAINT "student_registrations_total_credits_check" CHECK (total_credits >= 0);

ALTER TABLE public."students" ADD CONSTRAINT "students_current_semester_check" CHECK (current_semester >= 1 AND current_semester <= 10);

ALTER TABLE public."system_logs" ADD CONSTRAINT "system_logs_log_type_check" CHECK (log_type = ANY (ARRAY['audit_event'::text, 'timetable_job'::text, 'allocation_run'::text, 'server_error'::text]));

ALTER TABLE public."system_logs" ADD CONSTRAINT "system_logs_progress_check" CHECK (progress >= 0 AND progress <= 100);

ALTER TABLE public."system_logs" ADD CONSTRAINT "system_logs_status_check" CHECK (status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text, 'success'::text, 'failure'::text]));

ALTER TABLE public."teacher_course_assignments" ADD CONSTRAINT "teacher_course_assignments_semester_check" CHECK (semester >= 1 AND semester <= 10);

ALTER TABLE public."time_slots" ADD CONSTRAINT "time_slots_day_of_week_check" CHECK (day_of_week >= 1 AND day_of_week <= 5);

ALTER TABLE public."time_slots" ADD CONSTRAINT "time_slots_period_number_check" CHECK (period_number >= 1 AND period_number <= 6);

ALTER TABLE public."timetable_entries" ADD CONSTRAINT "timetable_entries_session_type_check" CHECK (session_type = ANY (ARRAY['theory'::text, 'practical'::text]));

ALTER TABLE public."timetable_entries" ADD CONSTRAINT "timetable_entries_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'conflict'::text]));

CREATE VIEW public."allocation_runs" WITH (security_invoker=true) AS
SELECT id,
    campus_id,
    academic_year,
    semester,
    status,
    user_id AS triggered_by,
    started_at AS triggered_at,
    COALESCE((metadata ->> 'total_students'::text)::integer, 0) AS total_students,
    COALESCE((metadata ->> 'fully_allocated'::text)::integer, 0) AS fully_allocated,
    COALESCE((metadata ->> 'partially_allocated'::text)::integer, 0) AS partially_allocated,
    COALESCE((metadata ->> 'unallocated'::text)::integer, 0) AS unallocated,
    COALESCE(metadata -> 'summary'::text, '{}'::jsonb) AS summary,
    error_message,
    started_at,
    completed_at,
    created_at
   FROM system_logs
  WHERE log_type = 'allocation_run'::text;

CREATE VIEW public."audit_logs" WITH (security_invoker=true) AS
SELECT id,
    event_type,
    user_id,
    user_role,
    action,
    resource_type,
    resource_id,
    status,
    error_message,
    metadata,
    ip_address,
    created_at
   FROM system_logs
  WHERE log_type = 'audit_event'::text;

CREATE VIEW public."timetable_generation_jobs" WITH (security_invoker=true) AS
SELECT id,
    campus_id,
    academic_year,
    semester,
    status,
    progress,
    error_message,
    user_id AS triggered_by,
    COALESCE(metadata -> 'config'::text, '{}'::jsonb) AS config,
    started_at,
    completed_at,
    created_at,
    updated_at
   FROM system_logs
  WHERE log_type = 'timetable_job'::text;

CREATE TRIGGER trg_allocation_runs_insert_update INSTEAD OF INSERT OR UPDATE ON allocation_runs FOR EACH ROW EXECUTE FUNCTION trg_allocation_runs_io();

CREATE TRIGGER trg_audit_logs_insert INSTEAD OF INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION trg_audit_logs_io();

CREATE TRIGGER trg_campuses_init_settings AFTER INSERT ON campuses FOR EACH ROW EXECUTE FUNCTION trg_init_campus_settings();

CREATE TRIGGER course_reference_guard BEFORE INSERT OR UPDATE ON course_prerequisite_rules FOR EACH ROW EXECUTE FUNCTION guard_course_reference_write();

CREATE TRIGGER course_reference_guard BEFORE INSERT OR UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION guard_course_reference_write();

CREATE TRIGGER course_semester_guard BEFORE UPDATE OF semester ON courses FOR EACH ROW EXECUTE FUNCTION guard_course_semester_change();

CREATE TRIGGER normalize_department_metadata BEFORE INSERT OR UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION normalize_department_metadata();

CREATE TRIGGER faculty_campus_guard BEFORE INSERT OR UPDATE OF role, department_id, campus_id ON faculty FOR EACH ROW EXECUTE FUNCTION check_faculty_campus();

CREATE TRIGGER course_reference_guard BEFORE INSERT OR UPDATE ON period_attendance FOR EACH ROW EXECUTE FUNCTION guard_course_reference_write();

CREATE TRIGGER course_reference_guard BEFORE INSERT OR UPDATE ON registration_preferences FOR EACH ROW EXECUTE FUNCTION guard_course_reference_write();

CREATE TRIGGER course_reference_guard BEFORE INSERT OR UPDATE ON semester_blueprints FOR EACH ROW EXECUTE FUNCTION guard_course_reference_write();

CREATE TRIGGER course_reference_guard BEFORE INSERT OR UPDATE ON student_registrations FOR EACH ROW EXECUTE FUNCTION guard_course_reference_write();

CREATE TRIGGER registration_snapshots BEFORE INSERT OR UPDATE ON student_registrations FOR EACH ROW EXECUTE FUNCTION sync_registration_snapshots();

CREATE TRIGGER trg_graduate_student AFTER UPDATE ON students FOR EACH ROW WHEN (new.current_semester > 10) EXECUTE FUNCTION delete_graduated_student();

CREATE TRIGGER course_reference_guard BEFORE INSERT OR UPDATE ON teacher_course_assignments FOR EACH ROW EXECUTE FUNCTION guard_course_reference_write();

CREATE TRIGGER revoke_deleted_assignment_authority AFTER DELETE ON teacher_course_assignments FOR EACH ROW EXECUTE FUNCTION revoke_deleted_assignment_authority();

CREATE TRIGGER course_reference_guard BEFORE INSERT OR UPDATE ON timetable_conflicts FOR EACH ROW EXECUTE FUNCTION guard_course_reference_write();

CREATE TRIGGER course_reference_guard BEFORE INSERT OR UPDATE ON timetable_entries FOR EACH ROW EXECUTE FUNCTION guard_course_reference_write();

CREATE TRIGGER trg_timetable_entries_published_guard BEFORE INSERT OR DELETE OR UPDATE ON timetable_entries FOR EACH ROW EXECUTE FUNCTION trg_guard_published_timetable_entries();

CREATE TRIGGER trg_timetable_jobs_insert_update INSTEAD OF INSERT OR UPDATE ON timetable_generation_jobs FOR EACH ROW EXECUTE FUNCTION trg_timetable_jobs_io();

ALTER TABLE public."admins" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."campus_settings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."campus_sign_ins" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."campuses" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."consent_records" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."course_prerequisite_rules" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."courses" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."department_notices" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."departments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."faculty" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."graduation_candidates" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."graduation_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."period_attendance" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."period_attendance_sessions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."period_unlock_requests" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."promotion_receipts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."registration_preferences" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."retired_cohorts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."schema_migrations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."semester_blueprints" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."student_registrations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."students" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."system_logs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."teacher_course_assignments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."time_slots" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."timetable_conflicts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."timetable_entries" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "backend_service_access" ON public."consent_records" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."faculty" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."campus_settings" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."teacher_course_assignments" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."campuses" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."students" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."course_prerequisite_rules" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."admins" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."courses" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."schema_migrations" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."campus_sign_ins" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."registration_preferences" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."semester_blueprints" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."system_logs" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."time_slots" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."timetable_entries" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."period_attendance" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."period_unlock_requests" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."student_registrations" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."graduation_candidates" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."graduation_operations" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."department_notices" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."departments" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."period_attendance_sessions" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."promotion_receipts" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."retired_cohorts" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

CREATE POLICY "backend_service_access" ON public."timetable_conflicts" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);

INSERT INTO public.schema_migrations (version,name) VALUES ('20260928_unified_master_schema_and_upsert','Unified master idempotent schema and institutional seed upsert');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261001_add_slot_7_and_8_to_student_registrations','Add slot_7_course_id and slot_8_course_id to student_registrations');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261002_harden_direct_rls_authorization','Harden direct RLS authorization and operational log access');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261007000000_plan03_schema_alignment','Plan 03: Schema alignment, class identity and ten-semester foundation');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261007010000_plan04_enrollment_capacity_transactions','Plan 04: Registration, eligibility, credits and global seats');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261007020000_plan05_deterministic_allocation_atomic_jobs','Plan 05: Deterministic allocation and atomic jobs');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261007030000_plan06_timetable_constraints_and_guards','Plan 06: Local OR-Tools timetables, JSON constraints and generation recovery');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261007040000_plan07_period_attendance_refinements','Plan 07: Period attendance and independent GPS sign-ins');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261007050000_plan08_campus_onboarding_and_atomic_promotion','Plan 08: Campus setup, promotion, graduation and short retention');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261007060000_plan09_credit_ledger_and_scoped_exports','Plan 09: Registered-credit ledger and scoped exports');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261008000000_plan06_timetable_ortools_recovery','Plan 06: Local OR-Tools timetables, JSON constraints and generation recovery');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261009020000_followup_plan03_host_campus_delivery_identity','Follow-up Plan 03: Host-campus classes and teacher identity');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261010020000_followup_plan06_file_constraints_and_cohort_guards','Follow-up Plan 06: OR-Tools rule compilation, durable JSON file overrides, and atomic timetable publication');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261010030000_followup_plan07_attendance_concurrency_and_pairing','Plan 07: Current-semester attendance, practical copying and concurrent edits');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261010040000_followup_plan08_recoverable_graduation_and_retention','Plan 08: Recoverable graduation and current-semester cleanup');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261010050000_followup_plan08_durable_graduation_recovery','Durable graduation and promotion retries');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261010060000_followup_plan09_registration_snapshots','Canonical enrollment and registration-time snapshots');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261010070000_followup_plan10_attendance_rpc_privileges','Restrict trusted attendance RPCs to backend callers');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261010080000_production_timetable_transactions','Production fenced timetable transactions and attendance ACLs');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261010090000_production_attendance_summary','Production attendance aggregation and readiness');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261010100000_production_allocation_fencing_and_clocks','Allocation fencing, projected seats and transaction clocks');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261011010000_timetable_draft_delivery_repair','Host-campus timetable uniqueness and legacy draft replacement');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261011020000_security_advisor_function_hardening','Pin reported function search paths and restrict every backend RPC overload');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261013010000_review_enrollment_and_assignment_repairs','Review: atomic enrollment and assignment authority');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261013020000_department_notices','Scoped department notices for student and faculty portals');

INSERT INTO public.schema_migrations (version,name) VALUES ('20261015010000_verified_timetable_publication','Verify saved publication and replace legacy timetable guards');

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA public TO service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

