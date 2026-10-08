-- =============================================================================
-- Migration: 20261007060000_plan09_credit_ledger_and_scoped_exports.sql
-- Plan 09: Registered-credit ledger and scoped exports
-- Findings: F50, F51, F52
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. F51: Optional explicit academic_level attribute on courses catalog
-- -----------------------------------------------------------------------------
ALTER TABLE courses
ADD COLUMN IF NOT EXISTS academic_level VARCHAR(10);

COMMENT ON COLUMN courses.academic_level IS
'Optional explicit academic level band (100s, 200s, 300s, 400s, 500s) to complement code parsing';

-- -----------------------------------------------------------------------------
-- 2. Export and Ledger Query Accelerators
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_student_registrations_sem_student
ON student_registrations (semester, student_id);

CREATE INDEX IF NOT EXISTS idx_period_attendance_export_lookup
ON period_attendance (timetable_slot_id, attendance_date);

-- -----------------------------------------------------------------------------
-- 3. Record migration in schema_migrations table
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES (
    '20261007060000_plan09_credit_ledger_and_scoped_exports',
    'Plan 09: Registered-credit ledger and scoped exports'
)
ON CONFLICT (version) DO NOTHING;
