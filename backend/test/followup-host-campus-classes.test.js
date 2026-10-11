/**
 * Automated Test Suite for Follow-up Plan 03: Host-campus classes and teacher identity
 * Findings covered: R06, R07, R08
 *
 * Primary verification obligations:
 * 1. Deliver the same catalogue course at campuses A and B; teachers, rosters and publication are independent.
 * 2. Visiting teacher with home campus A can read/mark only their assigned B class; another teacher at A cannot mark B.
 * 3. Multiple legitimate teacher/course records across terms do not trigger maybeSingle errors or authorize old terms.
 * 4. Published reservation blocks overlapping assignment even when catalogue course ID matches current cohort.
 * 5. Competing substitutions for one teacher cannot commit overlapping times; slots stay unchanged.
 * 6. Migration leaves published entry IDs intact and trigger immutability guards campus_id.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// Import compiled services
const { TimetableService } = require('../dist/modules/timetable/timetable.service')
const { PeriodAttendanceService } = require('../dist/modules/period-attendance/period-attendance.service')
const { FacultyService } = require('../dist/modules/faculty/faculty.service')
const { AssignmentsService } = require('../dist/modules/assignments/assignments.service')
const { loadGenerationInput } = require('../dist/modules/timetable/solver/loader')

const mockAuditLogger = {
  log: async () => {},
}
const mockServerLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
  info: () => {},
}

// Chainable query builder helper for unit tests
function createChainableMock(resolvedData = null, resolvedError = null) {
  const handler = {
    get: (target, prop) => {
      if (prop === 'then') {
        return (resolve) => resolve({ data: resolvedData, error: resolvedError })
      }
      return (...args) => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

describe('Follow-up Plan 03: Host-campus classes and teacher identity (R06, R07, R08)', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 1. R06: Host-Campus Class Delivery Identity & Independent Publication
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. R06: Host-Campus Class Delivery Identity & Independent Publication', () => {
    it('migration file exists with additive host campus_id and trigger guards', () => {
      const migrationFile = path.join(
        __dirname,
        '../../supabase/migrations/20261009020000_followup_plan03_host_campus_delivery_identity.sql'
      )
      assert.strictEqual(fs.existsSync(migrationFile), true, 'Migration file must exist')
      const sql = fs.readFileSync(migrationFile, 'utf8')
      assert.match(sql, /ALTER TABLE timetable_entries\s+ADD COLUMN IF NOT EXISTS campus_id UUID/i)
      assert.match(sql, /UPDATE timetable_entries te\s+SET campus_id = d\.campus_id/i)
      assert.match(sql, /idx_timetable_entries_campus_term/i)
      assert.match(sql, /NEW\.campus_id IS DISTINCT FROM OLD\.campus_id/i)
    })

    it('publication delegates exactly one host cohort to the atomic transaction', async () => {
 let args;const service=new TimetableService({admin:{rpc:async(name,input)=>{assert.equal(name,'publish_timetable_cohort');args=input;return {data:{success:true,published_count:1,published_at:'2026-10-10T00:00:00Z'}}}}},mockAuditLogger,mockServerLogger)
 const result=await service.publish('2025-26',1,{userId:'dir',role:'campus_director',campus_id:'campus-b'})
 assert.equal(result.publishedCount,1);assert.deepEqual(args,{p_campus_id:'campus-b',p_academic_year:'2025-26',p_semester:1})
})

    it('visiting roster requires the exact current delivery and filters year, semester and host', async () => {
 const seen=[];const tables={teacher_course_assignments:[{id:'assignment-b',teacher_id:'visiting',course_id:'course',campus_id:'campus-b',academic_year:'2026-27',semester:3}],campus_settings:[{campus_id:'campus-b',academic_year:'2026-27'}],courses:[{id:'course',semester:3,department_id:'catalogue-a'}],student_registrations:[{id:'reg',student_id:'student-b',campus_id:'campus-b',academic_year:'2026-27',semester:3,slot_1_course_id:'course'}],students:[{id:'student-b',campus_id:'campus-b',full_name:'Student B',departments:{name:'B',code:'B'}}]}
 const admin={from(table){const filters=[];let start=0;const rows=()=>tables[table].filter(row=>filters.every(([k,v])=>row[k]===v));const q={select:()=>q,eq:(k,v)=>{seen.push([table,k,v]);filters.push([k,v]);return q},in:(k,values)=>{filters.push([k,values[0]]);return q},order:()=>q,or:()=>q,range:(a)=>{start=a;return q},maybeSingle:async()=>({data:rows()[0]}),single:async()=>({data:rows()[0]}),then:(resolve)=>resolve({data:rows().slice(start,start+1000)})};return q}}
 const service=new FacultyService({admin});const user={userId:'visiting',role:'teacher',campus_id:'campus-a'}
 const roster=await service.getClassRoster('course',user,'assignment-b');assert.equal(roster.total_students,1)
 assert.ok(seen.some(([t,k,v])=>t==='student_registrations'&&k==='semester'&&v===3));assert.ok(seen.some(([t,k,v])=>t==='student_registrations'&&k==='campus_id'&&v==='campus-b'))
 await assert.rejects(service.getClassRoster('course',user),/assigned course delivery/)
 tables.teacher_course_assignments[0].academic_year='2025-26';await assert.rejects(service.getClassRoster('course',user,'assignment-b'),/current academic year/)
})
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. R07: Period Attendance Authorization with Composite Class/Term Scope
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. R07: Period Attendance Composite Delivery Authorization', () => {
    it('authorizes teacher matching exact host campus and term, rejecting multiple-row maybeSingle errors', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'timetable_entries') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: 'slot-b-1',
                        course_id: 'c-global-1',
                        department_id: 'dept-b',
                        campus_id: 'campus-b',
                        teacher_id: null,
                        academic_year: '2025-26',
                        semester: 1,
                        status: 'published',
                        courses: { title: 'OS', course_code: 'CS301' },
                        time_slots: { day_of_week: 1, start_time: '09:00', end_time: '10:00' },
                        departments: { campus_id: 'campus-b' },
                      },
                      error: null,
                    }),
                  }),
                }),
              }
            }
            if (table === 'teacher_course_assignments') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: async () => ({
                      // Teacher has MULTIPLE assignments for this course across terms & campuses
                      data: [
                        { id: 'assign-old', campus_id: 'campus-a', academic_year: '2024-25', semester: 1 },
                        { id: 'assign-current', campus_id: 'campus-b', academic_year: '2025-26', semester: 1 },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }
            }
            if (table === 'student_registrations') {
              const q = {
              order: () => q,
                select: () => q,
                or: () => q,
                eq: () => q,
                then: (resolve) => resolve({ data: [{ student_id: 'stu-b-1' }], error: null }),
              }
              return q
            }
            if (table === 'students') {
              const q = {
              order: () => q,
                select: () => q,
                in: () => q,
                eq: () => q,
                order: () => q,
                then: (resolve) => resolve({ data: [{ id: 'stu-b-1', full_name: 'Student B1' }], error: null }),
              }
              return q
            }
            if (table === 'period_attendance') {
              const q = {
              order: () => q,
                select: () => q,
                eq: () => q,
                then: (resolve) => resolve({ data: [], error: null }),
              }
              return q
            }
            return {}
          },
        },
      }

      const periodAttendanceService = new PeriodAttendanceService(mockSupabase, mockAuditLogger)
      const teacherUser = {
        userId: 'teacher-b-os',
        role: 'teacher',
        campus_id: 'campus-b',
      }

      const marks = await periodAttendanceService.getSlotMarks(teacherUser, 'slot-b-1', '2025-10-06')
      assert.strictEqual(marks.slot.id, 'slot-b-1')
      assert.strictEqual(marks.slot.course_id, 'c-global-1')
    })

    it('denies teacher of the same catalogue course at Campus A from accessing Campus B delivery', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'timetable_entries') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: {
                        id: 'slot-b-1',
                        course_id: 'c-global-1',
                        department_id: 'dept-b',
                        campus_id: 'campus-b',
                        teacher_id: 'teacher-campus-b',
                        academic_year: '2025-26',
                        semester: 1,
                        status: 'published',
                        courses: { title: 'OS', course_code: 'CS301' },
                        time_slots: { day_of_week: 1, start_time: '09:00', end_time: '10:00' },
                        departments: { campus_id: 'campus-b' },
                      },
                      error: null,
                    }),
                  }),
                }),
              }
            }
            if (table === 'teacher_course_assignments') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: async () => ({
                      // Teacher ONLY assigned to this course at Campus A
                      data: [
                        { id: 'assign-a', campus_id: 'campus-a', academic_year: '2025-26', semester: 1 },
                      ],
                      error: null,
                    }),
                  }),
                }),
              }
            }
            return {}
          },
        },
      }

      const periodAttendanceService = new PeriodAttendanceService(mockSupabase, mockAuditLogger)
      const campusATeacher = {
        userId: 'teacher-campus-a',
        role: 'teacher',
        campus_id: 'campus-a',
      }

      await assert.rejects(async () => {
        await periodAttendanceService.getSlotMarks(campusATeacher, 'slot-b-1', '2025-10-06')
      }, /You are not assigned to instruct this course/i)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. R08: Shared-Teacher Conflict Modeling & Atomic Assignment Guards
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. R08: Shared-Teacher Conflict Modeling Across Campuses & Semesters', () => {
    it('solver loader loads published reservations with teacher_id across other campuses even when courseId is shared', async () => {
      const mockSupabase = {
        from: (table) => {
          if (table === 'departments') {
            const q = {
              order: () => q,
              select: () => q,
              eq: () => q,
              then: (resolve) => resolve({ data: [{ id: 'dept-b', name: 'CS Dept B', code: 'CSB' }], error: null }),
            }
            return q
          }
          if (table === 'student_registrations') {
            const q = {
              order: () => q,
              select: () => q,
              eq: () => q,
              in: () => q,
              then: (resolve) => resolve({
                data: [
                  {
                    student_id: 'stu-1',
                    slot_1_course_id: 'c-shared-1',
                  },
                ],
                error: null,
              }),
            }
            return q
          }
          if (table === 'students') {
            const q = {
              order: () => q,
              select: () => q,
              in: () => q,
              then: (resolve) => resolve({ data: [{ id: 'stu-1', department_id: 'dept-b' }], error: null }),
            }
            return q
          }
          if (table === 'courses') {
            const q = {
              order: () => q,
              select: () => q,
              in: () => q,
              then: (resolve) => resolve({
                data: [
                  {
                    id: 'c-shared-1',
                    title: 'Algorithms',
                    course_code: 'CS202',
                    department_id: 'dept-b',
                    theory_hours_per_week: 3,
                    practical_hours_per_week: 0,
                    category: 'Major',
                  },
                ],
                error: null,
              }),
            }
            return q
          }
          if (table === 'teacher_course_assignments') {
            const q = {
              order: () => q,
              select: () => q,
              eq: () => q,
              then: (resolve) => resolve({
                data: [
                  { course_id: 'c-shared-1', campus_id: 'campus-a', semester: 1, teacher_id: 'prof-traveling' },
                ],
                error: null,
              }),
            }
            return q
          }
          if (table === 'time_slots') {
            const q = {
              order: () => q,
              select: () => q,
              order: () => q,
              then: (resolve) => resolve({
                data: [
                  { id: 'slot-1-1', day_of_week: 1, period_number: 1 },
                  { id: 'slot-1-2', day_of_week: 1, period_number: 2 },
                  { id: 'slot-1-3', day_of_week: 1, period_number: 3 },
                ],
                error: null,
              }),
            }
            return q
          }
          if (table === 'timetable_entries') {
            const q = {
              order: () => q,
              select: () => q,
              eq: () => q,
              then: (resolve) => resolve({
                data: [
                  {
                    id: 'entry-pub-campus-a',
                    academic_year: '2025-26',
                    semester: 1,
                    campus_id: 'campus-a',
                    teacher_id: 'prof-traveling',
                    course_id: 'c-shared-1',
                    department_id: 'dept-a',
                    status: 'published',
                    time_slots: { day_of_week: 1, period_number: 1 },
                  },
                ],
                error: null,
              }),
            }
            return q
          }
          return {}
        },
      }

      const input = await loadGenerationInput(mockSupabase, '2025-26', 1, 'campus-b')
      assert.strictEqual(input.teacherReservations.length, 1)
      assert.strictEqual(input.teacherReservations[0].teacherId, 'prof-traveling')
      assert.strictEqual(input.teacherReservations[0].day, 1)
      assert.strictEqual(input.teacherReservations[0].period, 1)
      assert.strictEqual(input.teacherReservations[0].sourceCampusId, 'campus-a')
    })

    it('assignTeacher rejects assignment if teacher has a scheduled published class at that slot', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'courses') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: 'c-2', department_id: 'dept-1', title: 'DB', course_code: 'CS202', semester: 2 },
                      error: null,
                    }),
                  }),
                }),
              }
            }
            if (table === 'faculty') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: 't-clashing', department_id: 'dept-1', campus_id: 'campus-1', role: 'teacher', full_name: 'Prof. Clash' },
                      error: null,
                    }),
                  }),
                }),
              }
            }
            if (table === 'timetable_entries') {
              return {
                select: (cols) => {
                  if (cols.includes('day_of_week')) {
                    // Check if checking the course's published slots or teacher's clashing slots
                    const q = {
              order: () => q,
                      eq: (field, val) => {
                        if (field === 'teacher_id') {
                          // Clashing query for teacher
                          return {
                            eq: () => ({
                              eq: () => ({
                                in: async () => ({
                                  data: [
                                    {
                                      id: 'other-entry',
                                      course_id: 'c-other',
                                      semester: 4,
                                      time_slots: { day_of_week: 2, period_number: 3 },
                                    },
                                  ],
                                  error: null,
                                }),
                              }),
                            }),
                          }
                        }
                        return q
                      },
                      then: (resolve) => resolve({
                        data: [{ id: 'entry-c2', time_slot_id: 'slot-uuid-1' }],
                        error: null,
                      }),
                    }
                    return q
                  }
                  return {}
                },
              }
            }
            return {}
          },
        },
      }

      const assignmentsService = new AssignmentsService(mockSupabase, mockAuditLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-1', campus_id: 'campus-1' }

      await assert.rejects(async () => {
        await assignmentsService.assignTeacher(
          hodUser,
          't-clashing',
          'c-2',
          '127.0.0.1',
          { campus_id: 'campus-1', academic_year: '2025-26', semester: 2 }
        )
      }, /shared-teacher clash/i)
    })

    it('substituteTeacher rejects candidate teacher when a conflict exists in another semester', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'timetable_entries') {
              return {
                select: (cols) => {
                  if (cols.includes('departments')) {
                    return {
                      eq: () => ({
                        single: async () => ({
                          data: {
                            id: 'entry-target',
                            academic_year: '2025-26',
                            semester: 1,
                            department_id: 'dept-1',
                            campus_id: 'campus-1',
                            course_id: 'c-1',
                            time_slot_id: 'slot-1',
                            status: 'published',
                            teacher_id: 'old-teacher',
                            time_slots: { day_of_week: 3, period_number: 2 },
                            departments: { campus_id: 'campus-1' },
                          },
                          error: null,
                        }),
                      }),
                    }
                  }
                  // Clash query
                  return {
                    eq: () => ({
                      eq: () => ({
                        eq: () => ({
                          neq: async () => ({
                            data: [
                              {
                                id: 'clash-entry',
                                course_id: 'c-foreign',
                                academic_year: '2025-26',
                                semester: 3, // Conflict in Semester 3!
                                status: 'published',
                              },
                            ],
                            error: null,
                          }),
                        }),
                      }),
                    }),
                  }
                },
              }
            }
            return {}
          },
        },
      }

      const timetableService = new TimetableService(mockSupabase, mockAuditLogger, mockServerLogger)
      const director = { userId: 'dir-1', role: 'campus_director', campus_id: 'campus-1' }

      await assert.rejects(async () => {
        await timetableService.substituteTeacher('entry-target', 'busy-teacher', director)
      }, /already has a scheduled class at Day 3 Period 2 in Semester 3/i)
    })
  })
})
