-- =============================================================================
-- Migration: 20261007050000_plan08_campus_onboarding_and_atomic_promotion.sql
-- Plan 08: Campus setup, promotion, graduation and short retention
-- Findings: F54, F55, F56
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. F54: Automatically initialize required campus_settings on campus creation
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_init_campus_settings()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campuses_init_settings ON campuses;
CREATE TRIGGER trg_campuses_init_settings
AFTER INSERT ON campuses
FOR EACH ROW
EXECUTE FUNCTION trg_init_campus_settings();

-- Backfill any existing campuses that might be missing campus_settings
INSERT INTO campus_settings (campus_id, academic_year, min_credits, max_credits)
SELECT c.id, '2025-26', 18, 26
FROM campuses c
LEFT JOIN campus_settings cs ON cs.campus_id = c.id
WHERE cs.id IS NULL
ON CONFLICT (campus_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. F56 & F55: Atomic Campus Promotion Procedure with Cooldown & Explicit Graduation Cohort
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promote_campus_students_atomic(
    p_campus_id UUID,
    p_director_id UUID,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
    SET last_promoted_at = timezone('utc'::text, now())
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
$$;

-- -----------------------------------------------------------------------------
-- 3. Concluded-Semester Attendance Retention Purge Procedure
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_concluded_semester_attendance(
    p_campus_id UUID,
    p_academic_year TEXT,
    p_semester SMALLINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deleted_count INTEGER := 0;
BEGIN
    -- Purge period_attendance records belonging to timetable entries of the concluded term
    -- Crucial: preserves student_registrations and other cohorts' attendance
    WITH deleted_attendance AS (
        DELETE FROM period_attendance
        WHERE timetable_slot_id IN (
            SELECT te.id
            FROM timetable_entries te
            JOIN departments d ON d.id = te.department_id
            WHERE d.campus_id = p_campus_id
              AND te.academic_year = p_academic_year
              AND te.semester = p_semester
        )
        RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted_attendance;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_attendance_records', v_deleted_count,
        'campus_id', p_campus_id,
        'academic_year', p_academic_year,
        'semester', p_semester
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Record migration
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('20261007050000_plan08_campus_onboarding_and_atomic_promotion', 'Plan 08: Campus setup, promotion, graduation and short retention')
ON CONFLICT (version) DO NOTHING;
