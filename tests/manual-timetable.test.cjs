const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const { validateManualEntries } = require('../backend/dist/modules/timetable/solver/manual-validation.js')
const { ManualTimetableSchema } = require('../backend/dist/modules/timetable/solver/schemas.js')
const { mutateTeacherAssignments } = require('../backend/dist/core/database/teacher-mutations.js')
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/src/modules/timetable/solver/constraints.base.json'))).rules
let db, serial = 0
const uid = n => `00000000-0000-4000-8000-${String(800000 + n).padStart(12, '0')}`
const entry = (courseId, period = 1, sessionType = 'theory', day = 1) => ({ courseId, day, period, sessionType, isLabBlock: sessionType === 'practical' })
const course = (id, extra = {}) => ({ courseId: id, courseCode: id, courseTitle: id, category: 'DSC', departmentId: 'dept',
  departmentName: 'Department', theoryHours: 1, practicalHours: 0, studentIds: new Set(['student']), teacherId: 'teacher', ...extra })
const slots = new Map(Array.from({ length: 5 }, (_, day) => [day + 1, new Map(Array.from({ length: 6 }, (_, period) => [period + 1, `slot-${day}-${period}`]))]))
const validate = (entries, courses, groups = [], reservations = [], semester = 1, effectiveRules = rules) =>
  validateManualEntries(entries, courses, slots, groups, reservations, semester, effectiveRules)
before(async () => {
  db = new PGlite({ extensions: { 'uuid-ossp': uuid_ossp, pgcrypto } })
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);')
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/baseline/schema.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/baseline/reference-data.sql'), 'utf8'))
  for (const file of fs.readdirSync(path.join(__dirname, '../supabase/migrations')).sort().filter(file => file > '20261020135038\uffff')) {
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8'))
  }
  for (const file of ['semester_lifecycle.sql', 'manual_timetable.sql']) await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/changes', file), 'utf8'))
})
after(async () => { await db?.close() })

async function fixture() {
  const n = ++serial
  const ids = Object.fromEntries(['campus', 'dept', 'director', 'hod', 'teacher', 'student', 'courseA', 'courseB', 'assignmentA', 'assignmentB', 'job'].map((name, index) => [name, uid(n * 100 + index)]))
  await db.exec(`INSERT INTO public.campuses(id,name,code) VALUES('${ids.campus}','Manual ${n}','M${n}');
    UPDATE public.campus_settings SET academic_year='2026-27',deadline=now()-interval '1 day' WHERE campus_id='${ids.campus}';
    INSERT INTO public.departments(id,name,code,campus_id) VALUES('${ids.dept}','Manual department ${n}','MD${n}','${ids.campus}');
    INSERT INTO auth.users(id) VALUES('${ids.director}'),('${ids.hod}'),('${ids.teacher}'),('${ids.student}');
    INSERT INTO public.faculty(id,full_name,email,role,department_id,campus_id) VALUES
    ('${ids.director}','Director','md${n}@example.test','campus_director',NULL,'${ids.campus}'),
    ('${ids.hod}','HOD','mh${n}@example.test','hod','${ids.dept}','${ids.campus}'),
    ('${ids.teacher}','Teacher','mt${n}@example.test','teacher','${ids.dept}','${ids.campus}');
    INSERT INTO public.students(id,full_name,cap_application_number,academic_year_joined,department_id,campus_id,current_semester)
    VALUES('${ids.student}','Student','MS${n}','2026-27','${ids.dept}','${ids.campus}',1);
    INSERT INTO public.courses(id,course_code,title,department_id,semester,credits,category,theory_hours_per_week,practical_hours_per_week)
    VALUES('${ids.courseA}','MA${n}','Course A','${ids.dept}',1,4,'DSC',1,0),('${ids.courseB}','MB${n}','Course B','${ids.dept}',1,4,'DSC',1,0);
    INSERT INTO public.student_registrations(student_id,campus_id,semester,academic_year,slot_1_course_id,slot_2_course_id,total_credits)
    VALUES('${ids.student}','${ids.campus}',1,'2026-27','${ids.courseA}','${ids.courseB}',8);
    INSERT INTO public.teacher_course_assignments(id,teacher_id,course_id,campus_id,academic_year,semester)
    VALUES('${ids.assignmentA}','${ids.teacher}','${ids.courseA}','${ids.campus}','2026-27',1),
    ('${ids.assignmentB}','${ids.teacher}','${ids.courseB}','${ids.campus}','2026-27',1);
    INSERT INTO public.system_logs(id,log_type,status,campus_id,academic_year,semester,metadata)
    VALUES('${ids.job}','timetable_job','failed','${ids.campus}','2026-27',1,'{}');`)
  ids.entries = [entry(ids.courseA), entry(ids.courseB, 2)]
  ids.courses = [course(ids.courseA, { teacherId: ids.teacher, studentIds: new Set([ids.student]), departmentId: ids.dept }),
    course(ids.courseB, { teacherId: ids.teacher, studentIds: new Set([ids.student]), departmentId: ids.dept })]
  return ids
}
async function context(ids, actor = ids.director, term = 0) {
  return (await db.query('SELECT public.timetable_manual_context($1,\'2026-27\',1,$2,$3) value', [ids.campus, actor, term])).rows[0].value
}
function draft(ids, entries = ids.entries, mode = 'follow_rules', reason = '') {
  return { entries, mode, reason, rules, report: validate(entries, ids.courses), savedBy: ids.director, savedAt: new Date().toISOString() }
}
async function commit(ids, value, publish = false, revision) {
  return (await db.query('SELECT public.commit_manual_timetable($1,\'2026-27\',1,$2,0,$3,$4::jsonb,$5) value',
    [ids.campus, ids.director, revision ?? (await context(ids)).revision, JSON.stringify(value), publish])).rows[0].value
}

test('manual SQL restores with backend-only routines and passes readiness', async () => {
  assert.equal((await db.query('SELECT public.production_readiness() value')).rows[0].value.ready, true)
  const ids = await fixture()
  await db.exec('SET ROLE service_role')
  try { assert.ok((await context(ids)).revision) } finally { await db.exec('RESET ROLE') }
  await db.exec('SET ROLE authenticated')
  try { await assert.rejects(context(ids), /permission denied/) } finally { await db.exec('RESET ROLE') }
})
test('draft validation permits missing hours but blocks student and teacher clashes', () => {
  const courses = [course('a'), course('b')]
  const incomplete = validate([entry('a')], courses)
  assert.equal(incomplete.unscheduledPeriods, 1)
  assert.equal(incomplete.blockingViolations.length, 0)
  assert.ok(incomplete.violations.some(item => item.type === 'unplaced_course'))
  const invalid = validate([entry('a'), entry('b')], courses)
  assert.ok(invalid.blockingViolations.some(item => item.type === 'student_conflict'))
  assert.ok(invalid.blockingViolations.some(item => item.type === 'teacher_conflict'))
})
test('parallel baskets stay synchronized across departments and preserve complete lab blocks', () => {
  const courses = [course('a', { category: 'MDC', theoryHours: 1, departmentId: 'a', studentIds: new Set(['a']), teacherId: 'a' }),
    course('b', { category: 'MDC', theoryHours: 1, departmentId: 'b', studentIds: new Set(['b']), teacherId: 'b' })]
  assert.ok(validate([entry('a')], courses).blockingViolations.some(item => item.type === 'category_slot_mismatch'))
  assert.equal(validate([entry('a'), entry('b')], courses).blockingViolations.length, 0)
  const lab = course('lab', { theoryHours: 0, practicalHours: 2 })
  assert.ok(validate([entry('lab', 3, 'practical'), entry('lab', 4, 'practical')], [lab]).violations.some(item => item.type === 'lunch_overlap'))
  assert.ok(validate([entry('lab', 1, 'practical')], [lab]).blockingViolations.some(item => item.type === 'invalid_lab_block'))
  const alternatives = [course('lab', { category: 'SEC', theoryHours: 0, practicalHours: 2, studentIds: new Set(['lab']), teacherId: 'lab' }),
    course('theory', { category: 'SEC', theoryHours: 2, studentIds: new Set(['theory']), teacherId: 'theory' })]
  assert.equal(validate([entry('lab', 1, 'practical'), entry('lab', 2, 'practical'), entry('theory', 1), entry('theory', 2)], alternatives).violations.length, 0)
})
test('semester/custom windows and published reservations apply to manual placement', () => {
  assert.ok(validate([entry('vac', 1)], [course('vac', { category: 'VAC' })], [], [], 3).violations.some(item => item.type === 'invalid_window'))
  const custom = [{ id: 'Friday', kind: 'DAY_WINDOW', scope: 'campus', isHard: true, description: 'Friday only', version: 1, parameters: { days: [5] } }]
  assert.ok(validate([entry('a')], [course('a')], [], [], 1, custom).violations.some(item => item.type === 'invalid_window'))
  assert.ok(validate([entry('a')], [course('a')], [], [{ teacherId: 'teacher', day: 1, period: 1 }]).violations.some(item => item.type === 'teacher_conflict'))
})
test('MDC theory blocks are consecutive, avoid lunch, and soft windows remain warnings', () => {
  const mdc = course('mdc', { category: 'MDC', theoryHours: 3 })
  for (const periods of [[1, 3], [3, 4]]) {
    assert.ok(validate([...periods.map(period => entry('mdc', period)), entry('mdc', 1, 'theory', 2)], [mdc])
      .blockingViolations.some(item => item.type === 'invalid_window'))
  }
  assert.equal(validate([entry('mdc', 1), entry('mdc', 2), entry('mdc', 1, 'theory', 2)], [mdc]).violations.length, 0)
  const soft = [{ id: 'soft', kind: 'DAY_WINDOW', scope: 'campus', isHard: false, description: 'Prefer Friday', parameters: { days: [5] } }]
  const report = validate([entry('a')], [course('a')], [], [], 1, soft)
  assert.equal(report.violations.length, 0); assert.equal(report.warnings.length, 1)
})
test('identity, unavailable slots, duplicate entries and teacher injection cannot be overridden', () => {
  assert.throws(() => validate([entry('outside')], [course('a')]), /outside this registered/)
  assert.throws(() => validate([entry('a', 7)], [course('a')]), /unavailable/)
  assert.throws(() => validate([entry('a'), entry('a')], [course('a')]), /twice/)
  const body = { academicYear: '2026-27', semester: 1, revision: 'a'.repeat(32), entries: [{ ...entry(uid(1)), teacherId: uid(2) }], mode: 'allow_overrides', reason: 'test' }
  assert.equal(ManualTimetableSchema.safeParse(body).success, false)
})
test('fallback is unavailable before a generation attempt or after successful complete generation', async () => {
  const ids = await fixture()
  await db.query("UPDATE public.system_logs SET status='completed' WHERE id=$1", [ids.job])
  await assert.rejects(context(ids), /failed or incomplete/)
  await db.query('DELETE FROM public.system_logs WHERE id=$1', [ids.job])
  await assert.rejects(context(ids), /Run timetable generation/)
})
test('incomplete strict drafts can be saved and resumed without publishing timetable entries', async () => {
  const ids = await fixture(), value = draft(ids, [ids.entries[0]])
  const before = await context(ids)
  const saved = await commit(ids, value, false, before.revision)
  assert.equal(saved.success, true)
  assert.notEqual(saved.revision, before.revision)
  assert.equal((await context(ids)).job.metadata.manualDraft.report.unscheduledPeriods, 1)
  assert.equal((await db.query('SELECT count(*)::int n FROM public.current_timetable_entries WHERE campus_id=$1', [ids.campus])).rows[0].n, 0)
  await assert.rejects(commit(ids, value, true), /Complete the timetable/)
})
test('strict mode rejects clashes and override mode requires a reason', async () => {
  const ids = await fixture(), entries = [entry(ids.courseA), entry(ids.courseB)]
  await assert.rejects(commit(ids, draft(ids, entries)), /Resolve scheduling violations/)
  await assert.rejects(commit(ids, draft(ids, entries, 'allow_overrides')), /override reason/)
  assert.equal((await context(ids)).job.metadata.manualDraft, undefined)
})
test('term/campus authority, active workers and open registrations block manual writes', async () => {
  const ids = await fixture()
  await assert.rejects(context(ids, ids.hod), /director affiliation/)
  await assert.rejects(context(ids, ids.director, 1), /term changed/)
  const other = await fixture()
  await assert.rejects(context(ids, other.director), /director affiliation/)
  await db.query("UPDATE public.system_logs SET status='running' WHERE id=$1", [ids.job])
  await assert.rejects(context(ids), /active allocation/)
  await db.query("UPDATE public.system_logs SET status='failed' WHERE id=$1", [ids.job])
  await db.query("UPDATE public.campus_settings SET deadline=now()+interval '1 day' WHERE campus_id=$1", [ids.campus])
  await assert.rejects(context(ids), /Close student registrations/)
})
test('another editor, HOD changes and catalogue changes invalidate an earlier revision', async () => {
  const ids = await fixture(), value = draft(ids)
  let old = await context(ids)
  await commit(ids, value, false, old.revision)
  await assert.rejects(commit(ids, value, false, old.revision), /inputs changed/)
  old = await context(ids)
  await db.query('UPDATE public.teacher_course_assignments SET assigned_at=now() WHERE id=$1', [ids.assignmentA])
  await assert.rejects(commit(ids, value, false, old.revision), /inputs changed/)
  old = await context(ids)
  await db.query('UPDATE public.courses SET theory_hours_per_week=2 WHERE id=$1', [ids.courseA])
  await assert.rejects(commit(ids, value, false, old.revision), /inputs changed/)
})
test('only HODs can mutate teacher assignments, through the database and service', async () => {
  const ids = await fixture()
  for (const operation of ['assign', 'batch', 'reassign', 'remove', 'substitute']) {
    await assert.rejects(db.query('SELECT public.mutate_teacher_assignments($1,$2)', [ids.director, operation]), error => error.code === 'P4030')
  }
  const fake = { admin: { rpc() { throw new Error('Must not reach database') } } }
  for (const role of ['campus_director', 'superadmin', 'teacher']) {
    await assert.rejects(mutateTeacherAssignments(fake, { role }, {}), /Only HODs/)
  }
  assert.equal((await db.query("SELECT public.mutate_teacher_assignments($1,'remove','[]'::jsonb,$2) value", [ids.hod, ids.assignmentB])).rows[0].value.success, true)
})
test('override publication records clashes and keeps HOD assignments intact', async () => {
  const ids = await fixture(), value = draft(ids, [entry(ids.courseA), entry(ids.courseB)], 'allow_overrides', 'Director accepted the shared slot')
  await commit(ids, value)
  const result = await commit(ids, value, true)
  assert.equal(result.publishedCount, 2)
  const rows = (await db.query('SELECT teacher_id,status FROM public.current_timetable_entries WHERE campus_id=$1', [ids.campus])).rows
  assert.equal(rows.length, 2)
  assert.ok(rows.every(row => row.teacher_id === ids.teacher && row.status === 'published'))
  assert.equal((await db.query('SELECT count(*)::int n FROM public.current_teacher_course_assignments WHERE campus_id=$1', [ids.campus])).rows[0].n, 2)
  const saved = (await context(ids)).job.metadata.manualDraft
  assert.ok(saved.report.violations.some(item => item.type === 'teacher_conflict'))
  assert.equal(saved.reason, value.reason)
  assert.equal(saved.publishedBy, ids.director)
  assert.equal((await db.query("SELECT count(*)::int n FROM public.system_logs WHERE event_type='manual_timetable_published' AND campus_id=$1", [ids.campus])).rows[0].n, 1)
  await assert.rejects(commit(ids, value), /Published timetables/)
  assert.notEqual((await db.query("SELECT current_setting('app.manual_timetable_override',true) value")).rows[0].value, 'on')
})
test('override publication may retain missing hours, while strict complete publication has zero violations', async () => {
  const incomplete = await fixture(), value = draft(incomplete, [entry(incomplete.courseA)], 'allow_overrides', 'Accepted one missing course hour')
  await commit(incomplete, value); assert.equal((await commit(incomplete, value, true)).publishedCount, 1)
  assert.equal((await context(incomplete)).job.metadata.manualDraft.report.unscheduledPeriods, 1)
  const complete = await fixture(), valid = draft(complete)
  await commit(complete, valid); assert.equal((await commit(complete, valid, true)).publishedCount, 2)
  assert.equal((await context(complete)).job.metadata.manualDraft.report.violations.length, 0)
})
test('publication cannot change an unsaved draft, authorize a foreign course or bypass HOD identity', async () => {
  const ids = await fixture(), value = draft(ids)
  await commit(ids, value)
  await assert.rejects(commit(ids, { ...value, entries: [entry(ids.courseA)] }, true), /Save this manual draft/)
  const other = await fixture()
  await assert.rejects(commit(ids, { ...value, entries: [entry(other.courseA)], mode: 'allow_overrides', reason: 'test' }), /outside this registered/)
})
test('a failed publication rolls back replacement rows, metadata and audit together', async () => {
  const ids = await fixture(), value = draft(ids)
  await db.query(`INSERT INTO public.timetable_entries(campus_id,academic_year,semester,course_id,department_id,time_slot_id,status)
    SELECT $1,'2026-27',1,$2,$3,id,'draft' FROM public.time_slots WHERE day_of_week=2 AND period_number=1`, [ids.campus, ids.courseA, ids.dept])
  await commit(ids, value)
  const before = await context(ids)
  await db.exec(`CREATE FUNCTION public.reject_manual_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.course_id='${ids.courseB}' THEN RAISE EXCEPTION 'Injected publication failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER zz_manual_test BEFORE INSERT ON public.timetable_entries FOR EACH ROW EXECUTE FUNCTION public.reject_manual_test();`)
  try { await assert.rejects(commit(ids, value, true, before.revision), /Injected publication failure/) }
  finally { await db.exec('DROP TRIGGER zz_manual_test ON public.timetable_entries; DROP FUNCTION public.reject_manual_test()') }
  const after = await context(ids)
  assert.equal(after.revision, before.revision)
  assert.deepEqual(after.entries, before.entries)
  assert.equal(after.job.metadata.manualDraft.publishedAt, undefined)
})

test('service preview/save/publication revalidate current inputs and require explicit override acknowledgement', async () => {
  const loader = require('../backend/dist/modules/timetable/solver/loader.js')
  const audience = require('../backend/dist/modules/timetable/timetable-audience.js')
  const { ManualTimetableService } = require('../backend/dist/modules/timetable/manual-timetable.service.js')
  const ids = await fixture()
  const originalLoader = loader.loadGenerationInput, originalAudience = audience.loadTimetableAudience
  loader.loadGenerationInput = async () => ({ courses: ids.courses, slotMap: slots, parallelGroups: [], teacherReservations: [] })
  audience.loadTimetableAudience = async () => ({ courseDepartments: new Map(ids.courses.map(course => [course.courseId, [ids.dept]])), departmentCounts: new Map([[ids.dept, 1]]) })
  const admin = {
    async rpc(name, p) {
      try {
        let result
        if (name === 'timetable_manual_context') result = await db.query('SELECT public.timetable_manual_context($1,$2,$3,$4,$5) value',
          [p.p_campus_id, p.p_academic_year, p.p_semester, p.p_actor_id, p.p_expected_term])
        else if (name === 'commit_manual_timetable') result = await db.query('SELECT public.commit_manual_timetable($1,$2,$3,$4,$5,$6,$7::jsonb,$8) value',
          [p.p_campus_id, p.p_academic_year, p.p_semester, p.p_actor_id, p.p_expected_term, p.p_revision, JSON.stringify(p.p_draft), p.p_publish])
        else throw new Error(`Unexpected RPC ${name}`)
        return { data: result.rows[0].value, error: null }
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } } }
    },
    from(table) {
      assert.ok(['departments', 'faculty'].includes(table))
      return { select() { return this }, eq() { return this }, in() { return this }, order() {
        return Promise.resolve({ data: table === 'faculty' ? [{ id: ids.teacher, full_name: 'HOD Assigned Teacher' }] : [{ id: ids.dept, name: 'Department' }], error: null })
      } }
    },
  }
  try {
    const service = new ManualTimetableService({ admin })
    const user = { role: 'campus_director', userId: ids.director, campus_id: ids.campus, term_version: 0 }
    const initial = await service.get('2026-27', 1, user)
    assert.equal(initial.report.unscheduledPeriods, 2)
    assert.ok(initial.courses.every(course => !Object.hasOwn(course, 'studentIds')))
    const request = { academicYear: '2026-27', semester: 1, revision: initial.revision,
      entries: [entry(ids.courseA), entry(ids.courseB)], mode: 'follow_rules', reason: '' }
    assert.equal((await service.preview(request, user)).canSave, false)
    await assert.rejects(service.save(request, user), /breaks scheduling rules/)
    request.mode = 'allow_overrides'; request.reason = 'Accepted scheduling collision'
    const saved = await service.save(request, user)
    const publish = { academicYear: '2026-27', semester: 1, revision: saved.revision, acknowledgeOverrides: false }
    await assert.rejects(service.publish(publish, user), /Acknowledge/)
    publish.acknowledgeOverrides = true
    assert.equal((await service.publish(publish, user)).publishedCount, 2)
    await assert.rejects(service.save({ ...request, revision: saved.revision }, user), /Published timetables/)
  } finally { loader.loadGenerationInput = originalLoader; audience.loadTimetableAudience = originalAudience }
})
