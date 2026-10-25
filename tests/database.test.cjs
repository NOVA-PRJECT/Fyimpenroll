const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
let db

before(async () => {
  db = new PGlite({ extensions: { 'uuid-ossp': uuid_ossp, pgcrypto } })
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);`)
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/baseline/schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/baseline/reference-data.sql'), 'utf8'))
  for (const filename of fs.readdirSync(path.join(__dirname, '../supabase/migrations')).filter(name => name > '20261020135038\uffff').sort()) {
    if (filename.endsWith('_plain_course_prerequisites.sql')) {
      await db.exec(`INSERT INTO public.campuses(id,name,code) VALUES ('00000000-0000-4000-8000-000000900001','Legacy campus','LEGACY');
        INSERT INTO public.departments(id,name,code,campus_id) VALUES ('00000000-0000-4000-8000-000000900002','Legacy dept','LEGACY','00000000-0000-4000-8000-000000900001');
        INSERT INTO public.courses(id,course_code,title,department_id,semester,credits,category) VALUES
          ('00000000-0000-4000-8000-000000900003','LEGACY1','Prior course','00000000-0000-4000-8000-000000900002',1,4,'DSC'),
          ('00000000-0000-4000-8000-000000900004','LEGACY2','Later course','00000000-0000-4000-8000-000000900002',2,4,'DSC');
        UPDATE public.courses SET prerequisite_course_ids=ARRAY['00000000-0000-4000-8000-000000900003'::uuid] WHERE course_code='LEGACY2';
        INSERT INTO public.course_prerequisite_rules(course_id,rule,target) VALUES
          ('00000000-0000-4000-8000-000000900004','DEPARTMENT','LEGACY'),
          ('00000000-0000-4000-8000-000000900004','COMPLETED_COURSE','LEGACY1');`)
    }
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', filename), 'utf8'))
  }
})
after(async () => { await db?.close() })

test('complete schema restores into an empty database and passes readiness', async () => {
  assert.equal((await db.query('SELECT public.production_readiness() AS status')).rows[0].status.ready, true)
  assert.equal((await db.query('SELECT count(*)::integer AS periods FROM public.time_slots')).rows[0].periods, 30)
  const denied = await db.query(`SELECT count(*)::integer AS exposed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','v') AND
    (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))`)
  assert.equal(denied.rows[0].exposed, 0)
})

const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
async function fixture(n, secondEntry = false) {
  const ids = Object.fromEntries(['campus','department','hod','teacher','replacement','student','course','otherCourse','slot','entry','otherEntry'].map((key, i) => [key, uid(n * 100 + i + 1)]))
  await db.exec(`INSERT INTO auth.users(id) VALUES ('${ids.hod}'),('${ids.teacher}'),('${ids.replacement}'),('${ids.student}');
    INSERT INTO public.campuses(id,name,code) VALUES ('${ids.campus}','Campus ${n}','C${n}');
    INSERT INTO public.departments(id,name,code,campus_id) VALUES ('${ids.department}','Department ${n}','D${n}','${ids.campus}');
    INSERT INTO public.faculty(id,full_name,email,role,department_id,campus_id) VALUES
      ('${ids.hod}','HOD','hod${n}@example.test','hod','${ids.department}','${ids.campus}'),
      ('${ids.teacher}','Teacher','teacher${n}@example.test','teacher','${ids.department}','${ids.campus}'),
      ('${ids.replacement}','Replacement','replacement${n}@example.test','teacher','${ids.department}','${ids.campus}');
    INSERT INTO public.students(id,full_name,cap_application_number,academic_year_joined,department_id,campus_id)
      VALUES ('${ids.student}','Student','CAP${n}','2026-27','${ids.department}','${ids.campus}');
    INSERT INTO public.courses(id,course_code,title,department_id,semester,credits,category) VALUES
      ('${ids.course}','TEST${n}A','Course A','${ids.department}',1,4,'DSC'),
      ('${ids.otherCourse}','TEST${n}B','Course B','${ids.department}',1,4,'DSC');`)
  const slot = (await db.query(`SELECT id FROM public.time_slots WHERE day_of_week=1 AND period_number=1`)).rows[0]
  if (slot) ids.slot = slot.id
  else await db.exec(`INSERT INTO public.time_slots(id,day_of_week,period_number,start_time,end_time) VALUES ('${ids.slot}',1,1,'09:30','10:30')`)
  await db.exec(`INSERT INTO public.timetable_entries(id,academic_year,semester,course_id,department_id,campus_id,time_slot_id,status,teacher_id)
    VALUES ('${ids.entry}','2026-27',1,'${ids.course}','${ids.department}','${ids.campus}','${ids.slot}','draft','${ids.teacher}')`)
  if (secondEntry) await db.exec(`INSERT INTO public.timetable_entries(id,academic_year,semester,course_id,department_id,campus_id,time_slot_id,status)
    VALUES ('${ids.otherEntry}','2026-27',1,'${ids.otherCourse}','${ids.department}','${ids.campus}','${ids.slot}','draft')`)
  await db.exec(`UPDATE public.timetable_entries SET status='published',published_at=now() WHERE id='${ids.entry}'`)
  return ids
}
const mutate = (ids, operation, overrides = {}) => db.query(`SELECT public.mutate_teacher_assignments($1,$2,$3::jsonb,$4,$5,$6) AS result`,
  [ids.hod, operation, JSON.stringify(overrides.items || []), overrides.assignment || null, overrides.entry || ids.entry, overrides.teacher === undefined ? ids.replacement : overrides.teacher])

test('substitution rejects student identities and preserves the existing teacher', async () => {
  const ids = await fixture(1)
  await assert.rejects(mutate(ids, 'substitute', { teacher: ids.student }), error => error.code === '23514')
  assert.equal((await db.query('SELECT teacher_id FROM public.timetable_entries WHERE id=$1', [ids.entry])).rows[0].teacher_id, ids.teacher)
})

test('substitution updates assignment and timetable together and preserves entry identity', async () => {
  const ids = await fixture(2)
  await mutate(ids, 'substitute')
  assert.equal((await db.query('SELECT teacher_id FROM public.timetable_entries WHERE id=$1', [ids.entry])).rows[0].teacher_id, ids.replacement)
  assert.equal((await db.query('SELECT teacher_id FROM public.teacher_course_assignments WHERE course_id=$1', [ids.course])).rows[0].teacher_id, ids.replacement)
})

test('a failed assignment insert rolls back the earlier timetable write', async () => {
  const ids = await fixture(3)
  await db.exec(`CREATE FUNCTION public.fail_test_assignment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected assignment failure'; END $$;
    CREATE TRIGGER zz_test_failure BEFORE INSERT ON public.teacher_course_assignments FOR EACH ROW EXECUTE FUNCTION public.fail_test_assignment();`)
  try {
    await assert.rejects(mutate(ids, 'substitute'), /injected assignment failure/)
    assert.equal((await db.query('SELECT teacher_id FROM public.timetable_entries WHERE id=$1', [ids.entry])).rows[0].teacher_id, ids.teacher)
  } finally { await db.exec('DROP TRIGGER zz_test_failure ON public.teacher_course_assignments; DROP FUNCTION public.fail_test_assignment()') }
})

test('competing substitutions cannot double-book a teacher across classes', async () => {
  const ids = await fixture(4, true)
  const results = await Promise.allSettled([mutate(ids, 'substitute'), mutate(ids, 'substitute', { entry: ids.otherEntry })])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.code, '23P01')
})

test('reassignment revokes the old teacher and deletion clears timetable authority', async () => {
  const ids = await fixture(5)
  const initial = await mutate(ids, 'assign', { items: [{ teacher_id: ids.teacher, course_id: ids.course, campus_id: ids.campus, academic_year: '2026-27', semester: 1 }] })
  const assignment = initial.rows[0].result.assignment.id
  await mutate(ids, 'reassign', { assignment })
  assert.equal((await db.query('SELECT teacher_id FROM public.timetable_entries WHERE id=$1', [ids.entry])).rows[0].teacher_id, ids.replacement)
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.teacher_course_assignments WHERE teacher_id=$1 AND course_id=$2', [ids.teacher, ids.course])).rows[0].n, 0)
  await mutate(ids, 'remove', { assignment })
  assert.equal((await db.query('SELECT teacher_id FROM public.timetable_entries WHERE id=$1', [ids.entry])).rows[0].teacher_id, null)
})

test('batch assignment rolls back earlier items when a later course is outside scope', async () => {
  const ids = await fixture(6)
  const other = await fixture(7)
  await assert.rejects(mutate(ids, 'batch', { items: [
    { teacher_id: ids.replacement, course_id: ids.course, campus_id: ids.campus, academic_year: '2026-27', semester: 1 },
    { teacher_id: ids.replacement, course_id: other.course, campus_id: other.campus, academic_year: '2026-27', semester: 1 },
  ] }), error => error.code === 'P4030')
  assert.equal((await db.query('SELECT teacher_id FROM public.timetable_entries WHERE id=$1', [ids.entry])).rows[0].teacher_id, ids.teacher)
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM public.teacher_course_assignments WHERE course_id=$1', [ids.course])).rows[0].n, 0)
})


test('plain prerequisite lists validate and update atomically without retired rule structures', async () => {
  const ids = await fixture(20)
  assert.equal((await db.query("SELECT to_regclass('public.course_prerequisite_rules') AS old_table")).rows[0].old_table, null)
  assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='courses' AND column_name='prerequisite_course_ids'")).rows[0].n, 0)
  const update = points => db.query('SELECT public.update_hod_course_guarded($1,$2,$3::jsonb)', [ids.course, ids.department, JSON.stringify(points)])
  const points = ['Know C.', 'Understand algorithms.']
  await update({ prerequisites: points })
  await update({ title: 'Updated course' })
  assert.deepEqual((await db.query('SELECT prerequisites FROM public.courses WHERE id=$1', [ids.course])).rows[0].prerequisites, points)
  for (const prerequisites of [null, {}, [''], [' spaced '], [5], ['x'.repeat(501)], Array(21).fill('Know C.')]) {
    await assert.rejects(update({ title: 'Must roll back', prerequisites }), error => error.code === '23514' || error.code === '23502')
    assert.equal((await db.query('SELECT title FROM public.courses WHERE id=$1', [ids.course])).rows[0].title, 'Updated course')
  }
  await update({ prerequisites: [] })
  assert.deepEqual((await db.query('SELECT prerequisites FROM public.courses WHERE id=$1', [ids.course])).rows[0].prerequisites, [])
  await assert.rejects(db.query('SELECT public.update_hod_course_guarded($1,$2,$3::jsonb)', [ids.course, ids.otherCourse, '{}']), error => error.code === 'P4040')
  await assert.rejects(db.query('UPDATE public.courses SET semester=2 WHERE id=$1', [ids.course]), error => error.code === 'P4090')
  // A free-text mention of a code must never create a relational dependency.
  await update({ prerequisites: ['Knowledge related to TEST20B is useful.'] })
  assert.deepEqual((await db.query('SELECT public.course_usage_types($1) AS usage', [ids.otherCourse])).rows[0].usage, [])
})


test('migration clears existing legacy configurations instead of converting them into restrictions', async () => {
  const legacy = (await db.query("SELECT prerequisites FROM public.courses WHERE course_code='LEGACY2'")).rows[0]
  assert.deepEqual(legacy.prerequisites, [])
  assert.deepEqual((await db.query("SELECT public.course_usage_types('00000000-0000-4000-8000-000000900003') AS usage")).rows[0].usage, [])
  await db.exec("UPDATE public.courses SET semester=3 WHERE course_code='LEGACY2'")
})
