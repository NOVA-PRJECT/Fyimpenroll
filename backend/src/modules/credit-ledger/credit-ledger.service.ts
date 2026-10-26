import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { SupabaseService } from '../../core/database/supabase.service'
import { AuthUser } from '../../core/auth/types'
import { fetchAllPaginated } from '../../core/database/pagination.util'
import { LevelBandKey, parseKuCourseCode, CANONICAL_CATEGORIES, ADVISORY_CREDIT_DISCLAIMER, UNRESOLVED_REQUIREMENT_NOTE } from './credit-ledger.constants'
import { registrationSlots } from './enrollment-reporting'
export { LevelBandKey }

export interface RegisteredCourseItem {
  id: string; courseCode: string; title: string; credits: number; category: string
  normalizedCategory: string; levelBand: LevelBandKey
  departmentId: string; departmentName: string; semester: number; academicYear: string
  creditSource: 'registration_snapshot' | 'current_catalogue_missing_snapshot'
}

@Injectable()
export class CreditLedgerService {
  constructor(private readonly supabase: SupabaseService) {}
  deriveLevelBand(code: string, explicitLevel?: string | null): LevelBandKey {
    return parseKuCourseCode(code, explicitLevel).derivedLevelBand
  }
  normalizeCategory(raw: string, code?: string, _title?: string): string {
    const category = (raw || '').trim().toUpperCase()
    return CANONICAL_CATEGORIES.includes(category as any) ? category : parseKuCourseCode(code || '').category || category || 'Other'
  }
  async getCreditLedger(targetStudentId: string, user: AuthUser) {
    if (user.role === 'teaching_staff') throw new ForbiddenException('Teaching staff is roster-only and not authorized to access student credit ledgers')
    if (user.role === 'hod' && !user.department_id) throw new ForbiddenException('HOD has no department affiliation')
    if (user.role === 'teacher' && !user.department_id) throw new ForbiddenException('Teacher has no department affiliation')
    const { data: student, error } = await this.supabase.admin.from('students')
      .select('id, full_name, cap_application_number, current_semester, academic_year_joined, department_id, campus_id, departments(id,name,code), campuses(id,name)')
      .eq('id', targetStudentId).single()
    if (error || !student) throw new NotFoundException('Student not found')
    if (user.role === 'student' && user.userId !== targetStudentId) throw new ForbiddenException('Students may only view their own ledger')
    if (user.role === 'hod' && (!user.department_id || !user.campus_id || user.department_id !== student.department_id || user.campus_id !== student.campus_id)) throw new ForbiddenException('Ledger outside HOD scope')
    if (user.role === 'campus_director' && (!user.campus_id || user.campus_id !== student.campus_id)) throw new ForbiddenException('Ledger outside campus scope')
    if (!['student','hod','campus_director','superadmin','teacher'].includes(user.role)) throw new ForbiddenException('Role cannot access credit ledgers')
    const registrations = await fetchAllPaginated<any>(this.supabase.admin.from('student_registrations')
      .select('*').eq('student_id', targetStudentId).order('id'))
    let deliveries: any[] | null = null
    if (user.role === 'teacher') {
      if (!user.campus_id) throw new ForbiddenException('Teacher has no campus affiliation')
      deliveries = await fetchAllPaginated<any>(this.supabase.admin.from('teacher_course_assignments')
        .select('id, course_id, campus_id, academic_year, semester, term_version').eq('teacher_id', user.userId).eq('campus_id', student.campus_id).order('id'))
    }
    const enrollments = registrations.flatMap(reg => registrationSlots(reg).map(slot => ({ ...slot, reg })))
      .filter(item => deliveries === null || deliveries.some(d => d.course_id === item.courseId && d.semester === item.reg.semester && d.academic_year === item.reg.academic_year && d.term_version === item.reg.term_version))
    if (deliveries !== null && !enrollments.length) throw new ForbiddenException('No assigned class enrollment for this student')
    const ids = [...new Set(enrollments.map(item => item.courseId))]
    const courses = ids.length ? await fetchAllPaginated<any>(this.supabase.admin.from('courses')
      .select('id, course_code, title, credits, category, academic_level, department_id, departments(id,name)').in('id', ids).order('id')) : []
    const courseMap = new Map(courses.map(c => [c.id, c]))
    const registeredCourses: RegisteredCourseItem[] = enrollments.map(({ courseId, slot, reg }) => {
      const c = courseMap.get(courseId) || { id: courseId }
      const selections = Array.isArray(reg.selections) ? reg.selections : reg.selections?.courses || []
      const snapshot = selections.find((s: any) => (s.course_id || s.id) === courseId && (s.slot == null || Number(s.slot) === slot))
      const hasSnapshot = snapshot?.credits != null && Number.isFinite(Number(snapshot.credits))
      const category = snapshot?.category ?? c.category ?? 'Other'
      return { id: courseId!, courseCode: c.course_code || 'Unavailable', title: c.title || 'Unavailable',
        credits: hasSnapshot ? Number(snapshot.credits) : Number(c.credits) || 0,
        creditSource: hasSnapshot ? 'registration_snapshot' : 'current_catalogue_missing_snapshot',
        category, normalizedCategory: this.normalizeCategory(category, c.course_code),
        levelBand: this.deriveLevelBand(c.course_code, hasSnapshot ? snapshot.academic_level : c.academic_level),
        departmentId: c.department_id, departmentName: c.departments?.name || 'Unknown',
        semester: reg.semester, academicYear: reg.academic_year }
    })
    const totalCredits = registeredCourses.reduce((sum, course) => sum + course.credits, 0)
    const categories = [...new Set([...CANONICAL_CATEGORIES,...registeredCourses.map(c => c.normalizedCategory)])].map(category => {
      const registered = registeredCourses.filter(c => c.normalizedCategory === category).reduce((a,c) => a+c.credits,0)
      return { category, title: category, registeredCredits: registered, earned: registered,
        min3Year: null, min4Year: null, shortfall3Year: null, shortfall4Year: null, isMet3Year: null, isMet4Year: null, advisoryStatus: 'policy_pending' }
    })
    const levelBands = [...new Set(registeredCourses.map(c => c.levelBand))].map(band => {
      const registered = registeredCourses.filter(c => c.levelBand === band).reduce((a,c) => a+c.credits,0)
      return { band, title: band, registeredCredits: registered, earned: registered, minimum: null, shortfall: null, isMet: null, advisoryStatus: 'policy_pending' }
    })
    const byDepartment = [...new Set(registeredCourses.map(c => c.departmentId))].map(departmentId => {
      const items = registeredCourses.filter(c => c.departmentId === departmentId)
      return { departmentId, departmentName: items[0].departmentName, earned: items.reduce((a,c) => a+c.credits,0), count: items.length }
    })
    const pending = (title: string) => ({ title, eligible: null, advisoryEligible: null, totalCredits,
      registeredCredits: totalCredits, requiredCredits: null, targetCredits: null, totalShortfall: null,
      unmetCategories: [], unmetBands: [], primaryShortfall: 'Unavailable: approved degree matrix pending', statusNote: UNRESOLVED_REQUIREMENT_NOTE })
    return {
      student: { id: student.id, fullName: student.full_name, capApplicationNumber: student.cap_application_number,
        currentSemester: student.current_semester, academicYearJoined: student.academic_year_joined,
        departmentName: (student.departments as any)?.name || 'Unknown', departmentCode: (student.departments as any)?.code || '', campusName: (student.campuses as any)?.name || 'Unknown' },
      advisoryMatrixVersion: null, requirementsAvailable: false, disclaimer: ADVISORY_CREDIT_DISCLAIMER,
      unresolvedRequirementNote: UNRESOLVED_REQUIREMENT_NOTE, totalCredits, totalRegisteredCredits: totalCredits,
      historicalSnapshotsComplete: registeredCourses.every(c => c.creditSource === 'registration_snapshot'),
      categories, levelBands, byDepartment,
      exitEligibility: { threeYear: pending('3-Year UG'), fourYear: pending('4-Year Honours'), fiveYear: pending('5-Year Integrated PG') }, registeredCourses,
    }
  }
}
