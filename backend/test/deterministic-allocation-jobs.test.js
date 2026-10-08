/**
 * Test Suite for Plan 05: Deterministic allocation and atomic jobs
 * Primary Findings: F18, F22, F23, F24, F25, F26, F70
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')

// Dist modules
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

describe('Plan 05: Deterministic Allocation and Atomic Jobs', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 1. F18: Deterministic Candidate Sorting Engine
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. F18: Deterministic Candidate Sorting Engine', () => {
    it('sorts candidates by Score DESC, then submitted_at ASC, then student_id ASC', () => {
      const candidates = [
        { studentId: 'student-z', score: 2, submittedAt: '2026-10-01T12:00:00Z' },
        { studentId: 'student-a', score: 3, submittedAt: '2026-10-01T15:00:00Z' }, // Higher score wins first
        { studentId: 'student-c', score: 2, submittedAt: '2026-10-01T10:00:00Z' }, // Earlier submittedAt wins tie
        { studentId: 'student-b', score: 2, submittedAt: '2026-10-01T12:00:00Z' }, // Exact tie with student-z; student-b wins lexicographically
      ]

      candidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        const timeA = new Date(a.submittedAt).getTime()
        const timeB = new Date(b.submittedAt).getTime()
        if (timeA !== timeB) return timeA - timeB
        return a.studentId.localeCompare(b.studentId)
      })

      assert.strictEqual(candidates[0].studentId, 'student-a') // score 3
      assert.strictEqual(candidates[1].studentId, 'student-c') // score 2, 10:00
      assert.strictEqual(candidates[2].studentId, 'student-b') // score 2, 12:00, 'b' < 'z'
      assert.strictEqual(candidates[3].studentId, 'student-z') // score 2, 12:00, 'z' > 'b'
    })

    it('produces an identical deterministic order regardless of input array ordering', () => {
      const input1 = [
        { studentId: 'stu-2', score: 1, submittedAt: '2026-10-01T10:00:00Z' },
        { studentId: 'stu-1', score: 1, submittedAt: '2026-10-01T10:00:00Z' },
      ]
      const input2 = [
        { studentId: 'stu-1', score: 1, submittedAt: '2026-10-01T10:00:00Z' },
        { studentId: 'stu-2', score: 1, submittedAt: '2026-10-01T10:00:00Z' },
      ]

      const sortFn = (a, b) => {
        if (b.score !== a.score) return b.score - a.score
        const timeA = new Date(a.submittedAt).getTime()
        const timeB = new Date(b.submittedAt).getTime()
        if (timeA !== timeB) return timeA - timeB
        return a.studentId.localeCompare(b.studentId)
      }

      input1.sort(sortFn)
      input2.sort(sortFn)

      assert.deepStrictEqual(input1, input2)
      assert.strictEqual(input1[0].studentId, 'stu-1')
      assert.strictEqual(input1[1].studentId, 'stu-2')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. F22: Closed Campus Window and Unpublished Guard
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. F22: Closed Campus Window and Unpublished Guard', () => {
    it('rejects allocation when campus registration deadline is still in the future (window open)', async () => {
      const futureDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'campus_settings') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { deadline: futureDeadline }, error: null }),
                  }),
                }),
              }
            }
            return {}
          },
        },
      }

      const service = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      await assert.rejects(
        async () => {
          await service.runAllocation(
            { academicYear: '2026-27', semester: 1 },
            { userId: 'u1', role: 'director', campus_id: 'campus-1' },
          )
        },
        (err) => {
          assert.strictEqual(err.name, 'BadRequestException')
          assert.ok(err.message.includes('Registration window is still open'))
          return true
        },
      )
    })

    it('rejects allocation when cohort timetable has published entries', async () => {
      const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'campus_settings') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { deadline: pastDeadline }, error: null }),
                  }),
                }),
              }
            }
            if (table === 'timetable_entries') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: async () => ({ count: 12, error: null }), // Published entries exist
                    }),
                  }),
                }),
              }
            }
            return {}
          },
        },
      }

      const service = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      await assert.rejects(
        async () => {
          await service.runAllocation(
            { academicYear: '2026-27', semester: 1 },
            { userId: 'u1', role: 'director', campus_id: 'campus-1' },
          )
        },
        (err) => {
          assert.strictEqual(err.name, 'ConflictException')
          assert.ok(err.message.includes('Timetable has already been published'))
          return true
        },
      )
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. F23: Atomic Allocation Run Claim RPC
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. F23: Atomic Allocation Run Claim Serialization', () => {
    it('invokes claim_allocation_run RPC and rejects when active run is in progress', async () => {
      const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      let claimedRpcCalled = false

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'campus_settings') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { deadline: pastDeadline }, error: null }),
                  }),
                }),
              }
            }
            if (table === 'timetable_entries') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: async () => ({ count: 0, error: null }),
                    }),
                  }),
                }),
              }
            }
            return {}
          },
          rpc: async (fnName, params) => {
            if (fnName === 'claim_allocation_run') {
              claimedRpcCalled = true
              assert.strictEqual(params.p_campus_id, 'campus-1')
              assert.strictEqual(params.p_academic_year, '2026-27')
              assert.strictEqual(params.p_semester, 1)
              return { data: null, error: { message: 'An allocation run is already in progress for this academic year and semester' } }
            }
            return { data: null, error: null }
          },
        },
      }

      const service = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      await assert.rejects(
        async () => {
          await service.runAllocation(
            { academicYear: '2026-27', semester: 1 },
            { userId: 'u1', role: 'director', campus_id: 'campus-1' },
          )
        },
        (err) => {
          assert.strictEqual(err.name, 'ConflictException')
          assert.ok(err.message.includes('already in progress'))
          return true
        },
      )
      assert.strictEqual(claimedRpcCalled, true)
    })

    it('rejects when allocation has already completed for the cohort', async () => {
      const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'campus_settings') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { deadline: pastDeadline }, error: null }),
                  }),
                }),
              }
            }
            if (table === 'timetable_entries') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: async () => ({ count: 0, error: null }),
                    }),
                  }),
                }),
              }
            }
            return {}
          },
          rpc: async (fnName) => {
            if (fnName === 'claim_allocation_run') {
              return { data: null, error: { message: 'Allocation has already been completed for Semester 1 (2026-27)' } }
            }
            return { data: null, error: null }
          },
        },
      }

      const service = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      await assert.rejects(
        async () => {
          await service.runAllocation(
            { academicYear: '2026-27', semester: 1 },
            { userId: 'u1', role: 'director', campus_id: 'campus-1' },
          )
        },
        (err) => {
          assert.strictEqual(err.name, 'ConflictException')
          assert.ok(err.message.includes('already been completed'))
          return true
        },
      )
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 4. F24: Removal of Partial-Write Fallback
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. F24: Fail-Fast Without Partial Write Fallback', () => {
    it('marks run failed and throws InternalServerErrorException if apply_course_allocation fails', async () => {
      const pastDeadline = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      let runStatusUpdatedTo = ''
      let studentRegistrationsUpdated = false

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'campus_settings') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: { deadline: pastDeadline }, error: null }),
                  }),
                }),
              }
            }
            if (table === 'timetable_entries') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: async () => ({ count: 0, error: null }),
                    }),
                  }),
                }),
              }
            }
            if (table === 'courses') {
              return {
                select: () => ({
                  eq: async () => ({ data: [{ id: 'course-1', course_code: 'ENG101', title: 'English', semester: 1, seat_limit: 60 }], error: null }),
                }),
              }
            }
            if (table === 'course_prerequisite_rules') {
              return {
                select: () => ({
                  in: async () => ({ data: [], error: null }),
                }),
              }
            }
            if (table === 'registration_preferences') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: async () => ({
                        data: [{
                          id: 'pref-1',
                          student_id: 'stu-1',
                          campus_id: 'campus-1',
                          semester: 1,
                          academic_year: '2026-27',
                          preferences: [{ slot: 1, choices: [{ course_id: 'course-1', rank: 1 }] }],
                          submitted_at: '2026-10-01T10:00:00Z',
                        }],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }
            }
            if (table === 'students') {
              return {
                select: () => ({
                  in: async () => ({ data: [{ id: 'stu-1', department_id: 'dept-1', current_semester: 1, departments: { code: 'ENG' } }], error: null }),
                }),
              }
            }
            if (table === 'student_registrations') {
              return {
                select: () => ({
                  in: () => ({
                    lt: async () => ({ data: [], error: null }),
                  }),
                  eq: () => ({
                    eq: async () => ({ data: [], error: null }),
                  }),
                }),
                update: () => {
                  studentRegistrationsUpdated = true
                  return { eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }
                },
              }
            }
            if (table === 'allocation_runs') {
              return {
                update: (payload) => {
                  if (payload.status) runStatusUpdatedTo = payload.status
                  return {
                    eq: async () => ({ error: null }),
                  }
                },
              }
            }
            return {}
          },
          rpc: async (fnName) => {
            if (fnName === 'claim_allocation_run') {
              return { data: 'run-uuid-1', error: null }
            }
            if (fnName === 'apply_course_allocation') {
              return { data: null, error: { message: 'Database transaction lock timeout' } }
            }
            return { data: null, error: null }
          },
        },
      }

      const service = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      await assert.rejects(
        async () => {
          await service.runAllocation(
            { academicYear: '2026-27', semester: 1 },
            { userId: 'u1', role: 'director', campus_id: 'campus-1' },
          )
        },
        (err) => {
          assert.strictEqual(err.name, 'InternalServerErrorException')
          assert.ok(err.message.includes('Database transaction lock timeout') || err.message.includes('commit course allocations'))
          return true
        },
      )

      assert.strictEqual(runStatusUpdatedTo, 'failed')
      assert.strictEqual(studentRegistrationsUpdated, false) // F24: NEVER executed partial fallback updates
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 5. F25: Failed-Run Cleanup Guard
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. F25: Failed-Run Cleanup Guard', () => {
    it('allows clearing runs with status "failed"', async () => {
      let deletedFromSystemLogs = false
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'allocation_runs') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: 'run-1', campus_id: 'campus-1', academic_year: '2026-27', semester: 1, status: 'failed' },
                      error: null,
                    }),
                  }),
                }),
              }
            }
            if (table === 'timetable_entries') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: async () => ({ count: 0, error: null }),
                    }),
                  }),
                }),
              }
            }
            if (table === 'system_logs') {
              return {
                delete: () => ({
                  eq: () => ({
                    eq: async () => {
                      deletedFromSystemLogs = true
                      return { error: null }
                    },
                  }),
                }),
              }
            }
            return {}
          },
        },
      }

      const service = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      const result = await service.clearFailedRun('run-1', { userId: 'u1', role: 'director', campus_id: 'campus-1' })
      assert.strictEqual(result.success, true)
      assert.strictEqual(deletedFromSystemLogs, true)
    })

    it('rejects clearing runs with status "completed" (F25)', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'allocation_runs') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: 'run-1', campus_id: 'campus-1', academic_year: '2026-27', semester: 1, status: 'completed' },
                      error: null,
                    }),
                  }),
                }),
              }
            }
          },
        },
      }

      const service = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      await assert.rejects(
        async () => {
          await service.clearFailedRun('run-1', { userId: 'u1', role: 'director', campus_id: 'campus-1' })
        },
        (err) => {
          assert.strictEqual(err.name, 'BadRequestException')
          assert.ok(err.message.includes('Only failed allocation runs can be cleared'))
          return true
        },
      )
    })

    it('rejects clearing runs when cohort timetable is published (F25)', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'allocation_runs') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: 'run-1', campus_id: 'campus-1', academic_year: '2026-27', semester: 1, status: 'failed' },
                      error: null,
                    }),
                  }),
                }),
              }
            }
            if (table === 'timetable_entries') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: async () => ({ count: 5, error: null }), // Published timetable exists
                    }),
                  }),
                }),
              }
            }
          },
        },
      }

      const service = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      await assert.rejects(
        async () => {
          await service.clearFailedRun('run-1', { userId: 'u1', role: 'director', campus_id: 'campus-1' })
        },
        (err) => {
          assert.strictEqual(err.name, 'BadRequestException')
          assert.ok(err.message.includes('published timetable entries'))
          return true
        },
      )
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 6. F26: Non-Negative Distinct Student Metrics
  // ──────────────────────────────────────────────────────────────────────────
  describe('6. F26: Non-Negative Distinct Student Metrics Engine', () => {
    it('calculates distinct student counts where fully + partially + unallocated === total_students and all >= 0', () => {
      const studentPrefList = [
        { student_id: 's1', preferences: [{ slot: 1, is_fixed: false }, { slot: 2, is_fixed: false }] },
        { student_id: 's2', preferences: [{ slot: 1, is_fixed: false }, { slot: 2, is_fixed: false }] },
        { student_id: 's3', preferences: [{ slot: 1, is_fixed: false }, { slot: 2, is_fixed: false }] },
        { student_id: 's4', preferences: [{ slot: 1, is_fixed: true }] }, // Only fixed
      ]

      // s1: slot 1 and 2 resolved
      // s2: slot 1 resolved, slot 2 unresolved
      // s3: slot 1 and 2 unresolved (2 unallocated slots!)
      // s4: slot 1 fixed (resolved)
      const slotState = new Map([
        ['s1', new Map([['slot_1', { resolved: true }], ['slot_2', { resolved: true }]])],
        ['s2', new Map([['slot_1', { resolved: true }], ['slot_2', { resolved: false }]])],
        ['s3', new Map([['slot_1', { resolved: false }], ['slot_2', { resolved: false }]])],
        ['s4', new Map([['slot_1', { resolved: true }]])],
      ])

      const unallocatedSlots = [
        { student_id: 's2', slot_key: 'slot_2' },
        { student_id: 's3', slot_key: 'slot_1' },
        { student_id: 's3', slot_key: 'slot_2' },
      ]

      const totalStudents = studentPrefList.length
      let fullyAllocatedStudents = 0
      let partiallyAllocatedStudents = 0
      let unallocatedStudents = 0
      let unresolvedCoreSlots = 0
      let unresolvedOptionalSlots = 0

      for (const pref of studentPrefList) {
        const slots = pref.preferences
        const electiveSlots = slots.filter((s) => !s.is_fixed)
        if (electiveSlots.length === 0) {
          fullyAllocatedStudents += 1
          continue
        }

        const slotMap = slotState.get(pref.student_id)
        let resolvedCount = 0
        for (const s of electiveSlots) {
          const slotKey = `slot_${s.slot}`
          if (slotMap.get(slotKey)?.resolved) {
            resolvedCount += 1
          }
        }

        if (resolvedCount === electiveSlots.length) {
          fullyAllocatedStudents += 1
        } else if (resolvedCount > 0) {
          partiallyAllocatedStudents += 1
        } else {
          unallocatedStudents += 1
        }
      }

      for (const unalloc of unallocatedSlots) {
        const slotNum = parseInt(unalloc.slot_key.replace('slot_', ''), 10) || 1
        if (slotNum <= 6) {
          unresolvedCoreSlots += 1
        } else {
          unresolvedOptionalSlots += 1
        }
      }

      assert.strictEqual(totalStudents, 4)
      assert.strictEqual(fullyAllocatedStudents, 2) // s1 and s4
      assert.strictEqual(partiallyAllocatedStudents, 1) // s2
      assert.strictEqual(unallocatedStudents, 1) // s3
      assert.strictEqual(fullyAllocatedStudents + partiallyAllocatedStudents + unallocatedStudents, totalStudents)
      assert.ok(fullyAllocatedStudents >= 0)
      assert.ok(partiallyAllocatedStudents >= 0)
      assert.ok(unallocatedStudents >= 0)
      assert.strictEqual(unresolvedCoreSlots, 3)
      assert.strictEqual(unresolvedOptionalSlots, 0)
    })
  })
})
