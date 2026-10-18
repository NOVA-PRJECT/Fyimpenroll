'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true });
const { createWindowRule, restoreBrowserRules, validateSchedulingRules, appliesToSemester } = require('../../frontend/src/core/utils/schedulingRules');
const { RuleDefinitionSchema } = require('../src/modules/timetable/solver/schemas');
const { validateTimetable } = require('../src/modules/timetable/solver/validator');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/modules/timetable/solver/constraints.base.json'), 'utf8')).rules;
const window = (kind, semester, category, day, period) => ({ ...createWindowRule(kind, semester, `${kind}-${semester}-${category}`), ...(category ? { targetCategory: category } : {}), parameters: { days: [day], periods: [period] } });
const rules = [window('DAY_WINDOW', 2, null, 2, 4), window('CATEGORY_WINDOW', 2, 'AEC', 2, 4), window('DAY_WINDOW', 4, null, 5, 5), window('CATEGORY_WINDOW', 4, 'SEC', 5, 5)];
const course = (id, category) => ({ courseId: id, courseCode: id, courseTitle: id, departmentId: 'dept', departmentName: 'Department', category, theoryHours: 1, practicalHours: 0, isCrossDept: false, studentIds: new Set([id]), teacherId: `teacher-${id}`, conflictSummary: '' });
const slot = (day, period) => ({ day, period, sessionType: 'theory', isLabBlock: false });
const slots = new Map(Array.from({ length: 5 }, (_, i) => [i + 1, new Map(Array.from({ length: 6 }, (_, p) => [p + 1, `${i + 1}-${p + 1}`]))]));

test('director-created S2 and S4 category rules survive the backend request schema', () => {
  for (const semester of [2, 4, 6]) {
    const rule = createWindowRule('CATEGORY_WINDOW', semester, `custom-${semester}`);
    assert.equal(validateSchedulingRules([rule]), '');
    const saved = RuleDefinitionSchema.parse(rule);
    assert.equal(saved.targetSemester, semester);
    assert.equal(saved.kind, 'CATEGORY_WINDOW');
    assert.deepEqual(saved.parameters.days, [1, 2, 3, 4, 5]);
  }
});
test('browser edits preserve other semesters and merge new repository defaults', () => {
  const cached = [base[0], rules[1], rules[3]];
  const restored = restoreBrowserRules(base, JSON.stringify(cached));
  assert.ok(restored.some(r => r.id === 'sem1_aec_first_paper'));
  assert.ok(restored.some(r => r.id === 'sem3_vac_window'));
  assert.ok(restored.some(r => r.id === rules[1].id));
  assert.ok(restored.some(r => r.id === rules[3].id));
  assert.equal(restored.filter(r => appliesToSemester(r, 2)).some(r => r.targetSemester === 4), false);
  assert.equal(restored.filter(r => appliesToSemester(r, 4)).some(r => r.targetSemester === 2), false);
});
test('invalid saved rules and empty or out-of-range windows block saving', () => {
  assert.throws(() => restoreBrowserRules(base, JSON.stringify([null])), /invalid/);
  assert.notEqual(validateSchedulingRules([{ ...rules[1], parameters: { days: [], periods: [4] } }]), '');
  assert.notEqual(validateSchedulingRules([{ ...rules[1], parameters: { days: [2], periods: [7] } }]), '');
  assert.notEqual(validateSchedulingRules([{ ...rules[1], targetSemester: 11 }]), '');
  assert.notEqual(validateSchedulingRules([rules[1], rules[1]]), '');
});
for (const [semester, category, day, period] of [[2, 'AEC', 2, 4], [4, 'SEC', 5, 5]]) {
  test(`validator applies S${semester} windows while ignoring the other semester`, () => {
    const c = course(`S${semester}-paper`, category);
    assert.deepEqual(validateTimetable({ assignments: [{ courseId: c.courseId, slots: [slot(day, period)] }] }, [c], slots, [], [], { semester, effectiveRules: rules }), []);
    const invalid = validateTimetable({ assignments: [{ courseId: c.courseId, slots: [slot(1, 1)] }] }, [c], slots, [], [], { semester, effectiveRules: rules });
    assert.ok(invalid.some(v => v.type === 'invalid_window'));
  });
}
test('a category window leaves unrelated DSC papers unrestricted', () => {
  const c = course('DSC-paper', 'DSC');
  assert.deepEqual(validateTimetable({ assignments: [{ courseId: c.courseId, slots: [slot(1, 1)] }] }, [c], slots, [], [], { semester: 2, effectiveRules: [rules[1]] }), []);
});
const python = process.env.TIMETABLE_TEST_PYTHON || 'python';
const available = spawnSync(python, ['-c', 'import ortools'], { encoding: 'utf8', timeout: 20000 }).status === 0;
for (const [semester, category, day, period] of [[2, 'AEC', 2, 4], [4, 'SEC', 5, 5]]) {
  test(`CP-SAT schedules S${semester} inside its own window with mixed-semester rules`, { skip: !available }, () => {
    const c = course(`S${semester}-paper`, category);
    const input = { semester, academic_year: '2026-27', courses: [{ ...c, studentIds: [...c.studentIds] }], rules, config: { max_time_in_seconds: 5, num_workers: 1 } };
    const r = spawnSync(python, [path.join(__dirname, '../src/modules/timetable/solver/ortools_solver.py')], { input: JSON.stringify(input), encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 0, r.error?.message || r.stderr);
    const result = JSON.parse(r.stdout);
    assert.ok(['OPTIMAL', 'FEASIBLE'].includes(result.status), JSON.stringify(result.diagnostics));
    assert.deepEqual(result.assignments.map(s => [s.day, s.period]), [[day, period]]);
  });
}
