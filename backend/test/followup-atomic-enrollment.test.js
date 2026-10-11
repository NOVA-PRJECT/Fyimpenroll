/**
 * Automated Acceptance Test Suite for Follow-up Plan 04:
 * Atomic enrollment, global seats and blueprint eligibility
 * Findings covered: R09, R10, R11, R12, R14
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// Import compiled dist modules
const { RegistrationsService } = require('../dist/modules/registrations/registrations.service')
const { AllocationService } = require('../dist/modules/allocation/allocation.service')
const {
  isCourseEligibleForSlot,
  validatePathwaySlots,
  evaluateCoursePrerequisites,
  normalizeCourseCode,
} = require('../dist/core/utils/slotRules')

function createMockLoggers() {
  const auditLogs = []
  return {
    auditLogs,
    mockAuditLogger: {
      log: async (event) => {
        auditLogs.push(event)
      },
    },
    mockServerLogger: {
      log: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
    },
  }
}

// Chainable query builder helper for unit tests
function createChainableMock(resolver) {
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
        return resolver('countQuery') || { count: 1, error: null }
      }
      return chain
    },
    order: () => chain,
    limit: () => chain,
    single: async () => resolver('single'),
    maybeSingle: async () => resolver('maybeSingle'),
    insert: async (payload) => resolver('insert', payload),
    update: (payload) => {
      return {
        ...chain,
        eq: () => resolver('update', payload),
      }
    },
    upsert: async (payload) => resolver('upsert', payload),
    then: (resolve) => resolve(resolver('then')),
  }
  return chain
}

describe('Follow-up Plan 04 · Atomic Enrollment, Global Seats & Blueprint Eligibility', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 1. R09: Schema alignment, credit breakdown in metadata, write failure gating
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. R09: Manual Allocation Schema Contract & Error Propagation', () => {
    it('persists manual allocation against actual migrated schema without core_credits/additional_credits columns', async () => {
      const { mockAuditLogger, mockServerLogger, auditLogs } = createMockLoggers()
      let insertedPayload = null

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChainableMock(() => ({
                data: { id: 'stu-1', campus_id: 'camp-1', department_id: 'dept-cs', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChainableMock(() => ({
                data: { academic_year: '2026-27' },
                error: null,
              }))
            }
            if (table === 'courses') {
              return createChainableMock((op) => {
                if (op === 'single') {
                  return {
                    data: { id: 'c-dsc-301', course_code: 'CS301', title: 'Data Structures', department_id: 'dept-cs', semester: 3, credits: 4, category: 'DSC', seat_limit: 60, tag: null },
                    error: null,
                  }
                }
                return {
                  data: [{ id: 'c-dsc-301', credits: 4 }],
                  error: null,
                }
              })
            }
            if (table === 'student_registrations') {
              return createChainableMock((op, payload) => {
                if (op === 'maybeSingle') {
                  return { data: null, error: null }
                }
                if (op === 'insert') {
                  insertedPayload = payload
                  return { data: { id: 'reg-new' }, error: null }
                }
                return { count: 5, error: null }
              })
            }
            if (table === 'course_prerequisite_rules') {
              return createChainableMock(() => ({ data: [], error: null }))
            }
            if (table === 'registration_preferences') {
              return createChainableMock(() => ({ data: null, error: null }))
            }
            if (table === 'semester_blueprints') {
              return createChainableMock(() => ({
                data: {
                  pathways: [{
                    id: 'pw-cs',
                    slots: [
                      { slot: 1, rule: 'FIXED', target: 'CS301' },
                      { slot: 2, rule: 'FIXED', target: 'CS302' },
                      { slot: 3, rule: 'DEPT_RESTRICTED', target: 'CS', name: 'Major Core' },
                    ],
                  }],
                },
                error: null,
              }))
            }
            if (table === 'departments') {
              return createChainableMock(() => ({
                data: [{ id: 'dept-cs', code: 'CS' }],
                error: null,
              }))
            }
            return createChainableMock(() => ({ data: null, error: null }))
          },
        },
      }

      const allocService = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-cs' }

      const result = await allocService.manualAllocate(
        { student_id: 'stu-1', slot_key: 'slot_3', course_id: 'c-dsc-301' },
        hodUser,
      )

      assert.strictEqual(result.success, true)
      assert.ok(insertedPayload, 'Must insert into student_registrations')
      assert.strictEqual(insertedPayload.core_credits, undefined, 'Must NOT include core_credits table column')
      assert.strictEqual(insertedPayload.additional_credits, undefined, 'Must NOT include additional_credits table column')
      assert.strictEqual(insertedPayload.total_credits, 4, 'Must set total_credits')
      assert.ok(insertedPayload.allocation_metadata?.credit_breakdown, 'Must store credit_breakdown inside allocation_metadata')
      assert.strictEqual(insertedPayload.allocation_metadata.credit_breakdown.core_credits, 4)
      assert.strictEqual(insertedPayload.allocation_metadata.credit_breakdown.total_credits, 4)
      assert.strictEqual(auditLogs.length, 1, 'Audit log recorded only on success')
    })

    it('propagates database error and rejects without recording audit or returning success', async () => {
      const { mockAuditLogger, mockServerLogger, auditLogs } = createMockLoggers()

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChainableMock(() => ({
                data: { id: 'stu-1', campus_id: 'camp-1', department_id: 'dept-cs', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChainableMock(() => ({
                data: { academic_year: '2026-27' },
                error: null,
              }))
            }
            if (table === 'courses') {
              return createChainableMock((op) => {
                if (op === 'single') {
                  return {
                    data: { id: 'c-dsc-301', course_code: 'CS301', title: 'Data Structures', department_id: 'dept-cs', semester: 3, credits: 4, category: 'DSC', seat_limit: 60, tag: null },
                    error: null,
                  }
                }
                return {
                  data: [{ id: 'c-dsc-301', credits: 4 }],
                  error: null,
                }
              })
            }
            if (table === 'student_registrations') {
              return createChainableMock((op) => {
                if (op === 'maybeSingle') {
                  return { data: null, error: null }
                }
                if (op === 'insert') {
                  // INJECTED DATABASE FAILURE!
                  return { data: null, error: { message: 'Column core_credits does not exist' } }
                }
                return { count: 5, error: null }
              })
            }
            if (table === 'course_prerequisite_rules') {
              return createChainableMock(() => ({ data: [], error: null }))
            }
            if (table === 'registration_preferences') {
              return createChainableMock(() => ({ data: null, error: null }))
            }
            if (table === 'semester_blueprints') {
              return createChainableMock(() => ({
                data: {
                  pathways: [{
                    id: 'pw-cs',
                    slots: [{ slot: 1, rule: 'DEPT_RESTRICTED', target: 'CS' }],
                  }],
                },
                error: null,
              }))
            }
            if (table === 'departments') {
              return createChainableMock(() => ({
                data: [{ id: 'dept-cs', code: 'CS' }],
                error: null,
              }))
            }
            return createChainableMock(() => ({ data: null, error: null }))
          },
        },
      }

      const allocService = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-cs' }

      await assert.rejects(
        async () => {
          await allocService.manualAllocate(
            { student_id: 'stu-1', slot_key: 'slot_1', course_id: 'c-dsc-301' },
            hodUser,
          )
        },
        (err) => {
          assert.strictEqual(err.name, 'InternalServerErrorException')
          assert.ok(err.message.includes('Failed to persist manual allocation'))
          return true
        },
      )

      assert.strictEqual(auditLogs.length, 0, 'No audit log must be emitted when write fails')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. R10: Global capacity locks for fixed courses & no un-transactional leakage
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. R10: Global Capacity Enforcement on Fixed Enrollment', () => {
    it('migration locks candidate fixed courses with deterministic row-level locks and verifies seat limit', () => {
      const migrationPath = path.join(
        __dirname,
        '../../supabase/migrations/20261009030000_followup_plan04_atomic_enrollment_and_global_seats.sql',
      )
      assert.ok(fs.existsSync(migrationPath), 'Migration file must exist')
      const sql = fs.readFileSync(migrationPath, 'utf8')

      // Verifies deterministic locking on candidate courses
      assert.ok(
        sql.includes('ORDER BY id') && sql.includes('FOR UPDATE'),
        'Must order candidate courses deterministically and acquire FOR UPDATE locks',
      )
      // Verifies global capacity check across all campuses for fixed courses
      assert.ok(
        sql.includes('Fixed course % (%) has reached maximum global capacity'),
        'Must enforce global seat capacity check for fixed courses',
      )
      assert.ok(
        sql.includes('academic_year = p_academic_year') && sql.includes('semester = p_semester'),
        'Capacity check must span all campuses for the active cohort',
      )
    })

    it('runAllocation does not execute pre-run upserts on student_registrations before atomic commit', async () => {
      const { mockAuditLogger, mockServerLogger } = createMockLoggers()
      const registeredTablesTouched = []

      const mockSupabase = {
        admin: {
          from: (table) => {
            registeredTablesTouched.push(table)
            if (table === 'system_logs' || table === 'allocation_runs') {
              return createChainableMock((op) => {
                if (op === 'single') return { data: { id: 'run-1', status: 'running', campus_id: 'c-1', academic_year: '2026-27', semester: 3 }, error: null }
                return { data: null, error: null }
              })
            }
            if (table === 'campus_settings') {
              return createChainableMock(() => ({ data: { academic_year: '2026-27', deadline: new Date(Date.now() - 3600000).toISOString() }, error: null }))
            }
            if (table === 'courses') {
              return createChainableMock(() => ({
                data: [{ id: 'c-fixed-1', course_code: 'FIX101', title: 'Fixed Course', seat_limit: 1, credits: 4, department_id: 'dept-1' }],
                error: null,
              }))
            }
            if (table === 'registration_preferences') {
              return createChainableMock(() => ({
                data: [
                  {
                    id: 'pref-1',
                    student_id: 'stu-1',
                    pathway_id: 'pw-1',
                    preferences: [{ slot: 1, is_fixed: true, choices: [{ course_id: 'c-fixed-1', rank: 1 }] }],
                    allocation_metadata: {},
                  },
                ],
                error: null,
              }))
            }
            if (table === 'student_registrations') {
              return createChainableMock((op) => {
                if (op === 'upsert' || op === 'insert') {
                  assert.fail('Should NOT perform direct upsert to student_registrations before atomic commit')
                }
                return { data: [], error: null }
              })
            }
            if (table === 'timetable_entries') {
              return createChainableMock(() => ({ data: [], count: 0, error: null }))
            }
            if (table === 'course_prerequisite_rules') {
              return createChainableMock(() => ({ data: [], error: null }))
            }
            return createChainableMock(() => ({ data: null, error: null }))
          },
          rpc: (name) => {
            if (name === 'claim_allocation_run') return Promise.resolve({data:'run-1',error:null})
            if (name === 'apply_course_allocation') {
              // Simulated atomic RPC failure
              return Promise.resolve({ data: null, error: { message: 'Injected RPC transaction abort' } })
            }
            return Promise.resolve({ data: null, error: null })
          },
        },
      }

      const allocService = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      const directorUser = { userId: 'dir-1', role: 'campus_director', campus_id: 'c-1' }

      await assert.rejects(
        async () => {
          await allocService.runAllocation(
            { academicYear: '2026-27', semester: 3 },
            directorUser,
          )
        },
        (err) => {
          assert.ok(err.message.includes('Injected RPC transaction abort'))
          return true
        },
      )
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. R11: No unsafe mutation fallbacks & safe idempotency replay
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. R11: Elimination of Mutation Fallbacks & Idempotency Key Handling', () => {
    it('submitCourses propagates RPC business rejection without falling back to direct table writes', async () => {
      const { mockAuditLogger, mockServerLogger } = createMockLoggers()

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChainableMock(() => ({
                data: { id: 'stu-1', campus_id: 'camp-1', department_id: 'dept-1', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChainableMock(() => ({
                data: { academic_year: '2026-27', deadline: new Date(Date.now() + 86400000).toISOString(), min_credits: 0, max_credits: 28 },
                error: null,
              }))
            }
            if (table === 'timetable_entries') {
              return createChainableMock(() => ({ data: [], count: 0, error: null }))
            }
            if (table === 'semester_blueprints') {
              return createChainableMock(() => ({
                data: {
                  pathways: [{
                    id: 'pw-1',
                    slots: [{ slot: 1, rule: 'FIXED', target: 'CS101' }],
                  }],
                },
                error: null,
              }))
            }
            if (table === 'courses') {
              return createChainableMock(() => ({
                data: [{ id: 'c-cs-101', course_code: 'CS101', title: 'Intro CS', credits: 4, department_id: 'dept-1', semester: 3, category: 'DSC', tag: null }],
                error: null,
              }))
            }
            if (table === 'student_registrations' || table === 'registration_preferences') {
              return createChainableMock((op) => {
                if (op === 'upsert' || op === 'insert') {
                  assert.fail('Fallback direct write to table was invoked after RPC failure!')
                }
                return { data: null, error: null }
              })
            }
            return createChainableMock(() => ({ data: null, error: null }))
          },
          rpc: (name) => {
            if (name === 'submit_student_registration') {
              // Simulated database rejection after seat exhausted by concurrent request
              return Promise.resolve({
                data: null,
                error: { message: 'Fixed course CS101 (Intro CS) has reached maximum global capacity (60/60 seats)' },
              })
            }
            return Promise.resolve({ data: null, error: null })
          },
        },
      }

      const regService = new RegistrationsService(mockSupabase, mockAuditLogger, mockServerLogger)
      const studentUser = { userId: 'stu-1', role: 'student', campus_id: 'camp-1', current_semester: 3 }

      await assert.rejects(
        async () => {
          await regService.submitCourses(
            { semester: 3, pathway_id: 'pw-1', preferences: {} },
            studentUser,
          )
        },
        (err) => {
          assert.strictEqual(err.name, 'ConflictException')
          assert.ok(err.message.includes('has reached maximum global capacity'))
          return true
        },
      )
    })

    it('updateSlot propagates RPC business rejection without falling back to direct table updates', async () => {
      const { mockAuditLogger, mockServerLogger } = createMockLoggers()

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChainableMock(() => ({
                data: { id: 'stu-1', campus_id: 'camp-1', department_id: 'dept-1', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChainableMock(() => ({
                data: { academic_year: '2026-27', deadline: new Date(Date.now() + 86400000).toISOString() },
                error: null,
              }))
            }
            if (table === 'timetable_entries') {
              return createChainableMock(() => ({ data: [], count: 0, error: null }))
            }
            if (table === 'student_registrations') {
              return createChainableMock((op) => {
                if (op === 'maybeSingle') {
                  return { data: { id: 'reg-1', pathway_id: 'pw-1', slot_2_course_id: 'c-old', allocation_metadata: {} }, error: null }
                }
                if (op === 'update') {
                  assert.fail('Fallback direct table update was invoked after RPC failure!')
                }
                return { count: 10, error: null }
              })
            }
            if (table === 'semester_blueprints') {
              return createChainableMock(() => ({
                data: {
                  pathways: [{
                    id: 'pw-1',
                    slots: [
                      { slot: 1, rule: 'FIXED', target: 'CS101' },
                      { slot: 2, rule: 'DEPT_RESTRICTED', target: 'CS', name: 'Major Core' },
                    ],
                  }],
                },
                error: null,
              }))
            }
            if (table === 'courses') {
              return createChainableMock(() => ({
                data: { id: 'c-new', course_code: 'CS201', title: 'Algorithms', credits: 4, department_id: 'dept-1', semester: 3, category: 'DSC', seat_limit: 60, tag: null },
                error: null,
              }))
            }
            if (table === 'departments') {
              return createChainableMock(() => ({ data: [{ id: 'dept-1', code: 'CS' }], error: null }))
            }
            if (table === 'course_prerequisite_rules') {
              return createChainableMock(() => ({ data: [], error: null }))
            }
            return createChainableMock(() => ({ data: null, error: null }))
          },
          rpc: (name) => {
            if (name === 'execute_student_course_change') {
              return Promise.resolve({
                data: null,
                error: { message: 'Rate limit exceeded: maximum 3 course changes allowed per 27 hours' },
              })
            }
            return Promise.resolve({ data: null, error: null })
          },
        },
      }

      const regService = new RegistrationsService(mockSupabase, mockAuditLogger, mockServerLogger)
      const studentUser = { userId: 'stu-1', role: 'student', campus_id: 'camp-1', current_semester: 3 }

      await assert.rejects(
        async () => {
          await regService.updateSlot(
            { slot_key: 'slot_2', course_id: 'c-new' },
            studentUser,
          )
        },
        (err) => {
          assert.strictEqual(err.name, 'ForbiddenException')
          assert.ok(err.message.includes('Rate limit exceeded'))
          return true
        },
      )
    })

    it('migration verifies idempotency replay safety and rejects key reuse with different parameters', () => {
      const migrationPath = path.join(
        __dirname,
        '../../supabase/migrations/20261009030000_followup_plan04_atomic_enrollment_and_global_seats.sql',
      )
      const sql = fs.readFileSync(migrationPath, 'utf8')

      assert.ok(
        sql.includes("elem.value->>'idempotency_key' = p_client_idempotency_key"),
        'Must check existing idempotency key in slot_change_history',
      )
      assert.ok(
        sql.includes("'idempotent_replay', true"),
        'Must return idempotent replay on identical key match',
      )
      assert.ok(
        sql.includes('Idempotency key % already used for a different request payload'),
        'Must reject key reuse with altered request payload',
      )
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 4. R12: Blueprint slot eligibility validation across mutation paths
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. R12: Blueprint Slot Rule Validation on Direct Changes & Manual Allocation', () => {
    it('updateSlot rejects course belonging to wrong department for slot rule', async () => {
      const { mockAuditLogger, mockServerLogger } = createMockLoggers()

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChainableMock(() => ({
                data: { id: 'stu-1', campus_id: 'camp-1', department_id: 'dept-cs', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChainableMock(() => ({
                data: { academic_year: '2026-27', deadline: new Date(Date.now() + 86400000).toISOString() },
                error: null,
              }))
            }
            if (table === 'timetable_entries') {
              return createChainableMock(() => ({ data: [], count: 0, error: null }))
            }
            if (table === 'student_registrations') {
              return createChainableMock(() => ({
                data: { id: 'reg-1', pathway_id: 'pw-1', slot_3_course_id: 'c-old', allocation_metadata: {} },
                error: null,
              }))
            }
            if (table === 'semester_blueprints') {
              return createChainableMock(() => ({
                data: {
                  pathways: [{
                    id: 'pw-1',
                    slots: [
                      { slot: 1, rule: 'FIXED', target: 'CS101' },
                      { slot: 2, rule: 'FIXED', target: 'CS102' },
                      { slot: 3, rule: 'DEPT_RESTRICTED', target: 'CS', name: 'CS Major' },
                    ],
                  }],
                },
                error: null,
              }))
            }
            if (table === 'courses') {
              return createChainableMock(() => ({
                // Course belongs to HIST department, but Slot 3 requires CS department!
                data: { id: 'c-hist-301', course_code: 'HIST301', title: 'World History', credits: 4, department_id: 'dept-hist', semester: 3, category: 'DSC', seat_limit: 60, tag: null },
                error: null,
              }))
            }
            if (table === 'departments') {
              return createChainableMock(() => ({
                data: [{ id: 'dept-cs', code: 'CS' }, { id: 'dept-hist', code: 'HIST' }],
                error: null,
              }))
            }
            return createChainableMock(() => ({ data: null, error: null }))
          },
        },
      }

      const regService = new RegistrationsService(mockSupabase, mockAuditLogger, mockServerLogger)
      const studentUser = { userId: 'stu-1', role: 'student', campus_id: 'camp-1', current_semester: 3 }

      await assert.rejects(
        async () => {
          await regService.updateSlot(
            { slot_key: 'slot_3', course_id: 'c-hist-301' },
            studentUser,
          )
        },
        (err) => {
          assert.strictEqual(err.name, 'BadRequestException')
          assert.ok(err.message.includes('not eligible for slot_3'))
          return true
        },
      )
    })

    it('manualAllocate rejects target course whose semester does not match student active semester', async () => {
      const { mockAuditLogger, mockServerLogger } = createMockLoggers()

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChainableMock(() => ({
                data: { id: 'stu-1', campus_id: 'camp-1', department_id: 'dept-cs', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChainableMock(() => ({
                data: { academic_year: '2026-27' },
                error: null,
              }))
            }
            if (table === 'courses') {
              return createChainableMock(() => ({
                // Semester 5 course targeted for a Semester 3 student!
                data: { id: 'c-cs-501', course_code: 'CS501', title: 'Compilers', department_id: 'dept-cs', semester: 5, credits: 4, category: 'DSC', seat_limit: 60, tag: null },
                error: null,
              }))
            }
            return createChainableMock(() => ({ data: null, error: null }))
          },
        },
      }

      const allocService = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-cs' }

      await assert.rejects(
        async () => {
          await allocService.manualAllocate(
            { student_id: 'stu-1', slot_key: 'slot_3', course_id: 'c-cs-501' },
            hodUser,
          )
        },
        (err) => {
          assert.strictEqual(err.name, 'BadRequestException')
          assert.ok(err.message.includes('Course belongs to semester 5, but student is active in semester 3'))
          return true
        },
      )
    })

    it('allows explicitly configured cross-campus fixed courses', () => {
      // Course belongs to foreign department/campus, but pathway slot fixed target matches course code
      const crossCampusCourse = {
        course_code: 'ENG101',
        department_id: 'dept-foreign',
        category: 'AEC',
        tag: null,
      }
      const deptMap = new Map([['ENG', 'dept-foreign'], ['CS', 'dept-home']])

      const eligible = isCourseEligibleForSlot(
        crossCampusCourse,
        'FIXED',
        'eng101',
        'dept-home',
        deptMap,
        'AEC English',
      )
      assert.strictEqual(eligible, true, 'Configured cross-campus fixed course must remain eligible')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 5. R14: Pathway change fixed course release & timestamp preservation
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. R14: Pathway Switch Reconciles Fixed Courses & Preserves Tiebreaker', () => {
    it('migration contains pathway slot reconciliation releasing removed fixed courses instead of blind COALESCE', () => {
      const migrationPath = path.join(
        __dirname,
        '../../supabase/migrations/20261009030000_followup_plan04_atomic_enrollment_and_global_seats.sql',
      )
      const sql = fs.readFileSync(migrationPath, 'utf8')

      // Verifies that when a formerly fixed slot is no longer fixed in the new pathway, it is set to NULL
      assert.ok(
        sql.includes("WHEN (v_existing_reg.allocation_metadata->'slot_1'->>'allocated_by') = 'fixed' THEN NULL"),
        'Must reset slot to NULL if it was previously allocated as fixed and new pathway is not fixed',
      )
      assert.ok(
        sql.includes("WHEN v_existing_reg.pathway_id IS NOT NULL AND v_existing_reg.pathway_id <> p_pathway_id THEN NULL"),
        'Must reset slot to NULL when student switches pathway',
      )
      // Verifies obsolete fixed metadata cleanup
      assert.ok(
        sql.includes("v_cleaned_meta := v_cleaned_meta - 'slot_1'"),
        'Must remove obsolete fixed slot metadata when switching pathway',
      )
    })

    it('submitCourses preserves original first submission timestamp across pathway changes', async () => {
      const { mockAuditLogger, mockServerLogger } = createMockLoggers()
      const initialTimestamp = '2026-09-01T10:00:00.000Z'
      let submittedRpcParams = null

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return createChainableMock(() => ({
                data: { id: 'stu-1', campus_id: 'camp-1', department_id: 'dept-1', current_semester: 3, departments: { code: 'CS' } },
                error: null,
              }))
            }
            if (table === 'campus_settings') {
              return createChainableMock(() => ({
                data: { academic_year: '2026-27', deadline: new Date(Date.now() + 86400000).toISOString(), min_credits: 0, max_credits: 28 },
                error: null,
              }))
            }
            if (table === 'timetable_entries') {
              return createChainableMock(() => ({ data: [], count: 0, error: null }))
            }
            if (table === 'registration_preferences') {
              return createChainableMock(() => ({
                // Prior submission exists with original tie-break timestamp!
                data: { id: 'pref-1', submitted_at: initialTimestamp, allocation_metadata: { slot_1: { allocated_by: 'fixed' } } },
                error: null,
              }))
            }
            if (table === 'student_registrations') {
              return createChainableMock((op) => {
                if (op === 'maybeSingle') {
                  return {
                    data: { id: 'reg-1', submitted_at: initialTimestamp, allocation_metadata: { slot_1: { allocated_by: 'fixed' } } },
                    error: null,
                  }
                }
                return { data: [], error: null }
              })
            }
            if (table === 'semester_blueprints') {
              return createChainableMock(() => ({
                data: {
                  pathways: [{
                    id: 'pw-new',
                    slots: [
                      // In pw-new, slot 1 is now an elective!
                      { slot: 1, rule: 'DEPT_RESTRICTED', target: 'CS', name: 'CS Elective' },
                    ],
                  }],
                },
                error: null,
              }))
            }
            if (table === 'courses') {
              return createChainableMock(() => ({
                data: [{ id: 'c-elec-1', course_code: 'CS201', title: 'Algorithms', credits: 4, department_id: 'dept-1', semester: 3, category: 'DSC', tag: null }],
                error: null,
              }))
            }
            if (table === 'departments') {
              return createChainableMock(() => ({ data: [{ id: 'dept-1', code: 'CS' }], error: null }))
            }
            if (table === 'course_prerequisite_rules') {
              return createChainableMock(() => ({ data: [], error: null }))
            }
            return createChainableMock(() => ({ data: null, error: null }))
          },
          rpc: (name, params) => {
            if (name === 'submit_student_registration') {
              submittedRpcParams = params
              return Promise.resolve({
                data: { success: true, submitted_at: initialTimestamp, preserved_first_submission: true },
                error: null,
              })
            }
            return Promise.resolve({ data: null, error: null })
          },
        },
      }

      const regService = new RegistrationsService(mockSupabase, mockAuditLogger, mockServerLogger)
      const studentUser = { userId: 'stu-1', role: 'student', campus_id: 'camp-1', current_semester: 3 }

      const result = await regService.submitCourses(
        {
          semester: 3,
          pathway_id: 'pw-new',
          preferences: {
            slot_1: [{ course_id: 'c-elec-1', rank: 1 }],
          },
        },
        studentUser,
      )

      assert.strictEqual(result.success, true)
      assert.ok(submittedRpcParams, 'Must call submit_student_registration RPC')
      assert.strictEqual(
        submittedRpcParams.p_submitted_at,
        initialTimestamp,
        'Must preserve first submission timestamp as tiebreaker across edits',
      )
      assert.strictEqual(
        submittedRpcParams.p_allocation_metadata['slot_1'],
        undefined,
        'Must clear obsolete fixed allocation metadata for formerly fixed slot',
      )
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Plan 01 Security Compliance: Privilege grants & search_path pinning
  // ──────────────────────────────────────────────────────────────────────────
  describe('6. Plan 01 Security Privilege Grants & Search Path Pinning', () => {
    it('migration revokes function execution from PUBLIC/anon/authenticated and grants strictly to service_role and postgres', () => {
      const migrationPath = path.join(
        __dirname,
        '../../supabase/migrations/20261009030000_followup_plan04_atomic_enrollment_and_global_seats.sql',
      )
      const sql = fs.readFileSync(migrationPath, 'utf8')

      // Verify submit_student_registration permissions
      assert.ok(
        sql.includes('REVOKE ALL ON FUNCTION public.submit_student_registration'),
        'Must revoke execute on submit_student_registration from PUBLIC',
      )
      assert.ok(
        sql.includes('GRANT EXECUTE ON FUNCTION public.submit_student_registration') &&
        sql.includes('TO service_role, postgres'),
        'Must grant execute on submit_student_registration strictly to service_role and postgres',
      )

      // Verify execute_student_course_change permissions
      assert.ok(
        sql.includes('REVOKE ALL ON FUNCTION public.execute_student_course_change'),
        'Must revoke execute on execute_student_course_change from PUBLIC',
      )
      assert.ok(
        sql.includes('GRANT EXECUTE ON FUNCTION public.execute_student_course_change') &&
        sql.includes('TO service_role, postgres'),
        'Must grant execute on execute_student_course_change strictly to service_role and postgres',
      )

      // Verify execute_manual_course_allocation permissions
      assert.ok(
        sql.includes('REVOKE ALL ON FUNCTION public.execute_manual_course_allocation'),
        'Must revoke execute on execute_manual_course_allocation from PUBLIC',
      )
      assert.ok(
        sql.includes('GRANT EXECUTE ON FUNCTION public.execute_manual_course_allocation') &&
        sql.includes('TO service_role, postgres'),
        'Must grant execute on execute_manual_course_allocation strictly to service_role and postgres',
      )

      // Verify search_path pinning
      const countSearchPath = (sql.match(/SET search_path = public, pg_temp/g) || []).length
      assert.strictEqual(countSearchPath >= 3, true, 'All RPC functions must pin search_path = public, pg_temp')
    })
  })
})
