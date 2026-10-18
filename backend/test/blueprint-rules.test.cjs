const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true })
const { isCourseEligibleForSlot: eligible, validatePathwaySlots, normalizeSlotTarget, getStudentSlotDefinition, getBlueprintPathways } = require('../src/core/utils/slotRules')
const { revalidateAllocationChoices } = require('../src/core/utils/allocationEligibility')
const { RegistrationsService } = require('../src/modules/registrations/registrations.service')
const { AllocationService } = require('../src/modules/allocation/allocation.service')
const { HodService } = require('../src/modules/hod/hod.service')
const { convertSnapshot, transactionSql } = require('../scripts/convert-blueprint-targets.cjs')

const departments = new Map([['HOME', 'home'], ['AWAY', 'away']])
const course = (id, category = 'MDC', department_id = 'away', semester = 2, tag = null) => ({ id, course_code: id, title: id, category, department_id, semester, tag, credits: 3, seat_limit: 10 })
const slot = (rule, target) => ({ rule, target, name: target })
const user = { userId: 'student', department_id: 'home', campus_id: 'campus', current_semester: 2, role: 'student' }
const logger = { log: async () => {}, warn() {}, error() {} }

function database(tables, rpc) {
  const writes = [], calls = []
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.start = 0; this.end = Infinity }
    select() { return this }
    eq(key, value) { this.filters.push(row => row[key] === value); return this }
    neq(key, value) { this.filters.push(row => row[key] !== value); return this }
    lt(key, value) { this.filters.push(row => row[key] < value); return this }
    in(key, values) { this.filters.push(row => values.includes(row[key])); return this }
    not(key, operator, value) { assert.equal(operator, 'in'); const ids = value.slice(1, -1).split(','); this.filters.push(row => !ids.includes(row[key])); return this }
    order() { return this }
    limit(n) { this.end = n - 1; return this }
    range(start, end) { this.start = start; this.end = end; return this }
    upsert(value) { writes.push({ table: this.table, value }); return this }
    update(value) { writes.push({ table: this.table, value }); return this }
    result() { const rows = (tables[this.table] || []).filter(row => this.filters.every(f => f(row))); return { data: rows.slice(this.start, this.end + 1), error: null, count: rows.length } }
    then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject) }
    async maybeSingle() { return { ...this.result(), data: this.result().data[0] || null } }
    single() { return this.maybeSingle() }
  }
  return { writes, calls, from: table => new Query(table), rpc: async (name, args) => { calls.push({ name, args }); return rpc?.(name, args) || { data: null, error: null } } }
}
const registration = db => new RegistrationsService({ admin: db }, logger, logger)

function prerequisiteScenario(kind, met = false) {
  const restricted = { ...course('restricted', 'AEC'), course_code: 'KU02AECMAL101', title: 'ROMANTIC LITERATURE' }
  if (kind === 'legacy course IDs') restricted.prerequisite_course_ids = ['prior-a', 'prior-b']
  const rule = {
    'department': { rule: 'DEPARTMENT', target: 'HIN,MAL' },
    'completed course': { rule: 'COMPLETED_COURSE', target: 'PRIOR101' },
    'completed semester': { rule: 'COMPLETED_SEMESTER', target: met ? '1' : '2' },
  }[kind]
  const previousIds = kind === 'legacy course IDs' ? ['prior-a', ...(met ? ['prior-b'] : [])]
    : kind === 'completed course' && met ? ['prior-a'] : []
  return {
    campus_settings: [{ campus_id: 'campus', academic_year: '2026-27', deadline: '2099-01-01' }],
    students: [{ id: user.userId, ...user, departments: { code: kind === 'department' && met ? 'MAL' : 'ITTT' } }],
    departments: [{ id: 'home', code: kind === 'department' && met ? 'MAL' : 'ITTT' }, { id: 'away', code: 'MAL' }],
    semester_blueprints: [{ department_id: 'home', semester: 2, min_credits: 3, max_credits: 3,
      pathways: [{ id: 'p', slots: [slot('GLOBAL_BASKET', 'AEC')] }] }],
    courses: [restricted, { ...course('fallback', 'AEC'), course_code: 'KU02AECHIN103' },
      { ...course('prior-a', 'AEC', 'away', 1), course_code: 'PRIOR101' }, course('prior-b', 'AEC', 'away', 1)],
    course_prerequisite_rules: rule ? [{ id: 'rule', course_id: restricted.id, ...rule }] : [],
    student_registrations: previousIds.length ? [{ id: 'history', student_id: user.userId, semester: 1,
      slot_1_course_id: previousIds[0], slot_2_course_id: previousIds[1] }] : [],
    registration_preferences: [],
  }
}

for (const kind of ['department', 'completed course', 'completed semester', 'legacy course IDs']) {
  test(`registration and resubmission accept blueprint choices with an unmet ${kind} prerequisite`, async () => {
    const tables = prerequisiteScenario(kind)
    const db = database(tables, () => ({ data: { success: true }, error: null }))
    const service = registration(db)
    const blueprint = await service.getBlueprint(user)
    assert.deepEqual(blueprint.slots[0].options.map(c => c.id), ['restricted', 'fallback'])
    const preferences = { slot_1: [{ course_id: 'restricted', rank: 1 }, { course_id: 'fallback', rank: 2 }] }
    const first = await service.submitCourses({ semester: 2, pathway_id: 'p', preferences }, user)
    assert.equal(first.success, true)
    assert.equal(first.isUpdate, false)
    assert.deepEqual(db.calls[0].args.p_preferences[0].choices, preferences.slot_1)
    assert.equal(db.calls[0].name, 'submit_student_registration')
    tables.registration_preferences.push({ id: 'saved', student_id: user.userId, semester: 2, academic_year: '2026-27',
      pathway_id: 'p', submitted_at: db.calls[0].args.p_submitted_at })
    preferences.slot_1 = [{ course_id: 'fallback', rank: 1 }, { course_id: 'restricted', rank: 2 }]
    const updated = await service.submitCourses({ semester: 2, pathway_id: 'p', preferences }, user)
    assert.equal(updated.success, true)
    assert.equal(updated.isUpdate, true)
    assert.deepEqual(db.calls[1].args.p_preferences[0].choices, preferences.slot_1)
    assert.equal(db.calls[1].args.p_submitted_at, db.calls[0].args.p_submitted_at)
  })

  test(`automatic allocation checks the ${kind} prerequisite and keeps fallback ranks`, async () => {
    for (const met of [false, true]) {
      const tables = prerequisiteScenario(kind, met)
      tables.campus_settings[0].deadline = '2020-01-01'
      tables.registration_preferences.push({ id: 'pref', student_id: user.userId, campus_id: 'campus', semester: 2,
        academic_year: '2026-27', pathway_id: 'p', submitted_at: '2026-01-01',
        preferences: [{ slot: 1, choices: [{ course_id: 'restricted', rank: 1 }, { course_id: 'fallback', rank: 2 }] }] })
      const db = database(tables, name => ({ data: name === 'claim_allocation_run' ? 'run' : {}, error: null }))
      await new AllocationService({ admin: db }, logger, logger).runAllocation({ semester: 2, academicYear: '2026-27' }, user)
      const commit = db.calls.find(call => call.name === 'apply_course_allocation').args
      assert.equal(commit.p_allocations.length, 1)
      assert.equal(commit.p_allocations[0].course_id, met ? 'restricted' : 'fallback')
      assert.equal(commit.p_allocations[0].metadata.round, met ? 1 : 2)
    }
  })

  test(`manual allocation and direct slot assignment still enforce the ${kind} prerequisite`, async () => {
    const tables = prerequisiteScenario(kind)
    tables.student_registrations.push({ id: 'current', student_id: user.userId, semester: 2, academic_year: '2026-27', pathway_id: 'p' })
    const db = database(tables)
    await assert.rejects(new AllocationService({ admin: db }, logger, logger).manualAllocate(
      { student_id: user.userId, slot_key: 'slot_1', course_id: 'restricted' }, { ...user, role: 'hod' }), /does not meet prerequisites/)
    await assert.rejects(registration(db).updateSlot({ slot_key: 'slot_1', course_id: 'restricted' }, user), /prerequisite requirement not satisfied/)
    assert.equal(db.calls.length, 0)
  })
}

test('an unmet prerequisite without a fallback can be submitted and leaves the allocation slot unresolved', async () => {
  const tables = prerequisiteScenario('department')
  const db = database(tables, name => ({ data: name === 'claim_allocation_run' ? 'run' : { success: true }, error: null }))
  await registration(db).submitCourses({ semester: 2, pathway_id: 'p', preferences: { slot_1: [{ course_id: 'restricted', rank: 1 }] } }, user)
  tables.registration_preferences.push({ id: 'pref', student_id: user.userId, campus_id: 'campus', semester: 2,
    academic_year: '2026-27', pathway_id: 'p', submitted_at: '2026-01-01', preferences: db.calls[0].args.p_preferences })
  tables.campus_settings[0].deadline = '2020-01-01'
  const result = await new AllocationService({ admin: db }, logger, logger).runAllocation({ semester: 2, academicYear: '2026-27' }, user)
  const commit = db.calls.find(call => call.name === 'apply_course_allocation').args
  assert.equal(result.unallocated, 1)
  assert.equal(commit.p_allocations.length, 0)
  assert.equal(commit.p_unallocated[0].slot_key, 'slot_1')
})

test('global basket matches categories and semester, with MDC exclusion only', () => {
  for (const category of ['MDC', 'AEC', 'VAC', 'SEC', 'DSE']) {
    assert.equal(eligible(course('c', category), 'GLOBAL_BASKET', category, 'home', departments, 2), true)
    assert.equal(eligible(course('c', category, 'home'), 'GLOBAL_BASKET', category, 'home', departments, 2), category !== 'MDC')
    assert.equal(eligible(course('c', category, 'away', 4), 'GLOBAL_BASKET', category, 'home', departments, 2), false)
  }
  assert.equal(eligible(course('c', 'AEC', 'away', 2, 'MDC'), 'GLOBAL_BASKET', 'MDC', 'home', departments, 2), false)
  for (const target of ['TT_S2_MDC', 'MDC-1', 'c', '', 'UNKNOWN']) assert.equal(eligible(course('c'), 'GLOBAL_BASKET', target, 'home', departments, 2), false)
})

test('pool accepts only own-department same-semester DSE independently of tags', () => {
  const matches = c => eligible(c, 'POOL_RESTRICTED', 'POOLED', 'home', departments, 2)
  assert.equal(matches(course('dse', 'DSE', 'home')), true)
  assert.equal(matches(course('dse', 'DSE', 'home', 2, 'old-anything')), true)
  for (const c of [course('dsc', 'DSC', 'home'), course('other', 'DSE'), course('old', 'DSE', 'home', 4)]) assert.equal(matches(c), false)
})

test('normalizes saves, rejects tag and course-code basket targets, resolves explicit slot 8 and flat records', () => {
  assert.equal(normalizeSlotTarget('GLOBAL_BASKET', ' mdc '), 'MDC')
  assert.equal(normalizeSlotTarget('POOL_RESTRICTED', 'POOL-A'), 'POOLED')
  assert.equal(validatePathwaySlots([slot('GLOBAL_BASKET', 'MDC')]).valid, true)
  assert.equal(validatePathwaySlots([slot('GLOBAL_BASKET', 'MDC-2')]).valid, false)
  assert.equal(validatePathwaySlots([slot('POOL_RESTRICTED', 'POOL-A')]).valid, false)
  const pathway = { slots: Array.from({ length: 8 }, () => slot('POOL_RESTRICTED', 'POOLED')) }
  assert.equal(getStudentSlotDefinition(pathway, 8, 'home').rule, 'POOL_RESTRICTED')
  assert.equal(getStudentSlotDefinition({ slots: [] }, 8, 'home').rule, 'LEGACY_MINOR')
  assert.equal(getStudentSlotDefinition(undefined, 8, 'home'), undefined)
  assert.equal(getBlueprintPathways({ slot_1_rule: 'GLOBAL_BASKET', slot_1_target: 'AEC' })[0].slots[0].target, 'AEC')
})

test('HOD save normalizes both pathway and flat targets and rejects old basket tags', async () => {
  const db = database({}), service = new HodService({ admin: db }, logger, logger, {})
  const body = { semester: 2, min_credits: 0, max_credits: 30, pathways: [{ id: 'p', name: 'Default', slots: [slot('GLOBAL_BASKET', ' aec '), slot('POOL_RESTRICTED', 'old')] }] }
  await service.updateBlueprint(body, user)
  assert.equal(db.writes[0].value.slot_1_target, 'AEC')
  assert.equal(db.writes[0].value.pathways[0].slots[1].target, 'POOLED')
  body.pathways[0].slots[0].target = 'TT_S2_AEC'
  await assert.rejects(service.updateBlueprint(body, user), /supported course category/)
  assert.equal(db.writes.length, 1)
})

test('student options and global HOD catalogue include all campuses with semester and ownership flags', async () => {
  const rows = [course('mdc-away'), course('mdc-home', 'MDC', 'home'), course('old', 'MDC', 'away', 4), course('dse', 'DSE', 'home'), course('aec', 'AEC', 'home')]
  rows.forEach(c => { c.departments = { campus_id: c.department_id === 'home' ? 'campus' : 'other', name: c.department_id } })
  const db = database({ courses: rows, departments: [{ id: 'home', code: 'HOME', campus_id: 'campus' }] })
  const slots = await registration(db).resolvePathwaySlots({ slots: [slot('GLOBAL_BASKET', 'MDC'), slot('POOL_RESTRICTED', 'POOLED'), slot('GLOBAL_BASKET', 'AEC')] }, user, departments, new Map())
  assert.deepEqual(slots.map(s => s.options.map(c => c.id)), [['mdc-away'], ['dse'], ['aec']])
  const catalogue = await new HodService({ admin: db }, logger, logger, {}).getCourses(2, user, false, undefined, true)
  assert.equal(catalogue.length, 4)
  assert.equal(catalogue.find(c => c.id === 'mdc-away').is_own_campus, false)
  assert.equal(catalogue.find(c => c.id === 'dse').is_own_dept, true)
})

test('initial and switched pathways use the saved student profile for tagless MDC and AEC options', async () => {
  const pathway = { id: 'p', slots: [slot('GLOBAL_BASKET', 'MDC'), slot('GLOBAL_BASKET', 'AEC')] }
  const db = database({
    students: [{ id: user.userId, department_id: 'home', campus_id: 'campus', current_semester: 2 }],
    campus_settings: [{ campus_id: 'campus', academic_year: '2026-27' }],
    departments: [{ id: 'home', code: 'HOME', name: 'Home' }, { id: 'away', code: 'AWAY', name: 'Away' }],
    semester_blueprints: [{ department_id: 'home', semester: 2, pathways: [pathway] }],
    courses: [course('mdc-away'), course('mdc-home', 'MDC', 'home'), course('aec', 'AEC', 'home'), course('old-mdc', 'MDC', 'away', 4), course('old-aec', 'AEC', 'away', 4)],
  })
  for (const sessionUser of [
    { ...user, current_semester: undefined },
    { ...user, department_id: 'away', current_semester: 4 },
  ]) {
    const initial = await registration(db).getBlueprint(sessionUser)
    const switched = await registration(db).getPathwaySlots('p', sessionUser)
    assert.equal(initial.student.current_semester, 2)
    for (const slots of [initial.slots, switched.data.slots]) {
      assert.deepEqual(slots.map(s => s.options.map(c => c.id)), [['mdc-away'], ['aec']])
    }
  }
  assert.equal(db.writes.length, 0)
})

test('submission rejects wrong-semester and wrong-category courses before persisting preferences', async () => {
  const c = course('invalid', 'AEC', 'away', 4)
  const tables = { courses: [c], departments: [{ id: 'home', code: 'HOME' }], students: [{ id: user.userId, ...user }],
    campus_settings: [{ campus_id: 'campus', academic_year: '2026-27', deadline: '2099-01-01' }],
    semester_blueprints: [{ department_id: 'home', semester: 2, pathways: [{ id: 'p', slots: [slot('GLOBAL_BASKET', 'MDC')] }] }] }
  const db = database(tables)
  const submit = () => registration(db).submitCourses({ semester: 2, pathway_id: 'p', preferences: { slot_1: [{ course_id: 'invalid', rank: 1 }] } }, user)
  await assert.rejects(submit(), /not eligible/)
  c.semester = 2
  await assert.rejects(submit(), /not eligible/)
  assert.equal(db.writes.length, 0)
})

test('configured pool in slot 7 supplies own-department DSE options instead of legacy minors', async () => {
  const db = database({
    campus_settings: [{ campus_id: 'campus', academic_year: '2026-27' }],
    departments: [{ id: 'home', code: 'HOME', name: 'Home' }],
    courses: [course('own-dse', 'DSE', 'home'), course('away-minor', 'DSC')],
    semester_blueprints: [{ department_id: 'home', semester: 2, pathways: [{ id: 'p', slots: Array.from({ length: 7 }, () => slot('POOL_RESTRICTED', 'POOLED')) }] }],
  }, () => ({ data: [], error: null }))
  const result = await registration(db).getAvailableSeats(2, 'slot_7', 'p', user)
  assert.deepEqual(result.courses.map(c => c.id), ['own-dse'])
  await assert.rejects(registration(db).getAvailableSeats(4, 'slot_7', 'p', user), /current semester/)
})

test('manual allocation rejects the legacy minor choice for an explicitly configured pool in slot 8', async () => {
  const db = database({
    students: [{ id: 'student', ...user }],
    campus_settings: [{ campus_id: 'campus', academic_year: '2026-27' }],
    courses: [course('away-minor', 'DSC')],
    departments: [{ id: 'home', code: 'HOME' }],
    student_registrations: [{ student_id: 'student', semester: 2, academic_year: '2026-27', pathway_id: 'p' }],
    semester_blueprints: [{ department_id: 'home', semester: 2, pathways: [{ id: 'p', slots: Array.from({ length: 8 }, () => slot('POOL_RESTRICTED', 'POOLED')) }] }],
  })
  await assert.rejects(new AllocationService({ admin: db }, logger, logger).manualAllocate({ student_id: 'student', slot_key: 'slot_8', course_id: 'away-minor' }, { ...user, role: 'hod' }), /not eligible/)
  assert.equal(db.calls.length, 0)
})

test('allocation removes stale choices without renumbering valid ranks or trusting saved rule flags', () => {
  const courses = new Map([['bad', course('bad', 'DSC', 'home')], ['good', course('good', 'DSE', 'home')]])
  const original = [{ slot: 1, rule: 'FIXED', is_fixed: true, choices: [{ course_id: 'bad', rank: 1 }, { course_id: 'good', rank: 2 }] }]
  const result = revalidateAllocationChoices(original, { slots: [slot('POOL_RESTRICTED', 'POOLED')] }, user, courses, departments)
  assert.deepEqual(result.slots[0].choices, [{ course_id: 'good', rank: 2 }])
  assert.equal(result.slots[0].is_fixed, false)
  assert.equal(result.skipped.length, 1)
  assert.equal(original[0].choices.length, 2)
  assert.equal(revalidateAllocationChoices(original, undefined, user, courses, departments).slots[0].choices.length, 0)
})

test('automatic allocation validates current pathways and persists skipped-choice diagnostics', async () => {
  const db = database({
    campus_settings: [{ campus_id: 'campus', deadline: '2020-01-01' }],
    courses: [course('bad', 'DSC', 'home'), course('good', 'DSE', 'home')],
    students: [{ id: 'student', department_id: 'home', current_semester: 2, departments: { code: 'HOME' } }],
    departments: [{ id: 'home', code: 'HOME' }],
    semester_blueprints: [{ id: 'b', department_id: 'home', semester: 2, pathways: [{ id: 'p', slots: [slot('POOL_RESTRICTED', 'POOLED')] }] }],
    registration_preferences: [{ id: 'pref', student_id: 'student', campus_id: 'campus', semester: 2, academic_year: '2026-27', pathway_id: 'p', submitted_at: '2026-01-01',
      preferences: [{ slot: 1, rule: 'POOL_RESTRICTED', choices: [{ course_id: 'bad', rank: 1 }, { course_id: 'good', rank: 2 }] }] }],
  }, name => ({ data: name === 'claim_allocation_run' ? 'run' : {}, error: null }))
  const result = await new AllocationService({ admin: db }, logger, logger).runAllocation({ semester: 2, academicYear: '2026-27' }, user)
  assert.equal(result.skipped_choices_count, 1)
  const commit = db.calls.find(call => call.name === 'apply_course_allocation').args
  assert.equal(commit.p_allocations[0].course_id, 'good')
  assert.equal(commit.p_summary.summary.skipped_choices_count, 1)
})

test('conversion handles tag/category/code targets, pool losses, and synced flat columns', () => {
  const courses = [course('a', 'AEC', 'home', 2, 'old'), course('b', 'AEC'), course('dsc', 'DSC', 'home', 2, 'POOL-A'), course('dse', 'DSE', 'home')]
  const bp = { id: '00000000-0000-0000-0000-000000000001', department_id: 'home', semester: 2, min_credits: 3, max_credits: 12, slot_1_rule: 'GLOBAL_BASKET', slot_1_target: 'old',
    pathways: [{ id: 'p', name: 'Original', slots: [slot('GLOBAL_BASKET', 'old'), slot('GLOBAL_BASKET', 'b'), slot('POOL_RESTRICTED', 'POOL-A'), slot('GLOBAL_BASKET', 'AEC')] }] }
  const snapshot = { courses, blueprints: [bp] }, result = convertSnapshot(snapshot)
  assert.equal(result.report.unresolved.length, 0)
  assert.deepEqual(result.blueprints[0].pathways[0].slots.map(s => s.target), ['AEC', 'AEC', 'POOLED', 'AEC'])
  assert.equal(result.blueprints[0].slot_1_target, 'AEC')
  assert.deepEqual(result.report.changes[2].removed_non_dse_course_ids, ['dsc'])
  assert.equal(bp.pathways[0].slots[0].target, 'old')
  const sql = transactionSql([bp], result.blueprints)
  assert.match(sql, /^BEGIN;/)
  assert.match(sql, /Blueprint changed/)
  assert.match(sql, /COMMIT;/)
  const rollback = transactionSql(result.blueprints, [bp])
  assert.match(rollback, /slot_1_target = 'old'/)
})

test('conversion requires mappings for empty or mixed baskets, and supports flat-only blueprints', () => {
  const snapshot = { courses: [course('a', 'AEC', 'away', 2, 'mixed'), course('b', 'VAC', 'away', 2, 'mixed')],
    blueprints: [{ id: 'b', department_id: 'home', semester: 2, slot_1_rule: 'GLOBAL_BASKET', slot_1_target: 'mixed', slot_2_rule: 'GLOBAL_BASKET', slot_2_target: 'missing', slot_3_rule: 'POOL_RESTRICTED', slot_3_target: 'old' }] }
  assert.equal(convertSnapshot(snapshot).report.unresolved.length, 2)
  const result = convertSnapshot(snapshot, { 'b:flat:1': 'AEC', 'b:flat:2': 'VAC' })
  assert.equal(result.report.unresolved.length, 0)
  assert.equal(result.blueprints[0].slot_3_target, 'POOLED')
  assert.equal(convertSnapshot({ ...snapshot, blueprints: result.blueprints }).report.converted_blueprints, 0)
})

const pgRuntime = path.resolve(__dirname, '../../scratch/timetable-publication-runtime/node_modules/@electric-sql/pglite')
test('PostgreSQL conversion and rollback execute atomically, detect stale rows, and reject silent trigger failures', { skip: !fs.existsSync(pgRuntime) }, async () => {
  const { PGlite } = require(pgRuntime)
  const db = new PGlite()
  const blueprintId = '00000000-0000-4000-8000-000000000001'
  const courseId = '00000000-0000-4000-8000-000000000002'
  try {
    await db.exec(`CREATE TABLE semester_blueprints(id uuid PRIMARY KEY, department_id text, semester int, pathways jsonb,
      slot_1_rule text, slot_1_target text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE courses(id uuid PRIMARY KEY, course_code text, department_id text, semester int, category text, tag text);`)
    const originalPathways = [{ id: 'p', name: "O'Brien $conversion_guard$", slots: [slot('GLOBAL_BASKET', 'old-tag')] }]
    await db.query('INSERT INTO semester_blueprints(id,department_id,semester,pathways,slot_1_rule,slot_1_target) VALUES ($1,$2,2,$3,$4,$5)', [blueprintId, 'home', JSON.stringify(originalPathways), 'GLOBAL_BASKET', 'old-tag'])
    await db.query('INSERT INTO courses VALUES ($1,$2,$3,2,$4,$5)', [courseId, 'AEC1', 'away', 'AEC', 'old-tag'])
    const snapshot = { blueprints: (await db.query('SELECT * FROM semester_blueprints')).rows, courses: (await db.query('SELECT * FROM courses')).rows }
    const converted = convertSnapshot(snapshot).blueprints
    const apply = transactionSql(snapshot.blueprints, converted, snapshot.courses)
    const rollback = transactionSql(converted, snapshot.blueprints)
    await db.exec(apply)
    assert.equal((await db.query('SELECT slot_1_target FROM semester_blueprints')).rows[0].slot_1_target, 'AEC')
    await db.exec(rollback)
    assert.deepEqual((await db.query('SELECT pathways FROM semester_blueprints')).rows[0].pathways, originalPathways)

    await db.exec("UPDATE courses SET category='VAC'")
    await assert.rejects(db.exec(apply), /Course catalogue changed/)
    await db.exec('ROLLBACK;')
    await db.exec("UPDATE courses SET category='AEC'")
    await db.query('UPDATE semester_blueprints SET pathways=$1', [JSON.stringify([{ ...originalPathways[0], slots: [...originalPathways[0].slots, slot('GLOBAL_BASKET', 'AEC')] }])])
    await assert.rejects(db.exec(apply), /Blueprint changed/)
    await db.exec('ROLLBACK;')
    await db.query('UPDATE semester_blueprints SET pathways=$1', [JSON.stringify(originalPathways)])

    await db.exec(`CREATE FUNCTION block_conversion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END; $$;
      CREATE TRIGGER silent_failure BEFORE UPDATE ON semester_blueprints FOR EACH ROW EXECUTE FUNCTION block_conversion();`)
    await assert.rejects(db.exec(apply), /conversion did not persist/)
    await db.exec('ROLLBACK;')
    assert.equal((await db.query('SELECT slot_1_target FROM semester_blueprints')).rows[0].slot_1_target, 'old-tag')
  } finally { await db.close() }
})
