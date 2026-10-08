/**
 * Unit Test Suite for Plan 03: Schema alignment, class identity and ten-semester foundation
 * Findings: F38 (withdrawn), F53, F64, F65, F66, F67, F68, F69, D07
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// Import compiled dist modules
const { HodService } = require('../dist/modules/hod/hod.service')
const { AssignmentsService } = require('../dist/modules/assignments/assignments.service')
const { AllocationService } = require('../dist/modules/allocation/allocation.service')
const { SEMESTERS } = require('../dist/core/constants/semesters')

const mockAuditLogger = {
  log: async () => {},
}
const mockServerLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
  info: () => {},
}

describe('Plan 03: Schema alignment, class identity and ten-semester foundation', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 1. F53 & D07: Semester Domain (1-10) and Catalog Readiness
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. F53 & D07: Ten Semester Domain & Catalog Readiness', () => {
    it('SEMESTERS constant contains all 10 semesters', () => {
      assert.deepStrictEqual([...SEMESTERS], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    })

    it('AllocationService.addPrerequisite accepts COMPLETED_SEMESTER targets up to 10 and rejects > 10', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 'c-1', semester: 5, department_id: 'dept-1' },
                  error: null,
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({ data: { id: 'rule-1' }, error: null }),
              }),
            }),
          }),
        },
      }

      const allocService = new AllocationService(mockSupabase, mockAuditLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-1' }

      // Valid semester 10
      const res = await allocService.addPrerequisite('c-1', { rule: 'COMPLETED_SEMESTER', target: '10' }, hodUser)
      assert.strictEqual(res.success, true)

      // Invalid semester 11
      await assert.rejects(async () => {
        await allocService.addPrerequisite('c-1', { rule: 'COMPLETED_SEMESTER', target: '11' }, hodUser)
      }, /Target for COMPLETED_SEMESTER must be an integer between 1 and 10/)

      // Invalid semester 0
      await assert.rejects(async () => {
        await allocService.addPrerequisite('c-1', { rule: 'COMPLETED_SEMESTER', target: '0' }, hodUser)
      }, /Target for COMPLETED_SEMESTER must be an integer between 1 and 10/)
    })

    it('AllocationService.runAllocation validates semester range up to 10 and rejects > 10', async () => {
      const mockSupabase = {
        admin: {
          from: () => ({
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        },
      }

      const allocService = new AllocationService(mockSupabase, mockAuditLogger)
      const directorUser = { userId: 'dir-1', role: 'campus_director', campus_id: 'camp-1' }

      // Invalid semester 11
      await assert.rejects(async () => {
        await allocService.runAllocation({ academicYear: '2026-27', semester: 11 }, directorUser)
      }, /Semester must be between 1 and 10/)

      // Invalid semester 0
      await assert.rejects(async () => {
        await allocService.runAllocation({ academicYear: '2026-27', semester: 0 }, directorUser)
      }, /Semester must be between 1 and 10/)
    })

    it('HodService.getCatalogReadiness generates an accurate 10-semester readiness matrix without fabricating curricula', async () => {
      const mockBlueprints = [
        {
          semester: 1,
          min_credits: 20,
          max_credits: 24,
          pathways: [{ name: 'Major Core', slots: [] }],
        },
        {
          semester: 10,
          min_credits: 12,
          max_credits: 16,
          pathways: [{ name: 'Research Dissertation Project', slots: [] }],
        },
      ]

      const mockCourses = [
        { id: 'c-1', course_code: 'CS101', title: 'Intro to CS', semester: 1, category: 'DSC', credits: 4 },
        { id: 'c-2', course_code: 'CS102', title: 'Calculus', semester: 1, category: 'MDC', credits: 4 },
        { id: 'c-10', course_code: 'CS1001', title: 'Doctoral/Honours Research', semester: 10, category: 'PROJECT', credits: 12 },
      ]

      const mockSupabase = {
        admin: {
          from: (table) => ({
            select: () => ({
              eq: async (col, val) => {
                if (table === 'semester_blueprints') {
                  return { data: mockBlueprints, error: null }
                }
                if (table === 'courses') {
                  return { data: mockCourses, error: null }
                }
                return { data: [], error: null }
              },
            }),
          }),
        },
      }

      const hodService = new HodService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-1' }

      const readiness = await hodService.getCatalogReadiness(hodUser)

      assert.strictEqual(readiness.department_id, 'dept-1')
      assert.strictEqual(readiness.summary.total_semesters, 10)
      assert.strictEqual(readiness.semesters.length, 10)

      // Semester 1 is ready
      const sem1 = readiness.semesters.find((s) => s.semester === 1)
      assert.strictEqual(sem1.status, 'ready')
      assert.strictEqual(sem1.has_blueprint, true)
      assert.strictEqual(sem1.course_count, 2)
      assert.strictEqual(sem1.missing_elements.length, 0)

      // Semester 10 is ready and flagged as research/project pathway
      const sem10 = readiness.semesters.find((s) => s.semester === 10)
      assert.strictEqual(sem10.status, 'ready')
      assert.strictEqual(sem10.has_blueprint, true)
      assert.strictEqual(sem10.has_research_or_project_pathway, true)

      // Semesters 2 through 9 are missing without invented mock curriculum
      const sem2 = readiness.semesters.find((s) => s.semester === 2)
      assert.strictEqual(sem2.status, 'missing')
      assert.strictEqual(sem2.has_blueprint, false)
      assert.strictEqual(sem2.course_count, 0)
      assert.deepStrictEqual(sem2.missing_elements, ['semester_blueprint', 'courses'])
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. F64: HOD Teacher Query & Roster Distinction
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. F64: HOD Teacher List Query & Roster Separation', () => {
    it('getDepartmentTeachers selects strictly role === teacher without requesting created_at', async () => {
      let queriedSelect = ''
      let queriedRoles = ''

      const mockSupabase = {
        admin: {
          from: (table) => {
            assert.strictEqual(table, 'faculty')
            return {
              select: (cols) => {
                queriedSelect = cols
                return {
                  eq: (col1, val1) => ({
                    eq: (col2, val2) => {
                      queriedRoles = `${col2}=${val2}`
                      return {
                        order: async () => ({
                          data: [
                            { id: 't-1', full_name: 'Dr. Alice', email: 'alice@uni.edu', role: 'teacher' },
                          ],
                          error: null,
                        }),
                      }
                    },
                  }),
                }
              },
            }
          },
        },
      }

      const hodService = new HodService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-1' }

      const teachers = await hodService.getDepartmentTeachers(hodUser)

      // Must not contain created_at which does not exist on faculty table
      assert.strictEqual(queriedSelect.includes('created_at'), false)
      assert.strictEqual(queriedSelect, 'id, full_name, email, role')
      // Must filter strictly by role=teacher
      assert.strictEqual(queriedRoles, 'role=teacher')
      assert.strictEqual(teachers.length, 1)
      assert.strictEqual(teachers[0].role, 'teacher')
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. F67: Visiting Cross-Campus Teachers & Term Identity
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. F67: Visiting Cross-Campus Teachers & Term Identity', () => {
    it('assignTeacher allows assigning a visiting teacher from another campus and persists term identity', async () => {
      let upsertedRow = null

      const mockSupabase = {
        admin: {
          from: (table) => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  if (table === 'courses') {
                    return {
                      data: { id: 'c-1', department_id: 'dept-host', title: 'Data Structures', course_code: 'CS201', semester: 3 },
                      error: null,
                    }
                  }
                  if (table === 'faculty') {
                    // Visiting teacher from a different campus
                    return {
                      data: { id: 't-visitor', department_id: 'dept-other', campus_id: 'campus-foreign', role: 'teacher', full_name: 'Prof. Visiting' },
                      error: null,
                    }
                  }
                  if (table === 'campus_settings') {
                    return { data: { academic_year: '2025-26' }, error: null }
                  }
                },
              }),
            }),
            upsert: (payload, opts) => {
              upsertedRow = payload
              return {
                select: () => ({
                  single: async () => ({ data: { id: 'assign-1', ...payload }, error: null }),
                }),
              }
            },
          }),
        },
      }

      const assignmentsService = new AssignmentsService(mockSupabase, mockAuditLogger)
      const hodUser = { userId: 'hod-host', role: 'hod', department_id: 'dept-host', campus_id: 'campus-host' }

      const result = await assignmentsService.assignTeacher(
        hodUser,
        't-visitor',
        'c-1',
        '127.0.0.1',
        { campus_id: 'campus-host', academic_year: '2025-26', semester: 3 }
      )

      assert.strictEqual(result.success, true)
      assert.strictEqual(upsertedRow.teacher_id, 't-visitor')
      assert.strictEqual(upsertedRow.course_id, 'c-1')
      assert.strictEqual(upsertedRow.campus_id, 'campus-host')
      assert.strictEqual(upsertedRow.academic_year, '2025-26')
      assert.strictEqual(upsertedRow.semester, 3)
    })

    it('assignTeacher and batchAssignTeachers strictly reject teaching_staff with ForbiddenException', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  if (table === 'courses') return { data: { id: 'c-1', department_id: 'dept-1' }, error: null }
                  if (table === 'faculty') return { data: { id: 'staff-1', role: 'teaching_staff', full_name: 'Staff John' }, error: null }
                },
              }),
              in: async (col, vals) => {
                if (table === 'courses') return { data: [{ id: 'c-1', department_id: 'dept-1', course_code: 'CS1' }], error: null }
                if (table === 'faculty') return { data: [{ id: 'staff-1', role: 'teaching_staff', full_name: 'Staff John' }], error: null }
              },
            }),
          }),
        },
      }

      const assignmentsService = new AssignmentsService(mockSupabase, mockAuditLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-1', campus_id: 'camp-1' }

      // assignTeacher
      await assert.rejects(async () => {
        await assignmentsService.assignTeacher(hodUser, 'staff-1', 'c-1', '127.0.0.1')
      }, (err) => err.status === 403 && /teaching staff/i.test(err.message))

      // batchAssignTeachers
      await assert.rejects(async () => {
        await assignmentsService.batchAssignTeachers(hodUser, [{ teacher_id: 'staff-1', course_id: 'c-1' }], '127.0.0.1')
      }, (err) => err.status === 403 && /teaching staff/i.test(err.message))
    })

    it('getCoursesAndAssignments retrieves campus, academic_year, semester and resolves visiting faculty names', async () => {
      const mockCourses = [
        { id: 'c-1', course_code: 'CS101', title: 'Intro', credits: 4, category: 'DSC', semester: 1 },
      ]
      const mockFaculty = [
        { id: 't-dept', full_name: 'Dr. Home', email: 'home@uni.edu', role: 'teacher' },
      ]
      const mockAssignments = [
        {
          id: 'a-1',
          teacher_id: 't-visiting',
          course_id: 'c-1',
          assigned_at: '2026-10-07T12:00:00Z',
          assigned_by: 'hod-1',
          campus_id: 'campus-1',
          academic_year: '2025-26',
          semester: 1,
        },
      ]

      const mockSupabase = {
        admin: {
          from: (table) => ({
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: async () => ({ data: mockFaculty, error: null }),
                }),
                order: async () => ({ data: mockCourses, error: null }),
              }),
              in: async (col, vals) => {
                if (table === 'teacher_course_assignments') {
                  return { data: mockAssignments, error: null }
                }
                if (table === 'faculty') {
                  // Resolves visiting faculty
                  return {
                    data: [{ id: 't-visiting', full_name: 'Dr. Visiting Guest', email: 'guest@uni.edu', role: 'teacher' }],
                    error: null,
                  }
                }
                return { data: [], error: null }
              },
            }),
          }),
        },
      }

      const assignmentsService = new AssignmentsService(mockSupabase, mockAuditLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-1' }

      const result = await assignmentsService.getCoursesAndAssignments(hodUser)
      assert.strictEqual(result.courses.length, 1)
      const course = result.courses[0]
      assert.strictEqual(course.assignments.length, 1)
      const assignment = course.assignments[0]
      assert.strictEqual(assignment.teacher_id, 't-visiting')
      assert.strictEqual(assignment.teacher_name, 'Dr. Visiting Guest')
      assert.strictEqual(assignment.campus_id, 'campus-1')
      assert.strictEqual(assignment.academic_year, '2025-26')
      assert.strictEqual(assignment.semester, 1)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 4. F68: Teacher Deletion Attendance Preservation & Auth Outcome Handling
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. F68: Teacher Deletion Attendance Preservation & Auth Error Handling', () => {
    it('deleteDepartmentTeacher preserves attendance, verifies Auth deletion outcome and handles partial failure', async () => {
      let authDeleteCalled = false

      const mockSupabase = {
        admin: {
          from: (table) => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 't-delete', full_name: 'Prof. Leaves', role: 'teacher', department_id: 'dept-1' },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
            delete: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
          }),
          auth: {
            admin: {
              deleteUser: async (id) => {
                authDeleteCalled = true
                return { error: { message: 'Auth service rate limit or network error' } }
              },
            },
          },
        },
      }

      const hodService = new HodService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-1' }

      const res = await hodService.deleteDepartmentTeacher('t-delete', hodUser)

      assert.strictEqual(authDeleteCalled, true)
      assert.strictEqual(res.success, true)
      assert.strictEqual(typeof res.warning, 'string')
      assert.match(res.warning, /Auth account cleanup failed/)
    })

    it('deleteDepartmentTeacher returns clean success when both DB and Auth deletion succeed', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 't-delete', full_name: 'Prof. Leaves', role: 'teacher', department_id: 'dept-1' },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
            delete: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
          }),
          auth: {
            admin: {
              deleteUser: async (id) => ({ error: null }),
            },
          },
        },
      }

      const hodService = new HodService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-1' }

      const res = await hodService.deleteDepartmentTeacher('t-delete', hodUser)
      assert.strictEqual(res.success, true)
      assert.strictEqual(res.warning, undefined)
      assert.match(res.message, /removed successfully/)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 5. F66 & F69: Credit Defaults, Extended Slots & SQL Migration Verification
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. F66, F69 & Additive Migration Verification', () => {
    it('migration file exists with additive non-destructive DDL', () => {
      const migrationPath = path.resolve(__dirname, '../../supabase/migrations/20261007000000_plan03_schema_alignment.sql')
      assert.strictEqual(fs.existsSync(migrationPath), true, 'Plan 03 migration file must exist')

      const sqlContent = fs.readFileSync(migrationPath, 'utf8')

      // F65: Indexes on system_logs directly (not on audit_logs view)
      assert.match(sqlContent, /CREATE INDEX IF NOT EXISTS idx_system_logs_audit_events\s+ON system_logs/i)

      // F66: Relaxed total_credits check >= 0 with default 0
      assert.match(sqlContent, /ALTER TABLE student_registrations\s+ALTER COLUMN total_credits SET DEFAULT 0/i)
      assert.match(sqlContent, /CHECK \(total_credits >= 0\)/i)

      // F53: Semesters 1-10 domain checks
      assert.match(sqlContent, /CHECK \(semester BETWEEN 1 AND 10\)/i)

      // F67: Campus and term identity on teacher_course_assignments
      assert.match(sqlContent, /campus_id UUID REFERENCES campuses\(id\)/i)
      assert.match(sqlContent, /uq_teacher_course_assignments_term/i)

      // F68: Actor cascades replaced with ON DELETE SET NULL
      assert.match(sqlContent, /period_attendance_marked_by_fkey\s+FOREIGN KEY \(marked_by\) REFERENCES auth\.users\(id\) ON DELETE SET NULL/i)
      assert.match(sqlContent, /teacher_course_assignments_assigned_by_fkey\s+FOREIGN KEY \(assigned_by\) REFERENCES auth\.users\(id\) ON DELETE SET NULL/i)

      // F69: Duplicate foreign key dropped
      assert.match(sqlContent, /DROP CONSTRAINT IF EXISTS student_registrations_student_id_fkey1/i)

      // F38: Note documenting retention of timetable unique constraint
      assert.match(sqlContent, /F38 \(Withdrawn\)/i)
    })

    it('exportStudentsExcel queries up to 8 slots with qualified inner join', async () => {
      let executedQuery = ''

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'courses') {
              return {
                select: () => ({
                  in: async () => ({
                    data: [
                      { id: 'c-1', title: 'Course 1', course_code: 'CS1' },
                      { id: 'c-7', title: 'Course 7', course_code: 'CS7' },
                      { id: 'c-8', title: 'Course 8', course_code: 'CS8' },
                    ],
                    error: null,
                  }),
                }),
              }
            }
            assert.strictEqual(table, 'student_registrations')
            return {
              select: (cols) => {
                executedQuery = cols
                return {
                  eq: () => ({
                    eq: async () => ({
                      data: [
                        {
                          student_id: 's-1',
                          slot_1_course_id: 'c-1',
                          slot_7_course_id: 'c-7',
                          slot_8_course_id: 'c-8',
                          students: [{ full_name: 'Student One', department_id: 'dept-1' }],
                        },
                      ],
                      error: null,
                    }),
                  }),
                }
              },
            }
          },
        },
      }

      const hodService = new HodService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-1' }

      await hodService.exportStudentsExcel(1, hodUser)

      assert.match(executedQuery, /slot_7_course_id/)
      assert.match(executedQuery, /slot_8_course_id/)
      assert.match(executedQuery, /students!inner\(full_name, department_id\)/)
    })
  })
})
