const { test } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const { StudentPortalService } = require('../backend/dist/modules/student/student-portal.service')
const { mutateTeacherAssignments } = require('../backend/dist/core/database/teacher-mutations')

function database() {
  const rows = {
    students: [{ id: 'student', campus_id: 'campus', department_id: 'dept', current_semester: 1 }],
    campus_settings: [{ campus_id: 'campus', academic_year: '2026-27' }],
    student_registrations: [{ id: 'reg', student_id: 'student', campus_id: 'campus', semester: 1, academic_year: '2026-27', slot_1_course_id: 'course' }],
    courses: [{ id: 'course', course_code: 'TEST101', title: 'Course', credits: 4, category: 'DSC', prerequisites: ['Know C.', 'Understand algorithms.'] }],
    teacher_course_assignments: [
      { id: 'valid', course_id: 'course', teacher_id: 'teacher', campus_id: 'campus', semester: 1, academic_year: '2026-27' },
      { id: 'other-campus', course_id: 'course', teacher_id: 'other', campus_id: 'elsewhere', semester: 1, academic_year: '2026-27' },
      { id: 'old', course_id: 'course', teacher_id: 'old', campus_id: 'campus', semester: 1, academic_year: '2025-26' },
    ],
    faculty: [{ id: 'teacher', full_name: 'Assigned Teacher' }, { id: 'other', full_name: 'Other Teacher' }],
  }
  const selections = []
  return { rows, selections, admin: { from(table) {
    const filters = []; let single = false, bounds
    return {
      select(value) { selections.push({ table, value }); assert.equal(value.includes('faculty!'), false); return this },
      eq(key, value) { filters.push(row => row[key] === value); return this },
      in(key, values) { filters.push(row => values.includes(row[key])); return this },
      order() { return this }, limit() { return this },
      range(from, to) { bounds = [from, to]; return this },
      maybeSingle() { single = true; return this },
      then(resolve, reject) {
        let data = rows[table].filter(row => filters.every(filter => filter(row)))
        if (bounds) data = data.slice(bounds[0], bounds[1] + 1)
        return Promise.resolve({ data: single ? data[0] || null : data, error: null }).then(resolve, reject)
      },
    }
  } } }
}

test('student courses resolve teacher names without a nonexistent foreign-key join', async () => {
  const db = database()
  const courses = await new StudentPortalService(db, {}, {}).courses({ userId: 'student' })
  assert.equal(courses[0].faculty_name, 'Assigned Teacher')
  assert.equal(courses[0].id, 'course')
  assert.ok(db.selections.some(selection => selection.table === 'faculty' && selection.value === 'id, full_name'))
})

test('enrolled courses remain available when no teacher is assigned', async () => {
  const db = database(); db.rows.teacher_course_assignments = []
  const courses = await new StudentPortalService(db, {}, {}).courses({ userId: 'student' })
  assert.equal(courses[0].faculty_name, null)
})

test('a failed atomic teacher change is propagated without direct table fallbacks', async () => {
  for (const [code, status] of [['23514',400], ['P4030',403], ['P4040',404], ['23P01',409], ['XX000',500]]) {
    const db = { admin: { rpc: async () => ({ data: null, error: { code, message: 'synthetic failure' } }), from() { assert.fail('must never use partial table writes') } } }
    await assert.rejects(mutateTeacherAssignments(db, { userId: 'actor', role: 'hod', campus_id: 'campus', term_version: 0 }, { p_actor_id: 'actor', p_operation: 'substitute' }), error => error.getStatus() === status)
  }
})


test('course details expose ordered points and retain the mobile display string without rule queries', async () => {
  const db = database()
  const course = await new StudentPortalService(db, {}, {}).course({ userId: 'student' }, 'course')
  assert.deepEqual(course.prerequisite_points, ['Know C.', 'Understand algorithms.'])
  assert.equal(course.prerequisites, 'Know C.; Understand algorithms.')
  assert.equal(db.selections.some(item => item.table === 'course_prerequisite_rules'), false)
})
