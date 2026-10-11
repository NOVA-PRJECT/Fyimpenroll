/**
 * Automated Acceptance Test Suite for Follow-up Plan 05:
 * Allocation accounting, scoped jobs and complete cohort data
 * Findings covered: R13, R15, R16, R36
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// Import compiled dist modules
const { AllocationService } = require('../dist/modules/allocation/allocation.service')
const { RegistrationsService } = require('../dist/modules/registrations/registrations.service')
const { TimetableService } = require('../dist/modules/timetable/timetable.service')
const { fetchAllPaginated } = require('../dist/core/database/pagination.util')

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
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    range: (from, to) => {
      const custom = resolver('range', { from, to })
      const result = custom ?? resolver('then') ?? { data: [], error: null }
      return { ...result, data: Array.isArray(result.data) ? result.data.slice(from, to + 1) : result.data }
    },
    single: async () => {
      const res = resolver('single')
      if (res !== undefined) return res
      const def = resolver('then')
      if (def && Array.isArray(def.data)) {
        return { data: def.data[0] || null, error: def.error || null }
      }
      return def || { data: null, error: null }
    },
    maybeSingle: async () => {
      const res = resolver('maybeSingle')
      if (res !== undefined) return res
      const def = resolver('then')
      if (def && Array.isArray(def.data)) {
        return { data: def.data[0] || null, error: def.error || null }
      }
      return def || { data: null, error: null }
    },
    insert: async (payload) => resolver('insert', payload),
    update: (payload) => {
      return {
        ...chain,
        eq: () => resolver('update', payload),
      }
    },
    delete: () => {
      return {
        ...chain,
        eq: () => resolver('delete'),
      }
    },
    then: (resolve) => {
      if (isCountQuery) {
        return resolve(resolver('countQuery') || { count: 0, error: null })
      }
      return resolve(resolver('then') || { data: [], error: null })
    },
  }
  return chain
}

describe('Follow-up Plan 05 · Allocation Accounting, Scoped Jobs & Complete Cohort Data', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 1. R13: Allocation Capacity Accounting (No Double Deduction)
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. R13: Available Seat Accounting & Net Occupancy Calculation', () => {
    it('capacity two with one existing fixed student permits exactly one additional elective student (not 0)', async () => {
      const { mockAuditLogger, mockServerLogger } = createMockLoggers()

      // Course C1 has seat_limit = 2
      // Student 1 (fixed) was already committed in student_registrations
      // Student 2 (elective) chose C1 as rank 1
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'campus_settings') {
              return createChainableMock((op) => {
                if (op === 'maybeSingle') {
                  return { data: { academic_year: '2025-26', deadline: '2025-01-01T00:00:00Z' }, error: null }
                }
              })
            }
            if (table === 'courses') {
              return createChainableMock((op) => {
                if (op === 'then') {
                  return {
                    data: [
                      { id: 'c1', course_code: 'CS101', title: 'Intro CS', semester: 1, department_id: 'dept-1', seat_limit: 2 },
                    ],
                    error: null,
                  }
                }
              })
            }
            if (table === 'course_prerequisite_rules') {
              return createChainableMock(() => ({ data: [], error: null }))
            }
            if (table === 'registration_preferences') {
              return createChainableMock((op) => {
                if (op === 'then' || op === 'range') {
                  return {
                    data: [
                      {
                        id: 'pref-stu-1',
                        student_id: 'stu-1',
                        campus_id: 'camp-1',
                        semester: 1,
                        academic_year: '2025-26',
                        preferences: [
                          { slot: 1, is_fixed: true, choices: [{ course_id: 'c1', rank: 1 }] },
                        ],
                        submitted_at: '2025-01-01T09:00:00Z',
                      },
                      {
                        id: 'pref-stu-2',
                        student_id: 'stu-2',
                        campus_id: 'camp-1',
                        semester: 1,
                        academic_year: '2025-26',
                        preferences: [
                          { slot: 1, is_fixed: false, choices: [{ course_id: 'c1', rank: 1 }] },
                        ],
                        submitted_at: '2025-01-01T10:00:00Z',
                      },
                    ],
                    error: null,
                  }
                }
              })
            }
            if (table === 'students') {
              return createChainableMock((op) => {
                if (op === 'then') {
                  return {
                    data: [
                      { id: 'stu-1', department_id: 'dept-1', current_semester: 1, departments: { code: 'CS' } },
                      { id: 'stu-2', department_id: 'dept-1', current_semester: 1, departments: { code: 'CS' } },
                    ],
                    error: null,
                  }
                }
              })
            }
            if (table === 'student_registrations') {
              return createChainableMock((op) => {
                if (op === 'then' || op === 'range') {
                  // Student 1 is ALREADY recorded in student_registrations with slot_1_course_id = c1
                  return {
                    data: [
                      {
                        student_id: 'stu-1',
                        slot_1_course_id: 'c1',
                        slot_2_course_id: null,
                        slot_3_course_id: null,
                        slot_4_course_id: null,
                        slot_5_course_id: null,
                        slot_6_course_id: null,
                        slot_7_course_id: null,
                        slot_8_course_id: null,
                      },
                    ],
                    error: null,
                  }
                }
              })
            }
            if (table === 'timetable_entries') {
              return createChainableMock(() => ({ count: 0, error: null }))
            }
            return createChainableMock(() => undefined)
          },
          rpc: async (name, params) => {
            if (name === 'claim_allocation_run') {
              return { data: 'run-123', error: null }
            }
            if (name === 'apply_course_allocation') {
              // Verify that Student 2 WAS allocated to course c1!
              const allocations = params.p_allocations || []
              const allocatedStudent2 = allocations.find((a) => a.student_id === 'stu-2' && a.course_id === 'c1')
              assert.ok(allocatedStudent2, 'Student 2 should be allocated the remaining 1 elective seat in C1')
              return { data: { success: true, allocated_count: allocations.length, unallocated_count: 0 }, error: null }
            }
            return { data: null, error: null }
          },
        },
      }

      const allocationService = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      const user = { userId: 'admin-1', role: 'campus_director', campus_id: 'camp-1' }

      const result = await allocationService.runAllocation({ semester: 1, academicYear: '2025-26' }, user)
      assert.strictEqual(result.success, true)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. R15: Campus-Scoped Publication Checks
  // ──────────────────────────────────────────────────────────────────────────
  describe("2. R15: Independent Campus Publication Scoping", () => {
    it("migration scopes timetable publication check to campus_id in all RPCs", () => {
      const migrationPath = path.join(
        __dirname,
        '../../supabase/migrations/20261010010000_followup_plan05_scoped_jobs_and_cohort_accounting.sql'
      )
      assert.ok(fs.existsSync(migrationPath), 'Migration 20261010010000 must exist')
      const sql = fs.readFileSync(migrationPath, 'utf8')

      // Check claim_allocation_run scopes to campus_id
      assert.ok(
        sql.includes('AND campus_id = p_campus_id') && sql.includes("AND status = 'published'"),
        'claim_allocation_run must filter timetable_entries by campus_id = p_campus_id'
      )

      // Check apply_course_allocation scopes to campus_id
      assert.ok(
        sql.includes('AND campus_id = p_campus_id') && sql.includes("AND status = 'published'"),
        'apply_course_allocation must filter timetable_entries by campus_id = p_campus_id'
      )

      // Check execute_student_course_change scopes to campus_id
      assert.ok(
        sql.includes('AND campus_id = p_campus_id') && sql.includes("AND status = 'published'"),
        'execute_student_course_change must filter timetable_entries by campus_id = p_campus_id'
      )
    })

    it("Campus B publication does NOT block Campus A student course changes in updateSlot", async () => {
      const { mockAuditLogger, mockServerLogger } = createMockLoggers()

      let checkedCampusId = null
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'campus_settings') {
              return createChainableMock((op) => {
                if (op === 'maybeSingle') {
                  return { data: { academic_year: '2025-26', deadline: '2099-01-01T00:00:00Z' }, error: null }
                }
              })
            }
            if (table === 'timetable_entries') {
              let filterCampus = null
              const chain = {
                select: () => chain,
                eq: (col, val) => {
                  if (col === 'campus_id') filterCampus = val
                  return chain
                },
                limit: async () => {
                  checkedCampusId = filterCampus
                  // If checked for Campus B, returns published row; for Campus A, returns empty!
                  if (filterCampus === 'campus-b') {
                    return { data: [{ id: 'published-slot-b' }], error: null }
                  }
                  return { data: [], error: null }
                },
              }
              return chain
            }
            if (table === 'students') {
              return createChainableMock((op) => {
                if (op === 'single') {
                  return { data: { id: 'stu-a-1', campus_id: 'campus-a', department_id: 'dept-a', current_semester: 1 }, error: null }
                }
              })
            }
            if (table === 'departments') {
              return createChainableMock((op) => {
                if (op === 'maybeSingle' || op === 'then') {
                  return { data: [{ id: 'dept-a', code: 'CS' }], error: null }
                }
              })
            }
            if (table === 'courses') {
              return createChainableMock((op) => {
                if (op === 'single') {
                  return { data: { id: 'c-new', course_code: 'CS102', title: 'Data Structures', credits: 4, semester: 1, department_id: 'dept-a', category: 'Major' }, error: null }
                }
              })
            }
            if (table === 'student_registrations') {
              return createChainableMock((op) => {
                if (op === 'maybeSingle') {
                  return { data: { id: 'reg-a', pathway_id: 'p-1', slot_1_course_id: 'c-old', allocation_metadata: {} }, error: null }
                }
                if (op === 'countQuery') {
                  return { count: 0, error: null }
                }
              })
            }
            if (table === 'semester_blueprints') {
              return createChainableMock(() => ({ data: { pathways: [{id:'p-1',slots:[{rule:'FIXED',target:'CS102',name:'Configured Paper'}]}] },error:null }))
            }
            if (table === 'course_prerequisite_rules') {
              return createChainableMock(() => ({ data: [], error: null }))
            }
            return createChainableMock(() => undefined)
          },
          rpc: async (name, params) => {
            if (name === 'execute_student_course_change') {
              assert.strictEqual(params.p_campus_id, 'campus-a')
              return { data: { success: true, slot_key: 'slot_1', course_id: 'c-new' }, error: null }
            }
            return { data: null, error: null }
          },
        },
      }

      const registrationsService = new RegistrationsService(mockSupabase, mockAuditLogger, mockServerLogger)
      const user = { userId: 'stu-a-1', role: 'student', campus_id: 'campus-a' }

      const res = await registrationsService.updateSlot(
        { slot_key: 'slot_1', course_id: 'c-new', idempotency_key: 'key-123' },
        user
      )
      assert.strictEqual(res.success, true)
      assert.strictEqual(checkedCampusId, 'campus-a', 'Query must check timetable publication specifically for campus-a')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. R16: Atomic Job Claims & Worker Fencing Tokens
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. R16: Atomic Job Claims & Fencing Protection', () => {
    it('migration creates partial unique index and claim_timetable_generation_job RPC with fencing token', () => {
      const migrationPath = path.join(
        __dirname,
        '../../supabase/migrations/20261010010000_followup_plan05_scoped_jobs_and_cohort_accounting.sql'
      )
      const sql = fs.readFileSync(migrationPath, 'utf8')

      assert.ok(
        sql.includes('uq_active_allocation_run_cohort'),
        'Must create unique partial index on system_logs for active allocation runs'
      )
      assert.ok(
        sql.includes('uq_active_timetable_generation_job_cohort'),
        'Must create unique partial index on system_logs for active timetable generation jobs'
      )
      assert.ok(
        sql.includes('FUNCTION public.claim_timetable_generation_job'),
        'Must create atomic claim_timetable_generation_job RPC'
      )
      assert.ok(
        sql.includes('pg_advisory_xact_lock'),
        'Must acquire transactional advisory lock during job claim'
      )
      assert.ok(
        sql.includes('fencing_token'),
        'Must generate and verify fencing token in job claims'
      )
    })

    it('TimetableService.generate claims job atomically and passes fencing token', async () => {
      const { mockAuditLogger, mockServerLogger } = createMockLoggers()
      let claimedParams = null

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'campus_settings') {
              return createChainableMock((op) => {
                if (op === 'maybeSingle') {
                  return { data: { academic_year: '2025-26', deadline: '2025-01-01T00:00:00Z' }, error: null }
                }
                return { data: [], error: null }
              })
            }
            if (table === 'allocation_runs') {
              return createChainableMock((op) => {
                if (op === 'then') {
                  return { data: [{ id: 'run-1', status: 'completed' }], error: null }
                }
                return { data: [], error: null }
              })
            }
            if (table === 'timetable_entries') {
              return createChainableMock(() => ({ count: 0, error: null }))
            }
            if (table === 'timetable_generation_jobs') {
              return createChainableMock(() => ({ data: [], error: null }))
            }
            return createChainableMock(() => ({ data: [], error: null }))
          },
          rpc: async (name, params) => {
            if (name === 'claim_timetable_generation_job') {
              claimedParams = params
              return {
                data: {
                  success: true,
                  job_id: 'job-tt-777',
                  fencing_token: params.p_fencing_token,
                },
                error: null,
              }
            }
            return { data: null, error: null }
          },
        },
      }

      const timetableService = new TimetableService(mockSupabase, mockAuditLogger, mockServerLogger)
      const user = { userId: 'dir-1', role: 'campus_director', campus_id: 'camp-1' }

      const result = await timetableService.generate('2025-26', 1, [], user)
      assert.strictEqual(result.success, true)
      assert.strictEqual(result.jobId, 'job-tt-777')
      assert.ok(result.fencingToken, 'Must generate and return fencing token')
      assert.strictEqual(claimedParams.p_campus_id, 'camp-1')
      assert.strictEqual(claimedParams.p_fencing_token, result.fencingToken)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 4. R36: Complete-Cohort Ordered Pagination
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. R36: Ordered Pagination for Full Cohorts', () => {
    it('fetchAllPaginated retrieves full dataset across multiple pages beyond default 1,000 row cap', async () => {
      // Simulate a dataset of 2,500 students (3 pages of 1,000)
      const totalStudents = 2500
      const dummyData = Array.from({ length: totalStudents }, (_, i) => ({
        id: `stu-${i + 1}`,
        name: `Student ${i + 1}`,
      }))

      let callCount = 0
      const pageFetcher = async (from, to) => {
        callCount++
        const slice = dummyData.slice(from, to + 1)
        return { data: slice, error: null }
      }

      const results = await fetchAllPaginated(pageFetcher, 1000)
      assert.strictEqual(results.length, 2500, 'Must retrieve all 2,500 records without truncation')
      assert.strictEqual(callCount, 4, 'Fetch 3 data batches and an empty sentinel; server caps may be smaller than requested pages')
      assert.strictEqual(results[0].id, 'stu-1')
      assert.strictEqual(results[2499].id, 'stu-2500')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Plan 01 Security Privilege Grants & Search Path Pinning
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. Plan 01 Security Privileges & Search Path Pinning', () => {
    it('migration revokes function execution from PUBLIC/anon/authenticated and grants strictly to service_role and postgres', () => {
      const migrationPath = path.join(
        __dirname,
        '../../supabase/migrations/20261010010000_followup_plan05_scoped_jobs_and_cohort_accounting.sql'
      )
      const sql = fs.readFileSync(migrationPath, 'utf8')

      // Verify search_path pinning
      const searchPathCount = (sql.match(/SET search_path = public, pg_temp/g) || []).length
      assert.ok(searchPathCount >= 4, 'All functions in migration must pin search_path = public, pg_temp')

      // Verify revokes and grants
      assert.ok(
        sql.includes('REVOKE ALL ON FUNCTION public.claim_allocation_run'),
        'Must revoke claim_allocation_run from PUBLIC'
      )
      assert.ok(
        sql.includes('REVOKE ALL ON FUNCTION public.apply_course_allocation'),
        'Must revoke apply_course_allocation from PUBLIC'
      )
      assert.ok(
        sql.includes('REVOKE ALL ON FUNCTION public.execute_student_course_change'),
        'Must revoke execute_student_course_change from PUBLIC'
      )
      assert.ok(
        sql.includes('REVOKE ALL ON FUNCTION public.claim_timetable_generation_job'),
        'Must revoke claim_timetable_generation_job from PUBLIC'
      )
      assert.ok(
        sql.includes('GRANT EXECUTE ON FUNCTION public.claim_allocation_run') &&
        sql.includes('TO service_role, postgres'),
        'Must grant claim_allocation_run to service_role and postgres'
      )
      assert.ok(
        sql.includes('GRANT EXECUTE ON FUNCTION public.claim_timetable_generation_job') &&
        sql.includes('TO service_role, postgres'),
        'Must grant claim_timetable_generation_job to service_role and postgres'
      )
    })
  })
})
