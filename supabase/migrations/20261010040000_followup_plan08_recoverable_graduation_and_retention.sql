-- =============================================================================
-- Migration: 20261010040000_followup_plan08_recoverable_graduation_and_retention.sql
-- Description: Follow-up Plan 08: Recoverable graduation and current-semester cleanup
-- Findings: R27 (High - graduation deletes Auth first which students_id_fkey forbids)
-- Target Schema: public
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Ensure students_id_fkey has ON DELETE CASCADE
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    -- Drop existing foreign key constraint if it exists without cascade
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'students' AND constraint_name = 'students_id_fkey'
    ) THEN
        ALTER TABLE students DROP CONSTRAINT students_id_fkey;
    END IF;

    -- Recreate constraint with ON DELETE CASCADE to allow Auth deletions to cascade cleanly
    ALTER TABLE students
        ADD CONSTRAINT students_id_fkey
        FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Graduation Operations & Recovery Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS graduation_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT UNIQUE NOT NULL,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    initiated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'partially_failed', 'failed')),
    total_candidates INTEGER NOT NULL DEFAULT 0,
    graduated_count INTEGER NOT NULL DEFAULT 0,
    db_deleted_count INTEGER NOT NULL DEFAULT 0,
    auth_deleted_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    candidate_student_ids UUID[] NOT NULL DEFAULT '{}',
    completed_student_ids UUID[] NOT NULL DEFAULT '{}',
    failed_student_ids UUID[] NOT NULL DEFAULT '{}',
    stage_details JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_grad_ops_campus ON graduation_operations(campus_id);
CREATE INDEX IF NOT EXISTS idx_grad_ops_status ON graduation_operations(status);
CREATE INDEX IF NOT EXISTS idx_grad_ops_idempotency ON graduation_operations(idempotency_key);

COMMENT ON TABLE graduation_operations IS 'Tracks recoverable graduation cleanup operations, immutable candidate sets, and staged DB/Auth progress.';

-- Enable RLS on graduation_operations
ALTER TABLE graduation_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Directors can read campus graduation operations" ON graduation_operations;
CREATE POLICY "Directors can read campus graduation operations"
    ON graduation_operations
    FOR SELECT
    TO authenticated
    USING (
        campus_id = (auth.jwt() -> 'app_metadata' ->> 'campus_id')::UUID
        OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'superadmin'
    );

DROP POLICY IF EXISTS "Service role manages graduation operations" ON graduation_operations;
CREATE POLICY "Service role manages graduation operations"
    ON graduation_operations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 3. Atomic Database Stage Graduation RPC (R27)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atomic_graduate_candidates_db(
    p_campus_id UUID,
    p_student_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_valid_ids UUID[];
    v_deleted_count INTEGER := 0;
BEGIN
    -- 1. Explicitly select candidates that belong to this campus AND are strictly semester 10
    SELECT COALESCE(array_agg(id), ARRAY[]::UUID[])
    INTO v_valid_ids
    FROM students
    WHERE campus_id = p_campus_id
      AND current_semester = 10
      AND id = ANY(p_student_ids);

    IF v_valid_ids IS NULL OR array_length(v_valid_ids, 1) IS NULL OR array_length(v_valid_ids, 1) = 0 THEN
        RETURN jsonb_build_object(
            'success', true,
            'deleted_count', 0,
            'deleted_student_ids', '[]'::jsonb
        );
    END IF;

    -- 2. Delete candidates from database. Dependent registrations, preferences,
    -- and marks cascade cleanly through foreign key CASCADE definitions.
    DELETE FROM students
    WHERE id = ANY(v_valid_ids);

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'deleted_count', v_deleted_count,
        'deleted_student_ids', to_jsonb(v_valid_ids)
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Follow-up Plan 01 Security Compliance: Grants and Revocations
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION atomic_graduate_candidates_db(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION atomic_graduate_candidates_db(UUID, UUID[]) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Record Migration
-- -----------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
VALUES (
    '20261010040000_followup_plan08_recoverable_graduation_and_retention',
    'Plan 08: Recoverable graduation and current-semester cleanup'
)
ON CONFLICT (version) DO NOTHING;
