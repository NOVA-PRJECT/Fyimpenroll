const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createPrerequisiteAnswers, groupCoursePrerequisites } = require('../src/core/course-prerequisites.ts')
const context = { studentId: 'student', academicYear: '2026-27', semester: 3 }
const course = { id: 'course', prerequisites: ['Know C.', 'Know data structures.'] }
function disk() {
  const rows = new Map()
  return { rows, getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) }
}

test('one course-wide answer survives refresh and is shared across ranks', () => {
  const storage = disk()
  const first = createPrerequisiteAnswers(() => storage)
  assert.equal(first.get(context, course), undefined)
  first.set(context, course, false)
  const refreshed = createPrerequisiteAnswers(() => storage)
  assert.equal(refreshed.get(context, { ...course }), false)
  assert.equal(storage.rows.size, 1)
  assert.equal(createPrerequisiteAnswers(() => disk()).get(context, course), undefined)
})

test('Yes is remembered, and course text, order, identity and registration period isolate answers', () => {
  const storage = disk(), answers = createPrerequisiteAnswers(() => storage)
  answers.set(context, course, true)
  assert.equal(answers.get(context, course), true)
  for (const changed of [
    { ...context, studentId: 'other' }, { ...context, academicYear: '2027-28' }, { ...context, semester: 4 },
  ]) assert.equal(answers.get(changed, course), undefined)
  for (const changed of [
    { ...course, id: 'other' }, { ...course, prerequisites: ['Know Python.'] },
    { ...course, prerequisites: [...course.prerequisites].reverse() },
  ]) assert.equal(answers.get(context, changed), undefined)
  assert.equal(answers.get(context, { id: 'empty', prerequisites: [] }), true)
})

test('corrupt and blocked storage do not imply approval, and page memory remembers No', () => {
  const corrupt = createPrerequisiteAnswers(() => ({ getItem: () => '{broken', setItem() {} }))
  assert.equal(corrupt.get(context, course), undefined)
  const blocked = createPrerequisiteAnswers(() => { throw new Error('disabled') })
  assert.equal(blocked.get(context, course), undefined)
  blocked.set(context, course, false)
  assert.equal(blocked.get(context, course), false)
})

test('final review groups every ranked choice by course while retaining its paper and rank', () => {
  const second = { id: 'second', prerequisites: ['Know statistics.'] }
  const groups = groupCoursePrerequisites([
    { course, placement: 'Paper 1 — Choice 1', informational: false },
    { course: second, placement: 'Paper 1 — Choice 2', informational: false },
    { course, placement: 'Paper 2 — Choice 3', informational: false },
    { course, placement: 'Paper 2 — Choice 3', informational: false },
  ])
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0].course.prerequisites, ['Know C.', 'Know data structures.'])
  assert.deepEqual(groups[0].placements, ['Paper 1 — Choice 1', 'Paper 2 — Choice 3'])
  assert.equal(groups[0].informational, false)
  assert.deepEqual(groups[1].course.prerequisites, ['Know statistics.'])
})

test('final review includes fixed guidance and courses without prerequisites', () => {
  const empty = { id: 'empty', prerequisites: [] }
  const groups = groupCoursePrerequisites([
    { course, placement: 'Fixed paper', informational: true },
    { course: empty, placement: 'Paper 2 — Choice 1', informational: false },
  ])
  assert.equal(groups[0].informational, true)
  assert.deepEqual(groups[1].course.prerequisites, [])
  assert.deepEqual(groupCoursePrerequisites([]), [])
})
