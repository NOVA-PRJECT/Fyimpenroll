const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261011020000_security_advisor_function_hardening.sql'), 'utf8');
const backendFunctions = [
  ['claim_allocation_run', 'p_campus_id uuid, p_academic_year text, p_semester smallint, p_user_id uuid, p_lease_seconds integer'],
  ['claim_allocation_run', 'uuid, text, smallint, uuid, integer, uuid'],
  ['apply_course_allocation', 'uuid, uuid, text, smallint, jsonb, jsonb'],
  ['apply_course_allocation', 'p_run_id uuid, p_campus_id uuid, p_academic_year text, p_semester smallint, p_allocations jsonb, p_unallocated jsonb, p_summary jsonb'],
  ['apply_course_allocation', 'uuid, uuid, text, smallint, jsonb, jsonb, jsonb, uuid'],
  ['claim_timetable_generation_job', 'p_campus_id uuid, p_academic_year text, p_semester integer, p_user_id uuid, p_config jsonb, p_lease_seconds integer'],
  ['claim_timetable_generation_job', 'uuid, text, smallint, uuid, integer, uuid'],
  ['heartbeat_timetable_generation_job', 'p_job_id uuid'],
  ['replace_timetable_draft', 'p_job_id uuid, p_campus_id uuid, p_academic_year text, p_semester integer, p_entries jsonb, p_conflicts jsonb, p_stats jsonb'],
  ['promote_campus_students_once', 'uuid, uuid, text'],
];
let db, originalFunctions;
before(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.schema_migrations(version text PRIMARY KEY, name text);
    CREATE TABLE public.security_probe(value text); INSERT INTO public.security_probe VALUES ('trusted');
    CREATE SCHEMA attacker; CREATE TABLE attacker.security_probe(value text); INSERT INTO attacker.security_probe VALUES ('spoofed');
    CREATE TEMP TABLE security_probe(value text); INSERT INTO pg_temp.security_probe VALUES ('temporary spoof');
    GRANT CREATE ON SCHEMA public TO PUBLIC, anon, authenticated;
    CREATE FUNCTION public.unrelated_public_helper() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;`);
  for (const [name, args] of backendFunctions) {
    await db.exec(`CREATE FUNCTION public.${name}(${args}) RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS
      $$ BEGIN RETURN (SELECT value FROM security_probe); END; $$;
      GRANT EXECUTE ON FUNCTION public.${name}(${args}) TO anon, authenticated;`);
  }
  for (const name of ['trg_prevent_published_timetable_mutation', 'trg_guard_published_timetable_entries', 'trg_init_campus_settings']) {
    await db.exec(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;`);
  }
  const helper = fs.readFileSync(path.join(root, 'supabase/migrations/20261007010000_plan04_enrollment_capacity_transactions.sql'), 'utf8');
  await db.exec(helper.slice(helper.indexOf('CREATE OR REPLACE FUNCTION check_unique_course_slots'), helper.indexOf('DO $$')));
  await db.exec("ALTER FUNCTION public.heartbeat_timetable_generation_job(uuid) SET timezone = 'UTC'");
  originalFunctions = (await db.query("SELECT oid, prosrc, proowner, prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY oid")).rows;
  assert.equal((await db.query("SELECT public.heartbeat_timetable_generation_job(NULL) result")).rows[0].result, 'temporary spoof');
  await db.exec(migration);
});
after(async () => { await db?.close(); });

test('all legacy and current worker overloads deny browser execution and retain backend access', async () => {
  const rows = (await db.query(`SELECT p.proname,
    has_function_privilege('anon', p.oid, 'EXECUTE') anon,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') authenticated,
    has_function_privilege('service_role', p.oid, 'EXECUTE') backend
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prosecdef`)).rows;
  assert.equal(rows.length, backendFunctions.length);
  for (const row of rows) assert.deepEqual([row.anon,row.authenticated,row.backend], [false,false,true], row.proname);
  for (const role of ['anon','authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    try { await assert.rejects(db.query('SELECT public.heartbeat_timetable_generation_job(NULL)'), /permission denied for function/); }
    finally { await db.exec('RESET ROLE'); }
  }
});

test('backend calls cannot resolve spoofed temporary tables or a caller-selected schema', async () => {
  await db.exec('SET ROLE service_role; SET search_path = attacker, pg_temp, public');
  try { assert.equal((await db.query('SELECT public.heartbeat_timetable_generation_job(NULL) result')).rows[0].result, 'trusted'); }
  finally { await db.exec('RESET ROLE; RESET search_path'); }
  const settings = (await db.query("SELECT proconfig FROM pg_proc WHERE oid='public.heartbeat_timetable_generation_job(uuid)'::regprocedure")).rows[0].proconfig;
  assert.ok(settings.includes('search_path=pg_catalog, public, pg_temp'));
  assert.ok(settings.includes('TimeZone=UTC'));
});

test('stateless constraint checks, unrelated public helpers, function bodies and academic data remain intact', async () => {
  assert.deepEqual((await db.query("SELECT oid, prosrc, proowner, prosecdef FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY oid")).rows, originalFunctions);
  assert.deepEqual((await db.query('SELECT * FROM public.security_probe')).rows, [{value:'trusted'}]);
  for (const role of ['anon','authenticated']) {
    assert.equal((await db.query("SELECT has_schema_privilege($1,'public','CREATE') allowed", [role])).rows[0].allowed, false);
    await db.exec(`SET ROLE ${role}`);
    try {
      assert.equal((await db.query('SELECT public.unrelated_public_helper() result')).rows[0].result, true);
      assert.equal((await db.query('SELECT public.check_unique_course_slots(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL) result')).rows[0].result, true);
      await assert.rejects(db.exec('CREATE TABLE public.forbidden_schema_object(id int)'), /permission denied for schema/);
    } finally { await db.exec('RESET ROLE'); }
  }
});

test('manual handoff is identical to the migration and safe to rerun after legacy variants are removed', async () => {
  assert.equal(fs.readFileSync(path.join(root, 'implementation-handoffs/production-audit/APPLY_SECURITY_ADVISOR_REPAIR.sql'), 'utf8'), migration);
  await db.exec('DROP FUNCTION public.replace_timetable_draft(uuid,uuid,text,integer,jsonb,jsonb,jsonb)');
  await db.exec(migration);
  assert.equal((await db.query("SELECT count(*) n FROM public.schema_migrations WHERE version='20261011020000_security_advisor_function_hardening'")).rows[0].n, 1);
});

test('inherited untrusted schema privileges abort the entire repair instead of claiming security', async () => {
  await db.exec(`CREATE ROLE schema_writer; GRANT CREATE ON SCHEMA public TO schema_writer; GRANT schema_writer TO authenticated;
    ALTER FUNCTION public.heartbeat_timetable_generation_job(uuid) RESET search_path;
    GRANT EXECUTE ON FUNCTION public.heartbeat_timetable_generation_job(uuid) TO PUBLIC, anon, authenticated;`);
  await assert.rejects(db.exec(migration), /still inherit CREATE/);
  await db.exec('ROLLBACK');
  const row = (await db.query("SELECT proconfig, has_function_privilege('anon',oid,'EXECUTE') anon FROM pg_proc WHERE oid='public.heartbeat_timetable_generation_job(uuid)'::regprocedure")).rows[0];
  assert.ok(!row.proconfig.some(value=>value.startsWith('search_path=')));
  assert.equal(row.anon, true);
});
