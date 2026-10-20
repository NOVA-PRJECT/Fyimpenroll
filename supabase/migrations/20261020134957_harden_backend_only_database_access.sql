-- The web/mobile clients use authenticated NestJS APIs, not direct table/RPC access.
-- Close the legacy Data API path (including TRUNCATE, which bypasses RLS).
-- Deliberately changes client access; backend service_role access and row contents are preserved.
DO $harden$
DECLARE
  table_name text;
  relation_oid regclass;
  policy_record record;
  column_record record;
  role_name text;
  before_rows jsonb := '{}'::jsonb;
  after_rows jsonb := '{}'::jsonb;
  fingerprint jsonb;
  app_tables constant text[] := ARRAY['admins', 'campus_settings', 'campus_sign_ins', 'campuses', 'consent_records', 'course_prerequisite_rules', 'courses', 'department_notices', 'departments', 'faculty', 'graduation_candidates', 'graduation_operations', 'period_attendance', 'period_attendance_sessions', 'period_unlock_requests', 'promotion_receipts', 'registration_preferences', 'retired_cohorts', 'schema_migrations', 'semester_blueprints', 'student_registrations', 'students', 'system_logs', 'teacher_course_assignments', 'time_slots', 'timetable_conflicts', 'timetable_entries'];
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  PERFORM set_config('search_path','pg_catalog, public, pg_temp',true);
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'Backend service_role must retain BYPASSRLS';
  END IF;
  FOREACH table_name IN ARRAY app_tables LOOP
    relation_oid := to_regclass(format('public.%I',table_name));
    IF relation_oid IS NULL THEN RAISE EXCEPTION 'Expected application table % is missing',table_name; END IF;
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',table_name);
    EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''hash'',
      md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'''' ORDER BY md5(to_jsonb(t)::text)),''''))) FROM public.%I t',table_name)
      INTO fingerprint;
    before_rows := before_rows || jsonb_build_object(table_name,fingerprint);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated',table_name);
    -- Explicit column grants are independent of table ACLs.
    FOR column_record IN SELECT attname FROM pg_attribute
      WHERE attrelid=relation_oid AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL
    LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES (%I) ON TABLE public.%I FROM PUBLIC, anon, authenticated',column_record.attname,table_name);
    END LOOP;
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role',table_name);
    FOR policy_record IN SELECT polname FROM pg_policy WHERE polrelid=relation_oid LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',policy_record.polname,table_name);
    END LOOP;
    EXECUTE format('CREATE POLICY backend_service_access ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',table_name);
  END LOOP;

  -- Views and helpers must not re-open access to protected tables.
  FOR policy_record IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='v'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON public.%I FROM PUBLIC, anon, authenticated',policy_record.relname);
    EXECUTE format('GRANT ALL PRIVILEGES ON public.%I TO service_role',policy_record.relname);
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker=true)',policy_record.relname);
  END LOOP;
  REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
  REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
  REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
  GRANT USAGE ON SCHEMA public TO service_role;

  -- App migrations run as postgres. Supabase-managed owner defaults are outside
  -- this role's authority and must not be edited by impersonating platform roles.
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  -- PUBLIC EXECUTE is a global built-in default; per-schema REVOKE cannot cancel it.
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

  FOREACH table_name IN ARRAY app_tables LOOP
    EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''hash'',
      md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'''' ORDER BY md5(to_jsonb(t)::text)),''''))) FROM public.%I t',table_name)
      INTO fingerprint;
    after_rows := after_rows || jsonb_build_object(table_name,fingerprint);
  END LOOP;
  IF before_rows IS DISTINCT FROM after_rows THEN RAISE EXCEPTION 'Database hardening changed application rows'; END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v')
      AND has_table_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) THEN
      RAISE EXCEPTION 'Role % still has direct application privileges',role_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prokind='f' AND has_function_privilege(role_name,p.oid,'EXECUTE')) THEN
      RAISE EXCEPTION 'Role % can still call application functions directly',role_name;
    END IF;
  END LOOP;
  PERFORM pg_notify('pgrst','reload schema');
END
$harden$;
