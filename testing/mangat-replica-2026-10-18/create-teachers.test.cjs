'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { allocateTeachers, parallelComponents, assertAuth, assertProfile, CAMPUS, PILOT_ID, PILOT_COURSE, SHARED_HINDI, MAX_HOURS } = require('./create-teachers.cjs');
const dept = { id: 'eco', code: 'ECOTT', campus_id: CAMPUS };
const course = (id, hours = 4) => ({ id, course_code: id, department_id: dept.id, semester: 2, theory_hours_per_week: hours, practical_hours_per_week: 0, expected_students: 10 });
const pilot = { id: 'pilot-delivery', teacher_id: PILOT_ID, course_id: PILOT_COURSE, campus_id: CAMPUS, academic_year: '2026-27', semester: 2 };
test('transitively parallel papers receive distinct teachers while preserving the pilot', () => {
  const courses = [course(PILOT_COURSE), course('b'), course('c')];
  const components = parallelComponents([{ courses: courses.map(c => ({ courseId: c.id })), parallelGroups: [{ courseIds: [PILOT_COURSE, 'b'] }, { courseIds: ['b', 'c'] }] }]);
  const result = allocateTeachers(courses, [dept], components, pilot);
  assert.equal(result.teachers.length, 3);
  assert.equal(result.assignments.find(a => a.course_id === PILOT_COURSE).id, pilot.id);
  assert.equal(result.teachers[0].existing_id, PILOT_ID);
});
test('staffing splits course hours across teachers at the 12-hour bound', () => {
  const courses = [PILOT_COURSE, 'b', 'c', 'd', 'e'].map(id => course(id, 6));
  const result = allocateTeachers(courses, [dept], new Map(courses.map(c => [c.id, c.id])), pilot);
  assert.equal(result.teachers.length, 3);
  assert.ok(result.teachers.every(t => t.weekly_hours <= MAX_HOURS));
  assert.equal(result.teachers.reduce((n, t) => n + t.weekly_hours, 0), 30);
});
test('shared Hindi uses a test ECOTT teacher and a test-campus delivery', () => {
  const courses = [course(PILOT_COURSE), { ...course(SHARED_HINDI, 3), department_id: 'real-hin' }];
  const result = allocateTeachers(courses, [dept], new Map(courses.map(c => [c.id, c.id])), pilot);
  const delivery = result.assignments.find(a => a.course_id === SHARED_HINDI);
  assert.equal(delivery.campus_id, CAMPUS);
  assert.equal(delivery.teacher_department_id, dept.id);
  assert.equal(delivery.shared_delivery, true);
  assert.ok(result.teachers.every(t => t.department_id === dept.id));
});
test('unapproved real departments cannot receive teacher accounts', () => {
  const courses = [course(PILOT_COURSE), { ...course('unapproved'), department_id: 'real-dept' }];
  assert.throws(() => allocateTeachers(courses, [dept], new Map(courses.map(c => [c.id, c.id])), pilot), /outside the test campus/);
});
test('an Auth collision cannot be adopted without this seed and plan marker', () => {
  const teacher = { email: 'teacher.ecott.02.mangattt.20261018@example.test', department_id: dept.id };
  const user = { email: teacher.email, email_confirmed_at: 'now', app_metadata: { role: 'teacher', campus_id: CAMPUS, department_id: dept.id } };
  assert.throws(() => assertAuth(user, teacher, { sha256: 'plan' }), /collision outside this plan/);
  assert.throws(() => assertAuth({ ...user, app_metadata: { ...user.app_metadata, campus_id: 'real-campus' } }, teacher, { sha256: 'plan' }), /identity mismatch/);
});
test('existing faculty with another department or role cannot be overwritten', () => {
  const teacher = { full_name: 'TT ECOTT Teacher 02', email: 'teacher.ecott.02.mangattt.20261018@example.test', role: 'teacher', campus_id: CAMPUS, department_id: dept.id };
  assert.throws(() => assertProfile({ id: 'id', ...teacher, department_id: 'real-dept' }, teacher, 'id'), /Faculty mismatch/);
  assert.throws(() => assertProfile({ id: 'id', ...teacher, role: 'hod' }, teacher, 'id'), /Faculty mismatch/);
});
