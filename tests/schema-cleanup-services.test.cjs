const { test } = require('node:test')
const assert = require('node:assert/strict')
const { StudentService } = require('../backend/dist/modules/student/student.service')
const { AllocationService } = require('../backend/dist/modules/allocation/allocation.service')
const { HodService } = require('../backend/dist/modules/hod/hod.service')
const user = { userId: 'student', campus_id: 'campus', department_id: 'dept', role: 'student' }

function fixture() {
  const records = {
    students: [{ id: 'student', campus_id: 'campus', department_id: 'dept', current_semester: 1, full_name: 'Student', departments: { name: 'Department' }, campuses: { name: 'Campus' } }],
    campus_settings: [{ id: 'settings', campus_id: 'campus', academic_year: '2026-27', deadline: '2100-01-01T00:00:00Z' }],
    student_registrations: [{ id: 'reg', student_id: 'student', semester: 1, academic_year: '2026-27', slot_1_course_id: 'course', total_credits: 4, selections: [{ course_id: 'stale-course' }], allocation_metadata: { slot_1: { allocated_by: 'hod' } } }],
    registration_preferences: [],
    system_logs: [{ id: 'timetable', log_type: 'timetable_job', campus_id: 'campus', academic_year: '2026-27', semester: 1, status: 'completed' }],
    courses: [{ id: 'course', course_code: 'TEST101', title: 'Confirmed course', credits: 4, departments: { name: 'Department' } }],
    semester_blueprints: [],
  }
  const writes = []
  const admin = { from(table) {
    table = ({ current_student_registrations: 'student_registrations', current_system_logs: 'system_logs' })[table] || table
    assert.ok(Object.hasOwn(records, table), `Retired or unexpected table/view ${table}`)
    const filters = []
    let limit = Infinity, sorting, single = false, bounds
    const query = {
      select(columns) {
        if (table === 'student_registrations') assert.doesNotMatch(columns, /\b(preferences|selected_courses)\b/)
        if (table === 'registration_preferences') assert.doesNotMatch(columns, /\ballocation_metadata\b/)
        if (table === 'system_logs') assert.doesNotMatch(columns, /\b(triggered_at|summary|total_students|fully_allocated|partially_allocated|unallocated)\b/)
        return this
      },
      eq(key, value) { filters.push(row => row[key] === value); return this },
      in(key, values) { filters.push(row => values.includes(row[key])); return this },
      order(key, options) { sorting = { key, descending: options?.ascending === false }; return this },
      limit(value) { limit = value; return this },
      range(start, end) { bounds = [start, end]; return this },
      single() { single = true; return this },
      maybeSingle() { single = true; return this },
      upsert(payload) { writes.push({ table, payload }); return Promise.resolve({ data: null, error: null }) },
      then(resolve, reject) {
        let data = records[table].filter(row => filters.every(filter => filter(row)))
        if (sorting) data.sort((a,b) => String(a[sorting.key]).localeCompare(String(b[sorting.key])) * (sorting.descending ? -1 : 1))
        data = data.slice(0, limit)
        if (bounds) data = data.slice(bounds[0], bounds[1] + 1)
        return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve, reject)
      },
    }
    return query
  } }
  return { admin, records, writes }
}

test('student dashboard retains confirmed courses without a preference row and ignores unrelated log types', async () => {
  const db = fixture()
  const response = await new StudentService({ admin: db.admin }, {}, {}).getDashboardSummary(user)
  assert.equal(response.hasRegistration, true)
  assert.equal(response.hasSubmission, true)
  assert.equal(response.allocationCompleted, false)
  assert.deepEqual(response.enrolledCourses.map(c => c.id), ['course'])
  assert.equal(response.totalRegisteredCredits, 4)
})

test('student dashboard never reconstructs confirmed enrolments from a stale selections snapshot', async () => {
  const db = fixture()
  db.records.student_registrations[0].slot_1_course_id = null
  const response = await new StudentService({ admin: db.admin }, {}, {}).getDashboardSummary(user)
  assert.equal(response.hasRegistration, false)
  assert.deepEqual(response.enrolledCourses, [])
})

test('allocation status reads only the matching campus/cohort allocation log and preserves its API', async () => {
  const db = fixture()
  db.records.system_logs.push({ id: 'run', log_type: 'allocation_run', campus_id: 'campus', academic_year: '2026-27', semester: 1, status: 'completed', started_at: '2026-10-01', completed_at: '2026-10-02', metadata: { total_students: 2, fully_allocated: 1, partially_allocated: 0, unallocated: 1, summary: { unresolved_core_slots: 1 } } })
  db.records.system_logs.push({ ...db.records.system_logs[1], id: 'other-campus', campus_id: 'elsewhere', started_at: '2026-10-03' })
  const response = await new AllocationService({ admin: db.admin }, {}, {}).getRunStatus('2026-27', 1, { ...user, role: 'campus_director' })
  assert.equal(response.run.id, 'run')
  assert.equal(response.run.triggered_at, '2026-10-01')
  assert.equal(response.run.total_students, 2)
  assert.deepEqual(response.run.summary, { unresolved_core_slots: 1 })
  assert.deepEqual(Object.keys(response.run).sort(), ['id','status','academic_year','semester','campus_id','triggered_at','completed_at','error_message','summary','total_students','fully_allocated','partially_allocated','unallocated'].sort())
})

test('HOD blueprint saves only pathways and keeps pathway identity without flat compatibility writes', async () => {
  const db = fixture()
  const pathway = { id: 'existing', name: 'Main', slots: [{ rule: 'GLOBAL_BASKET', target: 'DSC', name: 'Elective' }] }
  await new HodService({ admin: db.admin }, { log: async () => {} }, {}, {}).updateBlueprint({ semester: 1, min_credits: 0, max_credits: 40, pathways: [pathway] }, { ...user, role: 'hod' })
  assert.equal(db.writes.length, 1)
  assert.equal(db.writes[0].payload.pathways[0].id, 'existing')
  assert.equal(Object.keys(db.writes[0].payload).some(key => /^slot_/.test(key)), false)
  const { getBlueprintPathways } = require('../backend/dist/core/utils/slotRules')
  assert.deepEqual(getBlueprintPathways({ slot_1_rule: 'FIXED', slot_1_target: 'OLD' }), [])
})
