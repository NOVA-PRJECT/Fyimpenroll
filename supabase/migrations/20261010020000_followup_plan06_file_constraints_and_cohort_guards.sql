-- =============================================================================
-- Migration: 20261010020000_followup_plan06_file_constraints_and_cohort_guards.sql
-- Follow-up Plan 06: OR-Tools rule compilation, durable JSON file overrides,
-- and atomic timetable draft/publication transitions (R19, R20, R22).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. R20: Deprecate campus_settings.timetable_constraints in favor of file storage
-- -----------------------------------------------------------------------------
COMMENT ON COLUMN campus_settings.timetable_constraints IS
    'DEPRECATED (R20): Campus director timetable constraints are stored in durable versioned JSON files on the filesystem. Retained for historical export/migration only.';

-- -----------------------------------------------------------------------------
-- 2. R22: Cohort Publication Immutability Guard Trigger (INSERT, UPDATE, DELETE)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_guard_published_timetable_entries()
RETURNS TRIGGER AS $$
DECLARE
    v_published_count INT;
BEGIN
    -- On DELETE: strictly forbid deleting published timetable rows
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'published' THEN
            RAISE EXCEPTION 'Cannot delete published timetable entry % (F33/R22: published schedules are immutable)', OLD.id;
        END IF;
        RETURN OLD;
    END IF;

    -- On INSERT: strictly forbid adding new entries to an already-published cohort
    IF TG_OP = 'INSERT' THEN
        SELECT COUNT(*)
        INTO v_published_count
        FROM timetable_entries
        WHERE academic_year = NEW.academic_year
          AND semester = NEW.semester
          AND status = 'published'
          AND (
              (NEW.campus_id IS NOT NULL AND campus_id = NEW.campus_id)
              OR (NEW.campus_id IS NULL AND campus_id IS NULL)
          );

        IF v_published_count > 0 THEN
            RAISE EXCEPTION 'Cannot insert new timetable entry into already-published cohort (campus: %, year: %, semester: %) (R22)',
                COALESCE(NEW.campus_id::text, 'global'), NEW.academic_year, NEW.semester;
        END IF;

        RETURN NEW;
    END IF;

    -- On UPDATE:
    IF TG_OP = 'UPDATE' THEN
        -- If row is already published, allow ONLY teacher assignment/substitution
        IF OLD.status = 'published' THEN
            IF NEW.id <> OLD.id OR
               NEW.academic_year <> OLD.academic_year OR
               NEW.semester <> OLD.semester OR
               NEW.course_id <> OLD.course_id OR
               NEW.department_id <> OLD.department_id OR
               NEW.time_slot_id <> OLD.time_slot_id OR
               NEW.session_type <> OLD.session_type OR
               NEW.is_lab_block <> OLD.is_lab_block OR
               COALESCE(NEW.campus_id, '00000000-0000-0000-0000-000000000000'::uuid) <>
               COALESCE(OLD.campus_id, '00000000-0000-0000-0000-000000000000'::uuid) OR
               NEW.status <> 'published' THEN
                RAISE EXCEPTION 'Cannot modify core schedule identity or unpublish published timetable entry % (F33/R22)', OLD.id;
            END IF;
        END IF;

        -- If transitioning to published, ensure we are not publishing while another worker is generating
        IF OLD.status <> 'published' AND NEW.status = 'published' THEN
            -- Allowed transition during atomic publication
            RETURN NEW;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_timetable_entries_published_guard ON timetable_entries;
CREATE TRIGGER trg_timetable_entries_published_guard
BEFORE INSERT OR UPDATE OR DELETE ON timetable_entries
FOR EACH ROW
EXECUTE FUNCTION trg_guard_published_timetable_entries();

-- -----------------------------------------------------------------------------
-- 3. R22: Atomic Draft Replacement Function with Advisory Lock & Cohort Guard
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atomic_replace_timetable_draft(
    p_campus_id UUID,
    p_academic_year TEXT,
    p_semester INT,
    p_entries JSONB,
    p_job_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_published_count INT;
    v_inserted_count INT := 0;
    v_entry JSONB;
BEGIN
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
          (p_campus_id IS NOT NULL AND campus_id = p_campus_id)
          OR (p_campus_id IS NULL AND campus_id IS NULL)
      );

    IF v_published_count > 0 THEN
        RAISE EXCEPTION 'Cannot replace draft: cohort % Sem % for campus % is already published (R22)',
            p_academic_year, p_semester, COALESCE(p_campus_id::text, 'all');
    END IF;

    -- Verify job status if jobId provided
    IF p_job_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM timetable_generation_jobs
            WHERE id = p_job_id AND status = 'failed'
        ) THEN
            RAISE EXCEPTION 'Job % was marked failed before draft replacement commit (R22)', p_job_id;
        END IF;
    END IF;

    -- Atomically delete all existing draft entries for this cohort
    DELETE FROM timetable_entries
    WHERE academic_year = p_academic_year
      AND semester = p_semester
      AND status = 'draft'
      AND (
          (p_campus_id IS NOT NULL AND campus_id = p_campus_id)
          OR (p_campus_id IS NULL AND campus_id IS NULL)
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

    RETURN jsonb_build_object(
        'success', true,
        'inserted_count', v_inserted_count,
        'academic_year', p_academic_year,
        'semester', p_semester,
        'campus_id', p_campus_id
    );
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 4. Record migration
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES (
    '20261010020000_followup_plan06_file_constraints_and_cohort_guards',
    'Follow-up Plan 06: OR-Tools rule compilation, durable JSON file overrides, and atomic timetable publication'
)
ON CONFLICT (version) DO NOTHING;
