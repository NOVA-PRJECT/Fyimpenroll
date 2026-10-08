import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common'
import * as ExcelJS from 'exceljs'
import * as Papa from 'papaparse'
import { SupabaseService } from '../../core/database/supabase.service'
import { AuthUser } from '../../core/auth/types'
import { CreditLedgerService } from './credit-ledger.service'
import {
  ADVISORY_MATRIX_VERSION,
  ADVISORY_CREDIT_DISCLAIMER,
  UNRESOLVED_REQUIREMENT_NOTE,
} from './credit-ledger.constants'

/**
 * Sanitizes cell values to prevent CSV and formula injection attacks (e.g. '=1+1', '@', '+', '-').
 */
export function sanitizeSpreadsheetValue(val: any): any {
  if (val === null || val === undefined) return ''
  if (typeof val === 'number' || typeof val === 'boolean') return val
  const str = String(val)
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`
  }
  return str
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name)

  constructor(
    private readonly supabase: SupabaseService,
    private readonly creditLedgerService: CreditLedgerService,
  ) {}

  // ──────────────── 1. Final Registrations Export ────────────────
  async exportFinalRegistrations(
    query: {
      semester?: number
      academic_year?: string
      campus_id?: string
      department_id?: string
      format?: 'csv' | 'xlsx' | 'json'
    },
    user: AuthUser,
  ) {
    let dbQuery = this.supabase.admin
      .from('student_registrations')
      .select(`
        id,
        semester,
        academic_year,
        slot_1_course_id,
        slot_2_course_id,
        slot_3_course_id,
        slot_4_course_id,
        slot_5_course_id,
        slot_6_course_id,
        slot_7_course_id,
        slot_8_course_id,
        total_credits,
        selections,
        pathway_id,
        created_at,
        students!inner (
          id,
          full_name,
          cap_application_number,
          campus_id,
          department_id,
          departments ( id, name, code ),
          campuses ( id, name )
        )
      `)

    // Role scoping
    if (user.role === 'student') {
      dbQuery = dbQuery.eq('student_id', user.userId)
    } else if (user.role === 'hod') {
      if (!user.department_id) throw new ForbiddenException('HOD has no department affiliation')
      dbQuery = dbQuery.eq('students.department_id', user.department_id)
      if (user.campus_id) dbQuery = dbQuery.eq('students.campus_id', user.campus_id)
    } else if (user.role === 'campus_director') {
      if (!user.campus_id) throw new ForbiddenException('Director has no campus affiliation')
      dbQuery = dbQuery.eq('students.campus_id', user.campus_id)
    } else if (user.role === 'teaching_staff') {
      throw new ForbiddenException('Teaching staff is roster-only and cannot export registrations')
    } else if (user.role === 'teacher') {
      if (!user.department_id) throw new ForbiddenException('Teacher has no department affiliation')
      dbQuery = dbQuery.eq('students.department_id', user.department_id)
    }

    if (query.semester) dbQuery = dbQuery.eq('semester', query.semester)
    if (query.academic_year) dbQuery = dbQuery.eq('academic_year', query.academic_year)
    if (query.campus_id && user.role === 'superadmin') dbQuery = dbQuery.eq('students.campus_id', query.campus_id)
    if (query.department_id && (user.role === 'superadmin' || user.role === 'campus_director')) {
      dbQuery = dbQuery.eq('students.department_id', query.department_id)
    }

    const { data: registrations, error } = await dbQuery
    if (error) {
      this.logger.error('Failed to export registrations', error.message)
      throw new InternalServerErrorException('Failed to retrieve registration records')
    }

    // Resolve course codes/titles and pathways
    const courseIds = new Set<string>()
    for (const r of registrations || []) {
      for (let i = 1; i <= 8; i++) {
        const cid = (r as any)[`slot_${i}_course_id`]
        if (cid) courseIds.add(cid)
      }
    }

    const courseMap = new Map<string, { title: string; code: string; credits: number }>()
    if (courseIds.size > 0) {
      const { data: courses } = await this.supabase.admin
        .from('courses')
        .select('id, title, course_code, credits')
        .in('id', Array.from(courseIds))
      for (const c of courses || []) {
        courseMap.set(c.id, { title: c.title, code: c.course_code, credits: Number(c.credits) || 0 })
      }
    }

    const rows = (registrations || []).map((r: any) => {
      const student = r.students
      const dept = student?.departments
      const campus = student?.campuses

      const papers: string[] = []
      let coreCredits = 0
      let additionalCredits = 0

      for (let i = 1; i <= 8; i++) {
        const cid = r[`slot_${i}_course_id`]
        if (cid && courseMap.has(cid)) {
          const info = courseMap.get(cid)!
          papers.push(`${info.title} (${info.code})`)
          if (i <= 6) coreCredits += info.credits
          else additionalCredits += info.credits
        } else {
          papers.push('')
        }
      }

      const totalCredits = Number(r.total_credits) || (coreCredits + additionalCredits)
      const allocationState = papers.filter(Boolean).length >= 6 ? 'Allocated' : 'Unresolved'

      return {
        'Academic Year': r.academic_year || '2025-26',
        'Semester': r.semester,
        'Campus': campus?.name || 'Main Campus',
        'Department': dept?.name || 'Department',
        'Student Name': student?.full_name || '—',
        'CAP App No': student?.cap_application_number || '—',
        'Paper 1': papers[0] || '',
        'Paper 2': papers[1] || '',
        'Paper 3': papers[2] || '',
        'Paper 4': papers[3] || '',
        'Paper 5': papers[4] || '',
        'Paper 6': papers[5] || '',
        'Paper 7': papers[6] || '',
        'Paper 8': papers[7] || '',
        'Core Credits': coreCredits,
        'Additional Credits': additionalCredits,
        'Total Credits': totalCredits,
        'Allocation State': allocationState,
      }
    })

    return this.renderOutput(rows, 'Final_Registrations', query.format)
  }

  // ──────────────── 2. Unresolved Allocation Export ────────────────
  async exportUnresolvedAllocations(
    query: {
      semester?: number
      academic_year?: string
      format?: 'csv' | 'xlsx' | 'json'
    },
    user: AuthUser,
  ) {
    if (user.role === 'student' || user.role === 'teaching_staff') {
      throw new ForbiddenException('Role not authorized to export unresolved allocations')
    }

    let dbQuery = this.supabase.admin
      .from('student_registrations')
      .select(`
        id,
        semester,
        academic_year,
        slot_1_course_id,
        slot_2_course_id,
        slot_3_course_id,
        slot_4_course_id,
        slot_5_course_id,
        slot_6_course_id,
        slot_7_course_id,
        slot_8_course_id,
        total_credits,
        selections,
        created_at,
        students!inner (
          id,
          full_name,
          cap_application_number,
          campus_id,
          department_id,
          departments ( id, name, code ),
          campuses ( id, name )
        )
      `)

    if (user.role === 'hod') {
      dbQuery = dbQuery.eq('students.department_id', user.department_id)
      if (user.campus_id) dbQuery = dbQuery.eq('students.campus_id', user.campus_id)
    } else if (user.role === 'campus_director') {
      dbQuery = dbQuery.eq('students.campus_id', user.campus_id)
    }

    if (query.semester) dbQuery = dbQuery.eq('semester', query.semester)
    if (query.academic_year) dbQuery = dbQuery.eq('academic_year', query.academic_year)

    const { data: registrations, error } = await dbQuery
    if (error) throw new InternalServerErrorException('Failed to retrieve allocation records')

    const unresolvedRows: any[] = []

    for (const r of registrations || []) {
      const missingRequired: string[] = []
      const missingAdditional: string[] = []

      for (let i = 1; i <= 6; i++) {
        if (!r[`slot_${i}_course_id`]) {
          missingRequired.push(`Slot ${i}`)
        }
      }
      for (let i = 7; i <= 8; i++) {
        if (!r[`slot_${i}_course_id`]) {
          missingAdditional.push(`Slot ${i}`)
        }
      }

      // If at least one required slot is missing, it's unresolved
      if (missingRequired.length > 0) {
        const student = r.students as any
        unresolvedRows.push({
          'Academic Year': r.academic_year || '2025-26',
          'Semester': r.semester,
          'Campus': student?.campuses?.name || 'Main Campus',
          'Department': student?.departments?.name || 'Department',
          'Student Name': student?.full_name || '—',
          'CAP App No': student?.cap_application_number || '—',
          'Missing Required Slots': missingRequired.join(', '),
          'Missing Additional Slots': missingAdditional.join(', ') || 'None',
          'First Submitted At': r.created_at || '—',
          'Operational Status': 'Awaiting Manual Allocation / Capacity Clearance',
        })
      }
    }

    return this.renderOutput(unresolvedRows, 'Unresolved_Allocations', query.format)
  }

  // ──────────────── 3. Campus-Class Roster Export ────────────────
  async exportCampusClassRoster(
    query: {
      course_id: string
      academic_year?: string
      semester?: number
      format?: 'csv' | 'xlsx' | 'json'
    },
    user: AuthUser,
  ) {
    if (!query.course_id) {
      throw new NotFoundException('Course ID is required for class roster export')
    }

    // Fetch course
    const { data: course, error: cErr } = await this.supabase.admin
      .from('courses')
      .select('id, course_code, title, semester, department_id, departments ( id, name )')
      .eq('id', query.course_id)
      .single()

    if (cErr || !course) throw new NotFoundException('Course not found')

    // Scoping check
    if (user.role === 'hod' && user.department_id !== course.department_id) {
      throw new ForbiddenException('HODs may only export rosters for their department courses')
    }

    // Fetch enrolled students
    const filterConditions = Array.from({ length: 8 }, (_, i) => `slot_${i + 1}_course_id.eq.${query.course_id}`).join(',')
    let regQuery = this.supabase.admin
      .from('student_registrations')
      .select(`
        id,
        semester,
        academic_year,
        slot_1_course_id,
        slot_2_course_id,
        slot_3_course_id,
        slot_4_course_id,
        slot_5_course_id,
        slot_6_course_id,
        slot_7_course_id,
        slot_8_course_id,
        students!inner (
          id,
          full_name,
          cap_application_number,
          campus_id,
          departments ( id, name ),
          campuses ( id, name )
        )
      `)
      .or(filterConditions)

    if (query.academic_year) regQuery = regQuery.eq('academic_year', query.academic_year)
    if (query.semester) regQuery = regQuery.eq('semester', query.semester)
    if (user.campus_id && user.role !== 'superadmin') {
      regQuery = regQuery.eq('students.campus_id', user.campus_id)
    }

    const { data: registrations, error: regError } = await regQuery
    if (regError) throw new InternalServerErrorException('Failed to retrieve class roster')

    // Find assigned teacher if available
    const { data: assignment } = await this.supabase.admin
      .from('teacher_course_assignments')
      .select('faculty!inner ( id, full_name )')
      .eq('course_id', query.course_id)
      .maybeSingle()

    const assignedTeacherName = (assignment?.faculty as any)?.full_name || 'Unassigned'

    const rows = (registrations || []).map((r: any) => {
      const student = r.students
      let enrollmentType = 'Core'
      for (let i = 7; i <= 8; i++) {
        if (r[`slot_${i}_course_id`] === query.course_id) {
          enrollmentType = 'Additional / Elective'
          break
        }
      }

      return {
        'Course Code': course.course_code,
        'Course Title': course.title,
        'Academic Year': r.academic_year || '2025-26',
        'Semester': r.semester,
        'Campus': student?.campuses?.name || 'Main Campus',
        'CAP App No': student?.cap_application_number || '—',
        'Student Name': student?.full_name || '—',
        'Home Department': student?.departments?.name || 'Department',
        'Enrollment Type': enrollmentType,
        'Assigned Teacher': assignedTeacherName,
      }
    })

    return this.renderOutput(rows, `Class_Roster_${course.course_code}`, query.format)
  }

  // ──────────────── 4. Timetable Export ────────────────
  async exportTimetable(
    query: {
      campus_id?: string
      academic_year?: string
      semester?: number
      department_id?: string
      format?: 'csv' | 'xlsx' | 'json'
    },
    user: AuthUser,
  ) {
    const campusId = query.campus_id || user.campus_id
    if (!campusId && user.role !== 'superadmin') {
      throw new ForbiddenException('Campus affiliation required')
    }

    let dbQuery = this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        day_of_week,
        period,
        academic_year,
        semester,
        status,
        courses ( id, course_code, title ),
        faculty ( id, full_name ),
        departments ( id, name, campus_id, campuses ( id, name ) )
      `)

    if (campusId) dbQuery = dbQuery.eq('departments.campus_id', campusId)
    if (query.semester) dbQuery = dbQuery.eq('semester', query.semester)
    if (query.academic_year) dbQuery = dbQuery.eq('academic_year', query.academic_year)
    if (query.department_id) dbQuery = dbQuery.eq('department_id', query.department_id)

    const { data: entries, error } = await dbQuery
    if (error) throw new InternalServerErrorException('Failed to retrieve timetable entries')

    const dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

    const rows = (entries || []).map((e: any) => {
      const isDraft = e.status !== 'published'
      return {
        'Campus': e.departments?.campuses?.name || 'Campus',
        'Department': e.departments?.name || 'Department',
        'Academic Year': e.academic_year || '2025-26',
        'Semester': e.semester,
        'Day': dayNames[e.day_of_week] || `Day ${e.day_of_week}`,
        'Period': `Period ${e.period}`,
        'Course Code': e.courses?.course_code || '—',
        'Course Title': e.courses?.title || '—',
        'Assigned Teacher': e.faculty?.full_name || 'Unassigned',
        'Status': isDraft ? '[DRAFT]' : 'Published',
      }
    })

    return this.renderOutput(rows, 'Timetable_Schedule', query.format)
  }

  // ──────────────── 5. Period Attendance Export ────────────────
  async exportPeriodAttendance(
    query: {
      semester?: number
      academic_year?: string
      course_id?: string
      start_date?: string
      end_date?: string
      format?: 'csv' | 'xlsx' | 'json'
    },
    user: AuthUser,
  ) {
    let dbQuery = this.supabase.admin
      .from('period_attendance')
      .select(`
        id,
        attendance_date,
        status,
        marked_at,
        students!inner ( id, full_name, cap_application_number, department_id, campus_id ),
        timetable_entries!inner (
          id,
          period,
          day_of_week,
          semester,
          academic_year,
          course_id,
          courses ( id, course_code, title ),
          departments ( id, name, campus_id )
        )
      `)

    // Role scoping
    if (user.role === 'hod') {
      dbQuery = dbQuery.eq('students.department_id', user.department_id)
      if (user.campus_id) dbQuery = dbQuery.eq('students.campus_id', user.campus_id)
    } else if (user.role === 'campus_director') {
      dbQuery = dbQuery.eq('students.campus_id', user.campus_id)
    }

    if (query.semester) dbQuery = dbQuery.eq('timetable_entries.semester', query.semester)
    if (query.academic_year) dbQuery = dbQuery.eq('timetable_entries.academic_year', query.academic_year)
    if (query.course_id) dbQuery = dbQuery.eq('timetable_entries.course_id', query.course_id)
    if (query.start_date) dbQuery = dbQuery.gte('attendance_date', query.start_date)
    if (query.end_date) dbQuery = dbQuery.lte('attendance_date', query.end_date)

    const { data: marks, error } = await dbQuery
    if (error) throw new InternalServerErrorException('Failed to retrieve period attendance records')

    // Aggregate by session (course_id, attendance_date, period)
    const sessionMap = new Map<string, {
      date: string
      courseCode: string
      courseTitle: string
      period: number
      enrolled: number
      present: number
      absent: number
      asOf: string
    }>()

    for (const m of marks || []) {
      const te = m.timetable_entries as any
      const c = te?.courses
      const key = `${c?.course_code}_${m.attendance_date}_${te?.period}`

      if (!sessionMap.has(key)) {
        sessionMap.set(key, {
          date: m.attendance_date,
          courseCode: c?.course_code || '—',
          courseTitle: c?.title || '—',
          period: te?.period || 1,
          enrolled: 0,
          present: 0,
          absent: 0,
          asOf: m.marked_at || new Date().toISOString(),
        })
      }

      const sess = sessionMap.get(key)!
      sess.enrolled += 1
      if (m.status === 'present') sess.present += 1
      else if (m.status === 'absent') sess.absent += 1
    }

    const rows = Array.from(sessionMap.values()).map((s) => ({
      'Date': s.date,
      'Course Code': s.courseCode,
      'Course Title': s.courseTitle,
      'Period': `P${s.period}`,
      'Total Marked': s.enrolled,
      'Present Count': s.present,
      'Absent Count': s.absent,
      'Session Percentage': s.enrolled > 0 ? `${Math.round((s.present / s.enrolled) * 100)}%` : '0%',
      'Denominator (Hours)': 1, // Plan 07 counts copied 2-hour practicals as two distinct period entries
      'As of Date': s.asOf.split('T')[0],
    }))

    return this.renderOutput(rows, 'Period_Attendance_Summary', query.format)
  }

  // ──────────────── 6. GPS Sign-ins Export ────────────────
  async exportGpsSignIns(
    query: {
      campus_id?: string
      date?: string
      start_date?: string
      end_date?: string
      format?: 'csv' | 'xlsx' | 'json'
    },
    user: AuthUser,
  ) {
    const campusId = query.campus_id || user.campus_id
    if (!campusId && user.role !== 'superadmin') {
      throw new ForbiddenException('Campus affiliation required')
    }

    if (user.role === 'campus_director' && user.campus_id !== campusId) {
      throw new ForbiddenException('Directors can only export GPS sign-ins for their own campus')
    }

    let dbQuery = this.supabase.admin
      .from('campus_sign_ins')
      .select(`
        id,
        sign_in_date,
        session_type,
        status,
        source,
        created_at,
        campuses ( id, name ),
        students ( id, full_name, cap_application_number, departments ( id, name ) )
      `)

    if (campusId) dbQuery = dbQuery.eq('campus_id', campusId)
    if (query.date) dbQuery = dbQuery.eq('sign_in_date', query.date)
    if (query.start_date) dbQuery = dbQuery.gte('sign_in_date', query.start_date)
    if (query.end_date) dbQuery = dbQuery.lte('sign_in_date', query.end_date)

    const { data: signIns, error } = await dbQuery
    if (error) throw new InternalServerErrorException('Failed to retrieve GPS sign-in records')

    // Notice: Never exports raw latitude/longitude coordinates to protect student location privacy
    const rows = (signIns || []).map((s: any) => ({
      'Campus': s.campuses?.name || 'Campus',
      'Sign-in Date': s.sign_in_date,
      'Student Name': s.students?.full_name || '—',
      'CAP App No': s.students?.cap_application_number || '—',
      'Department': s.students?.departments?.name || 'Department',
      'Session': s.session_type || 'Morning',
      'Status': s.status || 'Verified',
      'Verification Source': s.source || 'GPS Mobile App',
      'Recorded At': s.created_at ? s.created_at.split('T')[1].substring(0, 8) : '—',
    }))

    return this.renderOutput(rows, 'GPS_Campus_Sign_Ins', query.format)
  }

  // ──────────────── 7. Registered-Credit Ledger Export ────────────────
  async exportCreditLedger(
    targetStudentId: string,
    user: AuthUser,
    format?: 'csv' | 'xlsx' | 'json',
  ) {
    const ledger = await this.creditLedgerService.getCreditLedger(targetStudentId, user)

    const rows = ledger.registeredCourses.map((c) => ({
      'Student Name': ledger.student.fullName,
      'CAP App No': ledger.student.capApplicationNumber,
      'Department': ledger.student.departmentName,
      'Semester': c.semester,
      'Course Code': c.courseCode,
      'Course Title': c.title,
      'Category': c.normalizedCategory,
      'Academic Level': c.levelBand,
      'Type': c.isAdditional ? 'Additional / Elective' : 'Core',
      'Registered Credits': c.credits,
      'Advisory Status': 'Registered (Advisory)',
    }))

    return this.renderOutput(
      rows,
      `Credit_Ledger_${ledger.student.capApplicationNumber || targetStudentId}`,
      format,
      {
        totalRegisteredCredits: ledger.totalRegisteredCredits,
        coreCredits: ledger.coreCredits,
        additionalCredits: ledger.additionalCredits,
        advisoryMatrixVersion: ledger.advisoryMatrixVersion,
        disclaimer: ledger.disclaimer,
      },
    )
  }

  // ──────────────── Output Rendering (CSV, XLSX, JSON) ────────────────
  private async renderOutput(
    rows: Record<string, any>[],
    filenamePrefix: string,
    format?: 'csv' | 'xlsx' | 'json',
    metadata?: Record<string, any>,
  ) {
    if (!format || format === 'json') {
      return { data: rows, count: rows.length, metadata }
    }

    if (format === 'csv') {
      // Sanitize all values against spreadsheet injection
      const sanitizedRows = rows.map((row) => {
        const sanitized: Record<string, any> = {}
        for (const [k, v] of Object.entries(row)) {
          sanitized[k] = sanitizeSpreadsheetValue(v)
        }
        return sanitized
      })

      const csv = Papa.unparse(sanitizedRows)
      return {
        buffer: Buffer.from(csv, 'utf-8'),
        filename: `${filenamePrefix}_${Date.now()}.csv`,
        contentType: 'text/csv; charset=utf-8',
      }
    }

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook()
      workbook.creator = 'FYIMP Academic Assistance Portal'
      workbook.created = new Date()

      const worksheet = workbook.addWorksheet(filenamePrefix.substring(0, 31), {
        views: [{ showGridLines: true }],
      })

      if (rows.length > 0) {
        const headers = Object.keys(rows[0])
        const headerRow = worksheet.addRow(headers)
        headerRow.height = 24
        headerRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1E3A8A' }, // Navy blue
          }
          cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
          cell.alignment = { vertical: 'middle', horizontal: 'center' }
        })

        for (const r of rows) {
          const values = headers.map((h) => sanitizeSpreadsheetValue(r[h]))
          const row = worksheet.addRow(values)
          row.eachCell((cell) => {
            cell.font = { name: 'Arial', size: 9.5 }
            cell.alignment = { vertical: 'middle' }
          })
        }

        // Auto column widths
        worksheet.columns.forEach((col: any) => {
          let maxLen = 12
          col.eachCell?.({ includeEmpty: true }, (cell: any) => {
            const val = cell.value ? String(cell.value) : ''
            maxLen = Math.max(maxLen, Math.min(val.length + 3, 50))
          })
          col.width = maxLen
        })
      }

      const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
      return {
        buffer,
        filename: `${filenamePrefix}_${Date.now()}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }
    }

    return { data: rows, count: rows.length, metadata }
  }
}
