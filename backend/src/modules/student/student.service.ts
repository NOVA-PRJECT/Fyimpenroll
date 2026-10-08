import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { SupabaseService } from '../../core/database/supabase.service'
import { AuditLoggerService } from '../../core/logging/audit-logger.service'
import { ServerLoggerService } from '../../core/logging/server-logger.service'
import { AuthUser } from '../../core/auth/types'

@Injectable()
export class StudentService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService,
    private readonly serverLogger: ServerLoggerService,
  ) {}

  async getDashboardSummary(user: AuthUser) {
    const { data: student, error } = await this.supabase.admin
      .from('students')
      .select(`
        campus_id,
        department_id,
        full_name,
        current_semester,
        academic_year_joined,
        must_change_password,
        departments (name),
        campuses (name)
      `)
      .eq('id', user.userId)
      .single()

    if (error || !student) {
      throw new NotFoundException('Student record not found')
    }

    const effectiveCampusId = student.campus_id || user.campus_id

    const { data: settings } = effectiveCampusId
      ? await this.supabase.admin
          .from('campus_settings')
          .select('deadline, min_credits, max_credits, academic_year')
          .eq('campus_id', effectiveCampusId)
          .maybeSingle()
      : { data: null }

    const academicYear = settings?.academic_year || null

    let regQuery = this.supabase.admin
      .from('student_registrations')
      .select(`
        id,
        total_credits,
        slot_1_course_id,
        slot_2_course_id,
        slot_3_course_id,
        slot_4_course_id,
        slot_5_course_id,
        slot_6_course_id,
        slot_7_course_id,
        slot_8_course_id,
        allocation_metadata,
        selections
      `)
      .eq('student_id', user.userId)
      .eq('semester', student.current_semester)

    if (academicYear) {
      regQuery = regQuery.eq('academic_year', academicYear)
    }

    let prefQuery = this.supabase.admin
      .from('registration_preferences')
      .select('id, preferences, allocation_metadata, submitted_at')
      .eq('student_id', user.userId)
      .eq('semester', student.current_semester)

    if (academicYear) {
      prefQuery = prefQuery.eq('academic_year', academicYear)
    }

    let allocRunPromise: Promise<any> = Promise.resolve({ data: null, error: null })
    if (effectiveCampusId) {
      let allocQuery = this.supabase.admin
        .from('allocation_runs')
        .select('id, status, completed_at')
        .eq('campus_id', effectiveCampusId)
        .eq('semester', student.current_semester)
        .eq('status', 'completed')
      if (academicYear) {
        allocQuery = allocQuery.eq('academic_year', academicYear)
      }
      allocRunPromise = Promise.resolve(
        allocQuery
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      )
    }

    const [regResWith8, prefRes, allocRunRes] = await Promise.all([
      regQuery.maybeSingle(),
      prefQuery.maybeSingle(),
      allocRunPromise,
    ])

    let reg: any = regResWith8.data
    if (regResWith8.error && (regResWith8.error.message?.includes('slot_7_course_id') || regResWith8.error.message?.includes('slot_8_course_id'))) {
      let fallbackQuery = this.supabase.admin
        .from('student_registrations')
        .select(`
          id,
          total_credits,
          slot_1_course_id,
          slot_2_course_id,
          slot_3_course_id,
          slot_4_course_id,
          slot_5_course_id,
          slot_6_course_id,
          allocation_metadata,
          selections
        `)
        .eq('student_id', user.userId)
        .eq('semester', student.current_semester)

      if (academicYear) {
        fallbackQuery = fallbackQuery.eq('academic_year', academicYear)
      }
      const { data: fallbackReg } = await fallbackQuery.maybeSingle()
      reg = fallbackReg
    }

    const pref = prefRes.data
    const allocationCompleted = !!allocRunRes?.data
    const hasRegistration =
      !!reg &&
      [1, 2, 3, 4, 5, 6, 7, 8].some((s) => !!(reg as any)[`slot_${s}_course_id`])

    const deadline = settings?.deadline ? new Date(settings.deadline) : null
    const now = new Date()
    const isOpen = deadline ? now < deadline : false
    const msRemaining = deadline && isOpen ? deadline.getTime() - now.getTime() : null
    const hoursRemaining = msRemaining !== null ? Math.max(0, Math.floor(msRemaining / (1000 * 60 * 60))) : null
    const isClosingSoon = isOpen && hoursRemaining !== null && hoursRemaining <= 24

    const registrationWindow = {
      isOpen,
      deadline: settings?.deadline || null,
      isClosingSoon,
      hoursRemaining,
      academicYear: settings?.academic_year || null,
      minCredits: settings?.min_credits ?? 20,
      maxCredits: settings?.max_credits ?? 24,
    }

    const studentInfo = {
      id: user.userId,
      full_name: student.full_name ?? '',
      current_semester: student.current_semester ?? 1,
      academic_year_joined: student.academic_year_joined ?? '—',
      department_name: (student.departments as any)?.name ?? 'Unknown',
      campus_name: (student.campuses as any)?.name ?? 'Unknown',
    }

    // Resolve enrolled / allocated courses
    const enrolledCourses: any[] = []
    let totalRegisteredCredits = 0

    if (reg || pref) {
      const courseIdsToFetch = new Set<string>()
      const slotCourseMap = new Map<number, { courseId: string; status: string; isConfirmed: boolean }>()

      const meta = {
        ...(typeof pref?.allocation_metadata === 'object' && pref?.allocation_metadata ? pref.allocation_metadata : {}),
        ...(typeof reg?.allocation_metadata === 'object' && reg?.allocation_metadata ? reg.allocation_metadata : {}),
      }

      // Reconstruct preferences map
      const prefs: Record<string, { course_id: string; rank: number }[]> = {}
      if (pref?.preferences) {
        if (Array.isArray(pref.preferences)) {
          for (const item of pref.preferences) {
            prefs[`slot_${item.slot}`] = item.choices || []
          }
        } else if (typeof pref.preferences === 'object') {
          Object.assign(prefs, pref.preferences)
        }
      }

      for (let s = 1; s <= 8; s++) {
        const slotKey = `slot_${s}`
        const cid = (reg as any)?.[`${slotKey}_course_id`]
        const slotMeta = meta[slotKey]
        const slotPrefs = prefs[slotKey]

        if (cid) {
          courseIdsToFetch.add(cid)
          let statusText = 'Confirmed Enrolled'
          if (slotMeta?.allocated_by === 'fixed') statusText = 'Core Fixed'
          else if (slotMeta?.allocated_by?.startsWith('rank_')) statusText = `Allocated by Algorithm (${slotMeta.allocated_by.replace('_', ' ')})`
          else if (slotMeta?.allocated_by === 'algorithm') statusText = 'Allocated by Algorithm'
          else if (slotMeta?.allocated_by === 'hod') statusText = 'Allocated by HOD'

          slotCourseMap.set(s, { courseId: cid, status: statusText, isConfirmed: true })
        } else if (Array.isArray(slotPrefs) && slotPrefs.length > 0) {
          const rank1Id = slotPrefs.find((p: any) => p.rank === 1)?.course_id
          if (rank1Id) {
            courseIdsToFetch.add(rank1Id)
            const isUnallocated = slotMeta?.allocated_by === 'unallocated'
            const statusText = isUnallocated
              ? 'Unallocated (Pending HOD Resolution)'
              : 'Preference Choice 1 (Pending)'
            slotCourseMap.set(s, { courseId: rank1Id, status: statusText, isConfirmed: false })
          }
        }
      }

      // If flat slots were empty, check selections JSONB
      if (courseIdsToFetch.size === 0 && (reg as any)?.selections) {
        const rawSel = (reg as any).selections
        const list = Array.isArray(rawSel) ? rawSel : Array.isArray(rawSel?.courses) ? rawSel.courses : []
        let idx = 1
        for (const item of list) {
          const cid = typeof item === 'string' ? item : item?.id || item?.course_id
          if (cid) {
            courseIdsToFetch.add(cid)
            slotCourseMap.set(idx, { courseId: cid, status: 'Enrolled Paper', isConfirmed: true })
            idx++
          }
        }
      }

      if (courseIdsToFetch.size > 0) {
        const { data: courses } = await this.supabase.admin
          .from('courses')
          .select(`
            id,
            course_code,
            title,
            credits,
            category,
            department_id,
            departments ( name )
          `)
          .in('id', Array.from(courseIdsToFetch))

        const courseDetailsMap = new Map((courses || []).map((c: any) => [c.id, c]))

        for (const [slotNum, slotInfo] of slotCourseMap.entries()) {
          const c = courseDetailsMap.get(slotInfo.courseId)
          if (c) {
            const cr = Number(c.credits) || 0
            totalRegisteredCredits += cr
            enrolledCourses.push({
              slotNumber: slotNum,
              id: c.id,
              courseCode: c.course_code,
              title: c.title,
              credits: cr,
              category: c.category || 'General',
              departmentName: (c.departments as any)?.name || 'General',
              status: slotInfo.status,
              isConfirmed: slotInfo.isConfirmed,
            })
          }
        }

        enrolledCourses.sort((a, b) => a.slotNumber - b.slotNumber)
      }
    }

    return {
      studentInfo,
      hasSubmission: !!reg || !!pref,
      hasRegistration,
      allocationCompleted,
      must_change_password: student.must_change_password,
      enrolledCourses,
      totalRegisteredCredits: totalRegisteredCredits || (reg ? Number(reg.total_credits) || 0 : 0),
      registrationWindow,
    }
  }

  async changePassword(currentPassword: string, newPassword: string, user: AuthUser) {
    // 1. Verify current password
    const verifyAuthClient = this.supabase.createAuthClient()
    const { error: verifyError } = await verifyAuthClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })

    if (verifyError) {
      throw new BadRequestException('Current password is incorrect')
    }

    // 2. Update to new password
    const { error: pwError } = await this.supabase.admin.auth.admin.updateUserById(
      user.userId,
      {
        password: newPassword,
        app_metadata: {
          role: 'student',
          department_id: user.department_id,
          campus_id: user.campus_id,
          must_change_password: false,
        },
      },
    )

    if (pwError) {
      throw new InternalServerErrorException('Failed to update password')
    }

    const { error: flagError } = await this.supabase.admin
      .from('students')
      .update({ must_change_password: false })
      .eq('id', user.userId)

    if (flagError) {
      return {
        success: false,
        code: 'SYNC_FAILED',
        message: 'Password was updated in auth system, but student profile synchronization failed. Please retry synchronization.',
        canRetrySync: true,
      }
    }

    // Sign in to get fresh session tokens
    const refreshAuthClient = this.supabase.createAuthClient()
    const { data: signInData } = await refreshAuthClient.auth.signInWithPassword({
      email: user.email,
      password: newPassword,
    })

    const freshToken = signInData?.session?.access_token
    const freshRefreshToken = signInData?.session?.refresh_token

    return {
      success: true,
      token: freshToken,
      refreshToken: freshRefreshToken,
      message: 'Password changed successfully',
    }
  }
}
