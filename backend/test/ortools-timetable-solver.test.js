/**
 * Test Suite for Plan 06: Local OR-Tools timetables, JSON constraints and generation recovery
 * Primary Findings: F33, F34, F35, F36, F37, F39, F40, F41, F42, F71
 * Data Observations: D03, D04, D05
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')

// Dist modules
const { runOrtoolsSolver } = require('../dist/modules/timetable/solver/ortools-runner')
const { detectParallelGroups } = require('../dist/modules/timetable/solver/loader')
const { validateTimetable, violationsToText } = require('../dist/modules/timetable/solver/validator')
const { TimetableService } = require('../dist/modules/timetable/timetable.service')

describe('Plan 06: Local OR-Tools Timetables, JSON Constraints & Recovery', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 1. F35, F40: Local OR-Tools CP-SAT Solver Execution & Output Mapping
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. F35 & F40: Local OR-Tools CP-SAT Solver Integration', () => {
    it('executes python ortools solver locally and produces an OPTIMAL or FEASIBLE valid schedule', async () => {
      const payload = {
        academic_year: '2025-2026',
        semester: 1,
        campus_id: 'campus-1',
        courses: [
          {
            courseId: 'c1',
            courseCode: 'KU01DSCMAT101',
            courseTitle: 'Calculus I',
            departmentId: 'dept-math',
            category: 'DSC',
            theoryHours: 3,
            practicalHours: 0,
            isCrossDept: false,
            studentIds: ['s1', 's2', 's3'],
          },
          {
            courseId: 'c2',
            courseCode: 'KU01DSCPHY101',
            courseTitle: 'Mechanics',
            departmentId: 'dept-phy',
            category: 'DSC',
            theoryHours: 2,
            practicalHours: 2,
            isCrossDept: false,
            studentIds: ['s4', 's5'],
          },
        ],
        parallel_groups: [],
        teacher_reservations: [],
        constraints: {},
        config: {
          max_time_in_seconds: 10,
          num_workers: 2,
        },
      }

      const result = await runOrtoolsSolver(payload)

      assert.ok(
        result.status === 'OPTIMAL' || result.status === 'FEASIBLE',
        `Expected OPTIMAL or FEASIBLE, got ${result.status}`
      )
      assert.strictEqual(result.stats.total_courses, 2)
      // c1 has 3 theory hours (3 sessions); c2 has 2 theory hours + 2 practical hours (2 lab periods = 4 total sessions)
      // Total session periods = 3 + 2 + 2 = 7 periods
      assert.strictEqual(result.assignments.length, 7)

      // Verify no session is scheduled on lunch (period 3 to 4 lab crossover)
      for (const a of result.assignments) {
        assert.ok(a.day >= 1 && a.day <= 5, 'Day must be 1..5')
        assert.ok(a.period >= 1 && a.period <= 6, 'Period must be 1..6')
      }

      // Verify c2 lab block is consecutive and on the same day
      const labSlots = result.assignments.filter((a) => a.courseId === 'c2' && a.isLabBlock)
      assert.strictEqual(labSlots.length, 2)
      assert.strictEqual(labSlots[0].day, labSlots[1].day)
      const periods = [labSlots[0].period, labSlots[1].period].sort((a, b) => a - b)
      assert.strictEqual(periods[1], periods[0] + 1)
      assert.ok(
        !(periods[0] === 3 && periods[1] === 4),
        'Lab block must not cross lunch break (P3-P4)'
      )
    })

    it('proves INFEASIBLE when constraints mathematically contradict available slots', async () => {
      const payload = {
        academic_year: '2025-2026',
        semester: 1,
        campus_id: 'campus-1',
        courses: [
          // 4 courses with 3 hours each, all sharing student s1, but all restricted to Tuesday afternoon P4..P6 (only 3 slots total)
          {
            courseId: 'c1',
            courseCode: 'KU01AECENG101',
            category: 'AEC',
            theoryHours: 3,
            practicalHours: 0,
            studentIds: ['s1'],
          },
          {
            courseId: 'c2',
            courseCode: 'KU01AECENG102',
            category: 'AEC',
            theoryHours: 3,
            practicalHours: 0,
            studentIds: ['s1'], // Shares s1, needs 3 slots too. 3 + 3 = 6 slots needed on Tuesday/Wednesday P4..P6
          },
          {
            courseId: 'c3',
            courseCode: 'KU01AECENG103',
            category: 'AEC',
            theoryHours: 3,
            practicalHours: 0,
            studentIds: ['s1'],
          },
        ],
        parallel_groups: [],
        teacher_reservations: [
          // Block out all Wednesday afternoon slots for a teacher reservation
          { teacherId: 't-busy', day: 3, period: 4 },
          { teacherId: 't-busy', day: 3, period: 5 },
          { teacherId: 't-busy', day: 3, period: 6 },
        ],
        // Assign t-busy to all courses
        courses: [
          {
            courseId: 'c1',
            courseCode: 'KU01AECENG101',
            category: 'AEC',
            theoryHours: 3,
            practicalHours: 0,
            studentIds: ['s1'],
            teacherId: 't-busy',
          },
          {
            courseId: 'c2',
            courseCode: 'KU01AECENG102',
            category: 'AEC',
            theoryHours: 3,
            practicalHours: 0,
            studentIds: ['s1'],
            teacherId: 't-busy',
          },
        ],
        constraints: {},
        config: {
          max_time_in_seconds: 5,
        },
      }

      const result = await runOrtoolsSolver(payload)
      // Since AEC is restricted to Tue (2) & Wed (3) P4-P6 (total 6 slots), and Wed P4-P6 are blocked by teacher_reservations,
      // only 3 slots remain on Tuesday. Both c1 and c2 require 3 slots with the same teacher -> impossible!
      assert.strictEqual(result.status, 'INFEASIBLE')
      assert.strictEqual(result.assignments.length, 0)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. F71: AEC-1 and AEC-2 Compulsory Basket Separation
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. F71: AEC-1 and AEC-2 Compulsory Basket Separation', () => {
    it('separates AEC-1 and AEC-2 into distinct parallel baskets when students take both', () => {
      // Synthetic scenario reproducing F71:
      // All semester 1 students take English (AEC-1) AND a second language (Malayalam, Hindi, Arabic in AEC-2)
      const courses = [
        {
          courseId: 'aec-eng',
          courseCode: 'KU01AECENG101',
          courseTitle: 'Communicative English',
          departmentId: 'dept-eng',
          category: 'AEC',
          theoryHours: 2,
          practicalHours: 0,
          isCrossDept: true,
          studentIds: new Set(['s1', 's2', 's3']), // All 3 students take English
          conflictSummary: '',
        },
        {
          courseId: 'aec-mal',
          courseCode: 'KU01AECMAL101',
          courseTitle: 'Malayalam Literature',
          departmentId: 'dept-mal',
          category: 'AEC',
          theoryHours: 2,
          practicalHours: 0,
          isCrossDept: true,
          studentIds: new Set(['s1']), // Student 1 takes Malayalam
          conflictSummary: '',
        },
        {
          courseId: 'aec-hin',
          courseCode: 'KU01AECHIN101',
          courseTitle: 'Hindi Literature',
          departmentId: 'dept-hin',
          category: 'AEC',
          theoryHours: 2,
          practicalHours: 0,
          isCrossDept: true,
          studentIds: new Set(['s2']), // Student 2 takes Hindi
          conflictSummary: '',
        },
        {
          courseId: 'aec-ara',
          courseCode: 'KU01AECARA101',
          courseTitle: 'Arabic Literature',
          departmentId: 'dept-ara',
          category: 'AEC',
          theoryHours: 2,
          practicalHours: 0,
          isCrossDept: true,
          studentIds: new Set(['s3']), // Student 3 takes Arabic
          conflictSummary: '',
        },
      ]

      const studentDeptMap = new Map([
        ['s1', 'dept-eng'],
        ['s2', 'dept-eng'],
        ['s3', 'dept-eng'],
      ])

      const groups = detectParallelGroups(courses, studentDeptMap)

      // The second language courses (Mal, Hin, Ara) have zero mutual student overlap -> forms 1 parallel group!
      // English overlaps with all of them -> placed in a separate basket!
      assert.strictEqual(groups.length, 1)
      const secondLangGroup = groups[0]
      assert.strictEqual(secondLangGroup.category, 'AEC')
      assert.ok(secondLangGroup.courseIds.includes('aec-mal'))
      assert.ok(secondLangGroup.courseIds.includes('aec-hin'))
      assert.ok(secondLangGroup.courseIds.includes('aec-ara'))
      assert.ok(
        !secondLangGroup.courseIds.includes('aec-eng'),
        'English (AEC-1) must NOT be forced into the same parallel basket as AEC-2 (F71)'
      )
    })

    it('validator verifies separate valid slots for AEC-1 and AEC-2 without category_slot_mismatch', () => {
      const courses = [
        {
          courseId: 'aec-eng',
          courseCode: 'KU01AECENG101',
          departmentId: 'dept-eng',
          category: 'AEC',
          theoryHours: 2,
          practicalHours: 0,
          studentIds: new Set(['s1']),
        },
        {
          courseId: 'aec-mal',
          courseCode: 'KU01AECMAL101',
          departmentId: 'dept-mal',
          category: 'AEC',
          theoryHours: 2,
          practicalHours: 0,
          studentIds: new Set(['s1']), // Same student s1 takes both
        },
      ]

      const parallelGroups = [] // Separate baskets, no group forced across both

      // Candidate response placing English on Tuesday (Day 2) and Malayalam on Wednesday (Day 3)
      const response = {
        assignments: [
          {
            courseId: 'aec-eng',
            slots: [
              { day: 2, period: 4, sessionType: 'theory', isLabBlock: false },
              { day: 2, period: 5, sessionType: 'theory', isLabBlock: false },
            ],
          },
          {
            courseId: 'aec-mal',
            slots: [
              { day: 3, period: 4, sessionType: 'theory', isLabBlock: false },
              { day: 3, period: 5, sessionType: 'theory', isLabBlock: false },
            ],
          },
        ],
      }

      const slotMap = new Map()
      const violations = validateTimetable(response, courses, slotMap, parallelGroups)

      // Should be 0 violations: no student conflict (Day 2 vs Day 3) and no category_slot_mismatch
      assert.strictEqual(violations.length, 0, `Expected 0 violations, got: ${violationsToText(violations).join('; ')}`)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. F37: Shared-Teacher Cross-Campus & Cross-Semester Clash Prevention
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. F37: Shared-Teacher Conflict Modeling & Reservations', () => {
    it('prevents solver from double-booking a visiting teacher across courses in the same cohort', async () => {
      const payload = {
        academic_year: '2025-2026',
        semester: 1,
        campus_id: 'campus-1',
        courses: [
          {
            courseId: 'c1',
            courseCode: 'KU01DSCMAT101',
            category: 'DSC',
            theoryHours: 2,
            practicalHours: 0,
            studentIds: ['s1'],
            teacherId: 'teacher-dr-smith', // Same teacher Dr. Smith
          },
          {
            courseId: 'c2',
            courseCode: 'KU01DSCMAT102',
            category: 'DSC',
            theoryHours: 2,
            practicalHours: 0,
            studentIds: ['s2'], // Disjoint students
            teacherId: 'teacher-dr-smith', // Same teacher Dr. Smith
          },
        ],
        parallel_groups: [],
        teacher_reservations: [],
        constraints: {},
        config: { max_time_in_seconds: 5 },
      }

      const result = await runOrtoolsSolver(payload)
      assert.ok(result.status === 'OPTIMAL' || result.status === 'FEASIBLE')

      // Verify Dr. Smith never has overlapping sessions
      const smithSlots = new Set()
      for (const a of result.assignments) {
        const slotKey = `${a.day}-${a.period}`
        assert.ok(!smithSlots.has(slotKey), `Teacher Dr. Smith has overlapping session at ${slotKey}`)
        smithSlots.add(slotKey)
      }
    })

    it('solver strictly respects teacher_reservations from other published schedules', async () => {
      const payload = {
        academic_year: '2025-2026',
        semester: 1,
        campus_id: 'campus-1',
        courses: [
          {
            courseId: 'c1',
            courseCode: 'KU01DSCMAT101',
            category: 'DSC',
            theoryHours: 5,
            practicalHours: 0,
            studentIds: ['s1'],
            teacherId: 'visiting-prof',
          },
        ],
        parallel_groups: [],
        // Visiting prof is busy teaching in Campus B / Semester 3 on Day 1 Period 1 & 2
        teacher_reservations: [
          { teacherId: 'visiting-prof', day: 1, period: 1 },
          { teacherId: 'visiting-prof', day: 1, period: 2 },
        ],
        constraints: {},
        config: { max_time_in_seconds: 5 },
      }

      const result = await runOrtoolsSolver(payload)
      assert.ok(result.status === 'OPTIMAL' || result.status === 'FEASIBLE')

      for (const a of result.assignments) {
        const isReserved = (a.day === 1 && (a.period === 1 || a.period === 2))
        assert.ok(!isReserved, `Course scheduled during visiting prof reserved slot at Day ${a.day} Period ${a.period}`)
      }
    })

    it('validator flags teacher conflict when teacher is scheduled in reserved slot', () => {
      const courses = [
        {
          courseId: 'c1',
          courseCode: 'KU01DSCMAT101',
          theoryHours: 1,
          practicalHours: 0,
          teacherId: 'prof-x',
          studentIds: new Set(['s1']),
        },
      ]

      const response = {
        assignments: [
          {
            courseId: 'c1',
            slots: [{ day: 2, period: 3, sessionType: 'theory', isLabBlock: false }],
          },
        ],
      }

      const teacherReservations = [
        { teacherId: 'prof-x', day: 2, period: 3, sourceSemester: 3, sourceCourseId: 'KU03MAT201' },
      ]

      const violations = validateTimetable(response, courses, new Map(), [], teacherReservations)
      assert.strictEqual(violations.length, 1)
      assert.strictEqual(violations[0].type, 'teacher_conflict')
      assert.ok(violations[0].detail.includes('conflicts with published timetable reservation'))
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 4. F33: Immutable Publication & In-Place Teacher Substitution
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. F33: Immutable Publication & Teacher Substitution In-Place', () => {
    it('service rejects generation when a published timetable exists for the term', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'campus_settings') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { deadline: '2026-09-01T00:00:00Z', academic_year: '2025-2026' }, // closed window
                    }),
                  }),
                }),
              }
            }
            if (table === 'allocation_runs') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({
                        eq: async () => ({ data: [{ id: 'run-1', status: 'completed' }] }), // completed allocation
                      }),
                    }),
                  }),
                }),
              }
            }
            if (table === 'departments') {
              return {
                select: () => ({
                  eq: async () => ({ data: [{ id: 'dept-1' }] }),
                }),
              }
            }
            if (table === 'timetable_entries') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({
                        limit: () => ({
                          in: async () => ({ data: [{ id: 'published-entry-1' }] }), // Published entry exists!
                        }),
                      }),
                    }),
                  }),
                }),
              }
            }
            return {
              select: () => ({ eq: async () => ({ data: null }) }),
            }
          },
        },
      }

      const service = new TimetableService(mockSupabase, { log: async () => {} }, { error: () => {}, warn: () => {} })

      await assert.rejects(
        async () => {
          await service.generate('2025-2026', 1, [], {
            userId: 'dir-1',
            role: 'campus_director',
            campus_id: 'campus-1',
          })
        },
        /Published timetables are strictly immutable \(F33\)/
      )
    })

    it('substituteTeacher updates teacher_id in place without altering entry id or session structure', async () => {
      let updatedTeacherId = null
      let updatedEntryId = null

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'timetable_entries') {
              return {
                select: () => ({
                  eq: (col, val) => {
                    if (col === 'id') {
                      return {
                        single: async () => ({
                          data: {
                            id: 'entry-uuid-1',
                            academic_year: '2025-2026',
                            semester: 1,
                            department_id: 'dept-1',
                            course_id: 'c1',
                            time_slot_id: 'slot-uuid-1',
                            status: 'published',
                            teacher_id: 'old-teacher',
                            time_slots: { id: 'slot-uuid-1', day_of_week: 2, period_number: 3 },
                            departments: { id: 'dept-1', campus_id: 'campus-1' },
                          },
                        }),
                      }
                    }
                    // clash check query
                    return {
                      eq: () => ({
                        eq: () => ({
                          neq: async () => ({ data: [] }), // No clash for new teacher
                        }),
                      }),
                    }
                  },
                }),
                update: (payload) => ({
                  eq: async (col, val) => {
                    updatedTeacherId = payload.teacher_id
                    updatedEntryId = val
                    return { error: null }
                  },
                }),
              }
            }
            return {}
          },
        },
      }

      const service = new TimetableService(mockSupabase, { log: async () => {} }, { error: () => {}, warn: () => {} })

      const result = await service.substituteTeacher('entry-uuid-1', 'new-teacher-uuid', {
        userId: 'dir-1',
        role: 'campus_director',
        campus_id: 'campus-1',
      })

      assert.strictEqual(result.success, true)
      assert.strictEqual(updatedEntryId, 'entry-uuid-1', 'Entry ID must be preserved')
      assert.strictEqual(updatedTeacherId, 'new-teacher-uuid', 'Teacher ID must be updated in place')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 5. F39: Durable JSON Constraints Merging & Overrides
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. F39: Durable JSON Constraints Management', () => {
    it('merges university baseline constraints with campus director overrides', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'campus_settings') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: {
                        timetable_constraints: {
                          hard_constraints: ['Campus 1 custom rule: No classes on Friday P6'],
                        },
                      },
                    }),
                  }),
                }),
              }
            }
            return {}
          },
        },
      }

      const service = new TimetableService(mockSupabase, { log: async () => {} }, { error: () => {}, warn: () => {} })
      const constraints = await service.getConstraints('1', {
        userId: 'dir-1',
        role: 'campus_director',
        campus_id: 'campus-1',
      })

      assert.ok(constraints.hard_constraints.includes('Campus 1 custom rule: No classes on Friday P6'))
      // Base rule should also be preserved
      assert.ok(constraints.hard_constraints.some((r) => r.includes('lunch break')))
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 6. F41: Closed Registration Window Precondition
  // ──────────────────────────────────────────────────────────────────────────
  describe('6. F41: Closed Registration Window Precondition', () => {
    it('rejects generation if registration deadline is in the future', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString() // Tomorrow
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'campus_settings') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { deadline: futureDate },
                    }),
                  }),
                }),
              }
            }
            return {}
          },
        },
      }

      const service = new TimetableService(mockSupabase, { log: async () => {} }, { error: () => {}, warn: () => {} })

      await assert.rejects(
        async () => {
          await service.generate('2025-2026', 1, [], {
            userId: 'dir-1',
            role: 'campus_director',
            campus_id: 'campus-1',
          })
        },
        /Registration window is still open/
      )
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 7. F36, D03, D04, D05: Validator Coverage & Diagnostics
  // ──────────────────────────────────────────────────────────────────────────
  describe('7. F36, D03, D04, D05: Coverage & Data Observations Diagnostics', () => {
    it('F36: flags unplaced courses that have required contact hours', () => {
      const courses = [
        {
          courseId: 'c-missing',
          courseCode: 'KU01DSCMAT101',
          theoryHours: 3,
          practicalHours: 0,
          studentIds: new Set(['s1']),
        },
      ]

      const response = { assignments: [] } // Empty assignments!
      const violations = validateTimetable(response, courses, new Map(), [])

      assert.strictEqual(violations.length, 1)
      assert.strictEqual(violations[0].type, 'unplaced_course')
      assert.ok(violations[0].detail.includes('was not scheduled'))
    })

    it('F36: flags invalid day/period outside domain (e.g. Day 99)', () => {
      const courses = [
        {
          courseId: 'c1',
          courseCode: 'KU01DSCMAT101',
          theoryHours: 1,
          practicalHours: 0,
          studentIds: new Set(['s1']),
        },
      ]

      const response = {
        assignments: [
          {
            courseId: 'c1',
            slots: [{ day: 99, period: 99, sessionType: 'theory', isLabBlock: false }],
          },
        ],
      }

      const violations = validateTimetable(response, courses, new Map(), [])
      assert.strictEqual(violations.length, 2) // domain error + hours mismatch
      assert.ok(violations.some((v) => v.detail.includes('outside operational timetable domain')))
    })

    it('D03: permits single 1-hour practical period for courses with practicalHours=1 without failing lab pair check', () => {
      const courses = [
        {
          courseId: 'c-odd',
          courseCode: 'KU01DSCBOT101',
          theoryHours: 2,
          practicalHours: 1, // Observation D03: odd practical hour
          studentIds: new Set(['s1']),
        },
      ]

      const response = {
        assignments: [
          {
            courseId: 'c-odd',
            slots: [
              { day: 1, period: 1, sessionType: 'theory', isLabBlock: false },
              { day: 2, period: 1, sessionType: 'theory', isLabBlock: false },
              { day: 3, period: 1, sessionType: 'practical', isLabBlock: true }, // Single practical session
            ],
          },
        ],
      }

      const violations = validateTimetable(response, courses, new Map(), [])
      assert.strictEqual(violations.length, 0, `Expected 0 violations for D03, got: ${violationsToText(violations).join('; ')}`)
    })
  })
})
