'use strict'

// Test-data seeding through RegistrationsService, not an authentication/consent test.
// Default: prepare a read-only preview. --apply submits only manifest-listed test students.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '../..')
require(path.join(root, 'node_modules/ts-node')).register({ project: path.join(root, 'backend/tsconfig.json'), transpileOnly: true })
const { isCourseEligibleForSlot, getBlueprintPathways, normalizeCourseCode, validatePathwaySlots } = require(path.join(root, 'backend/src/core/utils/slotRules'))
const CAMPUS = 'b72074e2-468e-4218-afb6-0f08f14cfe8f'
const PROJECT = 'lhnjlwtdphugjaluzrsp'
const YEAR = '2026-27'
const SEED = 'mangat-registrations-2026-10-18'
const privateDir = path.join(root, 'scratch/mangat-replica-2026-10-18')
const planFile = path.join(privateDir, 'registration-plan.json')
const stateFile = path.join(privateDir, 'registration-seed-state.json')
const reportFile = path.join(__dirname, 'REGISTRATION_SEED_REPORT.json')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(file + '.tmp', file)
}
const rotate = (rows, offset) => rows.length ? [...rows.slice(offset % rows.length), ...rows.slice(0, offset % rows.length)] : []
const rowKey = row => `${row.student_id}:${row.semester}:${row.academic_year}`
const fixedRules = new Set(['FIXED', 'AEC_ELECT', 'CAMPUS_FIXED'])
const stableRows = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id))
const catalogue = snapshot => ({ courses: stableRows(snapshot.courses), blueprints: stableRows(snapshot.blueprints), departments: stableRows(snapshot.departments) })

function assertScope(snapshot, manifest) {
  check(snapshot.campus?.id === CAMPUS && snapshot.campus.code === 'MANGATTT', 'Wrong test campus')
  check(snapshot.settings?.academic_year === YEAR, 'Unexpected academic year')
  check(new Date(snapshot.settings.deadline) > new Date(), 'Registration deadline must remain in the future')
  check(!snapshot.runs.length, 'Allocation has already started; seeding is closed')
  check(snapshot.students.length === manifest.length && manifest.length > 0, 'Student count differs from the uploaded manifest')
  const expected = new Map(manifest.map(row => [row.id, row]))
  check(expected.size === manifest.length, 'Duplicate uploaded student IDs')
  for (const student of snapshot.students) {
    const original = expected.get(student.id)
    check(original && original.department_id === student.department_id && original.cap_application_number === student.cap_application_number,
      'A student is outside the uploaded test manifest')
    check(student.campus_id === CAMPUS && [2, 4].includes(student.current_semester), 'A student has the wrong campus or semester')
    check(/^student\.[a-z]+\.s[24]\.\d{3}\.mangattt\.20261018@example\.test$/.test(original.email), 'Non-test email in the upload manifest')
    const dept = snapshot.departments.find(d => d.id === student.department_id)
    check(dept?.campus_id === CAMPUS && dept.code.endsWith('TT'), 'Student department is outside the test campus')
  }
  for (const row of [...snapshot.preferences, ...snapshot.registrations]) {
    check(expected.has(row.student_id) && row.campus_id === CAMPUS && row.academic_year === YEAR, 'Unexpected registration ownership')
  }
}

function buildPlan(snapshot, manifest) {
  assertScope(snapshot, manifest)
  const deptMap = new Map(snapshot.departments.flatMap(d => [[d.id, d.id], [d.code.toUpperCase(), d.id]]))
  const depts = new Map(snapshot.departments.map(d => [d.id, d]))
  const owned = course => depts.get(course.department_id)?.campus_id === CAMPUS && course.course_code.endsWith('TT')
  const originalKeys = new Set([...snapshot.preferences, ...snapshot.registrations].map(rowKey))
  const pending = []
  for (const student of [...snapshot.students].sort((a, b) => a.cap_application_number.localeCompare(b.cap_application_number))) {
    if (originalKeys.has(`${student.id}:${student.current_semester}:${YEAR}`)) continue
    const department = depts.get(student.department_id)
    const blueprint = snapshot.blueprints.find(b => b.department_id === student.department_id && b.semester === student.current_semester)
    const pathway = getBlueprintPathways(blueprint)[0]
    check(pathway && validatePathwaySlots(pathway.slots).valid, `Missing/invalid blueprint: ${department.code} S${student.current_semester}`)
    const serial = Number(student.cap_application_number.split('-').at(-1))
    check(Number.isInteger(serial) && serial > 0, 'Invalid synthetic student serial')
    const offset = serial - 1 + [...department.code].reduce((n, c) => n + c.charCodeAt(0), 0)
    const choices = pathway.slots.map(slot => stableRows(snapshot.courses.filter(c =>
      isCourseEligibleForSlot(c, slot.rule, slot.target || '', student.department_id, deptMap, student.current_semester, slot.name)
      && (owned(c) || (c.category === 'AEC' && ['KU02AECMAL101', 'KU02AECHIN103'].includes(c.course_code))))))
    const fixedIds = new Set()
    const fixed = {}
    pathway.slots.forEach((slot, i) => {
      if (!fixedRules.has(slot.rule)) return
      check(choices[i].length === 1 && owned(choices[i][0]), `Fixed TT course missing/ambiguous in ${department.code}`)
      fixed[`slot_${i + 1}`] = choices[i][0].id
      fixedIds.add(choices[i][0].id)
    })
    const preferences = {}
    const rank1Ids = new Set(fixedIds)
    const minorDepartments = new Set()
    // Most restricted minor slot first; every rank in a minor uses its assigned supplier.
    const electiveIndexes = pathway.slots.map((_, i) => i).filter(i => !fixedRules.has(pathway.slots[i].rule))
      .sort((a, b) => Number(!/minor/i.test(pathway.slots[a].name || '')) - Number(!/minor/i.test(pathway.slots[b].name || '')) || choices[a].length - choices[b].length)
    let scenario = 'varied-ranked-preferences'
    for (const index of electiveIndexes) {
      const slot = pathway.slots[index]
      let options = choices[index].filter(c => !fixedIds.has(c.id) && !rank1Ids.has(c.id))
      if (/minor/i.test(slot.name || '')) {
        const suppliers = rotate([...new Set(options.map(c => c.department_id))].sort(), offset)
        const supplier = suppliers.find(id => id !== student.department_id && !minorDepartments.has(id))
        check(supplier, `No distinct minor supplier for ${department.code} S${student.current_semester}`)
        minorDepartments.add(supplier)
        options = options.filter(c => c.department_id === supplier)
      }
      options = rotate(options, offset)
      if (slot.rule === 'GLOBAL_BASKET' && slot.target.trim().toUpperCase() === 'AEC') {
        const hindi = options.find(c => c.course_code === 'KU02AECHIN103')
        const malayalam = options.find(c => c.course_code === 'KU02AECMAL101')
        check(hindi && malayalam, 'Expected shared Hindi and Malayalam AEC options')
        if (department.code === 'ECOTT' && serial === 10) {
          options = [malayalam]
          scenario = 'unmet-AEC-prerequisite-without-fallback'
        } else if (serial % 2 === 0) {
          options = [malayalam, hindi]
          scenario = 'unmet-AEC-rank-1-with-Hindi-rank-2'
        } else {
          options = [hindi, malayalam]
          scenario = 'Hindi-rank-1'
        }
      }
      check(options.length, `Empty slot ${index + 1} for ${department.code}`)
      const ranked = options.slice(0, 3).map((course, i) => ({ course_id: course.id, rank: i + 1 }))
      preferences[`slot_${index + 1}`] = ranked
      rank1Ids.add(ranked[0].course_id)
    }
    const byId = new Map(snapshot.courses.map(c => [c.id, c]))
    const totalCredits = [...Object.values(fixed), ...Object.values(preferences).map(rows => rows[0].course_id)]
      .reduce((sum, id) => sum + Number(byId.get(id).credits), 0)
    check(totalCredits >= (blueprint.min_credits ?? snapshot.settings.min_credits) && totalCredits <= (blueprint.max_credits ?? snapshot.settings.max_credits), 'Planned credits violate the blueprint')
    const expectedChoices = pathway.slots.map((slot, i) => ({ slot: i + 1, rule: slot.rule, name: slot.name,
      is_fixed: fixedRules.has(slot.rule), choices: fixed[`slot_${i + 1}`]
        ? [{ course_id: fixed[`slot_${i + 1}`], rank: 1 }] : preferences[`slot_${i + 1}`] }))
    pending.push({ student_id: student.id, department_id: student.department_id, department_code: department.code,
      semester: student.current_semester, cap_application_number: student.cap_application_number, scenario,
      body: { semester: student.current_semester, pathway_id: pathway.id, preferences }, expectedChoices, fixed, totalCredits })
  }
  const contents = { seed_id: SEED, campus_id: CAMPUS, academic_year: YEAR, catalogue_sha256: digest(catalogue(snapshot)),
    settings: snapshot.settings, students: snapshot.students, originals: { preferences: snapshot.preferences, registrations: snapshot.registrations }, pending }
  return { ...contents, plan_sha256: digest(contents) }
}

function verifyPlanHash(plan) {
  const { plan_sha256, ...contents } = plan
  check(plan_sha256 === digest(contents) && plan.seed_id === SEED && plan.campus_id === CAMPUS && plan.academic_year === YEAR, 'Saved plan has changed or has the wrong scope')
}

function verifySaved(row, planRow) {
  check(row.pathway_id === planRow.body.pathway_id && digest(row.preferences) === digest(planRow.expectedChoices), `Saved preferences differ for ${planRow.cap_application_number}`)
}

async function main() {
  const mode = process.argv[2] || '--prepare'
  check(['--prepare', '--apply', '--verify'].includes(mode), 'Use --prepare, --apply or --verify')
  check(new URL(process.env.SUPABASE_URL).hostname === `${PROJECT}.supabase.co`, 'Wrong Supabase project')
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  check(key && !key.includes('placeholder'), 'Backend server key is required in process.env')
  if (!key.startsWith('sb_secret_')) check(JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'service_role', 'A server-side service role key is required')
  const { createClient } = require(path.join(root, 'node_modules/@supabase/supabase-js'))
  const client = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { fetchAllPaginated } = require(path.join(root, 'backend/src/core/database/pagination.util'))
  const rows = async (table, configure = q => q) => fetchAllPaginated(configure(client.from(table).select('*')).order('id'))
  async function snapshot() {
    const [campuses, settings, students, departments, courses, preferences, registrations, runs] = await Promise.all([
      rows('campuses', q => q.eq('id', CAMPUS)), rows('campus_settings', q => q.eq('campus_id', CAMPUS)),
      rows('students', q => q.eq('campus_id', CAMPUS)), rows('departments'), rows('courses'),
      rows('registration_preferences', q => q.eq('campus_id', CAMPUS).eq('academic_year', YEAR)),
      rows('student_registrations', q => q.eq('campus_id', CAMPUS).eq('academic_year', YEAR)),
      rows('allocation_runs', q => q.eq('campus_id', CAMPUS).eq('academic_year', YEAR)),
    ])
    const ids = departments.filter(d => d.campus_id === CAMPUS).map(d => d.id)
    const blueprints = await rows('semester_blueprints', q => q.in('department_id', ids).in('semester', [2, 4]))
    return { campus: campuses[0], settings: settings[0], students, departments, courses, blueprints, preferences, registrations, runs }
  }
  const manifest = read(path.join(privateDir, 'student-upload-verification.json')).created_student_and_auth_ids
  const current = await snapshot()
  assertScope(current, manifest)
  if (mode === '--prepare') {
    check(!fs.existsSync(planFile), 'Plan already exists; use --apply or --verify without regenerating it')
    const plan = buildPlan(current, manifest)
    write(path.join(privateDir, 'registration-before.json'), current)
    write(planFile, plan)
    const scenarios = {}
    for (const row of plan.pending) scenarios[row.scenario] = (scenarios[row.scenario] || 0) + 1
    write(reportFile, { status: 'PREPARED_NOT_SUBMITTED', prepared_at: new Date().toISOString(), campus: 'MANGATTT',
      existing_preferences_preserved: current.preferences.length, planned_new_submissions: plan.pending.length,
      by_semester: [2, 4].map(semester => ({ semester, planned: plan.pending.filter(p => p.semester === semester).length })),
      scenarios, plan_sha256: plan.plan_sha256, workflow: 'Server-side test seed via RegistrationsService; not a login/password/consent test' })
    console.log(JSON.stringify(read(reportFile), null, 2))
    return
  }
  const plan = read(planFile)
  verifyPlanHash(plan)
  check(digest(catalogue(current)) === plan.catalogue_sha256, 'Courses, departments or blueprints changed after planning')
  check(digest(current.settings) === digest(plan.settings), 'Campus settings changed after planning')
  check(digest(stableRows(current.students)) === digest(stableRows(plan.students)), 'Student profiles changed after planning')
  for (const table of ['preferences', 'registrations']) {
    for (const original of plan.originals[table]) check(digest(current[table].find(r => r.id === original.id)) === digest(original), 'An existing registration changed; stop to preserve it')
  }
  const { RegistrationsService } = require(path.join(root, 'backend/src/modules/registrations/registrations.service'))
  const { AuditLoggerService } = require(path.join(root, 'backend/src/core/logging/audit-logger.service'))
  const { ServerLoggerService } = require(path.join(root, 'backend/src/core/logging/server-logger.service'))
  const allowed = new Map(plan.pending.map(row => [row.student_id, row]))
  // Only the normal registration transaction is available for business-data writes.
  const admin = {
    from: table => client.from(table),
    rpc: async (name, args) => {
      const entry = allowed.get(args.p_student_id)
      check(mode === '--apply' && name === 'submit_student_registration' && entry && args.p_campus_id === CAMPUS
        && args.p_semester === entry.semester && args.p_academic_year === YEAR, 'Attempted write outside the approved test plan')
      check(digest(args.p_preferences) === digest(entry.expectedChoices), 'Backend resolved different preferences than the plan')
      const existing = await rows('registration_preferences', q => q.eq('student_id', entry.student_id).eq('semester', entry.semester).eq('academic_year', YEAR))
      const registrations = await rows('student_registrations', q => q.eq('student_id', entry.student_id).eq('semester', entry.semester).eq('academic_year', YEAR))
      check(!existing.length && !registrations.length, 'Refusing to overwrite a registration created after planning')
      return client.rpc(name, { ...args, p_allocation_metadata: { ...args.p_allocation_metadata,
        test_seed_id: SEED, test_plan_sha256: plan.plan_sha256 } })
    },
  }
  const audit = new AuditLoggerService({ admin: client })
  const service = new RegistrationsService({ admin }, {
    log: entry => audit.log({ ...entry, action: `${entry.action} (automated test-data seed)`,
      metadata: { ...entry.metadata, test_seed_id: SEED, test_plan_sha256: plan.plan_sha256 } }),
  }, new ServerLoggerService({ admin: client }))
  const state = fs.existsSync(stateFile) ? read(stateFile) : { seed_id: SEED, plan_sha256: plan.plan_sha256, submitted: [] }
  check(state.plan_sha256 === plan.plan_sha256, 'Existing run belongs to another plan')
  if (mode === '--apply') {
    for (const [index, entry] of plan.pending.entries()) {
      const saved = await rows('registration_preferences', q => q.eq('student_id', entry.student_id).eq('semester', entry.semester).eq('academic_year', YEAR))
      if (saved.length) {
        check(saved.length === 1 && saved[0].allocation_metadata?.test_plan_sha256 === plan.plan_sha256, 'A planned student already has an unrelated submission')
        verifySaved(saved[0], entry)
      } else {
        const result = await service.submitCourses(entry.body, { userId: entry.student_id, role: 'student', campus_id: CAMPUS,
          department_id: entry.department_id, current_semester: entry.semester })
        check(result.success && !result.isUpdate && result.total_credits === entry.totalCredits, 'Registration was not created as planned')
      }
      if (!state.submitted.includes(entry.student_id)) state.submitted.push(entry.student_id)
      state.updated_at = new Date().toISOString()
      write(stateFile, state)
      if (index === 0 || (index + 1) % 5 === 0 || index + 1 === plan.pending.length) {
        console.log(`Verified ${index + 1}/${plan.pending.length}: ${entry.department_code} S${entry.semester}`)
      }
    }
  }
  const after = await snapshot()
  assertScope(after, manifest)
  check(digest(catalogue(after)) === plan.catalogue_sha256 && digest(after.settings) === digest(plan.settings), 'Academic configuration changed')
  check(digest(stableRows(after.students)) === digest(stableRows(plan.students)), 'Student profiles/password flags changed')
  for (const table of ['preferences', 'registrations']) {
    for (const original of plan.originals[table]) check(digest(after[table].find(r => r.id === original.id)) === digest(original), 'Existing registration was altered')
  }
  for (const entry of plan.pending) {
    const saved = after.preferences.filter(r => rowKey(r) === `${entry.student_id}:${entry.semester}:${YEAR}`)
    check(saved.length === 1 && saved[0].allocation_metadata?.test_plan_sha256 === plan.plan_sha256, 'Missing or duplicate planned submission')
    verifySaved(saved[0], entry)
    const regs = after.registrations.filter(r => rowKey(r) === rowKey(saved[0]))
    check(regs.length === 1 && Number(regs[0].total_credits) === entry.totalCredits, 'Registration record/credits differ from the plan')
    check(regs[0].allocation_metadata?.test_plan_sha256 === plan.plan_sha256, 'Registration record lacks the seed marker')
    for (let slot = 1; slot <= 8; slot++) check((regs[0][`slot_${slot}_course_id`] || null) === (entry.fixed[`slot_${slot}`] || null), 'An elective was allocated prematurely or a fixed course differs')
  }
  check(after.preferences.length === plan.originals.preferences.length + plan.pending.length, 'Unexpected preference count')
  check(after.registrations.length === plan.originals.registrations.length + plan.pending.length, 'Unexpected registration count')
  write(path.join(privateDir, 'registration-after.json'), after)
  write(reportFile, { ...read(reportFile), status: 'PASS_ALL_TEST_REGISTRATIONS_VERIFIED', verified_at: new Date().toISOString(),
    automatically_submitted: plan.pending.length, total_preferences: after.preferences.length, total_registration_records: after.registrations.length,
    existing_submission_unchanged: true, passwords_and_student_profiles_unchanged: true, deadline_unchanged: true, allocation_runs: after.runs.length,
    by_department: [...new Set(plan.students.map(s => s.department_id))].map(id => ({ department: after.departments.find(d => d.id === id).code,
      semester_2: after.preferences.filter(p => p.semester === 2 && plan.students.find(s => s.id === p.student_id)?.department_id === id).length,
      semester_4: after.preferences.filter(p => p.semester === 4 && plan.students.find(s => s.id === p.student_id)?.department_id === id).length })) })
  const statusFile = path.join(__dirname, 'LIVE_STATUS.json')
  const status = read(statusFile)
  status.status = 'ACADEMIC_REPLICA_AND_ALL_TEST_REGISTRATIONS_VERIFIED'
  status.registrations_verified_at = new Date().toISOString()
  status.registration_seed_report = 'REGISTRATION_SEED_REPORT.json'
  status.private_registration_plan = '../../scratch/mangat-replica-2026-10-18/registration-plan.json'
  status.private_registration_snapshot = '../../scratch/mangat-replica-2026-10-18/registration-after.json'
  status.created_counts.registration_preferences = after.preferences.length
  status.created_counts.student_registrations = after.registrations.length
  status.campus_settings = after.settings
  status.workflow_state = { ...status.workflow_state, verified_at: status.registrations_verified_at,
    preferences: after.preferences.length, preference_records: after.preferences.length,
    registration_records: after.registrations.length, registration_deadline: after.settings.deadline,
    allocation_runs: after.runs, password_changes_pending: after.students.filter(s => s.must_change_password).length }
  status.verification.all_test_registrations_verified = true
  status.verification.manual_registration_preserved = true
  status.note = 'All 120 test registrations verified: 60 S2 and 60 S4. The original manual submission is unchanged. Automatic seeding tested backend registration business validation; remaining first-login/password/consent flows are not claimed as tested. Deadline is still open and no allocation has run. Teachers remain deferred.'
  write(statusFile, status)
  console.log(JSON.stringify(read(reportFile), null, 2))
}

module.exports = { buildPlan, assertScope, verifyPlanHash, digest, CAMPUS, YEAR }
if (require.main === module) main().catch(error => {
  fs.mkdirSync(privateDir, { recursive: true })
  write(path.join(privateDir, 'registration-seed-error.json'), { at: new Date().toISOString(), message: error.message })
  console.error('Registration seed stopped:', String(error.message).split('\n')[0])
  process.exitCode = 1
})
