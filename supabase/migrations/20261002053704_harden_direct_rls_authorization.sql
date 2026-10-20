-- =============================================================================
-- Migration: 20261002_harden_direct_rls_authorization.sql
-- Description: Close direct Supabase RLS authorization gaps found during review.
--   - Remove user-editable user_metadata from role checks.
--   - Make protected attendance, assignment, timetable, and log data backend-only.
--   - Remove legacy client grants and policies while preserving service_role.
-- =============================================================================

BEGIN;

-- Campus sign-ins are created only by the backend after GPS verification.
-- Reads and writes also go through its role-scoped API, so remove direct client
-- access instead of maintaining a second authorization implementation.
ALTER TABLE public.campus_sign_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_course_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.period_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.period_unlock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timetable_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view own campus sign-in records" ON public.campus_sign_ins;
DROP POLICY IF EXISTS "Students can insert own campus sign-in records" ON public.campus_sign_ins;
DROP POLICY IF EXISTS "Students insert own campus sign-ins" ON public.campus_sign_ins;
DROP POLICY IF EXISTS "Students and staff view campus sign-in records" ON public.campus_sign_ins;
DROP POLICY IF EXISTS "Staff manage campus sign-ins" ON public.campus_sign_ins;
DROP POLICY IF EXISTS "HODs can view department campus sign-in records" ON public.campus_sign_ins;
DROP POLICY IF EXISTS "Admins and Directors can view all campus sign-in records" ON public.campus_sign_ins;
DROP POLICY IF EXISTS "Campus admins and directors can read campus sign-ins" ON public.campus_sign_ins;

REVOKE ALL PRIVILEGES ON TABLE public.campus_sign_ins FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.campus_sign_ins TO service_role;

-- Remove policies left behind by the original logging migration. In
-- particular, authenticated users must not be able to forge audit rows or
-- alter allocation/timetable job state through the Data API.
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins, Directors, HODs can view system_logs" ON public.system_logs;
DROP POLICY IF EXISTS "Authenticated users can insert system_logs" ON public.system_logs;
DROP POLICY IF EXISTS "Allow update only on job records in system_logs" ON public.system_logs;

REVOKE ALL PRIVILEGES ON TABLE public.system_logs FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.system_logs TO service_role;

-- Compatibility views expose records backed by system_logs. Keep them
-- available to the backend service role only, including on projects where
-- default privileges granted access to anon/authenticated.
REVOKE ALL PRIVILEGES ON TABLE
    public.audit_logs,
    public.audit_logs_legacy,
    public.allocation_runs,
    public.allocation_runs_legacy,
    public.timetable_generation_jobs,
    public.timetable_generation_jobs_legacy
FROM PUBLIC, anon, authenticated;

GRANT ALL PRIVILEGES ON TABLE
    public.audit_logs,
    public.audit_logs_legacy,
    public.allocation_runs,
    public.allocation_runs_legacy,
    public.timetable_generation_jobs,
    public.timetable_generation_jobs_legacy
TO service_role;

-- Defense in depth: do not let these compatibility views bypass RLS if a
-- future grant is accidentally added. The deployed database is PostgreSQL 17.
ALTER VIEW public.audit_logs SET (security_invoker = true);
ALTER VIEW public.audit_logs_legacy SET (security_invoker = true);
ALTER VIEW public.allocation_runs SET (security_invoker = true);
ALTER VIEW public.allocation_runs_legacy SET (security_invoker = true);
ALTER VIEW public.timetable_generation_jobs SET (security_invoker = true);
ALTER VIEW public.timetable_generation_jobs_legacy SET (security_invoker = true);

-- Assignment and attendance mutations already pass through the NestJS API,
-- which performs actor/course/department checks. The clients use the API rather
-- than Supabase table writes, so remove direct Data API write paths.
DROP POLICY IF EXISTS "Allow read assignments for authenticated users" ON public.teacher_course_assignments;
DROP POLICY IF EXISTS "Allow write assignments for HODs and Admins" ON public.teacher_course_assignments;
REVOKE ALL PRIVILEGES ON TABLE public.teacher_course_assignments FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.teacher_course_assignments TO service_role;

-- Reads and writes are served by the backend's validated roster.
DROP POLICY IF EXISTS period_attendance_select_auth ON public.period_attendance;
DROP POLICY IF EXISTS "Students can view own period attendance" ON public.period_attendance;
DROP POLICY IF EXISTS "Faculty can mark period attendance" ON public.period_attendance;
DROP POLICY IF EXISTS "Faculty can mark assigned period attendance" ON public.period_attendance;
REVOKE ALL PRIVILEGES ON TABLE public.period_attendance FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.period_attendance TO service_role;

-- Unlock requests are audited and written through the backend after its HOD
-- department check. Do not expose direct authenticated table mutations.
DROP POLICY IF EXISTS "Allow HODs and Admins to manage unlock requests" ON public.period_unlock_requests;
REVOKE ALL PRIVILEGES ON TABLE public.period_unlock_requests FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.period_unlock_requests TO service_role;

-- Timetable conflicts are consumed and written through the backend only.
DROP POLICY IF EXISTS "Allow write access to timetable_conflicts for directors and sup" ON public.timetable_conflicts;
DROP POLICY IF EXISTS "Allow read access to timetable_conflicts for authenticated user" ON public.timetable_conflicts;
REVOKE ALL PRIVILEGES ON TABLE public.timetable_conflicts FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.timetable_conflicts TO service_role;

-- This event-trigger function is installed server-side and is not a client RPC.
DO $$
BEGIN
    IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
    END IF;
END;
$$;

-- Record this change in the application's migration ledger when present.
DO $$
BEGIN
    IF to_regclass('public.schema_migrations') IS NOT NULL THEN
        INSERT INTO public.schema_migrations (version, name)
        VALUES (
            '20261002_harden_direct_rls_authorization',
            'Harden direct RLS authorization and operational log access'
        )
        ON CONFLICT (version) DO NOTHING;
    END IF;
END;
$$;

COMMIT;
