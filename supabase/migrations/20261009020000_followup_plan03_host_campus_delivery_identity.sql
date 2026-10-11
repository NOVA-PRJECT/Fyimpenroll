-- =============================================================================
-- Migration: 20261009020000_followup_plan03_host_campus_delivery_identity.sql
-- Plan: Follow-up Plan 03 - Host-campus classes and teacher identity
-- Primary Findings: R06, R07, R08
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. R06: Add host campus_id to timetable_entries to separate host delivery
--    from catalogue course ownership (courses.department_id).
-- -----------------------------------------------------------------------------
ALTER TABLE timetable_entries
    ADD COLUMN IF NOT EXISTS campus_id UUID REFERENCES campuses(id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- 2. Safe non-destructive backfill for legacy timetable_entries
--    Derive host campus from the department where available.
-- -----------------------------------------------------------------------------
UPDATE timetable_entries te
SET campus_id = d.campus_id
FROM departments d
WHERE te.department_id = d.id
  AND te.campus_id IS NULL;

-- -----------------------------------------------------------------------------
-- 3. Composite indexing for host delivery scope lookups
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_timetable_entries_campus_term
    ON timetable_entries (campus_id, academic_year, semester);

CREATE INDEX IF NOT EXISTS idx_timetable_entries_campus_course
    ON timetable_entries (campus_id, course_id, academic_year, semester);

-- -----------------------------------------------------------------------------
-- 4. Update published guard trigger to include campus_id in immutable fields
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

    -- On UPDATE: if entry was published, forbid changing core slot, course, department, campus, or reverting status
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'published' THEN
            -- Allow in-place teacher assignment / substitution and class linkage (F33, F37, R08)
            IF NEW.id <> OLD.id OR
               NEW.academic_year <> OLD.academic_year OR
               NEW.semester <> OLD.semester OR
               NEW.course_id <> OLD.course_id OR
               NEW.department_id <> OLD.department_id OR
               NEW.campus_id IS DISTINCT FROM OLD.campus_id OR
               NEW.time_slot_id <> OLD.time_slot_id OR
               NEW.status <> 'published' THEN
                RAISE EXCEPTION 'Cannot modify core schedule identity or unpublish published timetable entry % (F33, R06)', OLD.id;
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 5. Record migration
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES ('20261009020000_followup_plan03_host_campus_delivery_identity', 'Follow-up Plan 03: Host-campus classes and teacher identity')
ON CONFLICT (version) DO NOTHING;
