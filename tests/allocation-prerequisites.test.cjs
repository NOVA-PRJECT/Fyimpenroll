const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const { AllocationService } = require('../backend/dist/modules/allocation/allocation.service')

async function allocate(students, preferences, courses, existing = [], pathwaySlots = [{ rule: 'GLOBAL_BASKET', target: 'SEC', name: 'Elective' }]) {
  let committed
  const rows = {
    campus_settings: [{ campus_id: 'campus', deadline: '2020-01-01' }], timetable_entries: [],
    courses: courses.map(course => ({ semester: 3, department_id: 'dept', category: 'SEC', seat_limit: 1, title: course.id, course_code: course.id, prerequisites: ['Know C.'], ...course })),
    students: students.map(student => ({ department_id: 'dept', current_semester: 3, departments: { code: 'CS' }, ...student })),
    registration_preferences: preferences.map((preference, i) => ({ id: `pref-${i}`, campus_id: 'campus', semester: 3, academic_year: '2026-27', pathway_id: 'path', ...preference })),
    semester_blueprints: [{ id: 'blueprint', department_id: 'dept', semester: 3, pathways: [{ id: 'path', name: 'Path', slots: pathwaySlots }] }],
    departments: [{ id: 'dept', code: 'CS' }], student_registrations: existing,
  }
  const queried = []
  const admin = {
    from(table) {
      table = ({ current_timetable_entries: 'timetable_entries', current_student_registrations: 'student_registrations' })[table] || table
      assert.ok(rows[table], `Unexpected table query: ${table}`)
      queried.push(table)
      const filters = []; let single = false, bounds
      const query = {
        select() { return this }, order() { return this },
        eq(key, value) { filters.push(row => row[key] === value); return this },
        in(key, values) { filters.push(row => values.includes(row[key])); return this },
        lt() { assert.fail('allocation must not load prior registrations for prerequisites') },
        range(from, to) { bounds = [from, to]; return this },
        maybeSingle() { single = true; return this },
        then(resolve, reject) {
          let data = rows[table].filter(row => filters.every(filter => filter(row)))
          if (bounds) data = data.slice(bounds[0], bounds[1] + 1)
          return Promise.resolve({ data: single ? data[0] || null : data, count: data.length, error: null }).then(resolve, reject)
        },
      }
      return query
    },
    async rpc(name, args) {
      if (name === 'run_current_term_operation') {
        assert.equal(args.p_expected_term, 0)
        name = args.p_operation; args = args.p_payload
      }
      if (name === 'claim_allocation_run') return { data: 'run', error: null }
      if (name === 'apply_course_allocation') { committed = args; return { data: { success: true }, error: null } }
      assert.fail(`Unexpected RPC ${name}`)
    },
  }
  const service = new AllocationService({ admin }, { log: async () => {} }, {})
  await service.runAllocation({ academicYear: '2026-27', semester: 3 }, { userId: 'director', role: 'campus_director', campus_id: 'campus', term_version: 0 })
  assert.equal(queried.includes('course_prerequisite_rules'), false)
  return committed
}
const pref = (student_id, submitted_at, choices) => ({ student_id, submitted_at, preferences: { slot_1: choices.map((course_id, i) => ({ course_id, rank: i + 1 })) } })

test('allocation uses capacity, preference rounds and timestamp despite course guidance and no answers', async () => {
  const result = await allocate([{ id: 'later' }, { id: 'earlier' }], [
    pref('later', '2026-10-01T10:00:00Z', ['A', 'B']), pref('earlier', '2026-10-01T09:00:00Z', ['A', 'B']),
  ], [{ id: 'A' }, { id: 'B' }])
  assert.deepEqual(result.p_allocations.map(row => [row.student_id, row.course_id, row.metadata.round]), [['earlier', 'A', 1], ['later', 'B', 2]])
  assert.ok(result.p_allocations.every(row => row.metadata.score === 0))
})

test('student ID breaks exact ties and globally filled seats are not allocated again', async () => {
  const result = await allocate([{ id: 'b' }, { id: 'a' }], [
    pref('b', '2026-10-01T09:00:00Z', ['FULL', 'A']), pref('a', '2026-10-01T09:00:00Z', ['FULL', 'A']),
  ], [{ id: 'FULL' }, { id: 'A' }], [{ student_id: 'other-campus', semester: 3, academic_year: '2026-27', slot_1_course_id: 'FULL' }])
  assert.deepEqual(result.p_allocations.map(row => [row.student_id, row.course_id]), [['a', 'A']])
  assert.equal(result.p_unallocated[0].student_id, 'b')
})

test('fixed papers and elective winners are sent in the same atomic allocation commit', async () => {
  const result = await allocate([{id:'student'}], [{student_id:'student',submitted_at:'2026-10-01',preferences:[
    {slot:1,is_fixed:true,choices:[{course_id:'FIX',rank:1}]},{slot:2,is_fixed:false,choices:[{course_id:'SEC',rank:1}]},
  ]}], [{id:'FIX',course_code:'FIX101',category:'DSC'},{id:'SEC'}], [],
  [{rule:'FIXED',target:'FIX101',name:'Fixed'},{rule:'GLOBAL_BASKET',target:'SEC',name:'Elective'}])
  assert.deepEqual(result.p_allocations.map(row=>[row.slot_key,row.course_id,row.allocated_by]),[['slot_1','FIX','fixed'],['slot_2','SEC','rank_1']])
})


test('course prerequisite API validation accepts point lists and rejects malformed entries', () => {
  const { CoursePrerequisitesSchema } = require('../backend/dist/modules/hod/hod.controller')
  assert.deepEqual(CoursePrerequisitesSchema.parse([' Know C. ', 'Understand algorithms.']), ['Know C.', 'Understand algorithms.'])
  assert.deepEqual(CoursePrerequisitesSchema.parse([]), [])
  for (const value of [null, {}, [''], ['   '], [5], ['x'.repeat(501)], Array(21).fill('Know C.')]) {
    assert.equal(CoursePrerequisitesSchema.safeParse(value).success, false)
  }
})
