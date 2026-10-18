const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildPlan, verifyPlanHash, CAMPUS, YEAR } = require('./seed-registrations.cjs')

function fixture() {
  const departments = ['ITTT', 'MATTT', 'STATT'].map(code => ({ id: code, code, campus_id: CAMPUS }))
  const course = (id, department_id, category, credits = 4) => ({ id, course_code: id, department_id, category, credits, semester: 2 })
  const slots = [
    { name: 'Major', rule: 'FIXED', target: 'MAJORTT' },
    { name: 'Minor 1', rule: 'EXCLUDE_DEPT', target: 'ITTT' },
    { name: 'Minor 2', rule: 'DEPT_RESTRICTED', target: 'STATT' },
    { name: 'AEC', rule: 'GLOBAL_BASKET', target: 'AEC' },
  ]
  const manifest = [1, 2, 3].map(n => ({ id: `student-${n}`, department_id: 'ITTT',
    cap_application_number: `TTMANGAT20261018-ITTT-S2-00${n}`, email: `student.ittt.s2.00${n}.mangattt.20261018@example.test` }))
  const snapshot = {
    campus: { id: CAMPUS, code: 'MANGATTT' }, settings: { academic_year: YEAR, deadline: '2099-01-01', min_credits: 15, max_credits: 15 },
    runs: [], students: manifest.map(s => ({ ...s, campus_id: CAMPUS, current_semester: 2 })), departments,
    courses: [course('MAJORTT', 'ITTT', 'DSC'), course('MAT1TT', 'MATTT', 'DSC'), course('MAT2TT', 'MATTT', 'DSC'),
      course('STA1TT', 'STATT', 'DSC'), course('STA2TT', 'STATT', 'DSC'),
      course('KU02AECHIN103', 'real-language', 'AEC', 3), course('KU02AECMAL101', 'real-language', 'AEC', 3),
      course('REAL-DSC', 'real-language', 'DSC')],
    blueprints: [{ id: 'blueprint', department_id: 'ITTT', semester: 2, pathways: [{ id: 'p', slots }] }],
    preferences: [{ id: 'preserved-pref', student_id: 'student-1', campus_id: CAMPUS, semester: 2, academic_year: YEAR, preferences: ['unchanged'] }],
    registrations: [{ id: 'preserved-reg', student_id: 'student-1', campus_id: CAMPUS, semester: 2, academic_year: YEAR }],
  }
  return { snapshot, manifest }
}

test('plans only missing submissions and preserves the existing student data exactly', () => {
  const { snapshot, manifest } = fixture()
  const before = JSON.stringify(snapshot)
  const plan = buildPlan(snapshot, manifest)
  assert.deepEqual(plan.pending.map(p => p.student_id), ['student-2', 'student-3'])
  assert.equal(JSON.stringify(snapshot), before)
  assert.deepEqual(plan.originals.preferences, snapshot.preferences)
  verifyPlanHash(plan)
})

test('every minor rank uses a different test supplier from the other minor, including restricted slots', () => {
  const { snapshot, manifest } = fixture()
  for (const row of buildPlan(snapshot, manifest).pending) {
    const first = row.body.preferences.slot_2.map(p => snapshot.courses.find(c => c.id === p.course_id).department_id)
    const second = row.body.preferences.slot_3.map(p => snapshot.courses.find(c => c.id === p.course_id).department_id)
    assert.ok(first.every(department => department === 'MATTT'))
    assert.ok(second.every(department => department === 'STATT'))
    assert.equal(row.totalCredits, 15)
  }
})

test('varies Hindi/Malayalam ranks while preserving the shared course codes', () => {
  const { snapshot, manifest } = fixture()
  const plan = buildPlan(snapshot, manifest)
  assert.deepEqual(plan.pending[0].body.preferences.slot_4, [{ course_id: 'KU02AECMAL101', rank: 1 }, { course_id: 'KU02AECHIN103', rank: 2 }])
  assert.deepEqual(plan.pending[1].body.preferences.slot_4, [{ course_id: 'KU02AECHIN103', rank: 1 }, { course_id: 'KU02AECMAL101', rank: 2 }])
})

test('rejects changed plans, foreign students/departments and non-test identities', () => {
  const original = fixture()
  const plan = buildPlan(original.snapshot, original.manifest)
  plan.pending[0].semester = 4
  assert.throws(() => verifyPlanHash(plan), /changed/)
  for (const change of [
    ({ snapshot }) => { snapshot.students[0].campus_id = 'real-campus' },
    ({ snapshot }) => { snapshot.departments[0].campus_id = 'real-campus' },
    ({ manifest }) => { manifest[0].email = 'real@example.com' },
    ({ snapshot }) => { snapshot.students[0].id = 'someone-else' },
  ]) {
    const data = fixture()
    change(data)
    assert.throws(() => buildPlan(data.snapshot, data.manifest))
  }
})

test('refuses closed windows, allocation runs, and incomplete or invalid catalogues', () => {
  for (const change of [
    ({ snapshot }) => { snapshot.settings.deadline = null },
    ({ snapshot }) => { snapshot.runs.push({ status: 'completed' }) },
    ({ snapshot }) => { snapshot.courses = snapshot.courses.filter(c => c.id !== 'MAJORTT') },
    ({ snapshot }) => { snapshot.courses = snapshot.courses.filter(c => c.department_id !== 'MATTT') },
    ({ snapshot }) => { snapshot.settings.max_credits = 10 },
  ]) {
    const data = fixture()
    change(data)
    assert.throws(() => buildPlan(data.snapshot, data.manifest))
  }
})
