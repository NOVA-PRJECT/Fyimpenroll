-- =============================================================================
-- Migration: 20261009010000_followup_plan01_harden_rpc_privileges.sql
-- Follow-up Plan 01: Database Privileges and Resource Authorization (R01)
--
-- Closes R01: Revokes default public/anon/authenticated execution grants on all
-- backend-only transactional RPCs and pins secure search paths (public, pg_temp)
-- to prevent privilege escalation via direct PostgREST / Supabase client calls.
-- =============================================================================

-- 1. Alter default privileges for schema public so future functions do not
-- automatically grant EXECUTE to PUBLIC.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- 2. Revoke and harden submit_student_registration (Plan 04 RPC)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'submit_student_registration'
    ) THEN
        REVOKE ALL ON FUNCTION public.submit_student_registration(
            UUID, UUID, SMALLINT, TEXT, TEXT, JSONB, JSONB, JSONB, NUMERIC, TIMESTAMPTZ
        ) FROM PUBLIC, anon, authenticated;

        GRANT EXECUTE ON FUNCTION public.submit_student_registration(
            UUID, UUID, SMALLINT, TEXT, TEXT, JSONB, JSONB, JSONB, NUMERIC, TIMESTAMPTZ
        ) TO service_role, postgres;

        ALTER FUNCTION public.submit_student_registration(
            UUID, UUID, SMALLINT, TEXT, TEXT, JSONB, JSONB, JSONB, NUMERIC, TIMESTAMPTZ
        ) SET search_path = public, pg_temp;
    END IF;
END $$;

-- 3. Revoke and harden execute_student_course_change (Plan 04 RPC)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'execute_student_course_change'
    ) THEN
        REVOKE ALL ON FUNCTION public.execute_student_course_change(
            UUID, UUID, SMALLINT, TEXT, TEXT, UUID, TEXT
        ) FROM PUBLIC, anon, authenticated;

        GRANT EXECUTE ON FUNCTION public.execute_student_course_change(
            UUID, UUID, SMALLINT, TEXT, TEXT, UUID, TEXT
        ) TO service_role, postgres;

        ALTER FUNCTION public.execute_student_course_change(
            UUID, UUID, SMALLINT, TEXT, TEXT, UUID, TEXT
        ) SET search_path = public, pg_temp;
    END IF;
END $$;

-- 4. Revoke and harden claim_allocation_run (Plan 05 RPC)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'claim_allocation_run'
    ) THEN
        REVOKE ALL ON FUNCTION public.claim_allocation_run(
            UUID, TEXT, SMALLINT, UUID, INT
        ) FROM PUBLIC, anon, authenticated;

        GRANT EXECUTE ON FUNCTION public.claim_allocation_run(
            UUID, TEXT, SMALLINT, UUID, INT
        ) TO service_role, postgres;

        ALTER FUNCTION public.claim_allocation_run(
            UUID, TEXT, SMALLINT, UUID, INT
        ) SET search_path = public, pg_temp;
    END IF;
END $$;

-- 5. Revoke and harden apply_course_allocation (Plan 04 6-arg and Plan 05 7-arg overloads)
DO $$
BEGIN
    -- 6-arg overload (from Plan 04)
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'apply_course_allocation'
          AND p.pronargs = 6
    ) THEN
        REVOKE ALL ON FUNCTION public.apply_course_allocation(
            UUID, UUID, TEXT, SMALLINT, JSONB, JSONB
        ) FROM PUBLIC, anon, authenticated;

        GRANT EXECUTE ON FUNCTION public.apply_course_allocation(
            UUID, UUID, TEXT, SMALLINT, JSONB, JSONB
        ) TO service_role, postgres;

        ALTER FUNCTION public.apply_course_allocation(
            UUID, UUID, TEXT, SMALLINT, JSONB, JSONB
        ) SET search_path = public, pg_temp;
    END IF;

    -- 7-arg overload (from Plan 05)
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'apply_course_allocation'
          AND p.pronargs = 7
    ) THEN
        REVOKE ALL ON FUNCTION public.apply_course_allocation(
            UUID, UUID, TEXT, SMALLINT, JSONB, JSONB, JSONB
        ) FROM PUBLIC, anon, authenticated;

        GRANT EXECUTE ON FUNCTION public.apply_course_allocation(
            UUID, UUID, TEXT, SMALLINT, JSONB, JSONB, JSONB
        ) TO service_role, postgres;

        ALTER FUNCTION public.apply_course_allocation(
            UUID, UUID, TEXT, SMALLINT, JSONB, JSONB, JSONB
        ) SET search_path = public, pg_temp;
    END IF;
END $$;

-- 6. Revoke and harden promote_campus_students_atomic (Plan 08 RPC)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'promote_campus_students_atomic'
    ) THEN
        REVOKE ALL ON FUNCTION public.promote_campus_students_atomic(
            UUID, UUID, TEXT
        ) FROM PUBLIC, anon, authenticated;

        GRANT EXECUTE ON FUNCTION public.promote_campus_students_atomic(
            UUID, UUID, TEXT
        ) TO service_role, postgres;

        ALTER FUNCTION public.promote_campus_students_atomic(
            UUID, UUID, TEXT
        ) SET search_path = public, pg_temp;
    END IF;
END $$;

-- 7. Revoke and harden cleanup_concluded_semester_attendance (Plan 08 RPC)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'cleanup_concluded_semester_attendance'
    ) THEN
        REVOKE ALL ON FUNCTION public.cleanup_concluded_semester_attendance(
            UUID, TEXT, SMALLINT
        ) FROM PUBLIC, anon, authenticated;

        GRANT EXECUTE ON FUNCTION public.cleanup_concluded_semester_attendance(
            UUID, TEXT, SMALLINT
        ) TO service_role, postgres;

        ALTER FUNCTION public.cleanup_concluded_semester_attendance(
            UUID, TEXT, SMALLINT
        ) SET search_path = public, pg_temp;
    END IF;
END $$;

-- 8. Pin search_path on trigger functions and check helpers
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'check_unique_course_slots'
    ) THEN
        ALTER FUNCTION public.check_unique_course_slots(
            UUID, UUID, UUID, UUID, UUID, UUID, UUID, UUID
        ) SET search_path = public, pg_temp;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'trg_guard_published_timetable_entries'
    ) THEN
        ALTER FUNCTION public.trg_guard_published_timetable_entries()
            SET search_path = public, pg_temp;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'trg_init_campus_settings'
    ) THEN
        ALTER FUNCTION public.trg_init_campus_settings()
            SET search_path = public, pg_temp;
    END IF;
END $$;
