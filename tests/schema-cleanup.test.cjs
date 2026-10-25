const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const uid = n => '00000000-0000-4000-8000-' + String(800000 + n).padStart(12, '0')
const cleanupName = '20261025062135_consolidate_application_schema.sql'
const cleanup = fs.readFileSync(path.join(__dirname, '../supabase/migrations', cleanupName), 'utf8')
let db, beforeRows
const rows = async table => (await db.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY id`)).rows.map(r => r.row)

before(async () => {
  db = new PGlite({ extensions: { 'uuid-ossp': uuid_ossp, pgcrypto } })
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);')
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/baseline/schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/baseline/reference-data.sql'), 'utf8'))
  for (const file of fs.readdirSync(path.join(__dirname, '../supabase/migrations')).sort()) {
    if (file > '20261020135038\uffff' && file < cleanupName) await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8'))
  }
  await db.exec(`
    INSERT INTO public.campuses(id,name,code) VALUES ('${uid(1)}','Cleanup campus','CLEAN');
    UPDATE public.campus_settings SET academic_year='2026-27',deadline='2100-01-01',min_credits=0,max_credits=40 WHERE campus_id='${uid(1)}';
    INSERT INTO public.departments(id,name,code,campus_id) VALUES ('${uid(2)}','Cleanup department','CL','${uid(1)}');
    INSERT INTO auth.users(id) VALUES ('${uid(3)}'),('${uid(4)}'),('${uid(5)}'),('${uid(6)}'),('${uid(7)}');
    INSERT INTO public.faculty(id,full_name,email,role,department_id,campus_id) VALUES ('${uid(3)}','HOD','cleanup@example.test','hod','${uid(2)}','${uid(1)}');
    INSERT INTO public.students(id,full_name,department_id,campus_id,current_semester,cap_application_number,academic_year_joined) VALUES
      ('${uid(4)}','Old preferences','${uid(2)}','${uid(1)}',1,'CLEAN4','2026-27'),
      ('${uid(5)}','Conflicting preferences','${uid(2)}','${uid(1)}',1,'CLEAN5','2026-27'),
      ('${uid(6)}','New submission','${uid(2)}','${uid(1)}',1,'CLEAN6','2026-27'),
      ('${uid(7)}','Graduating student','${uid(2)}','${uid(1)}',10,'CLEAN7','2026-27');
    INSERT INTO public.courses(id,course_code,title,department_id,semester,credits,category,tag,prerequisites) VALUES
      ('${uid(10)}','CLEAN101','First course','${uid(2)}',1,4,'DSC','OLD-TAG','["Know basic arithmetic."]'),
      ('${uid(11)}','CLEAN102','Second course','${uid(2)}',1,4,'DSC',null,'[]');
    INSERT INTO public.semester_blueprints(id,department_id,semester,min_credits,max_credits,slot_1_rule,slot_1_target,slot_1_name,pathways) VALUES
      ('${uid(20)}','${uid(2)}',1,0,40,'FIXED','CLEAN101','Old paper',null),
      ('${uid(21)}','${uid(2)}',2,0,40,'GLOBAL_BASKET','DSC','Old name','[{"id":"preserved","name":"Existing","slots":[{"rule":"GLOBAL_BASKET","target":"DSC","name":"Existing paper"}]}]');
    INSERT INTO public.student_registrations(id,student_id,campus_id,semester,academic_year,slot_1_course_id,total_credits,preferences,allocation_metadata,submitted_at) VALUES
      ('${uid(30)}','${uid(4)}','${uid(1)}',1,'2026-27','${uid(10)}',4,'{"slot_1":[{"course_id":"${uid(10)}","rank":1}]}','{"slot_1":{"allocated_by":"hod"}}','2026-01-01'),
      ('${uid(31)}','${uid(5)}','${uid(1)}',1,'2026-27','${uid(10)}',4,'{"slot_1":[{"course_id":"${uid(10)}","rank":1}]}','{"slot_1":{"allocated_by":"hod"}}','2026-01-02');
    INSERT INTO public.registration_preferences(id,student_id,campus_id,semester,academic_year,preferences,allocation_metadata,submitted_at) VALUES
      ('${uid(40)}','${uid(5)}','${uid(1)}',1,'2026-27','{"slot_1":[{"course_id":"${uid(11)}","rank":1}]}','{"slot_1":{"allocated_by":"unallocated"}}','2026-01-02');
    INSERT INTO public.system_logs(id,log_type,status,metadata) VALUES ('${uid(50)}','allocation_run','completed','{"total_students":2,"fully_allocated":2}');
  `)
  beforeRows = { registrations: await rows('student_registrations'), preferences: await rows('registration_preferences'), courses: await rows('courses'), logs: await rows('system_logs') }
  // A live worker must prevent any destructive schema change.
  await db.exec(`INSERT INTO public.system_logs(id,log_type,status) VALUES ('${uid(51)}','timetable_job','queued')`)
  await assert.rejects(db.exec(cleanup), /Drain allocation and timetable workers/)
  await db.exec('ROLLBACK')
  await db.exec(`DELETE FROM public.system_logs WHERE id='${uid(51)}'`)
  // An unknown dependency must roll back even the earlier backfill/function replacements.
  await db.exec('CREATE VIEW public.cleanup_dependency_test AS SELECT tag FROM public.courses')
  await assert.rejects(db.exec(cleanup), /depend|cannot drop/i)
  await db.exec('ROLLBACK')
  assert.equal((await db.query(`SELECT pathways FROM public.semester_blueprints WHERE id='${uid(20)}'`)).rows[0].pathways, null)
  assert.deepEqual(await rows('student_registrations'), beforeRows.registrations)
  await db.exec('DROP VIEW public.cleanup_dependency_test')
  // Deliberately modify retained data inside the transaction: the fingerprint check must abort.
  const corrupt = cleanup.replace('DO $verify$', `UPDATE public.courses SET title='Injected corruption' WHERE id='${uid(10)}';\nDO $verify$`)
  await assert.rejects(db.exec(corrupt), /changed retained records/)
  await db.exec('ROLLBACK')
  assert.deepEqual(await rows('courses'), beforeRows.courses)
  await db.exec(cleanup)
})
after(async () => { await db?.close() })

test('cleanup removes obsolete interfaces, preserves access boundaries and passes readiness', async () => {
  assert.equal((await db.query('SELECT public.production_readiness() AS status')).rows[0].status.ready, true)
  const removed = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND
    ((table_name='student_registrations' AND column_name IN ('preferences','selected_courses','legacy_preferences_snapshot')) OR
     (table_name='registration_preferences' AND column_name='allocation_metadata') OR
     (table_name='semester_blueprints' AND column_name ~ '^slot_[1-6]_(rule|target|name)$'))`)
  assert.equal(removed.rows.length, 0)
  const dangling = await db.query(`SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND (pg_get_functiondef(p.oid) LIKE '%row_data->''selected_courses''%' OR pg_get_functiondef(p.oid) LIKE '%row_data->''preferences'', row_data->''selections''%')`)
  assert.equal(dangling.rows.length, 0)
})

test('assigned slots, credits, dates and course snapshots survive without copying legacy choices', async () => {
  const expected = beforeRows.registrations.map(({ preferences, selected_courses, ...record }) => record)
  assert.deepEqual(await rows('student_registrations'), expected)
  const expectedPreferences = beforeRows.preferences.map(({ allocation_metadata, ...record }) => ({ ...record, legacy_allocation_metadata_snapshot: allocation_metadata }))
  assert.deepEqual(await rows('registration_preferences'), expectedPreferences)
  assert.deepEqual(await rows('system_logs'), beforeRows.logs)
  assert.deepEqual(await rows('courses'), beforeRows.courses.map(({ tag, ...record }) => record))
})

test('old-only blueprints convert and existing JSON pathways stay unchanged', async () => {
  const blueprints = await rows('semester_blueprints')
  assert.deepEqual(blueprints[0].pathways, [{ id: 'legacy-default', name: 'Default', slots: [{ rule: 'FIXED', target: 'CLEAN101', name: 'Old paper' }] }])
  assert.equal(blueprints[1].pathways[0].id, 'preserved')
  assert.equal(blueprints[1].pathways[0].slots[0].name, 'Existing paper')
})

test('atomic submission and editing use only current preferences and preserve the first timestamp', async () => {
  const submit = timestamp => db.query(`SELECT public.submit_student_registration($1,$2,1::smallint,'2026-27','legacy-default',$3::jsonb,$4::jsonb,$5::jsonb,4,$6::timestamptz) AS result`,
    [uid(6), uid(1), JSON.stringify({ slot_1: [{ course_id: uid(10), rank: 1 }] }), JSON.stringify({ slot_1: { allocated_by: 'fixed' } }), JSON.stringify({ slot_1: uid(10) }), timestamp])
  assert.equal((await submit('2026-02-01T00:00:00Z')).rows[0].result.success, true)
  assert.equal((await submit('2026-03-01T00:00:00Z')).rows[0].result.success, true)
  const record = (await db.query(`SELECT submitted_at,preferences,legacy_allocation_metadata_snapshot FROM public.registration_preferences WHERE student_id='${uid(6)}'`)).rows[0]
  assert.equal(record.submitted_at.toISOString().slice(0, 10), '2026-02-01')
  assert.equal(record.preferences.slot_1[0].course_id, uid(10))
  assert.equal(record.legacy_allocation_metadata_snapshot, null)
})

test('manual placement and student changes work without the retired preference metadata column', async () => {
  const manual = await db.query(`SELECT public.execute_manual_course_allocation($1,$2,1::smallint,'2026-27','slot_1',$3,$4,'hod','hod') AS result`, [uid(4), uid(1), uid(11), uid(3)])
  assert.equal(manual.rows[0].result.success, true)
  const changed = await db.query(`SELECT public.execute_student_course_change($1,$2,1::smallint,'2026-27','slot_1',$3,'cleanup-change') AS result`, [uid(5), uid(1), uid(11)])
  assert.equal(changed.rows[0].result.success, true)
  const snapshot = (await db.query(`SELECT legacy_allocation_metadata_snapshot FROM public.registration_preferences WHERE student_id='${uid(5)}'`)).rows[0]
  assert.equal(snapshot.legacy_allocation_metadata_snapshot.slot_1.allocated_by, 'unallocated')
})

test('graduation derives candidate lists from candidate records and supports retries', async () => {
  const args = [uid(1), [uid(7)], uid(3)]
  const prepare = () => db.query('SELECT public.prepare_graduation($1,$2::uuid[],$3) AS result', args)
  assert.equal((await prepare()).rows[0].result[0].student_id, uid(7))
  assert.equal((await prepare()).rows[0].result.length, 1)
  await db.query('SELECT public.graduate_candidate_database($1,$2)', [uid(1), uid(7)])
  await db.query('SELECT public.finish_graduation_candidate($1,$2,NULL)', [uid(1), uid(7)])
  const operations = await rows('graduation_operations')
  assert.equal(operations[0].status, 'completed')
  assert.equal(operations[0].graduated_count, 1)
  assert.equal(Object.hasOwn(operations[0], 'candidate_student_ids'), false)
})

test('allocation status keeps the previous response shape from canonical log metadata', () => {
  const { allocationRunResponse } = require('../backend/dist/core/logging/allocation-run')
  const response = allocationRunResponse({ id: 'run', user_id: 'director', started_at: 'now', metadata: { total_students: 4, fully_allocated: 3, partially_allocated: 1, summary: { allocated_slots_count: 20 } } })
  assert.equal(Object.hasOwn(response, 'metadata'), false)
  assert.equal(Object.hasOwn(response, 'triggered_by'), false)
  assert.equal(response.triggered_at, 'now')
  assert.equal(response.total_students, 4)
  assert.deepEqual(response.summary, { allocated_slots_count: 20 })
  assert.equal(allocationRunResponse(null), null)
})
