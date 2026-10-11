const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TimetableService } = require('../dist/modules/timetable/timetable.service');
const { loadTimetableAudience } = require('../dist/modules/timetable/timetable-audience');

function fixture() {
  const dept = (id, campus = 'campus') => ({ id, campus_id: campus, name: id, code: id });
  const registration = (student, department, patch = {}) => ({ student_id: student, students: { department_id: department },
    campus_id: 'campus', academic_year: '2026-27', semester: 1, ...patch });
  const entry = (course, owner, category = 'DSC', campus = 'campus') => ({ id: `entry-${course}-${campus}`, campus_id: campus,
    academic_year: '2026-27', semester: 1, department_id: owner, course_id: course, status: 'draft',
    time_slots: { day_of_week: 1, period_number: 1 }, courses: { id: course, course_code: course, category } });
  const tables = {
    departments: [dept('it'), dept('math'), dept('stats'), dept('foreign', 'other-campus')],
    student_registrations: [registration('student-it', 'it', { slot_1_course_id: 'it-major', slot_2_course_id: 'math-minor',
      slot_3_course_id: 'stats-minor', slot_7_course_id: 'extra-seven', slot_8_course_id: 'extra-eight' }),
      registration('student-math', 'math', { slot_1_course_id: 'math-minor', slot_2_course_id: 'it-major' }),
      registration('student-foreign', 'foreign', { campus_id: 'other-campus', slot_1_course_id: 'foreign-major' })],
    timetable_entries: [entry('it-major', 'it'), entry('math-minor', 'math'), entry('stats-minor', 'stats'),
      entry('extra-seven', 'stats'), entry('extra-eight', 'stats'), entry('campus-mdc', 'stats', 'MDC'),
      entry('foreign-major', 'foreign', 'DSC', 'other-campus')],
    system_logs: [], timetable_conflicts: [],
  };
  const queries = [];
  let failedTable;
  const db = { from(table) {
    const conditions = []; let start = 0, end = Infinity, projection;
    const result = () => ({ error: table === failedTable ? { message: 'Provider unavailable' } : null,
      data: (table === 'students' ? [...new Map(tables.student_registrations.map(r => [r.student_id,
        { id: r.student_id, department_id: r.students?.department_id }])).values()] : tables[table])
        .filter(row => conditions.every(check => check(row))).slice(start, end + 1).map(row => {
          // Match PostgREST: an unselected top-level ID is not available just
          // because it also exists inside the embedded course relationship.
          if (table === 'timetable_entries' && !/(?:^|,)\s*course_id\s*(?:,|$)/.test(projection || '')) {
            const { course_id, ...selected } = row; return selected;
          }
          return row;
        }) });
    const q = { select(value) { projection = value; queries.push({ table, projection, conditions }); return q; },
      eq(column, value) { conditions.push(row => row[column] === value); return q; },
      in(column, values) { conditions.push(row => values.includes(row[column])); return q; },
      or(value) {
        const campus = value.match(/campus_id.eq.([^,]+)/)?.[1];
        const departments = value.match(/department_id.in.\(([^)]+)\)/)?.[1].split(',') || [];
        conditions.push(row => row.campus_id === campus || row.campus_id == null && departments.includes(row.department_id)); return q;
      }, order() { return q; }, limit(n) { end = n - 1; return q; },
      range(from, to) { start = from; end = to; return q; },
      async maybeSingle() { const r = result(); return { ...r, data: r.data[0] || null }; },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    }; return q;
  } };
  const service = new TimetableService({ admin: db }, { log: async () => {} }, { warn() {}, error() {} });
  return { tables, registration, entry, db, service, queries, fail: table => { failedTable = table; } };
}
const director = { role: 'campus_director', userId: 'director', campus_id: 'campus' };

test('director cohort view includes both external minors and all eight registration slots without leaking identities', async () => {
  const f = fixture(); const result = await f.service.getEntries('2026-27', 1, 'it', director);
  assert.deepEqual(result.departments.map(d => d.id), ['it', 'math']);
  assert.deepEqual(result.departments.map(d => d.registeredStudentCount), [1, 1]);
  assert.deepEqual(result.entries.map(e => e.courseId), ['it-major', 'math-minor', 'stats-minor', 'extra-seven', 'extra-eight', 'campus-mdc']);
  assert.deepEqual(result.entries.find(e => e.courseId === 'stats-minor').enrolledDepartmentIds, ['it']);
  assert.equal(result.entries.find(e => e.courseId === 'stats-minor').departmentId, 'stats', 'Course ownership is retained');
  assert.ok(!JSON.stringify(result).includes('student-it'));
  assert.ok(!JSON.stringify(result).includes('other-campus'));
  assert.ok(!result.entries.some(e => e.courseId === 'foreign-major'));
});
test('departments without cohort students do not produce grids; another term does not borrow registrations', async () => {
  const f = fixture();
  assert.deepEqual((await f.service.getEntries('2026-27', 1, 'stats', director)).entries, []);
  const empty = await f.service.getEntries('2026-27', 2, undefined, director);
  assert.deepEqual(empty.departments, []); assert.deepEqual(empty.entries, []);
  await assert.rejects(f.service.getEntries('2026-27', 1, 'foreign', director), /does not belong/);
});
test('incomplete review entries and unscheduled minor sessions use the same enrollment audience', async () => {
  const f = fixture();
  f.tables.system_logs.push({ log_type: 'timetable_job', campus_id: 'campus', academic_year: '2026-27', semester: 1,
    status: 'completed', metadata: { reviewDraft: { kind: 'review_draft', unscheduledPeriods: 2,
      entries: [{ courseId: 'stats-minor', departmentId: 'stats', category: 'DSC' }],
      conflicts: [{ courseId: 'math-minor', departmentId: 'math', category: 'DSC', periods: 2 }] } } });
  const result = await f.service.getEntries('2026-27', 1, 'it', director);
  assert.equal(result.reviewDraft, true); assert.equal(result.unscheduledPeriods, 2);
  assert.equal(result.entries.length, 1); assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0].enrolledDepartmentIds, ['it', 'math']);
});
test('enrollment failures produce a retryable 503, never a misleading empty timetable', async () => {
  const f = fixture(); f.fail('student_registrations');
  await assert.rejects(f.service.getEntries('2026-27', 1, undefined, director), error => error.getStatus() === 503);
});
test('audience pagination includes students beyond the API cap and deduplicates department counts', async () => {
  const f = fixture();
  f.tables.student_registrations = Array.from({ length: 1005 }, (_, i) => f.registration(`student-${i}`, 'it', { slot_8_course_id: i === 1004 ? 'last-minor' : 'major' }));
  f.tables.student_registrations.push(f.tables.student_registrations[0]);
  const audience = await loadTimetableAudience(f.db, 'campus', '2026-27', 1);
  assert.equal(audience.departmentCounts.get('it'), 1005);
  assert.deepEqual(audience.courseDepartments.get('last-minor'), ['it']);
});
test('HOD course-management scoping and student published-only access remain enforced', async () => {
  const f = fixture();
  const hod = { ...director, role: 'hod', department_id: 'it' };
  const own = await f.service.getEntries('2026-27', 1, undefined, hod);
  assert.deepEqual(own.entries.map(e => e.courseId), ['it-major']);
  await assert.rejects(f.service.getEntries('2026-27', 1, 'math', hod), /own department/);
  const student = { ...director, role: 'student', department_id: 'it', userId: 'student-it' };
  assert.deepEqual((await f.service.getEntries('2026-27', 1, undefined, student)).entries, []);
});
