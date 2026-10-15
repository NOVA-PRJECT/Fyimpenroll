const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true })
const { TimetableService } = require('../src/modules/timetable/timetable.service')
const { PeriodAttendanceService } = require('../src/modules/period-attendance/period-attendance.service')

function database(tables, publish) {
  const calls = []
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.from = 0; this.to = Infinity }
    select(_columns, options) { this.head = options?.head; return this }
    eq(key, value) { this.filters.push(row => row[key] === value); return this }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this }
    order() { return this }
    limit(count) { this.to = count - 1; return this }
    range(from, to) { this.from = from; this.to = to; return this }
    or(expression) {
      const teacher = /teacher_id.eq.([^,]+)/.exec(expression)?.[1]
      const ids = /course_id.in.\(([^)]+)\)/.exec(expression)?.[1].split(',') || []
      this.filters.push(row => row.teacher_id === teacher || ids.includes(row.course_id))
      return this
    }
    result() {
      const rows = (tables[this.table] || []).filter(row => this.filters.every(filter => filter(row)))
      return { data: this.head ? null : rows.slice(this.from, this.to + 1), count: rows.length, error: null }
    }
    then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject) }
    async maybeSingle() { const result = this.result(); return { ...result, data: result.data?.[0] ?? null } }
  }
  return { calls, from: table => new Query(table), rpc: async (name, args) => { calls.push(name); return publish?.(name, args) ?? { data: null, error: null } } }
}
const director = { userId: 'director', role: 'campus_director', campus_id: 'campus', email: '' }
const logger = { log: async () => {}, warn() {}, error() {} }
const service = db => new TimetableService({ admin: db }, logger, logger)

test('rejects a success response when the RPC left sessions as drafts', async () => {
  const db = database({ timetable_entries: [], system_logs: [] }, () => ({ data: { success: true, published_count: 2 }, error: null }))
  await assert.rejects(service(db).publish('2026-27', 3, director), /Publication could not be verified/)
})

test('rejects zero-row publication without reporting success', async () => {
  const db = database({ system_logs: [] }, () => ({ data: { success: true, published_count: 0 }, error: null }))
  await assert.rejects(service(db).publish('2026-27', 3, director), /did not commit any/)
})

test('returns success only for the exact number of saved published sessions', async () => {
  const rows = [1, 2].map(id => ({ id, campus_id: 'campus', academic_year: '2026-27', semester: 3, status: 'published' }))
  const db = database({ timetable_entries: rows, system_logs: [] }, () => ({ data: { success: true, published_count: 2, published_at: '2026-10-15' }, error: null }))
  assert.equal((await service(db).publish('2026-27', 3, director)).publishedCount, 2)
})

test('blocks regeneration of a published cohort before claiming a worker', async () => {
  const db = database({ timetable_entries: [{ id: 1, campus_id: 'campus', academic_year: '2026-27', semester: 3, status: 'published' }] })
  await assert.rejects(service(db).generate('2026-27', 3, [], director), /already published/)
  assert.deepEqual(db.calls, [])
})

test('students receive only their registered published courses, including courses owned elsewhere', async () => {
  const base = { campus_id: 'campus', academic_year: '2026-27', semester: 3, department_id: 'other-department', time_slots: { day_of_week: 1, period_number: 2 }, courses: { id: 'elective', course_code: 'E1', title: 'Elective' } }
  const db = database({
    departments: [{ id: 'home', campus_id: 'campus' }],
    student_registrations: [{ id: 1, student_id: 'student', campus_id: 'campus', academic_year: '2026-27', semester: 3, slot_8_course_id: 'elective' }],
    timetable_entries: [
      { ...base, id: 1, course_id: 'elective', status: 'published' },
      { ...base, id: 2, course_id: 'not-enrolled', status: 'published' },
      { ...base, id: 3, course_id: 'elective', status: 'draft' },
      { ...base, id: 4, course_id: 'elective', status: 'published', campus_id: 'other-campus' },
    ],
  })
  const result = await service(db).getEntries('2026-27', 3, 'home', { userId: 'student', role: 'student', campus_id: 'campus', department_id: 'home' })
  assert.deepEqual(result.entries.map(row => row.id), [1])
  assert.deepEqual(result.conflicts, [])
})

test('a teacher sees direct published assignments without a separate assignment record', async () => {
  const db = database({ timetable_entries: [{ id: 'session', teacher_id: 'teacher', course_id: 'course', semester: 3, status: 'published', time_slots: { day_of_week: 1, period_number: 1 } }] })
  const result = await new PeriodAttendanceService({ admin: db }, logger, logger).getTeacherSchedule({ userId: 'teacher' }, '2026-10-18')
  assert.equal(result.weeklySchedule.length, 1)
  assert.equal(result.weeklySchedule[0].course_semester, 3)
})

test('an older course assignment cannot expose another teacher’s substituted sessions', async () => {
  const db = database({
    teacher_course_assignments: [{ teacher_id: 'teacher', course_id: 'course', campus_id: 'campus', academic_year: '2026-27', semester: 3, courses: { id: 'course' } }],
    timetable_entries: [{ id: 'session', teacher_id: 'replacement', course_id: 'course', campus_id: 'campus', academic_year: '2026-27', semester: 3, status: 'published' }],
  })
  const result = await new PeriodAttendanceService({ admin: db }, logger, logger).getTeacherSchedule({ userId: 'teacher' }, '2026-10-18')
  assert.deepEqual(result.weeklySchedule, [])
})

// Optional isolated PostgreSQL execution; no connection to the live database.
// Install once: npm install --prefix scratch/timetable-publication-runtime --no-save --package-lock=false --ignore-scripts @electric-sql/pglite
const pgRuntime = path.resolve(__dirname, '../../scratch/timetable-publication-runtime/node_modules/@electric-sql/pglite')
test('PostgreSQL repair persists publication, locks the cohort and rolls back silent trigger failures', { skip: !fs.existsSync(pgRuntime) }, async () => {
  const { PGlite } = require(pgRuntime)
  const db = new PGlite()
  const campus = '00000000-0000-4000-8000-000000000001'
  const department = '00000000-0000-4000-8000-000000000002'
  const course = '00000000-0000-4000-8000-000000000003'
  const user = '00000000-0000-4000-8000-000000000004'
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE schema_migrations(version text PRIMARY KEY, name text);
      CREATE TABLE departments(id uuid PRIMARY KEY, campus_id uuid);
      CREATE TABLE courses(id uuid PRIMARY KEY, department_id uuid);
      CREATE TABLE campus_settings(campus_id uuid, deadline timestamptz);
      CREATE TABLE system_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), log_type text, campus_id uuid,
        academic_year text, semester int, status text, user_id uuid, metadata jsonb, started_at timestamptz,
        completed_at timestamptz, created_at timestamptz, updated_at timestamptz, progress int, error_message text);
      CREATE TABLE timetable_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campus_id uuid, academic_year text,
        semester int, course_id uuid, department_id uuid, time_slot_id uuid DEFAULT gen_random_uuid(),
        session_type text DEFAULT 'theory', is_lab_block boolean DEFAULT false, teacher_id uuid,
        status text DEFAULT 'draft', published_at timestamptz);
      CREATE TABLE timetable_conflicts(academic_year text, semester int, course_id uuid, resolved boolean);
      INSERT INTO departments VALUES ('${department}','${campus}');
      INSERT INTO courses VALUES ('${course}','${department}');
      INSERT INTO campus_settings VALUES ('${campus}', now()-interval '1 day');
      INSERT INTO timetable_entries(campus_id,academic_year,semester,course_id,department_id)
        VALUES ('${campus}','2026-27',3,'${course}','${department}');
      INSERT INTO system_logs(log_type,campus_id,academic_year,semester,status,completed_at,metadata)
        SELECT 'timetable_job','${campus}','2026-27',3,'completed',now(),
          jsonb_build_object('draft_hash',md5(string_agg(e::text, ',' ORDER BY e.id))) FROM timetable_entries e;
      CREATE FUNCTION trg_prevent_published_timetable_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$;
      CREATE TRIGGER legacy_publication_guard BEFORE UPDATE ON timetable_entries
        FOR EACH ROW EXECUTE FUNCTION trg_prevent_published_timetable_mutation();
    `)
    const original = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/20261010080000_production_timetable_transactions.sql'), 'utf8')
    function sqlFunction(name) {
      const start = original.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`)
      assert.ok(start >= 0)
      return original.slice(start, original.indexOf('$$;', start) + 3)
    }
    await db.exec(sqlFunction('public.publish_timetable_cohort'))
    const publish = sem => db.query('SELECT public.publish_timetable_cohort($1,$2,$3) AS result', [campus, '2026-27', sem])
    assert.equal((await publish(3)).rows[0].result.published_count, 1)
    assert.equal((await db.query('SELECT status FROM timetable_entries')).rows[0].status, 'draft', 'legacy trigger reproduces false success')
    const migration = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/20261015010000_verified_timetable_publication.sql'), 'utf8')
    await db.exec(migration)
    assert.equal((await publish(3)).rows[0].result.published_count, 1)
    assert.equal((await db.query('SELECT status FROM timetable_entries')).rows[0].status, 'published')
    await assert.rejects(publish(3), /already published/)
    await assert.rejects(db.exec("UPDATE timetable_entries SET status='draft'"), /cannot be changed/)
    await assert.rejects(db.exec('DELETE FROM timetable_entries'), /cannot be deleted/)
    await db.exec(`UPDATE timetable_entries SET teacher_id='${user}'`)
    await db.exec(sqlFunction('claim_timetable_generation_job'))
    await assert.rejects(db.query('SELECT claim_timetable_generation_job($1,$2,$3::smallint,$4)', [campus, '2026-27', 3, user]), /published timetable already exists/)
    await assert.rejects(publish(5), /No verified current draft/)

    await db.exec(`
      INSERT INTO timetable_entries(campus_id,academic_year,semester,course_id,department_id)
        VALUES ('${campus}','2026-27',4,'${course}','${department}');
      INSERT INTO system_logs(log_type,campus_id,academic_year,semester,status,completed_at,metadata)
        SELECT 'timetable_job','${campus}','2026-27',4,'completed',now(),
          jsonb_build_object('draft_hash',md5(string_agg(e::text, ',' ORDER BY e.id))) FROM timetable_entries e WHERE semester=4;
      CREATE FUNCTION unrelated_broken_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.semester=4 THEN RETURN OLD; END IF; RETURN NEW; END $$;
      CREATE TRIGGER unrelated_trigger BEFORE UPDATE ON timetable_entries FOR EACH ROW EXECUTE FUNCTION unrelated_broken_trigger();
    `)
    await assert.rejects(publish(4), /did not persist every verified session/)
    assert.equal((await db.query('SELECT status FROM timetable_entries WHERE semester=4')).rows[0].status, 'draft')
    await db.exec(migration) // The repair is safe to apply again and preserves unrelated triggers.
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='unrelated_trigger'")).rows[0].n, 1)
  } finally { await db.close() }
})
