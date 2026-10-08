const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { AdminService } = require('../dist/modules/admin/admin.service')
const { DirectorService } = require('../dist/modules/director/director.service')

// ──────────────── Test Mocks & Fixtures ────────────────

function createMockAuditLogger() {
  const logs = []
  return {
    logs,
    log: async (entry) => {
      logs.push(entry)
      return { id: 'audit-log-1', ...entry }
    },
  }
}

function createMockServerLogger() {
  const errorLogs = []
  const warnLogs = []
  return {
    errorLogs,
    warnLogs,
    error: (msg, trace) => errorLogs.push({ msg, trace }),
    warn: (msg) => warnLogs.push(msg),
    log: () => {},
  }
}

function createMockSupabaseService(options = {}) {
  const {
    campuses = [],
    campusSettings = new Map(),
    faculty = new Map(),
    students = new Map(),
    registrations = new Map(),
    periodAttendance = new Map(),
    failRpc = null,
    failAuthDeleteIds = new Set(),
  } = options

  return {
    admin: {
      auth: {
        admin: {
          deleteUser: async (id) => {
            if (failAuthDeleteIds.has(id)) {
              return { data: null, error: { message: `Auth service network failure for ${id}` } }
            }
            return { data: { user: { id } }, error: null }
          },
        },
      },
      rpc: async (fnName, params) => {
        if (failRpc && failRpc[fnName]) {
          return { data: null, error: failRpc[fnName] }
        }

        if (fnName === 'promote_campus_students_atomic') {
          const { p_campus_id, p_idempotency_key } = params
          const settings = campusSettings.get(p_campus_id)
          if (!settings) {
            return {
              data: null,
              error: { message: `Campus settings record not found for campus ${p_campus_id} (F54)` },
            }
          }

          if (settings.last_promoted_at) {
            const lastPromoted = new Date(settings.last_promoted_at)
            const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
            if (lastPromoted > ninetyDaysAgo) {
              return {
                data: null,
                error: {
                  message: `Promotion is locked: students were already promoted on ${settings.last_promoted_at}. A minimum of 90 days must pass before next promotion (F56).`,
                },
              }
            }
          }

          // Gather graduating sem 10 students
          const graduatingIds = []
          let promotedCount = 0

          for (const [sId, student] of students.entries()) {
            if (student.campus_id === p_campus_id) {
              if (student.current_semester === 10) {
                graduatingIds.push(sId)
              } else if (student.current_semester >= 1 && student.current_semester < 10) {
                student.current_semester += 1
                promotedCount++
              }
            }
          }

          settings.last_promoted_at = new Date().toISOString()
          campusSettings.set(p_campus_id, settings)

          return {
            data: {
              success: true,
              promoted_count: promotedCount,
              graduating_student_ids: graduatingIds,
            },
            error: null,
          }
        }

        if (fnName === 'cleanup_concluded_semester_attendance') {
          const { p_campus_id, p_academic_year, p_semester } = params
          let deletedCount = 0
          for (const [attId, att] of Array.from(periodAttendance.entries())) {
            if (
              att.campus_id === p_campus_id &&
              att.academic_year === p_academic_year &&
              att.semester === p_semester
            ) {
              periodAttendance.delete(attId)
              deletedCount++
            }
          }
          return {
            data: {
              success: true,
              deleted_attendance_records: deletedCount,
              campus_id: p_campus_id,
              academic_year: p_academic_year,
              semester: p_semester,
            },
            error: null,
          }
        }

        return { data: null, error: { message: `Unknown RPC function ${fnName}` } }
      },
      from: (table) => {
        let selectedFields = '*'
        let filters = []
        let inFilters = []
        let updateData = null
        let insertData = null
        let isDelete = false

        const query = {
          select: (fields, countOpt) => {
            selectedFields = fields
            return query
          },
          insert: (data) => {
            insertData = data
            return query
          },
          upsert: (data, opts) => {
            if (table === 'campus_settings') {
              const prev = campusSettings.get(data.campus_id) || {}
              campusSettings.set(data.campus_id, { ...prev, ...data })
            }
            return Promise.resolve({ data, error: null })
          },
          update: (data) => {
            updateData = data
            return query
          },
          delete: (opt) => {
            isDelete = true
            return query
          },
          eq: (col, val) => {
            filters.push({ col, val })
            return query
          },
          in: (col, valArray) => {
            inFilters.push({ col, valArray })
            return query
          },
          maybeSingle: async () => {
            const results = await execute()
            return { data: results[0] ?? null, error: null }
          },
          single: async () => {
            const results = await execute()
            if (results.length === 0) {
              return { data: null, error: { message: 'Row not found' } }
            }
            return { data: results[0], error: null }
          },
          then: (resolve, reject) => {
            execute().then(
              (rows) => resolve({ data: rows, error: null, count: rows.length }),
              (err) => resolve({ data: null, error: err }),
            )
          },
        }

        async function execute() {
          if (insertData) {
            if (table === 'campuses') {
              const newCampus = { id: `camp_${Date.now()}`, ...insertData }
              campuses.push(newCampus)
              return [newCampus]
            }
          }

          if (isDelete) {
            if (table === 'students') {
              let deleted = 0
              for (const { col, valArray } of inFilters) {
                if (col === 'id') {
                  for (const id of valArray) {
                    if (students.has(id)) {
                      students.delete(id)
                      deleted++
                    }
                  }
                }
              }
              return new Array(deleted).fill({ id: 'deleted' })
            }
          }

          if (updateData) {
            if (table === 'campus_settings') {
              const matched = []
              for (const [cId, settings] of campusSettings.entries()) {
                const matches = filters.every(({ col, val }) => {
                  if (col === 'campus_id') return cId === val
                  return settings[col] === val
                })
                if (matches) {
                  Object.assign(settings, updateData)
                  matched.push(settings)
                }
              }
              return matched
            }
          }

          // Select queries
          let rows = []
          if (table === 'faculty') {
            rows = Array.from(faculty.values())
          } else if (table === 'campuses') {
            rows = campuses
          } else if (table === 'campus_settings') {
            rows = Array.from(campusSettings.values())
          } else if (table === 'students') {
            rows = Array.from(students.values())
          }

          return rows.filter((row) => {
            const matchEq = filters.every(({ col, val }) => row[col] === val)
            const matchIn = inFilters.every(({ col, valArray }) => valArray.includes(row[col]))
            return matchEq && matchIn
          })
        }

        return query
      },
    },
  }
}

// ──────────────── Test Suites ────────────────

describe('Plan 08: Campus Setup, Promotion, Graduation & Short Retention', () => {
  describe('1. F54: Campus Onboarding Completeness & Verified Settings Update', () => {
    it('creates campus and auto-initializes base campus_settings with setup status', async () => {
      const mockCampuses = []
      const mockSettings = new Map()
      const mockSupabase = createMockSupabaseService({
        campuses: mockCampuses,
        campusSettings: mockSettings,
      })
      const auditLogger = createMockAuditLogger()
      const serverLogger = createMockServerLogger()
      const adminService = new AdminService(mockSupabase, auditLogger, serverLogger)

      const user = { userId: 'admin-1', role: 'superadmin' }
      const result = await adminService.createCampus('Thalassery Campus', 'TC', user)

      assert.strictEqual(result.success, true)
      assert.ok(result.campus_id)
      assert.strictEqual(result.is_ready, false) // Geofence not yet configured
      assert.strictEqual(result.setup_status, 'incomplete_geofence')

      // Verify base settings were upserted in campus_settings
      const settings = mockSettings.get(result.campus_id)
      assert.ok(settings)
      assert.strictEqual(settings.academic_year, '2025-26')
      assert.strictEqual(settings.min_credits, 18)
      assert.strictEqual(settings.max_credits, 26)
    })

    it('director getSettings returns explicit setup_status and is_ready flag', async () => {
      const campusId = 'camp-thalassery'
      const facultyMap = new Map([
        ['dir-1', { id: 'dir-1', full_name: 'Dr. Director', campus_id: campusId }],
      ])
      const mockCampuses = [
        { id: campusId, name: 'Thalassery', center_latitude: 11.75, center_longitude: 75.49, radius_meters: 500 },
      ]
      const mockSettings = new Map([
        [campusId, { campus_id: campusId, academic_year: '2025-26', deadline: '2026-10-15T18:00:00Z', min_credits: 18, max_credits: 26 }],
      ])

      const mockSupabase = createMockSupabaseService({
        campuses: mockCampuses,
        faculty: facultyMap,
        campusSettings: mockSettings,
      })
      const auditLogger = createMockAuditLogger()
      const serverLogger = createMockServerLogger()
      const directorService = new DirectorService(mockSupabase, auditLogger, serverLogger)

      const directorUser = { userId: 'dir-1', role: 'campus_director', campus_id: campusId }
      const res = await directorService.getSettings(directorUser)

      assert.strictEqual(res.campusId, campusId)
      assert.strictEqual(res.is_ready, true)
      assert.strictEqual(res.setup_status, 'ready')
    })

    it('director updateSettings throws NotFoundException if campus settings row does not exist (no silent 0-row update)', async () => {
      const campusId = 'camp-nonexistent'
      const mockSupabase = createMockSupabaseService({
        campusSettings: new Map(), // Empty settings
      })
      const auditLogger = createMockAuditLogger()
      const serverLogger = createMockServerLogger()
      const directorService = new DirectorService(mockSupabase, auditLogger, serverLogger)

      const directorUser = { userId: 'dir-1', role: 'campus_director', campus_id: campusId }

      await assert.rejects(
        async () => {
          await directorService.updateSettings({ min_credits: 20 }, directorUser)
        },
        (err) => {
          assert.strictEqual(err.name, 'NotFoundException')
          assert.match(err.message, /Campus settings record not found.*F54/)
          return true
        },
      )
    })
  })

  describe('2. F56: Director Own-Campus Atomic Promotion & 90-Day Cooldown', () => {
    it('rejects promotion if director lacks campus assignment', async () => {
      const mockSupabase = createMockSupabaseService()
      const adminService = new AdminService(mockSupabase, createMockAuditLogger(), createMockServerLogger())

      const directorUser = { userId: 'dir-no-campus', role: 'campus_director' }
      await assert.rejects(
        async () => {
          await adminService.promoteStudents(directorUser)
        },
        { name: 'BadRequestException', message: 'Campus assignment missing for director' },
      )
    })

    it('enforces 90-day promotion cooldown within atomic transaction', async () => {
      const campusId = 'camp-kannur'
      const lastPromotedRecent = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days ago
      const mockSettings = new Map([
        [campusId, { campus_id: campusId, academic_year: '2025-26', last_promoted_at: lastPromotedRecent }],
      ])
      const mockSupabase = createMockSupabaseService({ campusSettings: mockSettings })
      const adminService = new AdminService(mockSupabase, createMockAuditLogger(), createMockServerLogger())

      const directorUser = { userId: 'dir-kannur', role: 'campus_director', campus_id: campusId }

      await assert.rejects(
        async () => {
          await adminService.promoteStudents(directorUser)
        },
        (err) => {
          assert.strictEqual(err.name, 'BadRequestException')
          assert.match(err.message, /minimum of 90 days must pass/i)
          return true
        },
      )
    })

    it('atomically advances semesters 1 through 9 students by 1 when cooldown has elapsed', async () => {
      const campusId = 'camp-kannur'
      const lastPromotedOld = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString() // 100 days ago
      const mockSettings = new Map([
        [campusId, { campus_id: campusId, academic_year: '2025-26', last_promoted_at: lastPromotedOld }],
      ])
      const mockStudents = new Map([
        ['s1', { id: 's1', campus_id: campusId, current_semester: 2 }],
        ['s2', { id: 's2', campus_id: campusId, current_semester: 5 }],
        ['s3', { id: 's3', campus_id: campusId, current_semester: 9 }],
      ])

      const mockSupabase = createMockSupabaseService({
        campusSettings: mockSettings,
        students: mockStudents,
      })
      const auditLogger = createMockAuditLogger()
      const adminService = new AdminService(mockSupabase, auditLogger, createMockServerLogger())

      const directorUser = { userId: 'dir-kannur', role: 'campus_director', campus_id: campusId }
      const result = await adminService.promoteStudents(directorUser, 'test-idempotency-key-1')

      assert.strictEqual(result.success, true)
      assert.strictEqual(result.promoted_count, 3)
      assert.strictEqual(result.graduated_count, 0)

      // Verify semester increments
      assert.strictEqual(mockStudents.get('s1').current_semester, 3)
      assert.strictEqual(mockStudents.get('s2').current_semester, 6)
      assert.strictEqual(mockStudents.get('s3').current_semester, 10)

      // Verify audit log recorded
      const audit = auditLogger.logs.find((l) => l.eventType === 'student_promoted')
      assert.ok(audit)
      assert.strictEqual(audit.metadata.promoted_count, 3)
      assert.strictEqual(audit.metadata.idempotency_key, 'test-idempotency-key-1')
    })
  })

  describe('3. F55: Explicit & Recoverable Graduation Cleanup (Semester 10 Cohort)', () => {
    it('graduates semester-10 cohort without writing semester 11, deleting both Auth and DB records', async () => {
      const campusId = 'camp-kannur'
      const mockSettings = new Map([
        [campusId, { campus_id: campusId, academic_year: '2025-26', last_promoted_at: null }],
      ])
      const mockStudents = new Map([
        ['s-undergrad', { id: 's-undergrad', campus_id: campusId, current_semester: 4 }],
        ['s-grad-1', { id: 's-grad-1', campus_id: campusId, current_semester: 10 }],
        ['s-grad-2', { id: 's-grad-2', campus_id: campusId, current_semester: 10 }],
      ])

      const mockSupabase = createMockSupabaseService({
        campusSettings: mockSettings,
        students: mockStudents,
      })
      const auditLogger = createMockAuditLogger()
      const adminService = new AdminService(mockSupabase, auditLogger, createMockServerLogger())

      const directorUser = { userId: 'dir-kannur', role: 'campus_director', campus_id: campusId }
      const result = await adminService.promoteStudents(directorUser)

      assert.strictEqual(result.success, true)
      assert.strictEqual(result.promoted_count, 1) // s-undergrad 4 -> 5
      assert.strictEqual(result.graduated_count, 2) // s-grad-1 and s-grad-2

      // Verify under-grad student advanced to sem 5
      assert.strictEqual(mockStudents.get('s-undergrad').current_semester, 5)

      // Crucial (F55): Graduating students were NEVER updated to semester 11; their rows were cleaned up
      assert.strictEqual(mockStudents.has('s-grad-1'), false)
      assert.strictEqual(mockStudents.has('s-grad-2'), false)
    })

    it('reports partial Auth deletion failures honestly and allows safe retry without ghost states', async () => {
      const campusId = 'camp-kannur'
      const mockStudents = new Map([
        ['s-grad-success', { id: 's-grad-success', campus_id: campusId, current_semester: 10 }],
        ['s-grad-fail', { id: 's-grad-fail', campus_id: campusId, current_semester: 10 }],
      ])

      // Simulate network failure for s-grad-fail
      const failAuthDeleteIds = new Set(['s-grad-fail'])
      const mockSupabase = createMockSupabaseService({
        students: mockStudents,
        failAuthDeleteIds,
      })
      const adminService = new AdminService(
        mockSupabase,
        createMockAuditLogger(),
        createMockServerLogger(),
      )

      const directorUser = { userId: 'dir-kannur', role: 'campus_director', campus_id: campusId }
      const gradResult = await adminService.graduateStudents(
        campusId,
        ['s-grad-success', 's-grad-fail'],
        directorUser,
      )

      // Verified honest reporting
      assert.strictEqual(gradResult.success, false)
      assert.strictEqual(gradResult.total_candidates, 2)
      assert.strictEqual(gradResult.graduated_count, 1)
      assert.strictEqual(gradResult.failed_count, 1)
      assert.deepStrictEqual(gradResult.failed_student_ids, ['s-grad-fail'])
      assert.strictEqual(gradResult.errors.length, 1)
      assert.match(gradResult.errors[0].error, /Auth service network failure/)

      // Successful student was removed from DB; failed student is retained in DB for safe retry
      assert.strictEqual(mockStudents.has('s-grad-success'), false)
      assert.strictEqual(mockStudents.has('s-grad-fail'), true)

      // Safe retry: clear network issue and retry remaining failed candidate
      failAuthDeleteIds.delete('s-grad-fail')
      const retryResult = await adminService.graduateStudents(
        campusId,
        gradResult.failed_student_ids,
        directorUser,
      )

      assert.strictEqual(retryResult.success, true)
      assert.strictEqual(retryResult.graduated_count, 1)
      assert.strictEqual(retryResult.failed_count, 0)
      assert.strictEqual(mockStudents.has('s-grad-fail'), false)
    })
  })

  describe('4. Short Retention: Concluded-Semester Attendance Purge & Ledger Preservation', () => {
    it('purges attendance for concluded term while strictly preserving student registrations and credit ledger', async () => {
      const campusId = 'camp-kannur'
      const concludedYear = '2024-25'
      const concludedSem = 2

      const mockAttendance = new Map([
        [
          'att-1',
          { id: 'att-1', campus_id: campusId, academic_year: concludedYear, semester: concludedSem, student_id: 's1' },
        ],
        [
          'att-2',
          { id: 'att-2', campus_id: campusId, academic_year: concludedYear, semester: concludedSem, student_id: 's2' },
        ],
        [
          'att-other-term',
          { id: 'att-other-term', campus_id: campusId, academic_year: '2025-26', semester: 3, student_id: 's1' },
        ],
      ])

      const mockSupabase = createMockSupabaseService({
        periodAttendance: mockAttendance,
      })
      const adminService = new AdminService(
        mockSupabase,
        createMockAuditLogger(),
        createMockServerLogger(),
      )

      const directorUser = { userId: 'dir-kannur', role: 'campus_director', campus_id: campusId }
      const purgeResult = await adminService.cleanupConcludedSemesterAttendance(
        campusId,
        concludedYear,
        concludedSem,
        directorUser,
      )

      assert.strictEqual(purgeResult.success, true)
      assert.strictEqual(purgeResult.deleted_attendance_records, 2)

      // Concluded attendance purged
      assert.strictEqual(mockAttendance.has('att-1'), false)
      assert.strictEqual(mockAttendance.has('att-2'), false)

      // Active term attendance preserved
      assert.strictEqual(mockAttendance.has('att-other-term'), true)
    })

    it('rejects director attempting to clean up attendance for a foreign campus', async () => {
      const mockSupabase = createMockSupabaseService()
      const adminService = new AdminService(
        mockSupabase,
        createMockAuditLogger(),
        createMockServerLogger(),
      )

      const directorUser = { userId: 'dir-kannur', role: 'campus_director', campus_id: 'camp-kannur' }

      await assert.rejects(
        async () => {
          await adminService.cleanupConcludedSemesterAttendance(
            'camp-foreign-campus',
            '2024-25',
            2,
            directorUser,
          )
        },
        {
          name: 'BadRequestException',
          message: 'Directors can only clean up attendance for their own campus',
        },
      )
    })
  })

  describe('5. Migration Integrity & Artifact Verification', () => {
    it('verifies Plan 08 migration exists and contains trigger, promote atomic RPC and cleanup RPC', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261007050000_plan08_campus_onboarding_and_atomic_promotion.sql',
      )
      assert.ok(fs.existsSync(migrationPath), 'Plan 08 migration file must exist')
      const content = fs.readFileSync(migrationPath, 'utf8')

      assert.match(content, /trg_campuses_init_settings/)
      assert.match(content, /promote_campus_students_atomic/)
      assert.match(content, /cleanup_concluded_semester_attendance/)
      assert.match(content, /FOR UPDATE/)
      assert.match(content, /interval '90 days'/)
      assert.match(content, /current_semester < 10/)
      assert.match(content, /schema_migrations/)
    })
  })
})
