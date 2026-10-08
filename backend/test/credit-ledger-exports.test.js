const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  parseKuCourseCode,
  ADVISORY_MATRIX_VERSION,
  ADVISORY_CREDIT_DISCLAIMER,
  UNRESOLVED_REQUIREMENT_NOTE,
  DEPARTMENT_ALIASES,
} = require('../dist/modules/credit-ledger/credit-ledger.constants')
const { CreditLedgerService } = require('../dist/modules/credit-ledger/credit-ledger.service')
const { ExportService, sanitizeSpreadsheetValue } = require('../dist/modules/credit-ledger/export.service')

// ──────────────── Mock Supabase Service ────────────────

function createMockSupabaseService(options = {}) {
  const {
    students = new Map(),
    registrations = new Map(),
    courses = new Map(),
    teacherAssignments = new Map(),
    timetableEntries = new Map(),
    periodAttendance = new Map(),
    campusSignIns = new Map(),
  } = options

  return {
    admin: {
      from: (table) => {
        let filters = []
        let orFilter = ''
        let inFilters = []
        let gteFilters = []
        let lteFilters = []

        const query = {
          select: () => query,
          order: () => query,
          limit: () => query,
          eq: (col, val) => {
            filters.push({ col, val })
            return query
          },
          or: (expr) => {
            orFilter = expr
            return query
          },
          in: (col, arr) => {
            inFilters.push({ col, arr })
            return query
          },
          gte: (col, val) => {
            gteFilters.push({ col, val })
            return query
          },
          lte: (col, val) => {
            lteFilters.push({ col, val })
            return query
          },
          single: async () => {
            const rows = await execute()
            return { data: rows[0] || null, error: rows[0] ? null : { message: 'Not found' } }
          },
          maybeSingle: async () => {
            const rows = await execute()
            return { data: rows[0] || null, error: null }
          },
          then: (resolve) => {
            execute().then((rows) => resolve({ data: rows, error: null }))
          },
        }

        async function execute() {
          let rows = []
          if (table === 'students') rows = Array.from(students.values())
          else if (table === 'student_registrations') rows = Array.from(registrations.values())
          else if (table === 'courses') rows = Array.from(courses.values())
          else if (table === 'teacher_course_assignments') rows = Array.from(teacherAssignments.values())
          else if (table === 'timetable_entries') rows = Array.from(timetableEntries.values())
          else if (table === 'period_attendance') rows = Array.from(periodAttendance.values())
          else if (table === 'campus_sign_ins') rows = Array.from(campusSignIns.values())

          return rows.filter((r) => {
            // Apply eq filters
            for (const { col, val } of filters) {
              if (col.includes('.')) {
                const parts = col.split('.')
                let current = r
                for (const p of parts) {
                  current = current?.[p]
                }
                if (current !== val) return false
              } else {
                if (r[col] !== val) return false
              }
            }

            // Apply in filters
            for (const { col, arr } of inFilters) {
              if (!arr.includes(r[col])) return false
            }

            // Apply gte / lte filters
            for (const { col, val } of gteFilters) {
              if (r[col] < val) return false
            }
            for (const { col, val } of lteFilters) {
              if (r[col] > val) return false
            }

            // Apply or filter
            if (orFilter) {
              const clauses = orFilter.split(',')
              const matchesAny = clauses.some((clause) => {
                const [cCol, cVal] = clause.split('.eq.')
                return r[cCol] === cVal
              })
              if (!matchesAny) return false
            }

            return true
          })
        }

        return query
      },
    },
  }
}

// ──────────────── Test Suites ────────────────

describe('Plan 09: Registered-Credit Ledger and Scoped Exports', () => {
  describe('1. F51: KU Course-Code Level Band Parsing & Department Aliases', () => {
    it('correctly parses KU03DSCCSE201 as 200s level without semester prefix misclassification', () => {
      const parsed = parseKuCourseCode('KU03DSCCSE201')
      assert.strictEqual(parsed.isValid, true)
      assert.strictEqual(parsed.semester, 3)
      assert.strictEqual(parsed.category, 'DSC')
      assert.strictEqual(parsed.discipline, 'CSE')
      assert.strictEqual(parsed.serialNumber, '201')
      assert.strictEqual(parsed.derivedLevelBand, '200s') // Serial 201 -> 200s, not 00s or 300s
    })

    it('correctly classifies all standard 64 KU course code patterns across semesters 1–10', () => {
      const testCases = [
        { code: 'KU01DSCMAT101', expectedLevel: '100s', sem: 1, cat: 'DSC' },
        { code: 'KU01AECENG101', expectedLevel: '100s', sem: 1, cat: 'AEC' },
        { code: 'KU01AECMAL101', expectedLevel: '100s', sem: 1, cat: 'AEC' },
        { code: 'KU01AECHIN101', expectedLevel: '100s', sem: 1, cat: 'AEC' },
        { code: 'KU01AECARA101', expectedLevel: '100s', sem: 1, cat: 'AEC' },
        { code: 'KU02DSCPHY102', expectedLevel: '100s', sem: 2, cat: 'DSC' },
        { code: 'KU03DSCCSE201', expectedLevel: '200s', sem: 3, cat: 'DSC' },
        { code: 'KU04DSEMAT202', expectedLevel: '200s', sem: 4, cat: 'DSE' },
        { code: 'KU05DSEMAT301', expectedLevel: '300s', sem: 5, cat: 'DSE' },
        { code: 'KU06DSECSE302', expectedLevel: '300s', sem: 6, cat: 'DSE' },
        { code: 'KU07RPHCSE401', expectedLevel: '400s', sem: 7, cat: 'RPH' },
        { code: 'KU08RPHCSE402', expectedLevel: '400s', sem: 8, cat: 'RPH' },
        { code: 'KU09DSCCSE501', expectedLevel: '500s', sem: 9, cat: 'DSC' },
        { code: 'KU10DSECSE502', expectedLevel: '500s', sem: 10, cat: 'DSE' },
      ]

      for (const tc of testCases) {
        const parsed = parseKuCourseCode(tc.code)
        assert.strictEqual(parsed.isValid, true, `Failed on ${tc.code}`)
        assert.strictEqual(parsed.derivedLevelBand, tc.expectedLevel, `Mismatched level on ${tc.code}`)
        assert.strictEqual(parsed.semester, tc.sem, `Mismatched sem on ${tc.code}`)
        assert.strictEqual(parsed.category, tc.cat, `Mismatched category on ${tc.code}`)
      }
    })

    it('supports department aliases such as CSE <-> IT and MATH <-> MAT', () => {
      assert.strictEqual(DEPARTMENT_ALIASES.IT, 'CSE')
      assert.strictEqual(DEPARTMENT_ALIASES.CSE, 'IT')
      assert.strictEqual(DEPARTMENT_ALIASES.MATHEMATICS, 'MAT')
      assert.strictEqual(DEPARTMENT_ALIASES.MATH, 'MAT')
    })

    it('honors explicit catalog academic_level override when provided', () => {
      const parsed = parseKuCourseCode('KU03DSCCSE201', '300s')
      assert.strictEqual(parsed.derivedLevelBand, '300s')
    })

    it('flags unmapped / non-standard codes as explicit Unknown rather than silently inventing levels', () => {
      const parsed = parseKuCourseCode('SPECIAL_SEMINAR_XYZ')
      assert.strictEqual(parsed.isValid, false)
      assert.strictEqual(parsed.derivedLevelBand, 'Unknown')
    })
  })

  describe('2. F50: Registered vs Certified Credits & Registration-Time Snapshot Preservation', () => {
    it('separates core credits (slots 1-6) from additional credits (slots 7-8 and selections)', async () => {
      const studentId = 'student-1'
      const mockStudents = new Map([
        [
          studentId,
          {
            id: studentId,
            full_name: 'Zayan',
            cap_application_number: 'CAP1001',
            current_semester: 3,
            academic_year_joined: '2024-25',
            department_id: 'dept-cs',
            campus_id: 'camp-1',
            departments: { id: 'dept-cs', name: 'Computer Science', code: 'CSE' },
            campuses: { id: 'camp-1', name: 'Thalassery Campus' },
          },
        ],
      ])

      const mockCourses = new Map([
        ['c1', { id: 'c1', course_code: 'KU01DSCMAT101', title: 'Calculus', credits: 4, category: 'DSC' }],
        ['c2', { id: 'c2', course_code: 'KU01DSCPHY101', title: 'Physics', credits: 4, category: 'DSC' }],
        ['c3', { id: 'c3', course_code: 'KU01AECENG101', title: 'English', credits: 3, category: 'AEC' }],
        ['c4', { id: 'c4', course_code: 'KU01VAC101', title: 'Values', credits: 2, category: 'VAC' }],
        ['c5', { id: 'c5', course_code: 'KU01SEC101', title: 'Coding', credits: 3, category: 'SEC' }],
        ['c6', { id: 'c6', course_code: 'KU01MDC101', title: 'Economics', credits: 3, category: 'MDC' }],
        ['c7', { id: 'c7', course_code: 'KU01DSE101', title: 'Extra Paper 7', credits: 4, category: 'DSE' }],
        ['c8', { id: 'c8', course_code: 'KU01DSE102', title: 'Extra Paper 8', credits: 4, category: 'DSE' }],
      ])

      const mockRegistrations = new Map([
        [
          'reg-1',
          {
            id: 'reg-1',
            student_id: studentId,
            semester: 1,
            academic_year: '2024-25',
            slot_1_course_id: 'c1',
            slot_2_course_id: 'c2',
            slot_3_course_id: 'c3',
            slot_4_course_id: 'c4',
            slot_5_course_id: 'c5',
            slot_6_course_id: 'c6',
            slot_7_course_id: 'c7',
            slot_8_course_id: 'c8',
            total_credits: 27,
            selections: [],
          },
        ],
      ])

      const mockSupabase = createMockSupabaseService({
        students: mockStudents,
        courses: mockCourses,
        registrations: mockRegistrations,
      })
      const creditLedgerService = new CreditLedgerService(mockSupabase)

      const user = { userId: studentId, role: 'student' }
      const ledger = await creditLedgerService.getCreditLedger(studentId, user)

      // Slots 1 to 6 = 4+4+3+2+3+3 = 19 Core Credits
      // Slots 7 to 8 = 4+4 = 8 Additional Credits
      // Total Registered Credits = 27
      assert.strictEqual(ledger.coreCredits, 19)
      assert.strictEqual(ledger.additionalCredits, 8)
      assert.strictEqual(ledger.totalRegisteredCredits, 27)
      assert.strictEqual(ledger.totalCredits, 27)

      // Verified non-certification advisory labels
      assert.strictEqual(ledger.advisoryMatrixVersion, ADVISORY_MATRIX_VERSION)
      assert.strictEqual(ledger.disclaimer, ADVISORY_CREDIT_DISCLAIMER)
      assert.strictEqual(ledger.unresolvedRequirementNote, UNRESOLVED_REQUIREMENT_NOTE)
    })

    it('preserves registration-time credit snapshot in selections even if catalog credits change later', async () => {
      const studentId = 'student-snapshot'
      const mockStudents = new Map([
        [
          studentId,
          {
            id: studentId,
            full_name: 'Anu',
            cap_application_number: 'CAP1002',
            current_semester: 1,
            academic_year_joined: '2025-26',
            department_id: 'dept-cs',
            campus_id: 'camp-1',
          },
        ],
      ])

      // Catalog was subsequently modified to 2 credits
      const mockCourses = new Map([
        ['c1', { id: 'c1', course_code: 'KU01DSCMAT101', title: 'Math', credits: 2, category: 'DSC' }],
      ])

      // Registration recorded credits=4 snapshot at enrollment time
      const mockRegistrations = new Map([
        [
          'reg-snap',
          {
            id: 'reg-snap',
            student_id: studentId,
            semester: 1,
            academic_year: '2025-26',
            slot_1_course_id: 'c1',
            total_credits: 4,
            selections: [{ id: 'c1', credits: 4, slot: 1 }],
          },
        ],
      ])

      const mockSupabase = createMockSupabaseService({
        students: mockStudents,
        courses: mockCourses,
        registrations: mockRegistrations,
      })
      const creditLedgerService = new CreditLedgerService(mockSupabase)

      const user = { userId: studentId, role: 'student' }
      const ledger = await creditLedgerService.getCreditLedger(studentId, user)

      // Course should retain the registered snapshot value of 4 credits, not the rewritten 2
      const regCourse = ledger.registeredCourses.find((c) => c.id === 'c1')
      assert.ok(regCourse)
      assert.strictEqual(regCourse.credits, 4)
      assert.strictEqual(ledger.coreCredits, 4)
    })
  })

  describe('3. F52: Advisory Benchmark Comparisons & Unresolved Note', () => {
    it('reports benchmark status as advisory without claiming official graduation clearance', async () => {
      const studentId = 'student-advisory'
      const mockStudents = new Map([
        [
          studentId,
          {
            id: studentId,
            full_name: 'Rahul',
            cap_application_number: 'CAP1003',
            current_semester: 6,
            academic_year_joined: '2022-23',
            department_id: 'dept-cs',
            campus_id: 'camp-1',
          },
        ],
      ])

      const mockSupabase = createMockSupabaseService({
        students: mockStudents,
        courses: new Map(),
        registrations: new Map(),
      })
      const creditLedgerService = new CreditLedgerService(mockSupabase)

      const user = { userId: studentId, role: 'student' }
      const ledger = await creditLedgerService.getCreditLedger(studentId, user)

      assert.ok(ledger.exitEligibility.threeYear.statusNote)
      assert.match(ledger.exitEligibility.threeYear.statusNote, /Advisory assessment only/i)
      assert.strictEqual(ledger.exitEligibility.threeYear.targetCredits, 133)
      assert.strictEqual(ledger.exitEligibility.fourYear.targetCredits, 177)
    })
  })

  describe('4. Formula Injection Sanitization', () => {
    it('escapes dangerous spreadsheet formula prefixes with single quote', () => {
      assert.strictEqual(sanitizeSpreadsheetValue('=cmd|calc'), "'=cmd|calc")
      assert.strictEqual(sanitizeSpreadsheetValue('+SUM(A1:B1)'), "'+SUM(A1:B1)")
      assert.strictEqual(sanitizeSpreadsheetValue('-100'), "'-100")
      assert.strictEqual(sanitizeSpreadsheetValue('@admin'), "'@admin")
      assert.strictEqual(sanitizeSpreadsheetValue('\tTabLeading'), "'\tTabLeading")

      // Regular values remain untouched
      assert.strictEqual(sanitizeSpreadsheetValue('Calculus 101'), 'Calculus 101')
      assert.strictEqual(sanitizeSpreadsheetValue(42), 42)
      assert.strictEqual(sanitizeSpreadsheetValue(true), true)
      assert.strictEqual(sanitizeSpreadsheetValue(null), '')
    })
  })

  describe('5. Scoped Exports Implementation & Role Authorization', () => {
    it('exportFinalRegistrations returns all 8 papers and credit breakdown with correct role scoping', async () => {
      const mockStudents = new Map([
        [
          's1',
          {
            id: 's1',
            full_name: 'Amina',
            cap_application_number: 'CAP2001',
            department_id: 'dept-mat',
            campus_id: 'camp-1',
            departments: { id: 'dept-mat', name: 'Mathematics' },
            campuses: { id: 'camp-1', name: 'Main' },
          },
        ],
      ])

      const mockRegistrations = new Map([
        [
          'r1',
          {
            id: 'r1',
            student_id: 's1',
            semester: 2,
            academic_year: '2025-26',
            slot_1_course_id: 'c1',
            slot_7_course_id: 'c7',
            total_credits: 8,
            students: mockStudents.get('s1'),
          },
        ],
      ])

      const mockCourses = new Map([
        ['c1', { id: 'c1', course_code: 'KU02DSCMAT101', title: 'Calculus II', credits: 4 }],
        ['c7', { id: 'c7', course_code: 'KU02DSEMAT102', title: 'Elective 7', credits: 4 }],
      ])

      const mockSupabase = createMockSupabaseService({
        students: mockStudents,
        registrations: mockRegistrations,
        courses: mockCourses,
      })
      const creditLedgerService = new CreditLedgerService(mockSupabase)
      const exportService = new ExportService(mockSupabase, creditLedgerService)

      const hodUser = { userId: 'hod-1', role: 'hod', department_id: 'dept-mat', campus_id: 'camp-1' }
      const res = await exportService.exportFinalRegistrations({ semester: 2, format: 'json' }, hodUser)

      assert.strictEqual(res.count, 1)
      const row = res.data[0]
      assert.strictEqual(row['Student Name'], 'Amina')
      assert.strictEqual(row['Paper 1'], 'Calculus II (KU02DSCMAT101)')
      assert.strictEqual(row['Paper 7'], 'Elective 7 (KU02DSEMAT102)')
      assert.strictEqual(row['Core Credits'], 4)
      assert.strictEqual(row['Additional Credits'], 4)
    })

    it('exportUnresolvedAllocations blocks student and teaching_staff roles', async () => {
      const mockSupabase = createMockSupabaseService()
      const creditLedgerService = new CreditLedgerService(mockSupabase)
      const exportService = new ExportService(mockSupabase, creditLedgerService)

      const studentUser = { userId: 's1', role: 'student' }
      await assert.rejects(
        async () => {
          await exportService.exportUnresolvedAllocations({}, studentUser)
        },
        { name: 'ForbiddenException' },
      )

      const staffUser = { userId: 'ts1', role: 'teaching_staff' }
      await assert.rejects(
        async () => {
          await exportService.exportUnresolvedAllocations({}, staffUser)
        },
        { name: 'ForbiddenException' },
      )
    })

    it('exportTimetable marks draft entries with [DRAFT]', async () => {
      const mockEntries = new Map([
        [
          't1',
          {
            id: 't1',
            day_of_week: 1,
            period: 2,
            academic_year: '2025-26',
            semester: 1,
            status: 'draft',
            courses: { id: 'c1', course_code: 'KU01DSCMAT101', title: 'Calculus' },
            faculty: { id: 'f1', full_name: 'Dr. Euler' },
            departments: { id: 'd1', name: 'Mathematics', campus_id: 'camp-1', campuses: { name: 'Main' } },
          },
        ],
      ])

      const mockSupabase = createMockSupabaseService({ timetableEntries: mockEntries })
      const creditLedgerService = new CreditLedgerService(mockSupabase)
      const exportService = new ExportService(mockSupabase, creditLedgerService)

      const user = { userId: 'admin-1', role: 'superadmin' }
      const res = await exportService.exportTimetable({ format: 'json' }, user)

      assert.strictEqual(res.count, 1)
      assert.strictEqual(res.data[0]['Status'], '[DRAFT]')
    })

    it('exportGpsSignIns does not export raw coordinates by default', async () => {
      const mockSignIns = new Map([
        [
          'g1',
          {
            id: 'g1',
            campus_id: 'camp-1',
            sign_in_date: '2026-10-08',
            session_type: 'Morning',
            status: 'Verified',
            source: 'GPS Mobile App',
            created_at: '2026-10-08T09:15:00Z',
            campuses: { id: 'camp-1', name: 'Thalassery' },
            students: { id: 's1', full_name: 'Zayan', cap_application_number: 'CAP1001', departments: { name: 'CS' } },
          },
        ],
      ])

      const mockSupabase = createMockSupabaseService({ campusSignIns: mockSignIns })
      const creditLedgerService = new CreditLedgerService(mockSupabase)
      const exportService = new ExportService(mockSupabase, creditLedgerService)

      const dirUser = { userId: 'dir-1', role: 'campus_director', campus_id: 'camp-1' }
      const res = await exportService.exportGpsSignIns({ format: 'json' }, dirUser)

      assert.strictEqual(res.count, 1)
      const row = res.data[0]
      assert.strictEqual(row['Campus'], 'Thalassery')
      assert.strictEqual(row['Verification Source'], 'GPS Mobile App')
      assert.strictEqual(row['latitude'], undefined)
      assert.strictEqual(row['longitude'], undefined)
    })
  })

  describe('6. Migration Verification', () => {
    it('verifies Plan 09 migration file exists and contains additive schema changes', () => {
      const migrationPath = path.resolve(
        __dirname,
        '../../supabase/migrations/20261007060000_plan09_credit_ledger_and_scoped_exports.sql',
      )
      assert.ok(fs.existsSync(migrationPath), 'Migration file must exist')
      const content = fs.readFileSync(migrationPath, 'utf8')
      assert.match(content, /academic_level/)
      assert.match(content, /schema_migrations/)
      assert.match(content, /20261007060000_plan09_credit_ledger_and_scoped_exports/)
    })
  })
})
