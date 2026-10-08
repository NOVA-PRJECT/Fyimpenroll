-- =============================================================================
-- Migration: 20261007040000_plan07_period_attendance_refinements.sql
-- Plan 07: Period attendance and independent GPS sign-ins
-- Findings: F43, F44, F45, F46, F47, F48, F49
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. F48: Ensure attendance_date and unique constraint on (timetable_slot_id, student_id, attendance_date)
-- -----------------------------------------------------------------------------
ALTER TABLE period_attendance
    ADD COLUMN IF NOT EXISTS attendance_date DATE;

-- Populate any historical null attendance_date from marked_at in IST
UPDATE period_attendance
SET attendance_date = (timezone('Asia/Kolkata', marked_at))::date
WHERE attendance_date IS NULL;

-- Ensure attendance_date is NOT NULL going forward
ALTER TABLE period_attendance
    ALTER COLUMN attendance_date SET NOT NULL;

-- Ensure unique constraint on (timetable_slot_id, student_id, attendance_date)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'period_attendance_unique'
          AND conrelid = 'period_attendance'::regclass
    ) THEN
        ALTER TABLE period_attendance
            ADD CONSTRAINT period_attendance_unique UNIQUE (timetable_slot_id, student_id, attendance_date);
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. F46 & F48: Optimized Index for Dated Period Queries & HOD Summaries
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_period_attendance_slot_date
    ON period_attendance (timetable_slot_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_period_attendance_student_date
    ON period_attendance (student_id, attendance_date);

-- -----------------------------------------------------------------------------
-- 3. F44: Make obsolete unlock columns fully optional / deprecated
-- -----------------------------------------------------------------------------
ALTER TABLE period_attendance
    ALTER COLUMN is_late_entry SET DEFAULT false,
    ALTER COLUMN unlocked_by DROP NOT NULL;

COMMENT ON COLUMN period_attendance.is_late_entry IS
    'DEPRECATED (Plan 07 / F44): Late-entry flag retained for historical rows only. Live edits are unrestricted for current semester.';

COMMENT ON COLUMN period_attendance.unlocked_by IS
    'DEPRECATED (Plan 07 / F44): HOD unlock actor retained for historical rows only. Live edits are unrestricted for current semester.';

-- -----------------------------------------------------------------------------
-- 4. Record migration
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('20261007040000_plan07_period_attendance_refinements', 'Plan 07: Period attendance and independent GPS sign-ins')
ON CONFLICT (version) DO NOTHING;
