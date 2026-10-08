const { describe, it } = require('node:test')
const assert = require('node:assert')

const { AuthorizationPolicy } = require('../dist/core/auth/authorization-policy')
const { HodService } = require('../dist/modules/hod/hod.service')
const { AllocationService } = require('../dist/modules/allocation/allocation.service')
const { CreditLedgerService } = require('../dist/modules/credit-ledger/credit-ledger.service')
const { AssignmentsService } = require('../dist/modules/assignments/assignments.service')
const { PeriodAttendanceService } = require('../dist/modules/period-attendance/period-attendance.service')
const { TimetableService } = require('../dist/modules/timetable/timetable.service')

// Helper mock logger
const mockAuditLogger = {
  log: async () => {},
}
const mockServerLogger = {
  error: () => {},
  warn: () => {},
  log: () => {},
}

describe('Plan 01: Authorization & Role Boundaries (F01, F02, F03, F04, F05, F06, F61)', () => {

  describe('1. Centralized AuthorizationPolicy Matrix', () => {
    it('assertCourseManagementScope allows superadmin regardless of course department', () => {
      const user = { userId: 'u1', email: 'admin@uni.edu', role: 'superadmin' }
      assert.doesNotThrow(() => {
        AuthorizationPolicy.assertCourseManagementScope(user, 'dept-99')
      })
    })

    it('assertCourseManagementScope allows HOD for their own department', () => {
      const user = { userId: 'u2', email: 'hod@cs.edu', role: 'hod', department_id: 'dept-cs' }
      assert.doesNotThrow(() => {
        AuthorizationPolicy.assertCourseManagementScope(user, 'dept-cs')
      })
    })

    it('assertCourseManagementScope blocks campus_director with 403 Forbidden', () => {
      const user = { userId: 'u3', email: 'dir@campus.edu', role: 'campus_director', campus_id: 'campus-1' }
      assert.throws(() => {
        AuthorizationPolicy.assertCourseManagementScope(user, 'dept-cs')
      }, /Campus Directors have no course or prerequisite content management privileges/)
    })

    it('assertCourseManagementScope blocks HOD for foreign department with 403', () => {
      const user = { userId: 'u4', email: 'hod@math.edu', role: 'hod', department_id: 'dept-math' }
      assert.throws(() => {
        AuthorizationPolicy.assertCourseManagementScope(user, 'dept-cs')
      }, /HOD can only manage courses belonging to their own department/)
    })

    it('assertCourseManagementScope blocks HOD with null department_id (fail-closed)', () => {
      const user = { userId: 'u5', email: 'hod@empty.edu', role: 'hod', department_id: null }
      assert.throws(() => {
        AuthorizationPolicy.assertCourseManagementScope(user, 'dept-cs')
      }, /HOD account has no assigned department affiliation/)
    })

    it('assertNotRosterOnly blocks teaching_staff with 403 Forbidden', () => {
      const user = { userId: 'u6', email: 'staff@campus.edu', role: 'teaching_staff' }
      assert.throws(() => {
        AuthorizationPolicy.assertNotRosterOnly(user, 'edit course')
      }, /Role 'teaching_staff' is roster-only/)
    })

    it('resolveTimetableScope derives correct scope and fails closed on missing campus/department', () => {
      const student = { userId: 's1', email: 'st@u.edu', role: 'student', campus_id: 'camp-1' }
      const res = AuthorizationPolicy.resolveTimetableScope(student)
      assert.strictEqual(res.campusId, 'camp-1')

      const badStudent = { userId: 's2', email: 'st2@u.edu', role: 'student', campus_id: null }
      assert.throws(() => {
        AuthorizationPolicy.resolveTimetableScope(badStudent)
      }, /Student has no campus affiliation/)

      const badDirector = { userId: 'd1', email: 'dir@u.edu', role: 'campus_director', campus_id: null }
      assert.throws(() => {
        AuthorizationPolicy.resolveTimetableScope(badDirector)
      }, /Campus Director has no assigned campus affiliation/)
    })
  })

  describe('2. F01: HOD Student Deletion Target Authorization', () => {
    it('Foreign student ID produces 403/404 and ZERO Auth deletion calls', async () => {
      let authDeleteCalls = 0
      let dbDeleteCalls = 0

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      // Student belongs to foreign department
                      data: { id: 'foreign-stud-1', department_id: 'dept-foreign', campus_id: 'camp-1', full_name: 'John' },
                      error: null,
                    })
                  }),
                }),
                delete: () => {
                  dbDeleteCalls++
                  return {
                    eq: () => ({ eq: async () => ({ error: null }) })
                  }
                }
              }
            }
          },
          auth: {
            admin: {
              deleteUser: async () => {
                authDeleteCalls++
                return { error: null }
              }
            }
          }
        }
      }

      const hodService = new HodService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-own', campus_id: 'camp-1' }

      await assert.rejects(async () => {
        await hodService.removeStudent('foreign-stud-1', hodUser)
      }, /Cannot remove a student from another department/)

      // Verify zero mutation calls to DB or Auth
      assert.strictEqual(dbDeleteCalls, 0, 'Database delete must not be called')
      assert.strictEqual(authDeleteCalls, 0, 'Auth deleteUser must never be called on foreign student')
    })

    it('Administrator / non-student ID produces 404 and ZERO Auth deletion calls', async () => {
      let authDeleteCalls = 0

      const mockSupabase = {
        admin: {
          from: (table) => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: null, // Admin ID not found in students table
                  error: null,
                })
              }),
            }),
          }),
          auth: {
            admin: {
              deleteUser: async () => {
                authDeleteCalls++
                return { error: null }
              }
            }
          }
        }
      }

      const hodService = new HodService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-own', campus_id: 'camp-1' }

      await assert.rejects(async () => {
        await hodService.removeStudent('admin-uuid-123', hodUser)
      }, /Student not found/)

      assert.strictEqual(authDeleteCalls, 0, 'Auth deleteUser must not be called for non-student ID')
    })

    it('Authorized own-department student deletion successfully deletes DB row and Auth user', async () => {
      let authDeleteCalls = 0
      let dbDeleteCalls = 0

      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'students') {
              return {
                select: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { id: 'own-stud-1', department_id: 'dept-own', campus_id: 'camp-1', full_name: 'Alice' },
                      error: null,
                    })
                  }),
                }),
                delete: () => ({
                  eq: (col1, val1) => ({
                    eq: async (col2, val2) => {
                      dbDeleteCalls++
                      return { error: null }
                    }
                  })
                })
              }
            }
          },
          auth: {
            admin: {
              deleteUser: async (id) => {
                authDeleteCalls++
                assert.strictEqual(id, 'own-stud-1')
                return { error: null }
              }
            }
          }
        }
      }

      const hodService = new HodService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-own', campus_id: 'camp-1' }

      const result = await hodService.removeStudent('own-stud-1', hodUser)
      assert.strictEqual(result.success, true)
      assert.strictEqual(dbDeleteCalls, 1)
      assert.strictEqual(authDeleteCalls, 1)
    })
  })

  describe('3. F02: HOD Course Mutations & Department Derivation', () => {
    it('createCourse derives department from authenticated HOD and rejects foreign department', async () => {
      const mockSupabase = { admin: {} }
      const hodService = new HodService(mockSupabase, mockAuditLogger, mockServerLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-own' }

      // When caller submits foreign department_id
      await assert.rejects(async () => {
        await hodService.createCourse({
          course_code: 'CS101',
          title: 'Intro',
          semester: 1,
          credits: 4,
          category: 'DSC',
          department_id: 'dept-foreign',
        }, hodUser)
      }, /HODs cannot create courses under a foreign department/)
    })

    it('updateCourse forbids updating a course owned by another department', async () => {
      const mockSupabase = {
        admin: {
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'c-1', course_code: 'MATH101', department_id: 'dept-math' },
                  error: null,
                })
              })
            })
          })
        }
      }

      const hodService = new HodService(mockSupabase, mockAuditLogger, mockServerLogger)
      const csHod = { userId: 'hod-cs', role: 'hod', department_id: 'dept-cs' }

      await assert.rejects(async () => {
        await hodService.updateCourse('c-1', {
          course_code: 'MATH101',
          title: 'Math New',
          credits: 4,
          category: 'DSC',
        }, csHod)
      }, /You can only update courses belonging to your own department/)
    })

    it('updateCourse forbids transferring course ownership via body', async () => {
      const mockSupabase = {
        admin: {
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'c-2', course_code: 'CS102', department_id: 'dept-cs' },
                  error: null,
                })
              })
            })
          })
        }
      }

      const hodService = new HodService(mockSupabase, mockAuditLogger, mockServerLogger)
      const csHod = { userId: 'hod-cs', role: 'hod', department_id: 'dept-cs' }

      await assert.rejects(async () => {
        await hodService.updateCourse('c-2', {
          course_code: 'CS102',
          title: 'CS 102',
          credits: 4,
          category: 'DSC',
          department_id: 'dept-other',
        }, csHod)
      }, /Course department ownership cannot be transferred via update/)
    })
  })

  describe('4. F03: Prerequisite Management Role Boundaries', () => {
    it('Campus Director receives 403 when attempting to add prerequisite rules', async () => {
      const mockSupabase = {
        admin: {
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 'c-1', course_code: 'CS101', department_id: 'dept-cs' },
                  error: null,
                }),
                maybeSingle: async () => ({
                  data: { id: 'c-1', course_code: 'CS101', department_id: 'dept-cs' },
                  error: null,
                })
              })
            })
          })
        }
      }

      const allocationService = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      const director = { userId: 'd-1', role: 'campus_director', campus_id: 'camp-1' }

      await assert.rejects(async () => {
        await allocationService.addPrerequisite('c-1', { rule: 'COMPLETED_SEMESTER', target: '2' }, director)
      }, /Campus Directors have no course or prerequisite content management privileges/)
    })

    it('Foreign HOD receives 403 when modifying prerequisites for another department course', async () => {
      const mockSupabase = {
        admin: {
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 'c-1', course_code: 'CS101', department_id: 'dept-cs' },
                  error: null,
                }),
                maybeSingle: async () => ({
                  data: { id: 'c-1', course_code: 'CS101', department_id: 'dept-cs' },
                  error: null,
                })
              })
            })
          })
        }
      }

      const allocationService = new AllocationService(mockSupabase, mockAuditLogger, mockServerLogger)
      const foreignHod = { userId: 'hod-math', role: 'hod', department_id: 'dept-math' }

      await assert.rejects(async () => {
        await allocationService.addPrerequisite('c-1', { rule: 'COMPLETED_SEMESTER', target: '2' }, foreignHod)
      }, /HOD can only manage courses belonging to their own department/)
    })
  })

  describe('5. F06: Credit Ledger Affiliation and teaching_staff Protection', () => {
    it('teaching_staff is denied credit ledger access with 403 Forbidden', async () => {
      const mockSupabase = {
        admin: {
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 's-1', department_id: 'dept-1', campus_id: 'camp-1' },
                  error: null,
                })
              })
            })
          })
        }
      }

      const ledgerService = new CreditLedgerService(mockSupabase)
      const staffUser = { userId: 'staff-1', role: 'teaching_staff', campus_id: 'camp-1' }

      await assert.rejects(async () => {
        await ledgerService.getCreditLedger('s-1', staffUser)
      }, /Teaching staff is roster-only and not authorized to access student credit ledgers/)
    })

    it('Missing/null affiliation on teacher or HOD fails closed with 403', async () => {
      const mockSupabase = {
        admin: {
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: 's-1', department_id: 'dept-1', campus_id: 'camp-1' },
                  error: null,
                })
              })
            })
          })
        }
      }

      const ledgerService = new CreditLedgerService(mockSupabase)
      const nullAffiliationHod = { userId: 'hod-null', role: 'hod', department_id: null, campus_id: 'camp-1' }

      await assert.rejects(async () => {
        await ledgerService.getCreditLedger('s-1', nullAffiliationHod)
      }, /HOD has no department affiliation/)

      const nullAffiliationTeacher = { userId: 't-null', role: 'teacher', department_id: null, campus_id: 'camp-1' }
      await assert.rejects(async () => {
        await ledgerService.getCreditLedger('s-1', nullAffiliationTeacher)
      }, /Teacher has no department affiliation/)
    })
  })

  describe('6. F61: Teaching Staff Role Limits in Assignments & Period Attendance', () => {
    it('AssignmentsService rejects teaching_staff as course instructors', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  if (table === 'courses') {
                    return { data: { id: 'c-1', department_id: 'dept-1' }, error: null }
                  }
                  if (table === 'faculty') {
                    return { data: { id: 'f-staff', department_id: 'dept-1', role: 'teaching_staff' }, error: null }
                  }
                }
              })
            })
          })
        }
      }

      const assignmentsService = new AssignmentsService(mockSupabase, mockAuditLogger)
      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-1' }

      await assert.rejects(async () => {
        await assignmentsService.assignTeacher(hodUser, 'f-staff', 'c-1', '127.0.0.1')
      }, /Only faculty with the teacher role can be assigned to instruct courses/)
    })

    it('PeriodAttendanceService blocks teaching_staff from submitting attendance', async () => {
      const mockSupabase = { admin: {} }
      const periodService = new PeriodAttendanceService(mockSupabase, mockAuditLogger, mockServerLogger)
      const staffUser = { userId: 'staff-1', role: 'teaching_staff' }

      await assert.rejects(async () => {
        await periodService.submitAttendance(staffUser, 'slot-1', [], '127.0.0.1')
      }, /Role 'teaching_staff' is roster-only and cannot perform submit period attendance/)
    })
  })

  describe('7. F04 & F05: Timetable Scoping, Draft Isolation & Empty-Campus Safety', () => {
    it('publishTimetable safely returns 0 published and performs no update on empty campus', async () => {
      let updateCalls = 0
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'departments') {
              return {
                select: () => ({
                  eq: async () => ({
                    data: [], // Empty campus, no departments
                    error: null,
                  })
                })
              }
            }
            if (table === 'timetable_entries') {
              return {
                update: () => {
                  updateCalls++
                  return {
                    eq: () => ({ eq: () => ({ in: () => ({ select: async () => ({ data: [], error: null }) }) }) })
                  }
                }
              }
            }
          }
        }
      }

      const timetableService = new TimetableService(mockSupabase, mockAuditLogger, mockServerLogger)
      const directorUser = { userId: 'd-1', role: 'campus_director', campus_id: 'empty-campus' }

      const result = await timetableService.publish('2026-27', 1, directorUser)
      assert.strictEqual(result.publishedCount, 0)
      assert.strictEqual(updateCalls, 0, 'No global update query must execute when campus has 0 departments')
    })

    it('getEntries blocks campus director from querying foreign department not in their campus', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'departments') {
              return {
                select: () => ({
                  eq: () => ({
                    order: async () => ({
                      data: [{ id: 'dept-campus-1' }],
                      error: null,
                    })
                  })
                })
              }
            }
          }
        }
      }

      const timetableService = new TimetableService(mockSupabase, mockAuditLogger, mockServerLogger)
      const directorUser = { userId: 'd-1', role: 'campus_director', campus_id: 'camp-1' }

      await assert.rejects(async () => {
        await timetableService.getEntries('2026-27', 1, 'foreign-dept-99', directorUser)
      }, /Requested department does not belong to your campus/)
    })

    it('getEntries hides draft entries and conflicts from students', async () => {
      const mockSupabase = {
        admin: {
          from: (table) => {
            if (table === 'departments') {
              return {
                select: () => ({
                  order: () => ({
                    in: async () => ({
                      data: [{ id: 'dept-1', name: 'CS', code: 'CS' }],
                      error: null,
                    }),
                    then: (fn) => fn({ data: [{ id: 'dept-1', name: 'CS', code: 'CS' }], error: null }),
                  }),
                  eq: () => ({
                    order: async () => ({
                      data: [{ id: 'dept-1', name: 'CS', code: 'CS' }],
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
                      eq: (col, val) => {
                        assert.strictEqual(col, 'status')
                        assert.strictEqual(val, 'published', 'Student query must strictly filter by status = published')
                        return {
                          eq: async () => ({
                            data: [{ id: 'te-1', status: 'published', is_lab_block: false }],
                            error: null,
                          })
                        }
                      }
                    })
                  })
                })
              }
            }
          }
        }
      }

      const timetableService = new TimetableService(mockSupabase, mockAuditLogger, mockServerLogger)
      const studentUser = { userId: 's-1', role: 'student', campus_id: 'camp-1', department_id: 'dept-1' }

      const result = await timetableService.getEntries('2026-27', 1, 'dept-1', studentUser)
      assert.strictEqual(result.entries.length, 1)
      assert.deepStrictEqual(result.conflicts, [], 'Students must never receive timetable conflicts')
    })
  })
})
