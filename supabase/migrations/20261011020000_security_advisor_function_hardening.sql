BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, public, pg_temp;

-- The application never lets browser roles create schema objects. Keeping
-- public trusted is required while legacy function bodies use unqualified names.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

DO $harden$
DECLARE
    target_names CONSTANT text[] := ARRAY[
        'check_unique_course_slots', 'claim_allocation_run', 'apply_course_allocation',
        'trg_prevent_published_timetable_mutation', 'claim_timetable_generation_job',
        'heartbeat_timetable_generation_job', 'replace_timetable_draft',
        'trg_guard_published_timetable_entries', 'trg_init_campus_settings',
        'promote_campus_students_once'
    ];
    backend_names CONSTANT text[] := ARRAY[
        'claim_allocation_run', 'apply_course_allocation', 'claim_timetable_generation_job',
        'heartbeat_timetable_generation_job', 'replace_timetable_draft',
        'promote_campus_students_once'
    ];
    fn record;
BEGIN
    -- Resolve ALL signatures: restricting the new fenced variant does not
    -- revoke access to older overloads left behind by earlier migrations.
    FOR fn IN
        SELECT p.oid, p.proname,
            format('%I.%I(%s)', n.nspname, p.proname,
                pg_get_function_identity_arguments(p.oid)) AS signature
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f'
            AND p.proname = ANY(target_names)
        ORDER BY p.oid
    LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path TO pg_catalog, public, pg_temp', fn.signature);
        IF fn.proname = ANY(backend_names) THEN
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
        END IF;
    END LOOP;

    IF has_schema_privilege('anon', 'public', 'CREATE')
        OR has_schema_privilege('authenticated', 'public', 'CREATE') THEN
        RAISE EXCEPTION 'Browser roles still inherit CREATE on public; review role membership before retrying';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY(target_names)
            AND NOT COALESCE(p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'], false)
    ) THEN RAISE EXCEPTION 'A reported function still has an unsafe search path'; END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = ANY(backend_names)
            AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
    ) THEN RAISE EXCEPTION 'Backend function execution privileges are not restricted correctly'; END IF;
END;
$harden$;

INSERT INTO public.schema_migrations(version, name)
VALUES ('20261011020000_security_advisor_function_hardening',
    'Pin reported function search paths and restrict every backend RPC overload')
ON CONFLICT (version) DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- Backend-only rows must show false / false / true for the three EXECUTE columns.
-- The stateless check helper and trigger functions retain their existing ACLs.
SELECT format('%I.%I(%s)', n.nspname, p.proname,
        pg_get_function_identity_arguments(p.oid)) AS signature,
    p.proconfig AS function_settings,
    p.proname IN ('claim_allocation_run', 'apply_course_allocation',
        'claim_timetable_generation_job', 'heartbeat_timetable_generation_job',
        'replace_timetable_draft', 'promote_campus_students_once') AS backend_only,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS backend_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
    AND p.proname IN ('check_unique_course_slots', 'claim_allocation_run',
        'apply_course_allocation', 'trg_prevent_published_timetable_mutation',
        'claim_timetable_generation_job', 'heartbeat_timetable_generation_job',
        'replace_timetable_draft', 'trg_guard_published_timetable_entries',
        'trg_init_campus_settings', 'promote_campus_students_once')
ORDER BY p.proname, p.oid;
