-- =============================================================================
-- FYIMP Course Registration & Campus Attendance Portal
-- UNIFIED MASTER DATABASE SCHEMA & SEED UPSERT SCRIPT
-- Version: 4.0.0 (Unified Idempotent Master Migration)
-- Target Schema: PostgreSQL 15+ / Supabase (public)
--
-- Historical consolidation script; not a certified production upgrade recipe.
-- It contains conditional DROP TABLE/COLUMN operations. Never run the whole
-- script against an existing database as an idempotent upgrade. Use reviewed,
-- unapplied forward migrations; see implementation-handoffs/followup/RELEASE_RUNBOOK.md.
-- =============================================================================

-- =============================================================================
-- PART 1: EXTENSIONS
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- PART 2: IDEMPOTENT TABLE PROVISIONING (CREATE TABLE IF NOT EXISTS)
-- =============================================================================

-- 1. Campuses
CREATE TABLE IF NOT EXISTS campuses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    center_latitude NUMERIC,
    center_longitude NUMERIC,
    radius_meters INTEGER NOT NULL DEFAULT 500,
    morning_cutoff_time TIME NOT NULL DEFAULT '09:30:00',
    midday_split_time TIME NOT NULL DEFAULT '13:30:00',
    evening_cutoff_time TIME NOT NULL DEFAULT '15:30:00',
    day_end_time TIME NOT NULL DEFAULT '17:00:00',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
COMMENT ON TABLE campuses IS 'Physical university campuses and satellite academic centers.';

-- 2. Campus Settings (Registration window, credits, promotion timestamp)
CREATE TABLE IF NOT EXISTS campus_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campus_id UUID NOT NULL UNIQUE REFERENCES campuses(id) ON DELETE CASCADE,
    academic_year TEXT NOT NULL DEFAULT '2026-27',
    min_credits INTEGER NOT NULL DEFAULT 18,
    max_credits INTEGER NOT NULL DEFAULT 26,
    deadline TIMESTAMPTZ,
    last_promoted_at TIMESTAMPTZ
);
COMMENT ON TABLE campus_settings IS 'Campus-level academic governance, credit constraints, and term deadlines.';

-- 3. Departments
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
COMMENT ON TABLE departments IS 'Academic departments affiliated with specific university campuses.';

-- 4. Courses
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 10),
    credits INTEGER NOT NULL CHECK (credits > 0),
    category TEXT NOT NULL CHECK (category IN ('DSS', 'DSC', 'DSE', 'VAC', 'SEC', 'MDC', 'MOOC', 'AEC', 'INT', 'FWD', 'RPH', 'CIP')),
    tag TEXT,
    theory_hours_per_week SMALLINT NOT NULL DEFAULT 0,
    practical_hours_per_week SMALLINT NOT NULL DEFAULT 0,
    seat_limit INTEGER NOT NULL DEFAULT 60,
    prerequisite_course_ids UUID[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);
COMMENT ON TABLE courses IS 'Master catalog of academic courses, credit values, contact hours, and seat limits.';

-- 5. Course Prerequisite Rules (V2 Multi-Round Allocation Scoring)
CREATE TABLE IF NOT EXISTS course_prerequisite_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    rule TEXT NOT NULL CHECK (rule IN ('COMPLETED_COURSE', 'COMPLETED_SEMESTER', 'DEPARTMENT')),
    target TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_course_rule_target UNIQUE(course_id, rule, target)
);
COMMENT ON TABLE course_prerequisite_rules IS 'Scoring rules evaluated during multi-round course allocation.';

-- 6. Admins
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'superadmin' CHECK (role IN ('superadmin', 'admin')),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Faculty
CREATE TABLE IF NOT EXISTS faculty (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('hod', 'teaching_staff', 'campus_director', 'teacher')),
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. Students
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    current_semester INTEGER NOT NULL DEFAULT 1 CHECK (current_semester BETWEEN 1 AND 10),
    cap_application_number TEXT NOT NULL UNIQUE,
    academic_year_joined TEXT NOT NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. Semester Blueprints
CREATE TABLE IF NOT EXISTS semester_blueprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
    min_credits INTEGER NOT NULL DEFAULT 18,
    max_credits INTEGER NOT NULL DEFAULT 26,
    slot_1_name TEXT,
    slot_1_rule TEXT,
    slot_1_target TEXT,
    slot_2_name TEXT,
    slot_2_rule TEXT,
    slot_2_target TEXT,
    slot_3_name TEXT,
    slot_3_rule TEXT,
    slot_3_target TEXT,
    slot_4_name TEXT,
    slot_4_rule TEXT,
    slot_4_target TEXT,
    slot_5_name TEXT,
    slot_5_rule TEXT,
    slot_5_target TEXT,
    slot_6_name TEXT,
    slot_6_rule TEXT,
    slot_6_target TEXT,
    pathways JSONB,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(department_id, semester)
);

-- 10. Registration Preferences
CREATE TABLE IF NOT EXISTS registration_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    semester SMALLINT NOT NULL,
    academic_year TEXT NOT NULL,
    pathway_id TEXT,
    preferences JSONB NOT NULL DEFAULT '[]'::jsonb,
    allocation_metadata JSONB DEFAULT '{}'::jsonb,
    submitted_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_student_pref UNIQUE(student_id, semester, academic_year)
);

-- 11. Student Registrations
CREATE TABLE IF NOT EXISTS student_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 8),
    academic_year TEXT NOT NULL,
    slot_1_course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    slot_2_course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    slot_3_course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    slot_4_course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    slot_5_course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    slot_6_course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    slot_7_course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    slot_8_course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    total_credits INTEGER NOT NULL DEFAULT 0 CHECK (total_credits >= 0),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    pathway_id TEXT,
    selections JSONB,
    selected_courses JSONB,
    allocation_metadata JSONB DEFAULT '{}'::jsonb,
    UNIQUE(student_id, semester, academic_year)
);

-- 12. Time Slots
CREATE TABLE IF NOT EXISTS time_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
    period_number SMALLINT NOT NULL CHECK (period_number BETWEEN 1 AND 10),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_lab_block BOOLEAN NOT NULL DEFAULT false,
    lab_pair_with UUID REFERENCES time_slots(id) ON DELETE SET NULL,
    UNIQUE(day_of_week, period_number)
);

-- 13. Timetable Entries
CREATE TABLE IF NOT EXISTS timetable_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year TEXT NOT NULL,
    semester SMALLINT NOT NULL,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    campus_id UUID REFERENCES campuses(id) ON DELETE CASCADE,
    time_slot_id UUID NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
    is_lab_block BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'published')),
    session_type TEXT DEFAULT 'theory',
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    -- Parallel elective options may share a slot; each host course delivery remains unique.
    CONSTRAINT timetable_entries_delivery_unique
        UNIQUE NULLS NOT DISTINCT (campus_id, academic_year, semester, course_id, time_slot_id, department_id)
);

-- 14. Timetable Conflicts
CREATE TABLE IF NOT EXISTS timetable_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year TEXT NOT NULL,
    semester SMALLINT NOT NULL,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    blocking_course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    conflicting_student_count INTEGER DEFAULT 0,
    resolved BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 15. Teacher Course Assignments
CREATE TABLE IF NOT EXISTS teacher_course_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES faculty(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    academic_year TEXT,
    semester SMALLINT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT teacher_course_assignments_unique UNIQUE(teacher_id, course_id)
);

-- 16. Period Attendance (Timetable Entry based)
CREATE TABLE IF NOT EXISTS period_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timetable_slot_id UUID NOT NULL REFERENCES timetable_entries(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    marked_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('present', 'absent')),
    marked_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    is_late_entry BOOLEAN NOT NULL DEFAULT false,
    unlocked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT period_attendance_unique UNIQUE (timetable_slot_id, student_id, attendance_date)
);

-- 17. Period Unlock Requests
CREATE TABLE IF NOT EXISTS period_unlock_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timetable_slot_id UUID NOT NULL REFERENCES timetable_entries(id) ON DELETE CASCADE,
    unlocked_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    unlocked_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 18. Campus Sign-Ins (Zero coordinate retention GPS attendance)
CREATE TABLE IF NOT EXISTS campus_sign_ins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
    session_type TEXT NOT NULL CHECK (session_type IN ('morning', 'evening')),
    signed_in_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    signed_in_date DATE NOT NULL DEFAULT ((timezone('utc'::text, now()) AT TIME ZONE 'Asia/Kolkata')::date),
    location_accuracy_meters NUMERIC NOT NULL DEFAULT 10,
    status TEXT NOT NULL CHECK (status IN ('on_time', 'late', 'early_leave')),
    source TEXT NOT NULL DEFAULT 'gps' CHECK (source IN ('gps', 'manual_staff')),
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT campus_sign_ins_unique UNIQUE (student_id, campus_id, signed_in_date, session_type)
);

-- 19. Consent Records
CREATE TABLE IF NOT EXISTS consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    policy_version TEXT NOT NULL DEFAULT 'v1.0',
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_id, policy_version)
);

-- 20. System Logs (Consolidated Audit & Background Jobs)
CREATE TABLE IF NOT EXISTS system_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    log_type TEXT NOT NULL CHECK (log_type IN ('audit_event', 'timetable_job', 'allocation_run', 'server_error')),
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'success', 'failure')),
    progress SMALLINT DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    error_message TEXT,
    error_stack TEXT,
    campus_id UUID REFERENCES campuses(id) ON DELETE CASCADE,
    academic_year TEXT,
    semester SMALLINT,
    user_id UUID,
    user_role TEXT,
    event_type TEXT,
    action TEXT,
    resource_type TEXT,
    resource_id UUID,
    ip_address INET,
    user_agent TEXT,
    route TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 21. Schema Migrations Audit Table
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- =============================================================================
-- PART 3: INCREMENTAL COLUMN UPGRADES & OBSOLETE CLEANUP (IDEMPOTENT)
-- =============================================================================

-- Ensure campuses geofence fields
ALTER TABLE campuses ADD COLUMN IF NOT EXISTS center_latitude NUMERIC;
ALTER TABLE campuses ADD COLUMN IF NOT EXISTS center_longitude NUMERIC;
ALTER TABLE campuses ADD COLUMN IF NOT EXISTS radius_meters INTEGER NOT NULL DEFAULT 500;
ALTER TABLE campuses ADD COLUMN IF NOT EXISTS morning_cutoff_time TIME NOT NULL DEFAULT '09:30:00';
ALTER TABLE campuses ADD COLUMN IF NOT EXISTS midday_split_time TIME NOT NULL DEFAULT '13:30:00';
ALTER TABLE campuses ADD COLUMN IF NOT EXISTS evening_cutoff_time TIME NOT NULL DEFAULT '15:30:00';
ALTER TABLE campuses ADD COLUMN IF NOT EXISTS day_end_time TIME NOT NULL DEFAULT '17:00:00';

-- Ensure campus_settings fields
ALTER TABLE campus_settings ADD COLUMN IF NOT EXISTS academic_year TEXT NOT NULL DEFAULT '2026-27';
ALTER TABLE campus_settings ADD COLUMN IF NOT EXISTS min_credits INTEGER NOT NULL DEFAULT 18;
ALTER TABLE campus_settings ADD COLUMN IF NOT EXISTS max_credits INTEGER NOT NULL DEFAULT 26;
ALTER TABLE campus_settings ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ;
ALTER TABLE campus_settings ADD COLUMN IF NOT EXISTS last_promoted_at TIMESTAMPTZ;

-- Ensure courses fields & retire obsolete columns
ALTER TABLE courses ADD COLUMN IF NOT EXISTS theory_hours_per_week SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS practical_hours_per_week SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS seat_limit INTEGER NOT NULL DEFAULT 60;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS prerequisite_course_ids UUID[] DEFAULT '{}';
ALTER TABLE courses ADD COLUMN IF NOT EXISTS tag TEXT;
ALTER TABLE courses DROP COLUMN IF EXISTS allowed_department_ids;

-- Ensure registration_preferences & student_registrations columns
ALTER TABLE registration_preferences ADD COLUMN IF NOT EXISTS pathway_id TEXT;
ALTER TABLE registration_preferences ALTER COLUMN pathway_id TYPE TEXT;
ALTER TABLE registration_preferences ADD COLUMN IF NOT EXISTS allocation_metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE registration_preferences ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE student_registrations ADD COLUMN IF NOT EXISTS pathway_id TEXT;
ALTER TABLE student_registrations ADD COLUMN IF NOT EXISTS selections JSONB;
ALTER TABLE student_registrations ADD COLUMN IF NOT EXISTS selected_courses JSONB;
ALTER TABLE student_registrations ADD COLUMN IF NOT EXISTS allocation_metadata JSONB DEFAULT '{}'::jsonb;

-- Relax total_credits constraint to support multi-phase / elective-only credit states
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
    ALTER TABLE student_registrations ADD CONSTRAINT student_registrations_total_credits_check CHECK (total_credits >= 0);
END $$;

-- Ensure timetable_entries fields
ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS session_type TEXT DEFAULT 'theory';
ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS is_lab_block BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Ensure period_attendance & period_unlock_requests structure
DO $$
BEGIN
    -- If period_attendance has old schema (lacking timetable_slot_id), rebuild table safely
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'period_attendance'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'period_attendance' AND column_name = 'timetable_slot_id'
    ) THEN
        DROP TABLE period_attendance CASCADE;
        CREATE TABLE period_attendance (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            timetable_slot_id UUID NOT NULL REFERENCES timetable_entries(id) ON DELETE CASCADE,
            student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
            marked_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
            status TEXT NOT NULL CHECK (status IN ('present', 'absent')),
            marked_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
            attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
            is_late_entry BOOLEAN NOT NULL DEFAULT false,
            unlocked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
            CONSTRAINT period_attendance_unique UNIQUE (timetable_slot_id, student_id, attendance_date)
        );
    ELSE
        ALTER TABLE period_attendance ADD COLUMN IF NOT EXISTS attendance_date DATE NOT NULL DEFAULT CURRENT_DATE;
        ALTER TABLE period_attendance ADD COLUMN IF NOT EXISTS is_late_entry BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE period_attendance ADD COLUMN IF NOT EXISTS unlocked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;

    -- If period_unlock_requests has old schema, rebuild safely
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'period_unlock_requests'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'period_unlock_requests' AND column_name = 'timetable_slot_id'
    ) THEN
        DROP TABLE period_unlock_requests CASCADE;
        CREATE TABLE period_unlock_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            timetable_slot_id UUID NOT NULL REFERENCES timetable_entries(id) ON DELETE CASCADE,
            unlocked_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
            unlocked_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
            reason TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
        );
    END IF;
END $$;

-- Drop redundant legacy registration_windows table if present
DROP TABLE IF EXISTS public.registration_windows CASCADE;

-- =============================================================================
-- PART 4: CONSTRAINT HARMONIZATION & POSTGREST FOREIGN KEYS
-- =============================================================================

-- Expand course category check to all 12 FYIMP categories
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_category_check;
ALTER TABLE courses ADD CONSTRAINT courses_category_check
    CHECK (category IN ('DSS', 'DSC', 'DSE', 'VAC', 'SEC', 'MDC', 'MOOC', 'AEC', 'INT', 'FWD', 'RPH', 'CIP'));

-- Expand course semester check to 1..10
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_semester_check;
ALTER TABLE courses ADD CONSTRAINT courses_semester_check
    CHECK (semester BETWEEN 1 AND 10);

-- Ensure faculty role check includes teacher
ALTER TABLE faculty DROP CONSTRAINT IF EXISTS faculty_role_check;
ALTER TABLE faculty ADD CONSTRAINT faculty_role_check
    CHECK (role IN ('hod', 'campus_director', 'teaching_staff', 'teacher'));

-- Ensure period_attendance unique constraint with attendance_date
ALTER TABLE period_attendance DROP CONSTRAINT IF EXISTS period_attendance_unique;
ALTER TABLE period_attendance ADD CONSTRAINT period_attendance_unique 
    UNIQUE (timetable_slot_id, student_id, attendance_date);

-- Ensure student_registrations_total_credits_check allows in-progress and partial allocations
ALTER TABLE student_registrations DROP CONSTRAINT IF EXISTS student_registrations_total_credits_check;
ALTER TABLE student_registrations ADD CONSTRAINT student_registrations_total_credits_check
    CHECK (total_credits >= 0);

-- Ensure foreign keys from registration tables to students table for PostgREST joins
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_student_registrations_students'
    ) THEN
        ALTER TABLE student_registrations 
        ADD CONSTRAINT fk_student_registrations_students 
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_registration_preferences_students'
    ) THEN
        ALTER TABLE registration_preferences 
        ADD CONSTRAINT fk_registration_preferences_students 
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
    END IF;
END;
$$;

-- =============================================================================
-- PART 5: UNIFIED LOGGING COMPATIBILITY VIEWS & INSTEAD OF TRIGGERS
-- =============================================================================

-- Idempotent cleanup: drop legacy objects whether they are VIEWs or BASE TABLEs.
-- On older databases the 20260908 migration renamed the original tables to *_legacy
-- (BASE TABLEs), so a plain DROP VIEW would fail with error 42809.
DO $$
DECLARE
    obj  text;
    otype text;
    -- Order matters: drop *_legacy wrappers first, then the main compatibility objects
    objs text[] := ARRAY[
        'allocation_runs_legacy', 'allocation_runs',
        'timetable_generation_jobs_legacy', 'timetable_generation_jobs',
        'audit_logs_legacy', 'audit_logs'
    ];
BEGIN
    FOREACH obj IN ARRAY objs LOOP
        -- Check for a VIEW first
        IF EXISTS (
            SELECT 1 FROM information_schema.views
            WHERE table_schema = 'public' AND table_name = obj
        ) THEN
            EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE;', obj);
        END IF;

        -- Check for a BASE TABLE (legacy renamed tables)
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = obj AND table_type = 'BASE TABLE'
        ) THEN
            -- Salvage any residual data from legacy base tables into system_logs
            IF obj = 'allocation_runs' OR obj = 'allocation_runs_legacy' THEN
                BEGIN
                    INSERT INTO system_logs (
                        id, log_type, academic_year, semester, campus_id, user_id,
                        status, started_at, completed_at, error_message, created_at, updated_at
                    )
                    SELECT
                        id, 'allocation_run', academic_year, semester, campus_id, triggered_by,
                        status, triggered_at, completed_at, error_message,
                        triggered_at, COALESCE(completed_at, triggered_at)
                    FROM public.allocation_runs_legacy  -- use EXECUTE below instead
                    ON CONFLICT (id) DO NOTHING;
                EXCEPTION WHEN OTHERS THEN
                    -- Column mismatch or table doesn't match expected shape — skip
                    NULL;
                END;
            END IF;

            IF obj = 'timetable_generation_jobs' OR obj = 'timetable_generation_jobs_legacy' THEN
                BEGIN
                    EXECUTE format(
                        'INSERT INTO system_logs (id, log_type, academic_year, semester, campus_id, user_id, status, progress, error_message, started_at, completed_at, created_at, updated_at)
                         SELECT id, ''timetable_job'', academic_year, semester, campus_id, triggered_by, status, progress, error_message, started_at, completed_at, created_at, updated_at
                         FROM public.%I ON CONFLICT (id) DO NOTHING', obj);
                EXCEPTION WHEN OTHERS THEN NULL;
                END;
            END IF;

            IF obj = 'audit_logs' OR obj = 'audit_logs_legacy' THEN
                BEGIN
                    EXECUTE format(
                        'INSERT INTO system_logs (id, log_type, event_type, user_id, user_role, action, resource_type, resource_id, status, error_message, metadata, ip_address, created_at, updated_at)
                         SELECT id, ''audit_event'', event_type, user_id, user_role, action, resource_type, resource_id, status, error_message, metadata, ip_address, created_at, created_at
                         FROM public.%I ON CONFLICT (id) DO NOTHING', obj);
                EXCEPTION WHEN OTHERS THEN NULL;
                END;
            END IF;

            EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE;', obj);
        END IF;
    END LOOP;
END $$;

-- 1. Allocation Runs View
CREATE OR REPLACE VIEW allocation_runs WITH (security_invoker = true) AS
SELECT 
    id, campus_id, academic_year, semester, status,
    user_id AS triggered_by,
    started_at AS triggered_at,
    COALESCE((metadata->>'total_students')::int, 0) AS total_students,
    COALESCE((metadata->>'fully_allocated')::int, 0) AS fully_allocated,
    COALESCE((metadata->>'partially_allocated')::int, 0) AS partially_allocated,
    COALESCE((metadata->>'unallocated')::int, 0) AS unallocated,
    COALESCE(metadata->'summary', '{}'::jsonb) AS summary,
    error_message, started_at, completed_at, created_at
FROM system_logs WHERE log_type = 'allocation_run';

CREATE OR REPLACE VIEW allocation_runs_legacy WITH (security_invoker = true) AS SELECT * FROM allocation_runs;

-- 2. Timetable Generation Jobs View
CREATE OR REPLACE VIEW timetable_generation_jobs WITH (security_invoker = true) AS
SELECT 
    id, campus_id, academic_year, semester, status, progress, error_message,
    user_id AS triggered_by,
    COALESCE(metadata->'config', '{}'::jsonb) AS config,
    started_at, completed_at, created_at, updated_at
FROM system_logs WHERE log_type = 'timetable_job';

CREATE OR REPLACE VIEW timetable_generation_jobs_legacy WITH (security_invoker = true) AS SELECT * FROM timetable_generation_jobs;

-- 3. Audit Logs View
CREATE OR REPLACE VIEW audit_logs WITH (security_invoker = true) AS
SELECT 
    id, event_type, user_id, user_role, action, resource_type, resource_id,
    status, error_message, metadata, ip_address, user_agent, created_at
FROM system_logs WHERE log_type = 'audit_event';

CREATE OR REPLACE VIEW audit_logs_legacy WITH (security_invoker = true) AS SELECT * FROM audit_logs;

-- Triggers for Allocation Runs View
CREATE OR REPLACE FUNCTION trg_allocation_runs_io()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO system_logs (
            id, log_type, campus_id, academic_year, semester, status, user_id,
            error_message, metadata, started_at, completed_at, created_at, updated_at
        ) VALUES (
            COALESCE(NEW.id, gen_random_uuid()),
            'allocation_run', NEW.campus_id, NEW.academic_year, NEW.semester, NEW.status,
            COALESCE(NEW.triggered_by, auth.uid()),
            NEW.error_message,
            jsonb_build_object(
                'total_students', NEW.total_students,
                'fully_allocated', NEW.fully_allocated,
                'partially_allocated', NEW.partially_allocated,
                'unallocated', NEW.unallocated,
                'summary', NEW.summary
            ),
            COALESCE(NEW.started_at, clock_timestamp()), NEW.completed_at,
            COALESCE(NEW.created_at, clock_timestamp()), clock_timestamp()
        ) RETURNING id INTO NEW.id;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE system_logs SET
            status = NEW.status,
            error_message = NEW.error_message,
            completed_at = NEW.completed_at,
            metadata = jsonb_build_object(
                'total_students', NEW.total_students,
                'fully_allocated', NEW.fully_allocated,
                'partially_allocated', NEW.partially_allocated,
                'unallocated', NEW.unallocated,
                'summary', NEW.summary
            ),
            updated_at = clock_timestamp()
        WHERE id = OLD.id AND log_type = 'allocation_run';
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_allocation_runs_insert_update
INSTEAD OF INSERT OR UPDATE ON allocation_runs
FOR EACH ROW EXECUTE FUNCTION trg_allocation_runs_io();

-- Triggers for Timetable Jobs View
CREATE OR REPLACE FUNCTION trg_timetable_jobs_io()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO system_logs (
            id, log_type, campus_id, academic_year, semester, status, progress, user_id,
            error_message, metadata, started_at, completed_at, created_at, updated_at
        ) VALUES (
            COALESCE(NEW.id, gen_random_uuid()),
            'timetable_job', NEW.campus_id, NEW.academic_year, NEW.semester, NEW.status,
            COALESCE(NEW.progress, 0),
            COALESCE(NEW.triggered_by, auth.uid()),
            NEW.error_message,
            jsonb_build_object('config', COALESCE(NEW.config, '{}'::jsonb)),
            COALESCE(NEW.started_at, clock_timestamp()), NEW.completed_at,
            COALESCE(NEW.created_at, clock_timestamp()), clock_timestamp()
        ) RETURNING id INTO NEW.id;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE system_logs SET
            status = NEW.status,
            progress = NEW.progress,
            error_message = NEW.error_message,
            completed_at = NEW.completed_at,
            metadata = jsonb_build_object('config', COALESCE(NEW.config, '{}'::jsonb)),
            updated_at = clock_timestamp()
        WHERE id = OLD.id AND log_type = 'timetable_job';
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_timetable_jobs_insert_update
INSTEAD OF INSERT OR UPDATE ON timetable_generation_jobs
FOR EACH ROW EXECUTE FUNCTION trg_timetable_jobs_io();

-- Triggers for Audit Logs View
CREATE OR REPLACE FUNCTION trg_audit_logs_io()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO system_logs (
            id, log_type, event_type, user_id, user_role, action, resource_type,
            resource_id, status, error_message, metadata, ip_address, user_agent, created_at, updated_at
        ) VALUES (
            COALESCE(NEW.id, gen_random_uuid()),
            'audit_event', NEW.event_type, NEW.user_id, NEW.user_role, NEW.action,
            NEW.resource_type, NEW.resource_id, NEW.status, NEW.error_message,
            COALESCE(NEW.metadata, '{}'::jsonb), NEW.ip_address, NEW.user_agent,
            COALESCE(NEW.created_at, clock_timestamp()), clock_timestamp()
        ) RETURNING id INTO NEW.id;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_insert
INSTEAD OF INSERT ON audit_logs
FOR EACH ROW EXECUTE FUNCTION trg_audit_logs_io();

-- =============================================================================
-- PART 6: STORED PROCEDURES & SECURITY DEFINER RPC FUNCTIONS
-- =============================================================================

-- Drop existing functions first so return types can be changed safely.
-- PostgreSQL error 42P13 prevents CREATE OR REPLACE from altering return types.
DROP FUNCTION IF EXISTS apply_course_allocation(UUID, UUID, TEXT, SMALLINT, JSONB, JSONB);
DROP FUNCTION IF EXISTS promote_campus_students(UUID);
DROP FUNCTION IF EXISTS delete_campus_cascade(UUID);
DROP FUNCTION IF EXISTS delete_department_cascade(UUID);

-- 1. Atomic Course Allocation Applicator (V2)
CREATE OR REPLACE FUNCTION apply_course_allocation(
    p_run_id UUID,
    p_campus_id UUID,
    p_academic_year TEXT,
    p_semester SMALLINT,
    p_allocations JSONB,
    p_unallocated JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    item JSONB;
    v_student_id UUID;
    v_reg_id UUID;
    v_slot_key TEXT;
    v_course_id UUID;
    v_meta JSONB;
    v_sql TEXT;
BEGIN
    -- Reset non-fixed elective slots back to NULL for this cohort
    UPDATE student_registrations sr
    SET
        slot_1_course_id = CASE WHEN sr.allocation_metadata->'slot_1'->>'allocated_by' = 'fixed' THEN sr.slot_1_course_id ELSE NULL END,
        slot_2_course_id = CASE WHEN sr.allocation_metadata->'slot_2'->>'allocated_by' = 'fixed' THEN sr.slot_2_course_id ELSE NULL END,
        slot_3_course_id = CASE WHEN sr.allocation_metadata->'slot_3'->>'allocated_by' = 'fixed' THEN sr.slot_3_course_id ELSE NULL END,
        slot_4_course_id = CASE WHEN sr.allocation_metadata->'slot_4'->>'allocated_by' = 'fixed' THEN sr.slot_4_course_id ELSE NULL END,
        slot_5_course_id = CASE WHEN sr.allocation_metadata->'slot_5'->>'allocated_by' = 'fixed' THEN sr.slot_5_course_id ELSE NULL END,
        slot_6_course_id = CASE WHEN sr.allocation_metadata->'slot_6'->>'allocated_by' = 'fixed' THEN sr.slot_6_course_id ELSE NULL END,
        allocation_metadata = jsonb_strip_nulls(
            jsonb_build_object(
                'slot_1', CASE WHEN sr.allocation_metadata->'slot_1'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_1' ELSE NULL END,
                'slot_2', CASE WHEN sr.allocation_metadata->'slot_2'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_2' ELSE NULL END,
                'slot_3', CASE WHEN sr.allocation_metadata->'slot_3'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_3' ELSE NULL END,
                'slot_4', CASE WHEN sr.allocation_metadata->'slot_4'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_4' ELSE NULL END,
                'slot_5', CASE WHEN sr.allocation_metadata->'slot_5'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_5' ELSE NULL END,
                'slot_6', CASE WHEN sr.allocation_metadata->'slot_6'->>'allocated_by' = 'fixed' THEN sr.allocation_metadata->'slot_6' ELSE NULL END
            )
        )
    WHERE sr.campus_id = p_campus_id
      AND sr.academic_year = p_academic_year
      AND sr.semester = p_semester;

    -- Apply allocated slots
    FOR item IN SELECT * FROM jsonb_array_elements(p_allocations)
    LOOP
        v_student_id := (item->>'student_id')::UUID;
        v_slot_key   := item->>'slot_key';
        v_course_id  := (item->>'course_id')::UUID;
        v_meta       := item->'metadata';

        SELECT id INTO v_reg_id FROM student_registrations
        WHERE student_id = v_student_id AND academic_year = p_academic_year AND semester = p_semester;

        IF v_reg_id IS NOT NULL THEN
            v_sql := format(
                'UPDATE student_registrations SET %I = $1, allocation_metadata = jsonb_set(COALESCE(allocation_metadata, ''{}''::jsonb), ARRAY[$2], $3, true) WHERE id = $4',
                v_slot_key || '_course_id'
            );
            EXECUTE v_sql USING v_course_id, v_slot_key, v_meta, v_reg_id;
        END IF;

        UPDATE registration_preferences
        SET allocation_metadata = jsonb_set(COALESCE(allocation_metadata, '{}'::jsonb), ARRAY[v_slot_key], v_meta, true),
            updated_at = timezone('utc'::text, now())
        WHERE student_id = v_student_id AND academic_year = p_academic_year AND semester = p_semester;
    END LOOP;

    -- Apply unallocated metadata
    FOR item IN SELECT * FROM jsonb_array_elements(p_unallocated)
    LOOP
        v_student_id := (item->>'student_id')::UUID;
        v_slot_key   := item->>'slot_key';
        v_meta       := item->'metadata';

        SELECT id INTO v_reg_id FROM student_registrations
        WHERE student_id = v_student_id AND academic_year = p_academic_year AND semester = p_semester;

        IF v_reg_id IS NOT NULL THEN
            v_sql := format(
                'UPDATE student_registrations SET %I = NULL, allocation_metadata = jsonb_set(COALESCE(allocation_metadata, ''{}''::jsonb), ARRAY[$1], $2, true) WHERE id = $3',
                v_slot_key || '_course_id'
            );
            EXECUTE v_sql USING v_slot_key, v_meta, v_reg_id;
        END IF;

        UPDATE registration_preferences
        SET allocation_metadata = jsonb_set(COALESCE(allocation_metadata, '{}'::jsonb), ARRAY[v_slot_key], v_meta, true),
            updated_at = timezone('utc'::text, now())
        WHERE student_id = v_student_id AND academic_year = p_academic_year AND semester = p_semester;
    END LOOP;

    -- Recalculate credit sums on student_registrations
    UPDATE student_registrations sr
    SET total_credits = COALESCE(
        (SELECT SUM(c.credits)
         FROM courses c
         WHERE c.id IN (
             sr.slot_1_course_id, sr.slot_2_course_id, sr.slot_3_course_id,
             sr.slot_4_course_id, sr.slot_5_course_id, sr.slot_6_course_id
         )), 0)
    WHERE sr.campus_id = p_campus_id
      AND sr.academic_year = p_academic_year
      AND sr.semester = p_semester;

    RETURN jsonb_build_object(
        'success', true,
        'allocated_slots_applied', jsonb_array_length(p_allocations),
        'unallocated_slots_applied', jsonb_array_length(p_unallocated)
    );
END;
$$;

-- Remove named legacy policies that are not covered by the blanket-policy
-- cleanup above. Operational logs are written/read by the NestJS service role.
DROP POLICY IF EXISTS "Admins, Directors, HODs can view system_logs" ON system_logs;
DROP POLICY IF EXISTS "Authenticated users can insert system_logs" ON system_logs;
DROP POLICY IF EXISTS "Allow update only on job records in system_logs" ON system_logs;
REVOKE ALL PRIVILEGES ON TABLE system_logs FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE system_logs TO service_role;
REVOKE ALL PRIVILEGES ON TABLE
    audit_logs, audit_logs_legacy,
    allocation_runs, allocation_runs_legacy,
    timetable_generation_jobs, timetable_generation_jobs_legacy
FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE
    audit_logs, audit_logs_legacy,
    allocation_runs, allocation_runs_legacy,
    timetable_generation_jobs, timetable_generation_jobs_legacy
TO service_role;

-- The RLS auto-enable event trigger is server-side infrastructure, not a
-- Data API RPC. Prevent direct calls by client roles if the function exists.
DO $$
BEGIN
    IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
    END IF;
END;
$$;

-- 2. Campus Student Promotion Procedure
CREATE OR REPLACE FUNCTION promote_campus_students(p_campus_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE students
    SET current_semester = current_semester + 1
    WHERE campus_id = p_campus_id AND current_semester < 10;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;

    UPDATE campus_settings
    SET last_promoted_at = timezone('utc'::text, now())
    WHERE campus_id = p_campus_id;

    RETURN jsonb_build_object('success', true, 'promoted_count', v_count);
END;
$$;

-- 3. Cascade Deletion Helpers
CREATE OR REPLACE FUNCTION delete_campus_cascade(p_campus_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    DELETE FROM campuses WHERE id = p_campus_id;
END;
$$;

CREATE OR REPLACE FUNCTION delete_department_cascade(p_dept_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    DELETE FROM departments WHERE id = p_dept_id;
END;
$$;

-- 4. Restrict RPC execute permissions to service_role only
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure AS func_sig
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'delete_campus_cascade',
              'delete_department_cascade',
              'promote_campus_students',
              'apply_course_allocation'
          )
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM public, anon, authenticated;', r.func_sig);
    END LOOP;
END;
$$;

-- =============================================================================
-- PART 7: HIGH-PERFORMANCE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_system_logs_type_created ON system_logs (log_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_job_lookup ON system_logs (log_type, campus_id, academic_year, semester, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reg_pref_lookup ON registration_preferences (campus_id, academic_year, semester);
CREATE INDEX IF NOT EXISTS idx_reg_pref_student ON registration_preferences (student_id, semester, academic_year);
CREATE INDEX IF NOT EXISTS idx_course_prereq_rules_course_id ON course_prerequisite_rules (course_id);
CREATE INDEX IF NOT EXISTS idx_period_att_slot_date ON period_attendance (timetable_slot_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_period_att_student_id ON period_attendance (student_id);
CREATE INDEX IF NOT EXISTS idx_period_att_course_id ON period_attendance (course_id);
CREATE INDEX IF NOT EXISTS idx_period_unlock_slot_id ON period_unlock_requests (timetable_slot_id);
CREATE INDEX IF NOT EXISTS idx_csi_student_date ON campus_sign_ins (student_id, signed_in_date);
CREATE INDEX IF NOT EXISTS idx_csi_campus_date ON campus_sign_ins (campus_id, signed_in_date);

-- =============================================================================
-- PART 8: ROW LEVEL SECURITY (RLS) HARDENING & LEAST-PRIVILEGE POLICIES
-- =============================================================================

-- Enable RLS across all 20 public tables
ALTER TABLE campuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_prerequisite_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE semester_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_course_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_unlock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE campus_sign_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;

-- 1. Remove dangerous blanket policies on any public table
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "authenticated_all_%I" ON %I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "authenticated_select_%I" ON %I;', t, t);
        EXECUTE format('DROP POLICY IF EXISTS "service_role_all_%I" ON %I;', t, t);
        EXECUTE format('CREATE POLICY "service_role_all_%I" ON %I FOR ALL TO service_role USING (true) WITH CHECK (true);', t, t);
    END LOOP;
END;
$$;

-- 2. Reference Data: Read-only for authenticated users
DROP POLICY IF EXISTS campuses_select_auth ON campuses;
CREATE POLICY campuses_select_auth ON campuses FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS departments_select_auth ON departments;
CREATE POLICY departments_select_auth ON departments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS campus_settings_select_auth ON campus_settings;
CREATE POLICY campus_settings_select_auth ON campus_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS courses_select_auth ON courses;
CREATE POLICY courses_select_auth ON courses FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS blueprints_select_auth ON semester_blueprints;
CREATE POLICY blueprints_select_auth ON semester_blueprints FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS prereq_select_auth ON course_prerequisite_rules;
CREATE POLICY prereq_select_auth ON course_prerequisite_rules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS timetable_slots_select_auth ON time_slots;
CREATE POLICY timetable_slots_select_auth ON time_slots FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS timetable_entries_select_auth ON timetable_entries;
CREATE POLICY timetable_entries_select_auth ON timetable_entries FOR SELECT TO authenticated USING (true);

-- 3. Profile Tables: Own record access
DROP POLICY IF EXISTS students_select_own ON students;
CREATE POLICY students_select_own ON students FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS faculty_select_own ON faculty;
CREATE POLICY faculty_select_own ON faculty FOR SELECT TO authenticated USING (id = auth.uid());

-- 4. Student Registrations: Own record access
DROP POLICY IF EXISTS registrations_select_own ON student_registrations;
CREATE POLICY registrations_select_own ON student_registrations FOR SELECT TO authenticated USING (student_id = auth.uid());

-- 5. Registration Preferences: Own record access with deadline check
DROP POLICY IF EXISTS preferences_select_own ON registration_preferences;
CREATE POLICY preferences_select_own ON registration_preferences FOR SELECT TO authenticated USING (student_id = auth.uid());

DROP POLICY IF EXISTS preferences_insert_own ON registration_preferences;
CREATE POLICY preferences_insert_own ON registration_preferences FOR INSERT TO authenticated
WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM students s
        JOIN campus_settings cs ON cs.campus_id = s.campus_id
        WHERE s.id = auth.uid()
          AND (cs.deadline IS NULL OR cs.deadline > NOW())
    )
);

DROP POLICY IF EXISTS preferences_update_own ON registration_preferences;
CREATE POLICY preferences_update_own ON registration_preferences FOR UPDATE TO authenticated
USING (
    student_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM students s
        JOIN campus_settings cs ON cs.campus_id = s.campus_id
        WHERE s.id = auth.uid()
          AND (cs.deadline IS NULL OR cs.deadline > NOW())
    )
)
WITH CHECK (
    student_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM students s
        JOIN campus_settings cs ON cs.campus_id = s.campus_id
        WHERE s.id = auth.uid()
          AND (cs.deadline IS NULL OR cs.deadline > NOW())
    )
);

-- 6. Teacher Course Assignments
DROP POLICY IF EXISTS "Allow read assignments for authenticated users" ON teacher_course_assignments;
DROP POLICY IF EXISTS "Allow write assignments for HODs and Admins" ON teacher_course_assignments;
REVOKE ALL PRIVILEGES ON TABLE teacher_course_assignments FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE teacher_course_assignments TO service_role;

-- 7. Period Attendance
DROP POLICY IF EXISTS period_attendance_select_auth ON period_attendance;
DROP POLICY IF EXISTS "Students can view own period attendance" ON period_attendance;
DROP POLICY IF EXISTS "Faculty can mark period attendance" ON period_attendance;
DROP POLICY IF EXISTS "Faculty can mark assigned period attendance" ON period_attendance;
REVOKE ALL PRIVILEGES ON TABLE period_attendance FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE period_attendance TO service_role;

-- 8. Period Unlock Requests
DROP POLICY IF EXISTS "Allow HODs and Admins to manage unlock requests" ON period_unlock_requests;
REVOKE ALL PRIVILEGES ON TABLE period_unlock_requests FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE period_unlock_requests TO service_role;

-- Timetable conflicts are consumed and written through the backend only.
DROP POLICY IF EXISTS "Allow write access to timetable_conflicts for directors and sup" ON timetable_conflicts;
DROP POLICY IF EXISTS "Allow read access to timetable_conflicts for authenticated user" ON timetable_conflicts;
REVOKE ALL PRIVILEGES ON TABLE timetable_conflicts FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE timetable_conflicts TO service_role;

-- 9. Campus Sign-Ins
DROP POLICY IF EXISTS "Students can view own campus sign-in records" ON campus_sign_ins;
DROP POLICY IF EXISTS "Students insert own campus sign-ins" ON campus_sign_ins;
DROP POLICY IF EXISTS "Students can insert own campus sign-in records" ON campus_sign_ins;
DROP POLICY IF EXISTS "Students and staff view campus sign-in records" ON campus_sign_ins;
DROP POLICY IF EXISTS "Staff manage campus sign-ins" ON campus_sign_ins;
DROP POLICY IF EXISTS "HODs can view department campus sign-in records" ON campus_sign_ins;
DROP POLICY IF EXISTS "Admins and Directors can view all campus sign-in records" ON campus_sign_ins;
DROP POLICY IF EXISTS "Campus admins and directors can read campus sign-ins" ON campus_sign_ins;
REVOKE ALL PRIVILEGES ON TABLE campus_sign_ins FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE campus_sign_ins TO service_role;

-- 10. Consent Records
DROP POLICY IF EXISTS consent_select_own ON consent_records;
CREATE POLICY consent_select_own ON consent_records FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS consent_insert_own ON consent_records;
CREATE POLICY consent_insert_own ON consent_records FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- =============================================================================
-- PART 9: MASTER INSTITUTIONAL SEED DATA UPSERT (ON CONFLICT DO UPDATE)
-- =============================================================================

-- 1. Campuses (4 University Campuses)
INSERT INTO campuses (id, name, code, center_latitude, center_longitude, radius_meters, morning_cutoff_time, midday_split_time, evening_cutoff_time, day_end_time) VALUES
('5b5289d5-17eb-43ba-832e-19883e9eaada', 'KUC Mangattuparamba', 'MANGAT', 11.9388, 75.3687, 500, '09:30:00', '13:30:00', '15:30:00', '17:00:00'),
('feed55c6-deea-46b7-9fa1-a97cfabf0838', 'Dr. Janaki Ammal Campus', 'THALAS', 11.7583, 75.5262, 500, '09:30:00', '13:30:00', '15:30:00', '17:00:00'),
('b351869a-8ea8-4e30-b505-1fe559554161', 'Dr. P.K. Rajan Memorial Campus', 'NILESH', 12.2472, 75.1278, 500, '09:30:00', '13:30:00', '15:30:00', '17:00:00'),
('2a05b3e6-c2cf-4011-8b81-18f034431de8', 'Swami Anandatheertha Campus', 'PAYYAN', 12.0983, 75.2072, 500, '09:30:00', '13:30:00', '15:30:00', '17:00:00')
ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name, 
    code = EXCLUDED.code,
    center_latitude = EXCLUDED.center_latitude,
    center_longitude = EXCLUDED.center_longitude,
    radius_meters = EXCLUDED.radius_meters,
    morning_cutoff_time = EXCLUDED.morning_cutoff_time,
    midday_split_time = EXCLUDED.midday_split_time,
    evening_cutoff_time = EXCLUDED.evening_cutoff_time,
    day_end_time = EXCLUDED.day_end_time;

-- 2. Campus Settings (Active Registration Window)
INSERT INTO campus_settings (campus_id, academic_year, min_credits, max_credits, deadline, last_promoted_at) VALUES
('5b5289d5-17eb-43ba-832e-19883e9eaada', '2026-27', 18, 26, '2026-10-31 18:29:59+00', '2026-07-18 15:12:50.089+00'),
('feed55c6-deea-46b7-9fa1-a97cfabf0838', '2026-27', 18, 26, '2026-10-31 18:29:59+00', NULL),
('b351869a-8ea8-4e30-b505-1fe559554161', '2026-27', 18, 26, '2026-10-31 18:29:59+00', NULL),
('2a05b3e6-c2cf-4011-8b81-18f034431de8', '2026-27', 18, 26, '2026-10-31 18:29:59+00', NULL)
ON CONFLICT (campus_id) DO UPDATE SET 
    academic_year = EXCLUDED.academic_year, 
    min_credits = EXCLUDED.min_credits,
    max_credits = EXCLUDED.max_credits,
    deadline = EXCLUDED.deadline;

-- 3. Departments (13 Academic Departments)
INSERT INTO departments (id, name, code, campus_id) VALUES
('96a54058-8437-46a3-9815-ae49deab0999', 'Information Technology', 'IT', '5b5289d5-17eb-43ba-832e-19883e9eaada'),
('a8a70f5e-3130-4a2a-8329-4e4365d683b5', 'Mathematical Science', 'MAT', '5b5289d5-17eb-43ba-832e-19883e9eaada'),
('71ba995f-fa2d-461b-8971-73c4fd00dac7', 'Physical Education & Sports', 'PES', '5b5289d5-17eb-43ba-832e-19883e9eaada'),
('b68264cf-6b23-409f-b4bd-0617e37ebb15', 'Environmental Studies', 'EVS', '5b5289d5-17eb-43ba-832e-19883e9eaada'),
('9cfa61d3-ed11-4d78-9001-54c76035fbcb', 'School Of Behavioural Sciences', 'SBS', '5b5289d5-17eb-43ba-832e-19883e9eaada'),
('f2f08c07-581a-434c-89c5-83ae47030a0e', 'Statistical Sciences', 'STA', '5b5289d5-17eb-43ba-832e-19883e9eaada'),
('7898c34b-e8bf-4acc-be44-9b42d185e605', 'Department of Economics', 'ECO', '5b5289d5-17eb-43ba-832e-19883e9eaada'),
('3cabe38e-2fe2-4ff6-9bc6-9f564fa2b8a2', 'Department of Wood Science & Technology', 'SWT', '5b5289d5-17eb-43ba-832e-19883e9eaada'),
('35984692-74e0-4772-a01e-fae2622ff773', 'Department of Studies in English', 'ENG', 'feed55c6-deea-46b7-9fa1-a97cfabf0838'),
('e814d190-e1c2-4731-b2ec-d97d5dc897e0', 'History', 'HIS', 'feed55c6-deea-46b7-9fa1-a97cfabf0838'),
('f2ccdb04-8628-4f33-947c-440b55170bd7', 'Department of Malayalam', 'MAL', 'b351869a-8ea8-4e30-b505-1fe559554161'),
('1366fb8a-21f8-4c71-a355-74caf50a20af', 'Department of Hindi', 'HIN', 'b351869a-8ea8-4e30-b505-1fe559554161'),
('b1870668-6a16-42c0-99fb-71fa2a9179d8', 'Department of Geography', 'GEO', '2a05b3e6-c2cf-4011-8b81-18f034431de8')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code, campus_id = EXCLUDED.campus_id;

-- 4. Time Slots (Standard academic schedule: 5 days x 6 periods = 30 slots)
DO $$
DECLARE
    d smallint;
    p smallint;
    st time;
    et time;
    start_times time[] := ARRAY['09:30:00'::time, '10:30:00'::time, '11:30:00'::time, '13:30:00'::time, '14:30:00'::time, '15:30:00'::time];
    end_times   time[] := ARRAY['10:30:00'::time, '11:30:00'::time, '12:30:00'::time, '14:30:00'::time, '15:30:00'::time, '16:30:00'::time];
BEGIN
    FOR d IN 1..5 LOOP
        FOR p IN 1..6 LOOP
            st := start_times[p];
            et := end_times[p];
            INSERT INTO time_slots (day_of_week, period_number, start_time, end_time, is_lab_block)
            VALUES (d, p, st, et, false)
            ON CONFLICT (day_of_week, period_number) DO UPDATE
            SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time;
        END LOOP;
    END LOOP;
END;
$$;

-- =============================================================================
-- PART 10: MIGRATION TRACKING RECORD
-- =============================================================================

INSERT INTO schema_migrations (version, name, applied_at)
VALUES ('20260928_unified_master_schema_and_upsert', 'Unified master idempotent schema and institutional seed upsert', timezone('utc'::text, now()))
ON CONFLICT (version) DO UPDATE SET applied_at = EXCLUDED.applied_at;

-- End of unified master upsert script.
