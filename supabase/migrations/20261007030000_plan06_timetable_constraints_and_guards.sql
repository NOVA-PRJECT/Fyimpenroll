-- =============================================================================
-- Migration: 20261007030000_plan06_timetable_constraints_and_guards.sql
-- Plan 06: Local OR-Tools timetables, JSON constraints and generation recovery
-- Findings: F33, F34, F35, F36, F37, F39, F40, F41, F42, F71; Data: D03, D04, D05
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. F39: Per-campus durable JSON constraint overrides on campus_settings
-- -----------------------------------------------------------------------------
ALTER TABLE campus_settings
    ADD COLUMN IF NOT EXISTS timetable_constraints JSONB DEFAULT NULL;

COMMENT ON COLUMN campus_settings.timetable_constraints IS
    'Per-campus director timetable JSON constraint overrides merging over university constraints.base.json (F39).';

-- -----------------------------------------------------------------------------
-- 2. F33 & F37: Add teacher_id and class_id to timetable_entries
-- -----------------------------------------------------------------------------
ALTER TABLE timetable_entries
    ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS class_id UUID;

CREATE INDEX IF NOT EXISTS idx_timetable_entries_teacher_slot
    ON timetable_entries (teacher_id, time_slot_id)
    WHERE teacher_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_timetable_entries_class_id
    ON timetable_entries (class_id)
    WHERE class_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. F33: Immutable publication database trigger on timetable_entries
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_guard_published_timetable_entries()
RETURNS TRIGGER AS $$
BEGIN
    -- On DELETE: strictly forbid deleting published timetable rows
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'published' THEN
            RAISE EXCEPTION 'Cannot delete published timetable entry % (F33: published schedules are immutable)', OLD.id;
        END IF;
        RETURN OLD;
    END IF;

    -- On UPDATE: if entry was published, forbid changing core slot, course, department, or reverting status
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'published' THEN
            -- Allow in-place teacher assignment / substitution and class linkage (F33, F37)
            IF NEW.id <> OLD.id OR
               NEW.academic_year <> OLD.academic_year OR
               NEW.semester <> OLD.semester OR
               NEW.course_id <> OLD.course_id OR
               NEW.department_id <> OLD.department_id OR
               NEW.time_slot_id <> OLD.time_slot_id OR
               NEW.status <> 'published' THEN
                RAISE EXCEPTION 'Cannot modify core schedule identity or unpublish published timetable entry % (F33)', OLD.id;
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_timetable_entries_published_guard ON timetable_entries;
CREATE TRIGGER trg_timetable_entries_published_guard
BEFORE UPDATE OR DELETE ON timetable_entries
FOR EACH ROW
EXECUTE FUNCTION trg_guard_published_timetable_entries();

-- -----------------------------------------------------------------------------
-- 4. F42: Indexes for durable job claims, heartbeats and stale worker detection
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_system_logs_timetable_jobs_active
    ON system_logs (log_type, status, updated_at)
    WHERE log_type = 'timetable_job';

-- -----------------------------------------------------------------------------
-- 5. Record migration
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('20261007030000_plan06_timetable_constraints_and_guards', 'Plan 06: Local OR-Tools timetables, JSON constraints and generation recovery')
ON CONFLICT (version) DO NOTHING;
