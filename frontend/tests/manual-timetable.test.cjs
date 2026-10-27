const { test } = require('node:test')
const assert = require('node:assert/strict')
const { defaultSessionType, linkedCourseIds, sessionPeriods, editManualSession } = require('../src/core/utils/manualTimetable.ts')
const entry = (courseId, period, sessionType = 'theory', day = 1) => ({ courseId, day, period, sessionType, isLabBlock: sessionType === 'practical' })

test('parallel changes include transitively linked courses across baskets', () => {
  assert.deepEqual(linkedCourseIds('a', [{ courseIds: ['a', 'b'] }, { courseIds: ['b', 'c'] }]), ['a', 'b', 'c'])
})
test('parallel practical and theory-only alternatives retain their catalogue session types', () => {
  assert.equal(defaultSessionType({ theoryHours: 2, practicalHours: 0 }, 'practical'), 'theory')
  assert.equal(defaultSessionType({ theoryHours: 0, practicalHours: 2 }, 'theory'), 'practical')
  assert.equal(defaultSessionType({ theoryHours: 2, practicalHours: 2 }, 'practical'), 'practical')
})
test('moving either half of a lab moves the complete pair and its parallel basket', () => {
  const entries = [entry('a', 1, 'practical'), entry('a', 2, 'practical'), entry('b', 1), entry('b', 2), entry('c', 5)]
  const moved = editManualSession(entries, entries[1], ['a', 'b'], { day: 3, period: 4 })
  assert.deepEqual(moved.filter(row => row.courseId !== 'c').map(row => [row.courseId, row.day, row.period]), [['a', 3, 4], ['a', 3, 5], ['b', 3, 4], ['b', 3, 5]])
  assert.deepEqual(moved.find(row => row.courseId === 'c'), entries[4])
})
test('removing a linked block preserves other sessions and an explicit unlinked override affects one course', () => {
  const entries = [entry('a', 1), entry('b', 1), entry('a', 5, 'theory', 2)]
  assert.deepEqual(editManualSession(entries, entries[0], ['a', 'b']), [entries[2]])
  assert.deepEqual(editManualSession(entries, entries[0], ['a']), [entries[1], entries[2]])
})
test('theory blocks stop at lunch and separate practical pairs remain independent', () => {
  const theory = [entry('a', 2), entry('a', 3), entry('a', 4)]
  assert.deepEqual(sessionPeriods(theory, theory[0]), [2, 3])
  const practical = [1, 2, 4, 5].map(period => entry('a', period, 'practical'))
  assert.deepEqual(sessionPeriods(practical, practical[3]), [4, 5])
  const overridden = [1, 4, 5].map(period => entry('a', period, 'practical'))
  assert.deepEqual(sessionPeriods(overridden, overridden[2]), [4, 5])
  assert.deepEqual(sessionPeriods(overridden, overridden[0]), [1])
})
