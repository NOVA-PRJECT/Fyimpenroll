-- =============================================================================
-- Migration: 20261007000000_plan03_schema_alignment.sql
-- Plan: Plan 03 - Schema alignment, class identity and ten-semester foundation
-- Primary Findings: F38 (withdrawn), F53, F64, F65, F66, F67, F68, F69
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. F65: Storage-level indexes on system_logs (never directly on audit_logs view)
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_system_logs_audit_events 
    ON system_logs (log_type, event_type, created_at DESC) 
    WHERE log_type = 'audit_event';

CREATE INDEX IF NOT EXISTS idx_system_logs_user_id 
    ON system_logs (user_id);

-- -----------------------------------------------------------------------------
-- 2. F66: Relaxes total_credits constraint to support pending/unallocated states
-- -----------------------------------------------------------------------------
ALTER TABLE student_registrations 
    ALTER COLUMN total_credits SET DEFAULT 0;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public' 
          AND table_name = 'student_registrations'
          AND constraint_name = 'student_registrations_total_credits_check'
    ) THEN
        ALTER TABLE student_registrations DROP CONSTRAINT student_registrations_total_credits_check;
    END IF;

    ALTER TABLE student_registrations 
        ADD CONSTRAINT student_registrations_total_credits_check CHECK (total_credits >= 0);
END $$;

-- -----------------------------------------------------------------------------
-- 3. F53 & D07: Extend semester domain to support full ten semesters (1-10)
-- -----------------------------------------------------------------------------
ALTER TABLE student_registrations 
    DROP CONSTRAINT IF EXISTS student_registrations_semester_check;
ALTER TABLE student_registrations 
    ADD CONSTRAINT student_registrations_semester_check CHECK (semester BETWEEN 1 AND 10);

ALTER TABLE semester_blueprints 
    DROP CONSTRAINT IF EXISTS semester_blueprints_semester_check;
ALTER TABLE semester_blueprints 
    ADD CONSTRAINT semester_blueprints_semester_check CHECK (semester BETWEEN 1 AND 10);

ALTER TABLE courses 
    DROP CONSTRAINT IF EXISTS courses_semester_check;
ALTER TABLE courses 
    ADD CONSTRAINT courses_semester_check CHECK (semester BETWEEN 1 AND 10);

-- -----------------------------------------------------------------------------
-- 4. F67: Introduce campus offering and term identity to teacher_course_assignments
--    Allows visiting teachers across campuses without changing catalog ownership.
-- -----------------------------------------------------------------------------
ALTER TABLE teacher_course_assignments 
    ADD COLUMN IF NOT EXISTS campus_id UUID REFERENCES campuses(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS academic_year TEXT,
    ADD COLUMN IF NOT EXISTS semester INTEGER CHECK (semester >= 1 AND semester <= 10);

-- Backfill existing rows with course semester and faculty campus where available
UPDATE teacher_course_assignments tca
SET 
    semester = COALESCE(tca.semester, c.semester),
    campus_id = COALESCE(tca.campus_id, f.campus_id),
    academic_year = COALESCE(tca.academic_year, '2025-26')
FROM courses c, faculty f
WHERE tca.course_id = c.id AND tca.teacher_id = f.id;

-- Transition from legacy course-only uniqueness to composite campus-term uniqueness
ALTER TABLE teacher_course_assignments 
    DROP CONSTRAINT IF EXISTS teacher_course_assignments_unique;

ALTER TABLE teacher_course_assignments 
    DROP CONSTRAINT IF EXISTS uq_teacher_course_assignments_term;

ALTER TABLE teacher_course_assignments 
    ADD CONSTRAINT uq_teacher_course_assignments_term 
    UNIQUE (teacher_id, course_id, campus_id, academic_year, semester);

CREATE INDEX IF NOT EXISTS idx_tca_campus_term 
    ON teacher_course_assignments (campus_id, academic_year, semester);

-- -----------------------------------------------------------------------------
-- 5. F68: Fix foreign key cascades on actor fields to prevent loss of attendance
-- -----------------------------------------------------------------------------
-- 5a. period_attendance.marked_by must NOT cascade delete student attendance marks
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN (
        SELECT tc.constraint_name 
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'period_attendance'
          AND kcu.column_name = 'marked_by'
          AND tc.constraint_type = 'FOREIGN KEY'
    ) LOOP
        EXECUTE 'ALTER TABLE period_attendance DROP CONSTRAINT ' || quote_ident(r.constraint_name);
    END LOOP;
END $$;

ALTER TABLE period_attendance ALTER COLUMN marked_by DROP NOT NULL;

ALTER TABLE period_attendance 
    ADD CONSTRAINT period_attendance_marked_by_fkey 
    FOREIGN KEY (marked_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 5b. teacher_course_assignments.assigned_by must be nullable and set null on actor deletion
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN (
        SELECT tc.constraint_name 
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'teacher_course_assignments'
          AND kcu.column_name = 'assigned_by'
          AND tc.constraint_type = 'FOREIGN KEY'
    ) LOOP
        EXECUTE 'ALTER TABLE teacher_course_assignments DROP CONSTRAINT ' || quote_ident(r.constraint_name);
    END LOOP;
END $$;

ALTER TABLE teacher_course_assignments ALTER COLUMN assigned_by DROP NOT NULL;

ALTER TABLE teacher_course_assignments 
    ADD CONSTRAINT teacher_course_assignments_assigned_by_fkey 
    FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 6. F69: Drop duplicate FK constraint on student_registrations(student_id)
-- -----------------------------------------------------------------------------
ALTER TABLE student_registrations 
    DROP CONSTRAINT IF EXISTS student_registrations_student_id_fkey1;

-- -----------------------------------------------------------------------------
-- 7. F38 (Withdrawn): Maintain timetable_entries uniqueness
-- NOTE: Timetable uniqueness retains (academic_year, semester, course_id, time_slot_id, department_id)
-- or slot-level independence so parallel elective classes across departments/sections can coexist.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 8. Record migration in schema_migrations
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('20261007000000_plan03_schema_alignment', 'Plan 03: Schema alignment, class identity and ten-semester foundation')
ON CONFLICT (version) DO NOTHING;
