const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SubmitAttendanceSchema, CopyPracticalSchema, CalendarDate, AcademicYear } = require('../contracts/validation.cjs')
const id = '00000000-0000-4000-8000-000000000001'

test('shared provisioning contracts bound passwords, academic years and teacher affiliation', () => {
  const {TeacherProvisioningSchema,StudentProvisioningSchema,FacultyProvisioningSchema}=require('../contracts/validation.cjs')
  const base={full_name:'Teacher',email:'teacher@test.invalid',password:'a'.repeat(257)}
  assert.equal(TeacherProvisioningSchema.safeParse(base).success,false)
  const valid={...base,password:'Safe-password-123'}
  assert.equal(TeacherProvisioningSchema.safeParse(valid).success,true)
  const student={...valid,cap_application_number:'CAP1',current_semester:'10',academic_year_joined:'2026-28'}
  assert.equal(StudentProvisioningSchema.safeParse(student).success,false)
  assert.equal(StudentProvisioningSchema.parse({...student,academic_year_joined:'2026-27'}).current_semester,10)
  assert.equal(FacultyProvisioningSchema.safeParse({...valid,role:'teacher',campus_id:id}).success,false)
  assert.equal(FacultyProvisioningSchema.safeParse({...valid,role:'teacher',campus_id:id,department_id:id}).success,true)
})
test('attendance boundary rejects duplicate IDs and absent, malformed or unsafe revisions', () => {
  for (const expected_revision of [undefined, null, -1, 0.5, '0', '1abc', Infinity, 2147483648]) {
    assert.equal(SubmitAttendanceSchema.safeParse({ timetable_slot_id: id, expected_revision }).success, false)
  }
  assert.equal(SubmitAttendanceSchema.safeParse({ timetable_slot_id: id, expected_revision: 0, absent_student_ids: [id, id] }).success, false)
  assert.equal(SubmitAttendanceSchema.safeParse({ timetable_slot_id: id, expected_revision: 0 }).success, true)
})
test('practical copy requires a revision and rejects conflicting compatibility aliases', () => {
  const body = { source_slot_id: id, target_slot_id: id, attendance_date: '2026-11-02' }
  assert.equal(CopyPracticalSchema.safeParse(body).success, false)
  assert.equal(CopyPracticalSchema.safeParse({ ...body, expected_revision: 0 }).success, true)
  assert.equal(CopyPracticalSchema.safeParse({ ...body, expected_revision: 1, expected_target_revision: 0 }).success, false)
})
test('calendar and academic year validation rejects rollover dates and nonconsecutive years', () => {
  assert.equal(CalendarDate.safeParse('2026-02-29').success, false)
  assert.equal(CalendarDate.safeParse('2028-02-29').success, true)
  assert.equal(AcademicYear.safeParse('2026-28').success, false)
  assert.equal(AcademicYear.safeParse('2099-00').success, true)
})

test('shared blueprint contract rejects inverted credit ranges and oversized pathways', () => {
  const {BlueprintUpdateSchema}=require('../contracts/validation.cjs')
  assert.equal(BlueprintUpdateSchema.safeParse({semester:10,min_credits:20,max_credits:10}).success,false)
  const pathway={name:'Research',slots:[{rule:'fixed',target:id}]}
  assert.equal(BlueprintUpdateSchema.safeParse({semester:10,min_credits:0,max_credits:20,pathways:Array(101).fill(pathway)}).success,false)
  assert.equal(BlueprintUpdateSchema.safeParse({semester:10,min_credits:0,max_credits:20,pathways:[pathway]}).success,true)
})
