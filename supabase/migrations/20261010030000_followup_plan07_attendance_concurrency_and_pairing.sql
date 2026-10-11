-- =============================================================================
-- Migration: 20261010030000_followup_plan07_attendance_concurrency_and_pairing.sql
-- Follow-up Plan 07: Current-semester attendance, practical copying and concurrent edits
-- Primary Findings: R03, R28, R29
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. R29: Dated Attendance Sessions Table for Revision Tracking & Optimistic Locking
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS period_attendance_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timetable_slot_id UUID NOT NULL REFERENCES timetable_entries(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    revision_token TEXT NOT NULL,
    marked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    last_marked_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    total_students INTEGER NOT NULL DEFAULT 0,
    present_count INTEGER NOT NULL DEFAULT 0,
    absent_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_period_attendance_sessions UNIQUE (timetable_slot_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_period_attendance_sessions_slot_date
    ON period_attendance_sessions (timetable_slot_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_period_attendance_sessions_date
    ON period_attendance_sessions (attendance_date);

ALTER TABLE period_attendance_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view period attendance sessions"
    ON period_attendance_sessions FOR SELECT TO authenticated
    USING (true);

-- -----------------------------------------------------------------------------
-- 2. R28: Retired Cohorts Registry (Term Retention Scope Contract for Plan 08)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retired_cohorts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    semester SMALLINT NOT NULL CHECK (semester >= 1 AND semester <= 10),
    retired_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    retired_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reason TEXT DEFAULT 'Term concluded and attendance archived/purged',
    CONSTRAINT uq_retired_cohorts UNIQUE (campus_id, academic_year, semester)
);

CREATE INDEX IF NOT EXISTS idx_retired_cohorts_lookup
    ON retired_cohorts (campus_id, academic_year, semester);

ALTER TABLE retired_cohorts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view retired cohorts"
    ON retired_cohorts FOR SELECT TO authenticated
    USING (true);

-- -----------------------------------------------------------------------------
-- 3. R29: Backfill existing sessions from historical period_attendance marks
-- -----------------------------------------------------------------------------
INSERT INTO period_attendance_sessions (
    timetable_slot_id,
    attendance_date,
    revision,
    revision_token,
    marked_by,
    last_marked_at,
    total_students,
    present_count,
    absent_count
)
SELECT
    pa.timetable_slot_id,
    pa.attendance_date,
    1 AS revision,
    md5(pa.timetable_slot_id::text || '_' || pa.attendance_date::text || '_1') AS revision_token,
    (array_agg(pa.marked_by ORDER BY pa.marked_at DESC NULLS LAST))[1] AS marked_by,
    max(pa.marked_at) AS last_marked_at,
    count(*)::integer AS total_students,
    count(*) FILTER (WHERE pa.status = 'present')::integer AS present_count,
    count(*) FILTER (WHERE pa.status = 'absent')::integer AS absent_count
FROM period_attendance pa
GROUP BY pa.timetable_slot_id, pa.attendance_date
ON CONFLICT (timetable_slot_id, attendance_date) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. R29: Atomic Period Attendance Submission with Revision CAS (PostgreSQL RPC)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atomic_submit_period_attendance(
    p_slot_id UUID,
    p_attendance_date DATE,
    p_user_id UUID,
    p_absent_student_ids UUID[],
    p_all_roster_ids UUID[],
    p_course_id UUID,
    p_expected_revision INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- -----------------------------------------------------------------------------
-- 5. R03 & R29: Atomic Practical Copying with Pair Validation & Target Revision CAS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atomic_copy_practical_attendance(
    p_source_slot_id UUID,
    p_target_slot_id UUID,
    p_attendance_date DATE,
    p_user_id UUID,
    p_expected_target_revision INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- -----------------------------------------------------------------------------
-- 6. R28: Harden Term Cleanup to Prevent Repopulation of Retired Attendance
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_concluded_semester_attendance(
    p_campus_id UUID,
    p_academic_year TEXT,
    p_semester SMALLINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- -----------------------------------------------------------------------------
-- 7. Follow-up Plan 01 Security Compliance: Grants and Revocations
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION atomic_submit_period_attendance(UUID, DATE, UUID, UUID[], UUID[], UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION atomic_submit_period_attendance(UUID, DATE, UUID, UUID[], UUID[], UUID, INTEGER) TO authenticated, service_role;

REVOKE ALL ON FUNCTION atomic_copy_practical_attendance(UUID, UUID, DATE, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION atomic_copy_practical_attendance(UUID, UUID, DATE, UUID, INTEGER) TO authenticated, service_role;

REVOKE ALL ON FUNCTION cleanup_concluded_semester_attendance(UUID, TEXT, SMALLINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cleanup_concluded_semester_attendance(UUID, TEXT, SMALLINT) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. Record migration
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES (
    '20261010030000_followup_plan07_attendance_concurrency_and_pairing',
    'Plan 07: Current-semester attendance, practical copying and concurrent edits'
)
ON CONFLICT (version) DO NOTHING;
