const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { AuthorizationPolicy } = require('../dist/core/auth/authorization-policy')
const { ExportService } = require('../dist/modules/credit-ledger/export.service')
const { TimetableService } = require('../dist/modules/timetable/timetable.service')
const { PeriodAttendanceService } = require('../dist/modules/period-attendance/period-attendance.service')

// ──────────────── Follow-up Plan 01 Test Suite (R01, R04, R05, R03) ────────────────

describe('Follow-up Plan 01 · R01: RPC Privileges and Search Path Hardening', () => {
  it('migration file exists and contains explicit REVOKE from PUBLIC/anon/authenticated and search_path pinning', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../supabase/migrations/20261009010000_followup_plan01_harden_rpc_privileges.sql',
    )
    assert.ok(fs.existsSync(migrationPath), 'Migration 20261009010000 must exist')

    const sql = fs.readFileSync(migrationPath, 'utf8')

    // Must revoke from PUBLIC, anon, authenticated
    assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.submit_student_registration'), 'Must revoke submit_student_registration')
    assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.execute_student_course_change'), 'Must revoke execute_student_course_change')
    assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.claim_allocation_run'), 'Must revoke claim_allocation_run')
    assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.apply_course_allocation'), 'Must revoke apply_course_allocation')
    assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.promote_campus_students_atomic'), 'Must revoke promote_campus_students_atomic')
    assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.cleanup_concluded_semester_attendance'), 'Must revoke cleanup_concluded_semester_attendance')

    // Must grant to service_role
    assert.ok(sql.includes('TO service_role, postgres;'), 'Must grant EXECUTE to service_role')

    // Must pin search path
    assert.ok(sql.includes('SET search_path = public, pg_temp;'), 'Must pin search_path to public, pg_temp')

    // Must alter default privileges
    assert.ok(
      sql.includes('ALTER DEFAULT PRIVILEGES IN SCHEMA public') &&
      sql.includes('REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated'),
      'Must alter default privileges in schema public'
    )
  })
})

describe('Follow-up Plan 01 · R04: Actor-Derived Scope Enforcement on Export Endpoints', () => {
  function createMockSupabaseForExports() {
    const courses = [
      { id: 'c-101', course_code: 'KU01DSCCSE101', title: 'Data Structures', department_id: 'dept-cse', semester: 1 },
      { id: 'c-102', course_code: 'KU01DSCMAT101', title: 'Calculus', department_id: 'dept-mat', semester: 1 },
    ]
    const teacherAssignments = [
      { id: 'ta-1', teacher_id: 'teacher-alice', course_id: 'c-101' }, // Alice teaches c-101
    ]
    const studentRegistrations = [
      {
        id: 'reg-1',
        student_id: 'student-bob',
        semester: 1,
        academic_year: '2025-26',
        slot_1_course_id: 'c-101',
        slot_2_course_id: null,
        slot_3_course_id: null,
        slot_4_course_id: null,
        slot_5_course_id: null,
        slot_6_course_id: null,
        slot_7_course_id: null,
        slot_8_course_id: null,
        students: {
          id: 'student-bob',
          full_name: 'Bob Student',
          cap_application_number: 'CAP123',
          campus_id: 'campus-main',
          department_id: 'dept-cse',
          departments: { id: 'dept-cse', name: 'CSE', code: 'CSE' },
          campuses: { id: 'campus-main', name: 'Main Campus' },
        },
      },
    ]
    const timetableEntries = [
      {
        id: 'tt-1', campus_id: 'campus-main', teacher_id: 'teacher-alice', time_slots: {day_of_week:1,period_number:1},
        day_of_week: 1,
        period: 1,
        academic_year: '2025-26',
        semester: 1,
        status: 'published',
        course_id: 'c-101',
        courses: { id: 'c-101', course_code: 'KU01DSCCSE101', title: 'Data Structures' },
        faculty: { id: 'teacher-alice', full_name: 'Alice Teacher' },
        departments: { id: 'dept-cse', name: 'CSE', campus_id: 'campus-main', campuses: { id: 'campus-main', name: 'Main Campus' } },
      },
      {
        id: 'tt-2', campus_id: 'campus-main', teacher_id: 'teacher-charlie', time_slots: {day_of_week:1,period_number:2},
        day_of_week: 1,
        period: 2,
        academic_year: '2025-26',
        semester: 1,
        status: 'draft', // DRAFT
        course_id: 'c-102',
        courses: { id: 'c-102', course_code: 'KU01DSCMAT101', title: 'Calculus' },
        faculty: { id: 'teacher-charlie', full_name: 'Charlie Teacher' },
        departments: { id: 'dept-mat', name: 'Mathematics', campus_id: 'campus-main', campuses: { id: 'campus-main', name: 'Main Campus' } },
      },
    ]

    return {
      admin: {
        from: (table) => {
          let filters = []
          const query = {
            select: () => query,
            order: () => query,
            eq: (col, val) => {
              filters.push({ col, val, op: 'eq' })
              return query
            },
            in: (col, arr) => {
              filters.push({ col, arr, op: 'in' })
              return query
            },
            or: () => query,
            gte: () => query,
            lte: () => query,
            single: async () => {
              if (table === 'courses') {
                const targetId = filters.find((f) => f.col === 'id')?.val
                const found = courses.find((c) => c.id === targetId)
                return { data: found || null, error: found ? null : { message: 'Not found' } }
              }
              return { data: null, error: null }
            },
            maybeSingle: async () => {
              if (table === 'teacher_course_assignments') {
                const tid = filters.find((f) => f.col === 'teacher_id')?.val
                const cid = filters.find((f) => f.col === 'course_id')?.val
                const match = teacherAssignments.find((a) => a.teacher_id === tid && a.course_id === cid)
                return { data: match || null, error: null }
              }
              if (table === 'student_registrations') {
                const sid = filters.find((f) => f.col === 'student_id')?.val
                const match = studentRegistrations.find((r) => r.student_id === sid)
                return { data: match || null, error: null }
              }
              return { data: null, error: null }
            },
            then: (resolve) => {
              if (table === 'teacher_course_assignments') {
                const tid = filters.find((f) => f.col === 'teacher_id')?.val
                const matches = teacherAssignments.filter((a) => !tid || a.teacher_id === tid)
                return resolve({ data: matches, error: null })
              }
              if (table === 'student_registrations') {
                return resolve({ data: studentRegistrations, error: null })
              }
              if (table === 'timetable_entries') {
                // Filter entries based on eq and in
                let res = [...timetableEntries]
                for (const f of filters) {
                  if (f.op === 'eq') {
                    res = res.filter((e) => e[f.col] === f.val)
                  } else if (f.op === 'in') {
                    res = res.filter((e) => f.arr.includes(e[f.col]))
                  }
                }
                return resolve({ data: res, error: null })
              }
              if (table === 'period_attendance') {
                return resolve({ data: [], error: null })
              }
              return resolve({ data: [], error: null })
            },
          }
          return query
        },
      },
    }
  }

  it('exportCampusClassRoster rejects unassigned teachers with ForbiddenException', async () => {
    const mockSupabase = createMockSupabaseForExports()
    const exportService = new ExportService(mockSupabase)

    const unassignedTeacher = {
      userId: 'teacher-unassigned',
      role: 'teacher',
      department_id: 'dept-cse',
      campus_id: 'campus-main',
    }

    await assert.rejects(
      async () => {
        await exportService.exportCampusClassRoster(
          { course_id: 'c-101', format: 'json' },
          unassignedTeacher,
        )
      },
      /Teacher is not assigned to teach this course/,
      'Unassigned teacher must not be able to export class roster'
    )
  })

  it('exportCampusClassRoster allows assigned teacher', async () => {
    const mockSupabase = createMockSupabaseForExports()
    const exportService = new ExportService(mockSupabase)

    const assignedTeacher = {
      userId: 'teacher-alice',
      role: 'teacher',
      department_id: 'dept-cse',
      campus_id: 'campus-main',
    }

    const result = await exportService.exportCampusClassRoster(
      { course_id: 'c-101', format: 'csv' },
      assignedTeacher,
    )
    assert.ok(result.filename.startsWith('Class_Roster_KU01DSCCSE101'))
    assert.strictEqual(result.contentType, 'text/csv; charset=utf-8')
  })

  it('exportTimetable strictly excludes draft entries for student callers and limits to enrolled courses', async () => {
    const mockSupabase = createMockSupabaseForExports()
    const exportService = new ExportService(mockSupabase)

    const studentUser = {
      userId: 'student-bob',
      role: 'student',
      department_id: 'dept-cse',
      campus_id: 'campus-main',
      current_semester: 1,
    }

    const result = await exportService.exportTimetable(
      { semester: 1, format: 'json' },
      studentUser,
    )

    const rows = result.data
    // Student Bob is enrolled in c-101 (Data Structures). c-102 is draft and not enrolled.
    assert.strictEqual(rows.length, 1, 'Student must only receive enrolled published entries')
    assert.strictEqual(rows[0]['Course Code'], 'KU01DSCCSE101')
    assert.strictEqual(rows[0]['Status'], 'Published')
    assert.ok(!rows.some((r) => r['Status'] === '[DRAFT]'), 'Draft entries must NEVER be returned to student')
  })

  it('exportPeriodAttendance rejects teacher when querying unassigned course', async () => {
    const mockSupabase = createMockSupabaseForExports()
    const exportService = new ExportService(mockSupabase)

    const teacherAlice = {
      userId: 'teacher-alice', // Assigned only to c-101
      role: 'teacher',
      department_id: 'dept-cse',
      campus_id: 'campus-main',
    }

    await assert.rejects(
      async () => {
        await exportService.exportPeriodAttendance(
          { course_id: 'c-102', format: 'json' }, // c-102 is not assigned to Alice
          teacherAlice,
        )
      },
      /Teacher is not assigned to teach this course/
    )
  })
})

describe('Follow-up Plan 01 · R05: Teacher Timetable Query Department Intersection', () => {
  it('intersect teacher timetable queries with assigned courses even when departmentId is provided', async () => {
    const mockDb = {
      admin: {
        from: (table) => {
          let filters = []
          const q = {
            select: () => q,
            order: () => q,
            eq: (col, val) => {
              filters.push({ col, val, op: 'eq' })
              return q
            },
            in: (col, arr) => {
              filters.push({ col, arr, op: 'in' })
              return q
            },
            then: (resolve) => {
              if (table === 'departments') {
                return resolve({ data: [{ id: 'dept-foreign', name: 'Foreign Dept', code: 'FD' }], error: null })
              }
              if (table === 'teacher_course_assignments') {
                // Teacher only assigned to 'course-assigned-1'
                return resolve({ data: [{ course_id: 'course-assigned-1' }], error: null })
              }
              if (table === 'timetable_entries') {
                // Check if query enforced in('course_id', ['course-assigned-1'])
                const courseInFilter = filters.find((f) => f.col === 'course_id' && f.op === 'in')
                assert.ok(courseInFilter, 'Query must enforce in filter on course_id for teachers')
                assert.deepStrictEqual(courseInFilter.arr, ['course-assigned-1'])
                return resolve({ data: [], error: null })
              }
              return resolve({ data: [], error: null })
            },
          }
          return q
        },
      },
    }

    const timetableService = new TimetableService(mockDb)

    const teacherUser = {
      userId: 'teacher-visiting',
      role: 'teacher',
      campus_id: 'campus-home',
      department_id: 'dept-home',
    }

    // Teacher attempts querying a different departmentId 'dept-foreign'
    const result = await timetableService.getEntries('2025-26', 1, 'dept-foreign', teacherUser)
    assert.ok(result, 'Must return structured timetable result')
    assert.deepStrictEqual(result.entries, [])
  })

  it('teacher with 0 assignments returns empty entries immediately', async () => {
    const mockDb = {
      admin: {
        from: (table) => {
          const q = {
            select: () => q,
            order: () => q,
            eq: () => q,
            in: () => q,
            then: (resolve) => {
              if (table === 'departments') return resolve({ data: [], error: null })
              if (table === 'teacher_course_assignments') return resolve({ data: [], error: null })
              return resolve({ data: [], error: null })
            },
          }
          return q
        },
      },
    }

    const timetableService = new TimetableService(mockDb)
    const teacherWithoutAssignments = {
      userId: 'teacher-no-courses',
      role: 'teacher',
      campus_id: 'campus-home',
      department_id: 'dept-home',
    }

    const result = await timetableService.getEntries('2025-26', 1, undefined, teacherWithoutAssignments)
    assert.strictEqual(result.entries.length, 0, 'Teacher with 0 assignments must get empty entries')
  })
})

describe('Follow-up Plan 01 · R03 Containment: Practical Attendance Copy Authorization', () => {
  function createMockSupabaseForAttendance(options = {}) {
    const {
      teacherAssignments = [{ teacher_id: 'teacher-auth', course_id: 'c-lab-1' }],
      timetableEntries = [
        {
          id: 'slot-p1',
          course_id: 'c-lab-1',
          department_id: 'dept-cse',
          status: 'published',
          is_lab_block: true,
          time_slots: { day_of_week: 1, period_number: 1 },
        },
        {
          id: 'slot-p2',
          course_id: 'c-lab-1',
          department_id: 'dept-cse',
          status: 'published',
          is_lab_block: true,
          time_slots: { day_of_week: 1, period_number: 2 },
        },
      ],
      marks = [{ student_id: 's-1', status: 'present', course_id: 'c-lab-1' }],
    } = options

    return {
      admin: {
        from: (table) => {
          let filters = []
          const q = {
            select: () => q,
            eq: (col, val) => {
              filters.push({ col, val })
              return q
            },
            maybeSingle: async () => {
              if (table === 'timetable_entries') {
                const id = filters.find((f) => f.col === 'id')?.val
                const found = timetableEntries.find((e) => e.id === id)
                return { data: found || null, error: null }
              }
              return { data: null, error: null }
            },
            then: (resolve) => {
              if (table === 'teacher_course_assignments') {
                const tid = filters.find((f) => f.col === 'teacher_id')?.val
                const matches = teacherAssignments.filter((a) => a.teacher_id === tid)
                return resolve({ data: matches, error: null })
              }
              if (table === 'period_attendance') {
                return resolve({ data: marks, error: null })
              }
              return resolve({ data: [], error: null })
            },
            upsert: async () => ({ error: null }),
          }
          return q
        },
      },
    }
  }

  it('rejects unassigned teacher from copying practical attendance', async () => {
    const mockDb = createMockSupabaseForAttendance()
    const mockAudit = { log: async () => {} }
    const periodService = new PeriodAttendanceService(mockDb, mockAudit)

    const unassignedTeacher = {
      userId: 'teacher-unassigned',
      role: 'teacher',
      department_id: 'dept-cse',
      campus_id: 'campus-main',
    }

    const dto = {
      source_slot_id: 'slot-p1',
      target_slot_id: 'slot-p2',
      attendance_date: '2026-10-05',
    }

    await assert.rejects(
      async () => {
        await periodService.copyPracticalAttendance(unassignedTeacher, dto, '127.0.0.1')
      },
      /Teacher is not assigned to teach this course/,
      'Unassigned teacher must be forbidden from copying attendance'
    )
  })

  it('rejects foreign HOD from copying attendance for another department', async () => {
    const mockDb = createMockSupabaseForAttendance()
    const mockAudit = { log: async () => {} }
    const periodService = new PeriodAttendanceService(mockDb, mockAudit)

    const foreignHod = {
      userId: 'hod-math',
      role: 'hod',
      department_id: 'dept-math', // Class belongs to dept-cse
      campus_id: 'campus-main',
    }

    const dto = {
      source_slot_id: 'slot-p1',
      target_slot_id: 'slot-p2',
      attendance_date: '2026-10-05',
    }

    await assert.rejects(
      async () => {
        await periodService.copyPracticalAttendance(foreignHod, dto, '127.0.0.1')
      },
      /Cannot manage attendance for another department|HOD cannot manage attendance for another department/,
      'Foreign HOD must not copy attendance for another department'
    )
  })

  it('allows authorized assigned teacher to copy practical attendance', async () => {
    const mockDb = createMockSupabaseForAttendance()
    const mockAudit = { log: async () => {} }
    const periodService = new PeriodAttendanceService(mockDb, mockAudit)

    const authorizedTeacher = {
      userId: 'teacher-auth',
      role: 'teacher',
      department_id: 'dept-cse',
      campus_id: 'campus-main',
    }

    const dto = {
      source_slot_id: 'slot-p1',
      target_slot_id: 'slot-p2',
      attendance_date: '2026-10-05',
      overwrite: true,
    }

    const result = await periodService.copyPracticalAttendance(authorizedTeacher, dto, '127.0.0.1')
    assert.strictEqual(result.success, true)
    assert.strictEqual(result.copied_count, 1)
  })
})
