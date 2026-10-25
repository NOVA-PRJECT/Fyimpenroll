const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const root = path.join(__dirname, '..')
const read = name => fs.readFileSync(path.join(root,name), 'utf8')
const assert = require('node:assert/strict')
const { PGlite } = require('@electric-sql/pglite')
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
test('Semester 4 guidance updates exactly the reviewed catalogue and survives legacy retirement', async () => {
 const db = new PGlite({ extensions: { 'uuid-ossp': uuid_ossp, pgcrypto } })
 try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);")
  await db.exec(read('supabase/baseline/schema.sql'))
  await db.exec(read('supabase/migrations/20261022141208_atomic_teacher_changes.sql'))
  const campus=(await db.query("INSERT INTO public.campuses(name,code) VALUES('QA','QA') RETURNING id")).rows[0].id
  const dept=(await db.query("INSERT INTO public.departments(name,code,campus_id) VALUES('QA','QA',$1) RETURNING id",[campus])).rows[0].id
  const { courses }=JSON.parse(read('scripts/data/semester-4-prerequisites.json'))
  for(const c of courses) await db.query("INSERT INTO public.courses(course_code,title,department_id,semester,credits,category) VALUES($1,$2,$3,4,4,'DSC')",[c.course_code,c.title,dept])
  await db.query("INSERT INTO public.courses(course_code,title,department_id,semester,credits,category) VALUES('QA_PRIOR','Prior',$1,3,4,'DSC')",[dept])
  await db.exec(read('supabase/migrations/20261025044031_plain_course_prerequisites.sql'))
  assert.ok((await db.query("SELECT to_regclass('public.course_prerequisite_rules') AS name")).rows[0].name)
  await db.exec(read('supabase/data/semester_4_prerequisites.sql'))
  const saved=(await db.query('SELECT course_code,prerequisites FROM public.courses WHERE semester=4')).rows
  assert.equal(saved.length,38)
  for(const row of saved) assert.deepEqual(row.prerequisites,courses.find(c=>c.course_code===row.course_code).prerequisites)
  assert.deepEqual((await db.query("SELECT prerequisites FROM public.courses WHERE course_code='QA_PRIOR'")).rows[0].prerequisites,[])
  await assert.rejects(db.exec(read('supabase/data/semester_4_prerequisites.sql')), /Existing Semester 4 prerequisites/)
  await db.exec('ROLLBACK')
  await db.exec(read('supabase/migrations/20261025044158_retire_legacy_course_prerequisites.sql'))
  for(const row of (await db.query('SELECT course_code,prerequisites FROM public.courses WHERE semester=4')).rows) assert.deepEqual(row.prerequisites,courses.find(c=>c.course_code===row.course_code).prerequisites)
  await db.exec(read('supabase/migrations/20261025062135_consolidate_application_schema.sql'))
  for(const row of (await db.query('SELECT course_code,prerequisites FROM public.courses WHERE semester=4')).rows) assert.deepEqual(row.prerequisites,courses.find(c=>c.course_code===row.course_code).prerequisites)
  assert.equal((await db.query('SELECT public.production_readiness() AS readiness')).rows[0].readiness.ready,true)

 } finally { await db.close() }
})
