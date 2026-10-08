/**
 * Unit Test Suite for Plan 04: Registration, eligibility, credits and global seats
 * Findings: F13, F14, F15, F16, F17, F19, F20, F21, F27, F28, F29, F30, F31, F32
 * Data Observations: D01, D02, D06, D08
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')

// Dist modules
const {
  validatePathwaySlots,
  evaluateCoursePrerequisites,
  normalizeCourseCode,
} = require('../dist/core/utils/slotRules')
const { RegistrationsService } = require('../dist/modules/registrations/registrations.service')
const { AllocationService } = require('../dist/modules/allocation/allocation.service')

const mockAuditLogger = {
  log: async () => {},
}
const mockServerLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
  info: () => {},
}

function createChain(resolver) {
  let isCountQuery = false
  const chain = {
    select: (cols, opts) => {
      if (opts && opts.count === 'exact') isCountQuery = true
      return chain
    },
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    lt: () => chain,
    lte: () => chain,
    gt: () => chain,
    gte: () => chain,
    or: () => {
      if (isCountQuery) {
        return { count: 50, error: null }
      }
      return chain
    },
    order: () => chain,
    limit: () => chain,
    insert: async () => ({ error: null }),
    update: () => chain,
    single: async () => resolver('single'),
    maybeSingle: async () => resolver('maybeSingle'),
    then: (resolve) => resolve(resolver('then')),
  }
  return chain
}

describe('Plan 04: Registration, eligibility, credits and global seats', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 1. F20 & D02: Blueprint Pathway Slots Validation & Duplicate Fixed Rejection
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. F20 & D02: validatePathwaySlots Engine', () => {
    it('validates a correct pathway with 6 slots and distinct fixed courses', () => {
      const slots = [
        { slot: 1, rule: 'FIXED', target: 'ENG101', name: 'Major Core 1' },
        { slot: 2, rule: 'FIXED', target: 'ENG102', name: 'Major Core 2' },
        { slot: 3, rule: 'ALL_DEPTS', target: '', name: 'MDC 1' },
        { slot: 4, rule: 'DEPT_RESTRICTED', target: 'HIST,POL', name: 'Minor 1' },
        { slot: 5, rule: 'AEC_ELECT', target: 'ENG103', name: 'AEC 1' },
        { slot: 6, rule: 'EXCLUDE_DEPT', target: '', name: 'SEC 1' },
      ]
      const result = validatePathwaySlots(slots)
      assert.strictEqual(result.valid, true)
      assert.strictEqual(result.errors.length, 0)
    })

    it('rejects duplicate fixed course codes in a single pathway (F20, D02)', () => {
      const slots = [
        { slot: 1, rule: 'FIXED', target: 'ENG101', name: 'Major Core 1' },
        { slot: 2, rule: 'FIXED', target: 'eng101', name: 'Major Core 2' }, // duplicate case-insensitive
        { slot: 3, rule: 'ALL_DEPTS', target: '', name: 'MDC 1' },
      ]
      const result = validatePathwaySlots(slots)
      assert.strictEqual(result.valid, false)
      assert.ok(result.errors.some((e) => e.includes('ENG101') && e.includes('Duplicate fixed course')))
    })

    it('rejects duplicate slots or invalid slot numbers', () => {
      const slots = [
        { slot: 1, rule: 'FIXED', target: 'ENG101', name: 'Core 1' },
        { slot: 1, rule: 'FIXED', target: 'ENG102', name: 'Core 2' }, // duplicate slot number 1
      ]
      const result = validatePathwaySlots(slots)
      assert.strictEqual(result.valid, false)
      assert.ok(result.errors.some((e) => e.includes('Duplicate slot number 1')))
    })

    it('rejects slots with empty rule or fixed slots missing target', () => {
      const slots = [
        { slot: 1, rule: '', target: '', name: 'Invalid' },
        { slot: 2, rule: 'FIXED', target: '', name: 'Core missing target' },
      ]
      const result = validatePathwaySlots(slots)
      assert.strictEqual(result.valid, false)
      assert.ok(result.errors.length >= 2)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. F19: Canonical Prerequisite Evaluation Engine
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. F19: evaluateCoursePrerequisites Engine', () => {
    const course = {
      id: 'c-advanced-ai',
      course_code: 'CS401',
      semester: 7,
      prerequisite_course_ids: [],
    }

    it('satisfies COMPLETED_COURSE prerequisite when course is in prior registrations', () => {
      const rules = [
        { id: 'r1', course_id: 'c-advanced-ai', rule: 'COMPLETED_COURSE', target: 'CS201' },
      ]
      const student = { department_code: 'CS', current_semester: 7 }
      const completedCodes = new Set(['CS201', 'CS101'])

      const result = evaluateCoursePrerequisites(course, rules, student, completedCodes)
      assert.strictEqual(result.eligible, true)
      assert.strictEqual(result.score, 1)
    })

    it('fails COMPLETED_COURSE prerequisite when course is missing from prior registrations', () => {
      const rules = [
        { id: 'r1', course_id: 'c-advanced-ai', rule: 'COMPLETED_COURSE', target: 'CS201' },
      ]
      const student = { department_code: 'CS', current_semester: 7 }
      const completedCodes = new Set(['CS101']) // Missing CS201

      const result = evaluateCoursePrerequisites(course, rules, student, completedCodes)
      assert.strictEqual(result.eligible, false)
      assert.ok(result.reason.includes('CS201'))
      assert.strictEqual(result.score, 0)
    })

    it('enforces DEPARTMENT constraint correctly', () => {
      const rules = [
        { id: 'r2', course_id: 'c-advanced-ai', rule: 'DEPARTMENT', target: 'CS, IT' },
      ]
      const csStudent = { department_code: 'CS', current_semester: 7 }
      const histStudent = { department_code: 'HIST', current_semester: 7 }

      const csResult = evaluateCoursePrerequisites(course, rules, csStudent, new Set())
      assert.strictEqual(csResult.eligible, true)

      const histResult = evaluateCoursePrerequisites(course, rules, histStudent, new Set())
      assert.strictEqual(histResult.eligible, false)
      assert.ok(histResult.reason.includes('restricted to departments'))
      assert.ok(histResult.reason.includes('HIST'))
    })

    it('enforces COMPLETED_SEMESTER constraint correctly', () => {
      const rules = [
        { id: 'r3', course_id: 'c-advanced-ai', rule: 'COMPLETED_SEMESTER', target: '4' },
      ]
      const sem5Student = { department_code: 'CS', current_semester: 5 } // 5 > 4 completed
      const sem4Student = { department_code: 'CS', current_semester: 4 } // has not completed semester 4 yet

      assert.strictEqual(evaluateCoursePrerequisites(course, rules, sem5Student, new Set()).eligible, true)
      assert.strictEqual(evaluateCoursePrerequisites(course, rules, sem4Student, new Set()).eligible, false)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. F30: Student Course Change Lockout (Deadline & Published Timetable)
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. F30: Student Change Lockout (Registration Window & Published Timetable)', () => {
    it('blocks slot change when campus deadline has passed', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChain(() => ({
                data: { campus_id: 'campus-1', department_id: 'dept-1', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChain(() => ({
                data: {
                  academic_year: '2026-27',
                  deadline: new Date(Date.now() - 3600000).toISOString(),
                },
                error: null,
              }))
            }
            return createChain(() => ({ data: null, error: null }))
          },
        },
      }

      const service = new RegistrationsService(mockSupabase, mockAuditLogger, mockServerLogger)
      const user = { userId: 'stu-1', role: 'student', campus_id: 'campus-1', current_semester: 3 }

      await assert.rejects(
        async () => {
          await service.updateSlot({ slot_key: 'slot_3', course_id: 'course-new' }, user)
        },
        (err) => {
          assert.strictEqual(err.name, 'ForbiddenException')
          assert.ok(err.message.includes('Registration window is closed'))
          return true
        },
      )
    })

    it('blocks slot change when timetable for cohort is published even if window is open (F30)', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChain(() => ({
                data: { campus_id: 'campus-1', department_id: 'dept-1', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChain(() => ({
                data: {
                  academic_year: '2026-27',
                  deadline: new Date(Date.now() + 3600000).toISOString(),
                },
                error: null,
              }))
            }
            if (table === 'timetable_entries') {
              return createChain(() => ({
                data: [{ id: 'tt-entry-1' }], // Published timetable entry exists!
                error: null,
              }))
            }
            return createChain(() => ({ data: null, error: null }))
          },
        },
      }

      const service = new RegistrationsService(mockSupabase, mockAuditLogger, mockServerLogger)
      const user = { userId: 'stu-1', role: 'student', campus_id: 'campus-1', current_semester: 3 }

      await assert.rejects(
        async () => {
          await service.updateSlot({ slot_key: 'slot_3', course_id: 'course-new' }, user)
        },
        (err) => {
          assert.strictEqual(err.name, 'ForbiddenException')
          assert.ok(err.message.includes('Timetable has been published'))
          return true
        },
      )
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 4. F31: 27-Hour Rolling Rate Limit (Max 3 changes)
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. F31: Rolling 3-per-27h Rate Limit', () => {
    it('blocks the 4th change within 27 hours and reports cooldown time', async () => {
      const now = Date.now()
      const mockHistory = [
        { at: new Date(now - 2 * 3600000).toISOString(), from: 'c1', to: 'c2' },
        { at: new Date(now - 5 * 3600000).toISOString(), from: 'c2', to: 'c3' },
        { at: new Date(now - 10 * 3600000).toISOString(), from: 'c3', to: 'c4' },
      ]

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChain(() => ({
                data: { campus_id: 'campus-1', department_id: 'dept-1', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChain(() => ({
                data: {
                  academic_year: '2026-27',
                  deadline: new Date(now + 86400000).toISOString(),
                },
                error: null,
              }))
            }
            if (table === 'timetable_entries') {
              return createChain(() => ({ data: [], error: null }))
            }
            if (table === 'student_registrations') {
              return createChain(() => ({
                data: {
                  id: 'reg-1',
                  slot_3_course_id: 'c-old',
                  allocation_metadata: {
                    slot_change_history: mockHistory,
                  },
                },
                error: null,
              }))
            }
            return createChain(() => ({ data: null, error: null }))
          },
        },
      }

      const service = new RegistrationsService(mockSupabase, mockAuditLogger, mockServerLogger)
      const user = { userId: 'stu-1', role: 'student', campus_id: 'campus-1', current_semester: 3 }

      await assert.rejects(
        async () => {
          await service.updateSlot({ slot_key: 'slot_3', course_id: 'course-new' }, user)
        },
        (err) => {
          assert.strictEqual(err.name, 'ForbiddenException')
          assert.ok(err.message.includes('Rate limit exceeded: You have reached the maximum limit of 3 course changes'))
          return true
        },
      )
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 5. F21: Global Capacity Enforcement Across All Campuses
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. F21: Global Course Capacity Across All Campuses', () => {
    it('rejects slot change when global capacity for course is exhausted', async () => {
      const now = Date.now()
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChain(() => ({
                data: { campus_id: 'campus-1', department_id: 'dept-1', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'courses') {
              return createChain(() => ({
                data: { id: 'c-full', course_code: 'FULL101', title: 'Full Course', seat_limit: 50, semester: 3, credits: 4 },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChain(() => ({
                data: { academic_year: '2026-27', deadline: new Date(now + 86400000).toISOString() },
                error: null,
              }))
            }
            if (table === 'timetable_entries') {
              return createChain(() => ({ data: [], error: null }))
            }
            if (table === 'student_registrations') {
              return createChain((op) => {
                if (op === 'then') {
                  return { count: 50, error: null }
                }
                return {
                  data: { id: 'reg-1', slot_3_course_id: 'c-prev', allocation_metadata: {} },
                  error: null,
                }
              })
            }
            if (table === 'course_prerequisite_rules') {
              return createChain(() => ({ data: [], error: null }))
            }
            return createChain(() => ({ data: null, error: null }))
          },
        },
      }

      const service = new RegistrationsService(mockSupabase, mockAuditLogger, mockServerLogger)
      const user = { userId: 'stu-1', role: 'student', campus_id: 'campus-1', current_semester: 3 }

      await assert.rejects(
        async () => {
          await service.updateSlot({ slot_key: 'slot_3', course_id: 'c-full' }, user)
        },
        (err) => {
          assert.strictEqual(err.name, 'ConflictException')
          assert.ok(err.message.includes('has reached maximum global capacity'))
          return true
        },
      )
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 6. F27, F28, F29: Authoritative Academic Year & Manual Allocation Authorization
  // ──────────────────────────────────────────────────────────────────────────
  describe('6. F27, F28, F29: Manual Allocation Authorization & Validation', () => {
    it('fails closed when campus_settings.academic_year is missing (F27)', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChain(() => ({
                data: { id: 'stu-1', department_id: 'dept-1', campus_id: 'campus-1', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChain(() => ({
                data: { academic_year: null }, // Missing academic_year
                error: null,
              }))
            }
            return createChain(() => ({ data: null, error: null }))
          },
        },
      }

      const allocService = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-1' }

      await assert.rejects(
        async () => {
          await allocService.manualAllocate(
            { student_id: 'stu-1', slot_key: 'slot_3', course_id: 'c-101' },
            hodUser,
          )
        },
        (err) => {
          assert.strictEqual(err.name, 'BadRequestException')
          assert.ok(err.message.includes('No active academic year found in campus settings'))
          return true
        },
      )
    })

    it('authorizes HOD for student in HOD department even if course belongs to another department (F28)', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChain(() => ({
                data: { id: 'stu-1', department_id: 'dept-cs', campus_id: 'campus-1', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'courses') {
              let isArrayQuery = false
              const chain = {
                select: () => chain,
                eq: () => chain,
                in: () => {
                  isArrayQuery = true
                  return chain
                },
                single: async () => ({
                  data: { id: 'c-hist-101', course_code: 'HIST101', title: 'World History', department_id: 'dept-hist', seat_limit: 60, semester: 3, credits: 4, category: 'MDC' },
                  error: null,
                }),
                then: (resolve) => {
                  if (isArrayQuery) {
                    return resolve({ data: [{ id: 'c-hist-101', credits: 4 }], error: null })
                  }
                  return resolve({
                    data: { id: 'c-hist-101', course_code: 'HIST101', title: 'World History', department_id: 'dept-hist', seat_limit: 60, semester: 3, credits: 4, category: 'MDC' },
                    error: null,
                  })
                },
              }
              return chain
            }
            if (table === 'campus_settings') {
              return createChain(() => ({
                data: { academic_year: '2026-27' },
                error: null,
              }))
            }
            if (table === 'student_registrations') {
              return createChain((op) => {
                if (op === 'then') {
                  return { count: 10, error: null }
                }
                return { data: null, error: null }
              })
            }
            if (table === 'course_prerequisite_rules') {
              return createChain(() => ({ data: [], error: null }))
            }
            if (table === 'registration_preferences') {
              return createChain(() => ({ data: null, error: null }))
            }
            return createChain(() => ({ data: null, error: null }))
          },
        },
      }

      const allocService = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      // HOD belongs to dept-cs, matching student.department_id!
      const hodUser = { userId: 'hod-cs', role: 'hod', department_id: 'dept-cs' }

      const result = await allocService.manualAllocate(
        { student_id: 'stu-1', slot_key: 'slot_3', course_id: 'c-hist-101' },
        hodUser,
      )
      assert.strictEqual(result.success, true)
      assert.ok(result.message.includes('HIST101'))
    })

    it('rejects HOD when student belongs to a different department (F28)', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChain(() => ({
                data: { id: 'stu-1', department_id: 'dept-pol', campus_id: 'campus-1', current_semester: 3, departments: { code: 'POL' } },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChain(() => ({
                data: { academic_year: '2026-27' },
                error: null,
              }))
            }
            return createChain(() => ({ data: null, error: null }))
          },
        },
      }

      const allocService = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-cs', role: 'hod', department_id: 'dept-cs' } // Different dept

      await assert.rejects(
        async () => {
          await allocService.manualAllocate(
            { student_id: 'stu-1', slot_key: 'slot_3', course_id: 'c-101' },
            hodUser,
          )
        },
        (err) => {
          assert.strictEqual(err.name, 'ForbiddenException')
          assert.ok(err.message.includes('You may only allocate courses to students in your department'))
          return true
        },
      )
    })

    it('rejects duplicate course assignment in another slot during manual allocation (F20)', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChain(() => ({
                data: { id: 'stu-1', department_id: 'dept-cs', campus_id: 'campus-1', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChain(() => ({
                data: { academic_year: '2026-27' },
                error: null,
              }))
            }
            if (table === 'courses') {
              return createChain(() => ({
                data: { id: 'c-duplicate', course_code: 'DUP101', title: 'Duplicate Course', department_id: 'dept-cs', seat_limit: 60, semester: 3, credits: 4, category: 'DSC' },
                error: null,
              }))
            }
            if (table === 'student_registrations') {
              return createChain(() => ({
                data: {
                  id: 'reg-1',
                  slot_1_course_id: 'c-duplicate', // Already in slot_1!
                  slot_2_course_id: 'c-other',
                  allocation_metadata: {},
                },
                error: null,
              }))
            }
            return createChain(() => ({ data: null, error: null }))
          },
        },
      }

      const allocService = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-cs', role: 'hod', department_id: 'dept-cs' }

      await assert.rejects(
        async () => {
          // Attempt to assign to slot_3 when it's already in slot_1
          await allocService.manualAllocate(
            { student_id: 'stu-1', slot_key: 'slot_3', course_id: 'c-duplicate' },
            hodUser,
          )
        },
        (err) => {
          assert.strictEqual(err.name, 'BadRequestException')
          assert.ok(err.message.includes('Duplicate course assignment across slots is not allowed'))
          return true
        },
      )
    })
  })
})
