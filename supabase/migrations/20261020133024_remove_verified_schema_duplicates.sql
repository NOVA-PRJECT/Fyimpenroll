-- Remove only catalog-verified duplicates. No table, column, function, or row is removed.
-- One DO statement makes the validation, cleanup, and preservation checks atomic.
DO $cleanup$
DECLARE
  relation_name text;
  duplicate_name text;
  policy_pair record;
  before_rows jsonb := '{}'::jsonb;
  after_rows jsonb := '{}'::jsonb;
  fingerprint jsonb;
  before_access jsonb;
  after_access jsonb;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '20s', true);
  PERFORM set_config('search_path', 'pg_catalog, public, pg_temp', true);

  -- Fail quickly on contention. Hold locks only for this small catalog cleanup.
  LOCK TABLE public.course_prerequisite_rules, public.period_attendance,
    public.registration_preferences, public.student_registrations, public.students,
    public.time_slots, public.timetable_entries IN ACCESS EXCLUSIVE MODE;

  FOREACH relation_name IN ARRAY ARRAY['course_prerequisite_rules', 'period_attendance',
    'registration_preferences', 'student_registrations', 'students', 'time_slots', 'timetable_entries']
  LOOP
    EXECUTE format('SELECT jsonb_build_object(''count'', count(*), ''hash'',
      md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '''' ORDER BY id), '''')))
      FROM public.%I t', relation_name) INTO fingerprint;
    before_rows := before_rows || jsonb_build_object(relation_name, fingerprint);
  END LOOP;

  -- DISTINCT intentionally ignores repeated identical policies; grants and RLS flags
  -- are included so an accidental authorization change aborts the whole operation.
  SELECT jsonb_build_object(
    'policies', (SELECT jsonb_agg(x ORDER BY x::text) FROM (
      SELECT DISTINCT to_jsonb(p) - 'policyname' AS x FROM pg_policies p WHERE schemaname = 'public'
    ) effective),
    'rls', (SELECT jsonb_agg(jsonb_build_array(c.oid, c.relrowsecurity, c.relforcerowsecurity, c.relacl::text) ORDER BY c.oid)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v'))
  ) INTO before_access;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.student_registrations'::regclass
      AND c.conname = 'student_registrations_student_id_fkey' AND c.contype = 'f'
      AND c.confrelid = 'public.students'::regclass AND c.convalidated
  ) THEN
    RAISE EXCEPTION 'Cleanup stopped: canonical registration/student FK is missing or unvalidated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.student_registrations'::regclass
      AND conname = 'fk_student_registrations_students') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint old_fk JOIN pg_constraint kept_fk ON kept_fk.conrelid = old_fk.conrelid
      WHERE old_fk.conrelid = 'public.student_registrations'::regclass
        AND old_fk.conname = 'fk_student_registrations_students'
        AND kept_fk.conname = 'student_registrations_student_id_fkey'
        AND old_fk.convalidated AND kept_fk.convalidated
        AND pg_get_constraintdef(old_fk.oid) = pg_get_constraintdef(kept_fk.oid)
    ) THEN
      RAISE EXCEPTION 'Cleanup stopped: registration FKs are not equivalent';
    END IF;
    ALTER TABLE public.student_registrations DROP CONSTRAINT fk_student_registrations_students RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_period_attendance_export_lookup')
      AND indrelid = 'public.period_attendance'::regclass AND indisvalid AND indisready) THEN
    RAISE EXCEPTION 'Cleanup stopped: retained attendance index is missing or invalid';
  END IF;
  FOREACH duplicate_name IN ARRAY ARRAY['idx_period_att_slot_date', 'idx_period_attendance_slot_date']
  LOOP
    IF to_regclass('public.' || duplicate_name) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_index old_ix JOIN pg_index kept_ix ON old_ix.indrelid = kept_ix.indrelid
        JOIN pg_class old_class ON old_class.oid = old_ix.indexrelid
        JOIN pg_class kept_class ON kept_class.oid = kept_ix.indexrelid
      WHERE old_ix.indexrelid = to_regclass('public.' || duplicate_name)
        AND kept_ix.indexrelid = 'public.idx_period_attendance_export_lookup'::regclass
        AND old_ix.indisvalid AND old_ix.indisready AND NOT old_ix.indisunique AND NOT old_ix.indisprimary
        AND NOT old_ix.indisreplident AND NOT old_ix.indisclustered
        AND NOT kept_ix.indisunique AND NOT kept_ix.indisprimary
        AND old_ix.indnkeyatts = kept_ix.indnkeyatts AND old_ix.indnatts = kept_ix.indnatts
        AND old_ix.indkey = kept_ix.indkey AND old_ix.indclass = kept_ix.indclass
        AND old_ix.indcollation = kept_ix.indcollation AND old_ix.indoption = kept_ix.indoption
        AND old_ix.indnullsnotdistinct = kept_ix.indnullsnotdistinct
        AND old_ix.indexprs::text IS NOT DISTINCT FROM kept_ix.indexprs::text
        AND old_ix.indpred::text IS NOT DISTINCT FROM kept_ix.indpred::text
        AND old_class.relam = kept_class.relam
        AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = old_ix.indexrelid)
    ) THEN
      RAISE EXCEPTION 'Cleanup stopped: index % is not an equivalent non-constraint index', duplicate_name;
    END IF;
    EXECUTE format('DROP INDEX public.%I RESTRICT', duplicate_name);
  END LOOP;

  FOR policy_pair IN SELECT * FROM (VALUES
    ('course_prerequisite_rules', 'Allow authenticated read on course_prerequisite_rules', 'prereq_select_auth'),
    ('registration_preferences', 'Allow students read their own registration_preferences', 'preferences_select_own'),
    ('time_slots', 'Allow read access to time_slots for authenticated users', 'timetable_slots_select_auth'),
    ('timetable_entries', 'Allow read access to timetable_entries for authenticated users', 'timetable_entries_select_auth')
  ) pairs(table_name, duplicate_policy, retained_policy)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.' || policy_pair.table_name)
        AND polname = policy_pair.retained_policy) THEN
      RAISE EXCEPTION 'Cleanup stopped: retained policy % is missing', policy_pair.retained_policy;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.' || policy_pair.table_name)
        AND polname = policy_pair.duplicate_policy) THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy old_policy JOIN pg_policy kept_policy ON kept_policy.polrelid = old_policy.polrelid
      WHERE old_policy.polrelid = to_regclass('public.' || policy_pair.table_name)
        AND old_policy.polname = policy_pair.duplicate_policy AND kept_policy.polname = policy_pair.retained_policy
        AND (to_jsonb(old_policy) - ARRAY['oid', 'polname']) = (to_jsonb(kept_policy) - ARRAY['oid', 'polname'])
    ) THEN
      RAISE EXCEPTION 'Cleanup stopped: policy % is not equivalent', policy_pair.duplicate_policy;
    END IF;
    EXECUTE format('DROP POLICY %I ON public.%I RESTRICT', policy_pair.duplicate_policy, policy_pair.table_name);
  END LOOP;

  FOREACH relation_name IN ARRAY ARRAY['course_prerequisite_rules', 'period_attendance',
    'registration_preferences', 'student_registrations', 'students', 'time_slots', 'timetable_entries']
  LOOP
    EXECUTE format('SELECT jsonb_build_object(''count'', count(*), ''hash'',
      md5(COALESCE(string_agg(md5(to_jsonb(t)::text), '''' ORDER BY id), '''')))
      FROM public.%I t', relation_name) INTO fingerprint;
    after_rows := after_rows || jsonb_build_object(relation_name, fingerprint);
  END LOOP;
  SELECT jsonb_build_object(
    'policies', (SELECT jsonb_agg(x ORDER BY x::text) FROM (
      SELECT DISTINCT to_jsonb(p) - 'policyname' AS x FROM pg_policies p WHERE schemaname = 'public'
    ) effective),
    'rls', (SELECT jsonb_agg(jsonb_build_array(c.oid, c.relrowsecurity, c.relforcerowsecurity, c.relacl::text) ORDER BY c.oid)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v'))
  ) INTO after_access;
  IF before_rows IS DISTINCT FROM after_rows THEN
    RAISE EXCEPTION 'Cleanup stopped: table data changed';
  END IF;
  IF before_access IS DISTINCT FROM after_access THEN
    RAISE EXCEPTION 'Cleanup stopped: effective policies, grants, or RLS settings changed';
  END IF;
  PERFORM pg_notify('pgrst', 'reload schema');
  RAISE NOTICE 'Duplicate cleanup verified: seven table fingerprints and effective access rules unchanged';
END
$cleanup$;
