import { enrollmentCounts } from '../../core/database/enrollment-counts'
import { termOperation } from '../../core/database/term-operation'
import { fetchAllPaginated } from '../../core/database/pagination.util'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { SupabaseService } from '../../core/database/supabase.service'
import { AuditLoggerService, AuditEvents } from '../../core/logging/audit-logger.service'
import { AuthUser } from '../../core/auth/types'
import { SLOT_RULES } from '../../core/constants/courseCategories'
import { Pathway, PathwaySlot } from '../../core/types/course.types'
import {
  isCourseEligibleForSlot,
  getStudentSlotDefinition,
  getBlueprintPathways,
  normalizeCourseCode,
  validatePathwaySlots,
} from '../../core/utils/slotRules'

@Injectable()
export class RegistrationsService {
  private readonly logger = new Logger(RegistrationsService.name)

  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService,
  ) {}

  async resolvePathwaySlots(
    pathway: Pathway,
    user: AuthUser,
    deptMap: Map<string, string>,
    deptIdToName: Map<string, string>,
    requestedSlot?: number,
  ) {
    const slotsInfo = pathway.slots
      .map((s: PathwaySlot, i: number) => ({
        slot: i + 1,
        rule: s.rule,
        target: s.target,
        name: s.name ?? `Paper ${i + 1}`,
      }))
      .filter((s) => s.rule && s.target)

    if (slotsInfo.length === 0) {
      throw new BadRequestException('Pathway has no configured course slots')
    }

    const fixedTargets: string[] = []
    slotsInfo.forEach((s) => {
      if (
        s.rule === SLOT_RULES.FIXED ||
        s.rule === SLOT_RULES.AEC_ELECT ||
        s.rule === SLOT_RULES.CAMPUS_FIXED
      ) {
        if (s.target) {
          const norm = normalizeCourseCode(s.target)
          fixedTargets.push(norm)
          if (s.target.trim() !== norm) {
            fixedTargets.push(s.target.trim())
          }
        }
      }
    })

    let fixedCourseIds: string[] = []
    let fixedCoursesMap: Record<string, any> = {}

    if (fixedTargets.length > 0) {
      const { data: fixedCourses } = await this.supabase.admin
        .from('courses')
        .select('id, course_code, title, department_id, semester, credits, category, prerequisites')
        .in('course_code', fixedTargets)

      if (fixedCourses) {
        fixedCourseIds = fixedCourses.map((c) => c.id)
        for (const c of fixedCourses) {
          fixedCoursesMap[c.course_code] = c
          fixedCoursesMap[normalizeCourseCode(c.course_code)] = c
        }
      }
    }

    const candidates = await fetchAllPaginated<any>(this.supabase.admin.from('courses')
      .select('id, course_code, title, department_id, semester, credits, category, seat_limit, prerequisites')
      .eq('semester', user.current_semester).order('id'))
    const resolvedSlots = slotsInfo.filter(info => requestedSlot === undefined || info.slot === requestedSlot).map(({ slot, rule, target, name }) => {
      if ([SLOT_RULES.FIXED, SLOT_RULES.AEC_ELECT, SLOT_RULES.CAMPUS_FIXED].includes(rule as any)) {
        const course = fixedCoursesMap[normalizeCourseCode(target)] || fixedCoursesMap[target?.trim()]
        return { slot, rule, name, course: course ? { ...course, department_name: deptIdToName.get(course.department_id) || 'Unknown' } : undefined }
      }
      if (rule === SLOT_RULES.EXCLUDE_DEPT && !String(target || '').split(',').some(code =>
        deptMap.has(code.trim().toUpperCase()) || Array.from(deptMap.values()).includes(code.trim()))) return { slot, rule, name, options: [] }
      const options = candidates.filter(course => !fixedCourseIds.includes(course.id) &&
        isCourseEligibleForSlot(course, rule, target, user.department_id ?? '', deptMap, user.current_semester!, name))
        .map(course => ({ ...course, department_name: deptIdToName.get(course.department_id) || 'Unknown' }))
      return { slot, rule, name, options }
    })

    return resolvedSlots
  }

  async getBlueprint(user: AuthUser) {
    let campusId = user.campus_id
    let departmentId = user.department_id
    let semester = user.current_semester

    // Fetch authoritative student record from students table
    const { data: studentRecord } = await this.supabase.admin
      .from('students')
      .select('campus_id, department_id, current_semester, full_name')
      .eq('id', user.userId)
      .maybeSingle()

    if (studentRecord) {
      if (studentRecord.campus_id) campusId = studentRecord.campus_id
      if (studentRecord.department_id) departmentId = studentRecord.department_id
      if (studentRecord.current_semester) semester = studentRecord.current_semester
    }

    if (!campusId || !departmentId || !semester) {
      throw new BadRequestException(
        'Student academic profile incomplete. Department, campus, or semester information is missing.',
      )
    }

    const [settingsRes, blueprintRes, deptRes] = await Promise.all([
      this.supabase.admin
        .from('campus_settings')
        .select('deadline, min_credits, max_credits, academic_year')
        .eq('campus_id', campusId)
        .maybeSingle(),
      this.supabase.admin
        .from('semester_blueprints')
        .select('*')
        .eq('department_id', departmentId)
        .eq('semester', semester)
        .maybeSingle(),
      this.supabase.admin.from('departments').select('id, name, code'),
    ])

    const departmentsData = deptRes.data ?? []
    const studentDept = departmentsData.find((d) => d.id === departmentId)
    const studentDeptName = studentDept?.name || 'your department'

    if (settingsRes.error) {
      this.logger.error(`Failed to query campus settings: ${settingsRes.error.message}`)
      throw new InternalServerErrorException('Failed to retrieve campus registration settings')
    }
    if (!settingsRes.data) {
      throw new NotFoundException(
        'Registration settings have not been configured for your campus yet. Please contact your Campus Director.',
      )
    }

    if (blueprintRes.error) {
      this.logger.error(`Failed to query semester blueprint: ${blueprintRes.error.message}`)
      throw new InternalServerErrorException('Failed to retrieve semester curriculum blueprint')
    }
    if (!blueprintRes.data) {
      throw new NotFoundException(
        `No curriculum structure configured for ${studentDeptName} (Semester ${semester}). Please contact your Head of Department (HOD) to configure the semester structure.`,
      )
    }

    const settings = settingsRes.data
    const blueprint = blueprintRes.data
    const deadline = settings.deadline ? new Date(settings.deadline) : null
    const windowOpen = deadline !== null && new Date() < deadline

    const pathways = getBlueprintPathways(blueprint)
    if (pathways.length === 0) {
      throw new BadRequestException('Blueprint has no pathways configured')
    }

    const deptMap = new Map<string, string>()
    for (const d of departmentsData) {
      if (d.code) {
        deptMap.set(d.code, d.id)
        deptMap.set(d.code.toUpperCase(), d.id)
        deptMap.set(d.code.toLowerCase(), d.id)
      }
      if (d.id) {
        deptMap.set(d.id, d.id)
      }
    }
    const deptIdToName = new Map<string, string>(departmentsData.map((d: any) => [d.id, d.name]))

    const effectiveUser: AuthUser = {
      ...user,
      campus_id: campusId,
      department_id: departmentId,
      current_semester: semester,
    }

    const [prefRes, regResWith8, completedRunRes] = await Promise.all([
      this.supabase.admin
        .from('registration_preferences')
        .select('id, pathway_id, preferences, submitted_at')
        .eq('student_id', user.userId)
        .eq('semester', semester)
        .eq('academic_year', settings.academic_year)
        .maybeSingle(),
      this.supabase.admin
        .from('current_student_registrations')
        .select('id, pathway_id, selections, allocation_metadata, submitted_at, total_credits, slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id')
        .eq('student_id', user.userId)
        .eq('semester', semester)
        .eq('academic_year', settings.academic_year)
        .maybeSingle(),
      this.supabase.admin
        .from('current_system_logs')
        .select('id, status, completed_at')
        .eq('log_type', 'allocation_run')
        .eq('campus_id', campusId)
        .eq('academic_year', settings.academic_year)
        .eq('semester', semester)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const allocationCompleted = !!completedRunRes?.data
    const allocationCompletedAt = completedRunRes?.data?.completed_at || null

    const existingPref = prefRes.data
    let existingReg: any = regResWith8.data

    // Gracefully handle if slot_7/slot_8 columns are not yet in DB schema
    if (regResWith8.error && (regResWith8.error.message?.includes('slot_7_course_id') || regResWith8.error.message?.includes('slot_8_course_id'))) {
      const { data: fallbackReg } = await this.supabase.admin
        .from('current_student_registrations')
        .select('id, pathway_id, selections, allocation_metadata, submitted_at, total_credits, slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id')
        .eq('student_id', user.userId)
        .eq('semester', semester)
        .eq('academic_year', settings.academic_year)
        .maybeSingle()
      existingReg = fallbackReg
    }

    // Resolve slots for the student's chosen pathway (or default first pathway)
    const defaultPathway = pathways[0]
    const chosenPathwayId = existingPref?.pathway_id ?? existingReg?.pathway_id ?? defaultPathway.id
    const targetPathway = pathways.find((p) => p.id === chosenPathwayId) || defaultPathway
    const slots = await this.resolvePathwaySlots(targetPathway, effectiveUser, deptMap, deptIdToName)

    // Fetch candidate minor courses for student (courses from other departments in same semester)
    const { data: minorCoursesRaw } = await this.supabase.admin
      .from('courses')
      .select('id, course_code, title, department_id, semester, credits, category, prerequisites')
      .eq('semester', semester)
      .neq('department_id', departmentId)
      .in('category', ['DSC', 'DSE', 'DSS', 'MDC'])
      .order('title', { ascending: true })

    const minorCourses = (minorCoursesRaw ?? []).map((c) => ({
      ...c,
      department_name: deptIdToName.get(c.department_id) || 'General',
    }))

    let preferences: Record<string, { course_id: string; rank: number }[]> = {}
    let allocationMetadata: Record<string, any> = {
      ...(typeof existingReg?.allocation_metadata === 'object' && existingReg?.allocation_metadata ? existingReg.allocation_metadata : {}),
    }

    if (allocationCompleted) {
      // Once allocation has run, pre-allocation registration_preferences have ZERO importance.
      // Active enrollments are driven exclusively by student_registrations.
      preferences = {}
      if (existingReg) {
        for (let s = 1; s <= 8; s++) {
          const slotKey = `slot_${s}`
          const cid = (existingReg as any)[`${slotKey}_course_id`]
          if (cid) {
            preferences[slotKey] = [{ course_id: cid, rank: 1 }]
          }
        }
      }
    } else {
      if (existingPref?.preferences) {
        const raw = existingPref.preferences
        if (Array.isArray(raw)) {
          for (const item of raw) {
            const slotKey = `slot_${item.slot}`
            if (Array.isArray(item.choices)) {
              preferences[slotKey] = item.choices
            }
          }
        } else if (typeof raw === 'object') {
          preferences = raw as any
        }
      }

      // Backfill any confirmed slots from existingReg into preferences map if missing
      if (existingReg) {
        for (let s = 1; s <= 8; s++) {
          const slotKey = `slot_${s}`
          const cid = (existingReg as any)[`${slotKey}_course_id`]
          if (cid && (!preferences[slotKey] || preferences[slotKey].length === 0)) {
            preferences[slotKey] = [{ course_id: cid, rank: 1 }]
            if (!allocationMetadata[slotKey]) {
              allocationMetadata[slotKey] = { allocated_by: 'fixed', course_id: cid }
            }
          }
        }
      }
    }

    // Resolve course metadata for all currently enrolled slots in student_registrations
    const allocatedCourses: Record<string, any> = {}
    if (existingReg) {
      const enrolledCids: string[] = []
      for (let s = 1; s <= 8; s++) {
        const cid = (existingReg as any)[`slot_${s}_course_id`]
        if (cid) enrolledCids.push(cid)
      }
      if (enrolledCids.length > 0) {
        const { data: enrolledData } = await this.supabase.admin
          .from('courses')
          .select('id, course_code, title, credits, department_id, semester, seat_limit, category, prerequisites')
          .in('id', enrolledCids)

        if (enrolledData) {
          for (const c of enrolledData) {
            allocatedCourses[c.id] = {
              ...c,
              department_name: deptIdToName.get(c.department_id) || 'General',
            }
          }
        }
      }
    }

    // Calculate real-time available seats for candidate courses post-allocation
    const availableSeats: Record<string, number> = {}
    if (allocationCompleted) {
      const allReferencedCourses: any[] = []
      for (const slot of slots) {
        if (slot.options) allReferencedCourses.push(...slot.options)
        if (slot.course) allReferencedCourses.push(slot.course)
      }
      allReferencedCourses.push(...minorCourses)

      const seatCounts = await enrollmentCounts(this.supabase.admin, [...new Map(allReferencedCourses.filter(c => c?.id).map(c => [c.id, c])).values()].map(c => ({
        key: c.id, course_id: c.id, campus_id: campusId, academic_year: settings.academic_year, semester,
      })))
      for (const c of allReferencedCourses) {
        if (c && c.id) {
          const limit = c.seat_limit ? Number(c.seat_limit) : 60
          const enrolled = seatCounts[c.id] || 0
          availableSeats[c.id] = Math.max(0, limit - enrolled)
        }
      }
    }

    // Compute remaining slot changes within the 27-hour rolling window
    let slotChangesRemaining = 3
    let slotChangesNextReset: string | null = null

    if (allocationCompleted) {
      const WINDOW_MS = 27 * 60 * 60 * 1000
      const now = Date.now()
      const regMeta = (existingReg?.allocation_metadata as Record<string, any>) || {}
      const history = Array.isArray(regMeta.slot_change_history) ? regMeta.slot_change_history : []
      const recentChanges = history.filter(
        (entry: any) => entry?.at && now - new Date(entry.at).getTime() < WINDOW_MS,
      )

      slotChangesRemaining = Math.max(0, 3 - recentChanges.length)
      if (recentChanges.length > 0) {
        const sorted = [...recentChanges].sort(
          (a: any, b: any) => new Date(a.at).getTime() - new Date(b.at).getTime(),
        )
        const oldest = sorted[0]
        slotChangesNextReset = new Date(new Date(oldest.at).getTime() + WINDOW_MS).toISOString()
      }
    }

    const submittedAt = existingPref?.submitted_at ?? existingReg?.submitted_at ?? null

    return {
      success: true,
      windowOpen,
      deadline: settings.deadline,
      academicYear: settings.academic_year,
      minCredits: blueprint.min_credits ?? settings.min_credits ?? 20,
      maxCredits: blueprint.max_credits ?? settings.max_credits ?? 24,
      min_credits: blueprint.min_credits ?? settings.min_credits ?? 20,
      max_credits: blueprint.max_credits ?? settings.max_credits ?? 24,
      totalCredits: existingReg ? Number(existingReg.total_credits) || null : null,
      total_credits: existingReg ? Number(existingReg.total_credits) || null : null,
      pathways,
      selectedPathwayId: chosenPathwayId,
      slots,
      minorCourses,
      existingRegistration: Object.keys(preferences).length > 0 ? preferences : null,
      existingPreferences: preferences,
      allocationMetadata: allocationMetadata,
      allocatedCourses,
      allocationCompleted,
      allocationCompletedAt,
      availableSeats,
      slotChangesRemaining,
      slotChangesNextReset,
      submittedAt: submittedAt,
      student: {
        id: user.userId,
        full_name: studentRecord?.full_name || user.full_name || '',
        current_semester: semester,
      },
      existingSlots: existingReg
        ? {
            slot_1: existingReg.slot_1_course_id,
            slot_2: existingReg.slot_2_course_id,
            slot_3: existingReg.slot_3_course_id,
            slot_4: existingReg.slot_4_course_id,
            slot_5: existingReg.slot_5_course_id,
            slot_6: existingReg.slot_6_course_id,
            slot_7: (existingReg as any).slot_7_course_id || null,
            slot_8: (existingReg as any).slot_8_course_id || null,
          }
        : null,
    }
  }

  async getMyRegistration(user: AuthUser) {
    return this.getBlueprint(user)
  }

  async getPathwaySlots(pathwayId: string, user: AuthUser) {
    let departmentId = user.department_id
    let semester = user.current_semester

    const { data: studentRecord } = await this.supabase.admin
      .from('students')
      .select('campus_id, department_id, current_semester')
      .eq('id', user.userId)
      .maybeSingle()

    if (studentRecord) {
      if (studentRecord.department_id) departmentId = studentRecord.department_id
      if (studentRecord.current_semester) semester = studentRecord.current_semester
    }

    const { data: blueprint, error: bpErr } = await this.supabase.admin
      .from('semester_blueprints')
      .select('*')
      .eq('department_id', departmentId)
      .eq('semester', semester)
      .maybeSingle()

    if (bpErr || !blueprint) throw new NotFoundException('Blueprint not found for this semester')

    const pathways = getBlueprintPathways(blueprint)
    const pathway = pathways?.find((p) => p.id === pathwayId)
    if (!pathway) throw new NotFoundException('Pathway not found')

    const { data: departmentsData } = await this.supabase.admin
      .from('departments')
      .select('id, name, code')

    const deptMap = new Map<string, string>()
    for (const d of departmentsData ?? []) {
      if (d.code) {
        deptMap.set(d.code, d.id)
        deptMap.set(d.code.toUpperCase(), d.id)
        deptMap.set(d.code.toLowerCase(), d.id)
      }
      if (d.id) {
        deptMap.set(d.id, d.id)
      }
    }
    const deptIdToName = new Map<string, string>((departmentsData ?? []).map((d: any) => [d.id, d.name]))

    const effectiveUser: AuthUser = {
      ...user,
      campus_id: studentRecord?.campus_id || user.campus_id,
      department_id: departmentId,
      current_semester: semester,
    }
    const slots = await this.resolvePathwaySlots(pathway, effectiveUser, deptMap, deptIdToName)

    return {
      success: true,
      data: {
        pathway_id: pathway.id,
        pathway_name: pathway.name,
        slots,
      },
    }
  }

  async submitCourses(
    body: {
      semester: number
      pathway_id: string
      courses?: string[]
      preferences?: Record<string, { course_id: string; rank: number }[]>
    },
    user: AuthUser,
  ) {
    const { semester, pathway_id, courses, preferences } = body

    let campusId = user.campus_id
    let departmentId = user.department_id
    let currentSemester = user.current_semester

    const { data: studentRecord } = await this.supabase.admin
      .from('students')
      .select('campus_id, department_id, current_semester')
      .eq('id', user.userId)
      .maybeSingle()

    if (studentRecord) {
      if (studentRecord.campus_id) campusId = studentRecord.campus_id
      if (studentRecord.department_id) departmentId = studentRecord.department_id
      if (studentRecord.current_semester) currentSemester = studentRecord.current_semester
    }

    if (semester !== currentSemester) {
      throw new BadRequestException('Submitted semester does not match current semester')
    }

    const [settingsRes, blueprintRes, deptRes] = await Promise.all([
      this.supabase.admin
        .from('campus_settings')
        .select('deadline, min_credits, max_credits, academic_year')
        .eq('campus_id', campusId)
        .maybeSingle(),
      this.supabase.admin
        .from('semester_blueprints')
        .select('*')
        .eq('department_id', departmentId)
        .eq('semester', semester)
        .maybeSingle(),
      this.supabase.admin.from('departments').select('id, name, code'),
    ])

    const departmentsData = deptRes.data ?? []
    const deptMap = new Map<string, string>()
    for (const d of departmentsData) {
      if (d.code) {
        deptMap.set(d.code, d.id)
        deptMap.set(d.code.toUpperCase(), d.id)
        deptMap.set(d.code.toLowerCase(), d.id)
      }
      if (d.id) {
        deptMap.set(d.id, d.id)
      }
    }

    const settings = settingsRes.data
    const blueprint = blueprintRes.data

    if (!settings) throw new NotFoundException('Campus registration settings not found')
    if (!blueprint) throw new NotFoundException('No blueprint found for your semester')

    const deadline = settings.deadline ? new Date(settings.deadline) : null
    if (!deadline || new Date() >= deadline) {
      throw new ForbiddenException('Registration window is closed')
    }

    // Post-allocation guard: Block preference submissions once allocation has completed for this semester
    const { data: completedRun } = await this.supabase.admin
      .from('current_system_logs')
      .select('id')
      .eq('log_type', 'allocation_run')
      .eq('campus_id', campusId)
      .eq('academic_year', settings.academic_year)
      .eq('semester', semester)
      .eq('status', 'completed')
      .limit(1)
      .maybeSingle()

    if (completedRun) {
      throw new ForbiddenException(
        'Course allocation has already been completed for this semester. ' +
        'Please use direct slot update to change your course registration.',
      )
    }

    const pathways = getBlueprintPathways(blueprint)
    const pathway = pathways.find((p) => p.id === pathway_id)
    if (!pathway) throw new BadRequestException('Invalid pathway selected')

    // F20, D02: Validate pathway slots for duplicate fixed courses and valid slot configuration
    const pathwayValidation = validatePathwaySlots(pathway.slots || [])
    if (!pathwayValidation.valid) {
      throw new BadRequestException(`Invalid pathway blueprint configuration: ${pathwayValidation.errors.join('; ')}`)
    }

    // Fetch existing preferences and registration records to preserve original submitted_at (F17)
    const [existingPrefRes, existingRegRes] = await Promise.all([
      this.supabase.admin
        .from('registration_preferences')
        .select('id, submitted_at, preferences')
        .eq('student_id', user.userId)
        .eq('semester', semester)
        .eq('academic_year', settings.academic_year)
        .maybeSingle(),
      this.supabase.admin
        .from('current_student_registrations')
        .select('id, submitted_at')
        .eq('student_id', user.userId)
        .eq('semester', semester)
        .eq('academic_year', settings.academic_year)
        .maybeSingle(),
    ])

    const existingPref = existingPrefRes.data
    const existingReg = existingRegRes.data

    // Step 3 tiebreaker rule: frozen on first submission. Re-ranking preferences never resets this timestamp (F17)
    const submittedAt = existingPref?.submitted_at ?? existingReg?.submitted_at ?? new Date().toISOString()

    // Resolve fixed targets globally by unique course code (F14)
    const fixedTargets: string[] = []
    pathway.slots.forEach((s) => {
      if (
        s.rule === SLOT_RULES.FIXED ||
        s.rule === SLOT_RULES.AEC_ELECT ||
        s.rule === SLOT_RULES.CAMPUS_FIXED
      ) {
        if (s.target) {
          const norm = normalizeCourseCode(s.target)
          fixedTargets.push(norm)
          if (s.target.trim() !== norm) {
            fixedTargets.push(s.target.trim())
          }
        }
      }
    })

    let fixedCoursesMap: Record<string, any> = {}
    if (fixedTargets.length > 0) {
      const { data: fixedCourses } = await this.supabase.admin
        .from('courses')
        .select('id, course_code, title, credits, department_id, category, semester, prerequisites')
        .in('course_code', fixedTargets)
      if (fixedCourses) {
        for (const c of fixedCourses) {
          fixedCoursesMap[c.course_code] = c
          fixedCoursesMap[normalizeCourseCode(c.course_code)] = c
        }
      }
    }

    const unifiedPreferences: {
      slot: number
      rule: string
      name?: string
      is_fixed: boolean
      choices: { course_id: string; rank: number }[]
    }[] = []

    const evaluatedCourses: any[] = []

    // F13: Process configured pathway slots (supporting variable component sizes for research/projects)
    pathway.slots.forEach((s, i) => {
      const slotNum = i + 1
      const slotKey = `slot_${slotNum}`
      const isFixed =
        s.rule === SLOT_RULES.FIXED ||
        s.rule === SLOT_RULES.AEC_ELECT ||
        s.rule === SLOT_RULES.CAMPUS_FIXED

      const normTarget = normalizeCourseCode(s.target)
      const fc = fixedCoursesMap[normTarget] || fixedCoursesMap[s.target?.trim()]

      if (isFixed && fc) {
        unifiedPreferences.push({
          slot: slotNum,
          rule: s.rule,
          name: s.name,
          is_fixed: true,
          choices: [{ course_id: fc.id, rank: 1 }],
        })
        evaluatedCourses.push(fc)
      } else {
        // Elective slot: student submits up to 3 preferences
        let slotChoices: { course_id: string; rank: number }[] = []
        if (preferences && preferences[slotKey]) {
          slotChoices = preferences[slotKey]
        } else if (courses && courses[i]) {
          slotChoices = [{ course_id: courses[i], rank: 1 }]
        }

        // F13: Runtime validation: required compulsory completeness
        if (!slotChoices || slotChoices.length === 0) {
          throw new BadRequestException(`Please select course preferences for compulsory Paper ${slotNum} (${s.name || s.rule})`)
        }

        if (slotChoices.length > 3) {
          throw new BadRequestException(`Maximum 3 preferences allowed for ${slotKey}`)
        }

        // Validate consecutive ranks and distinct courses within slot
        const ranksInSlot = new Set<number>()
        const coursesInSlot = new Set<string>()
        for (const choice of slotChoices) {
          if (!choice.course_id || typeof choice.course_id !== 'string') {
            throw new BadRequestException(`Invalid course selected in ${slotKey}`)
          }
          if (typeof choice.rank !== 'number' || choice.rank < 1 || choice.rank > 3) {
            throw new BadRequestException(`Invalid rank ${choice.rank} in ${slotKey}. Ranks must be between 1 and 3.`)
          }
          if (ranksInSlot.has(choice.rank)) {
            throw new BadRequestException(`Duplicate rank ${choice.rank} in ${slotKey}`)
          }
          ranksInSlot.add(choice.rank)

          if (coursesInSlot.has(choice.course_id)) {
            throw new BadRequestException(`Duplicate course chosen across ranks in ${slotKey}`)
          }
          coursesInSlot.add(choice.course_id)
        }

        unifiedPreferences.push({
          slot: slotNum,
          rule: s.rule,
          name: s.name,
          is_fixed: false,
          choices: slotChoices,
        })
      }
    })

    // Optional Slot 7 (Paper 7 - Additional Minor Elective)
    if (!pathway.slots[6]?.rule && preferences && preferences['slot_7'] && preferences['slot_7'].length > 0) {
      if (preferences['slot_7'].length > 3) {
        throw new BadRequestException('Maximum 3 preferences allowed for slot_7')
      }
      unifiedPreferences.push({
        slot: 7,
        rule: SLOT_RULES.EXCLUDE_DEPT,
        name: 'Paper 7 (Minor Elective)',
        is_fixed: false,
        choices: preferences['slot_7'],
      })
    }

    // Optional Slot 8 (Paper 8 - Additional Minor Elective)
    if (!pathway.slots[7]?.rule && preferences && preferences['slot_8'] && preferences['slot_8'].length > 0) {
      if (preferences['slot_8'].length > 3) {
        throw new BadRequestException('Maximum 3 preferences allowed for slot_8')
      }
      unifiedPreferences.push({
        slot: 8,
        rule: SLOT_RULES.EXCLUDE_DEPT,
        name: 'Paper 8 (Minor Elective)',
        is_fixed: false,
        choices: preferences['slot_8'],
      })
    }

    // Prerequisite self-declarations are browser-only guidance; validate blueprint eligibility here.
    const allElectiveCourseIds = new Set<string>()
    unifiedPreferences.forEach((sItem) => {
      if (!sItem.is_fixed) {
        sItem.choices.forEach((p) => allElectiveCourseIds.add(p.course_id))
      }
    })

    if (allElectiveCourseIds.size > 0) {
      const { data: electiveCourses, error: elecErr } = await this.supabase.admin
        .from('courses')
        .select('id, course_code, title, credits, department_id, semester, category, prerequisites')
        .in('id', Array.from(allElectiveCourseIds))

      if (elecErr || !electiveCourses) {
        throw new InternalServerErrorException('Failed to validate selected courses')
      }

      const courseMap = new Map<string, any>(electiveCourses.map((c: any) => [c.id, c]))
      for (const id of allElectiveCourseIds) {
        if (!courseMap.has(id)) {
          throw new BadRequestException(`Course ID ${id} is invalid or does not exist`)
        }
      }

      // Validate every ranked choice against the configured slot, independent of prerequisites.
      for (const sItem of unifiedPreferences) {
        if (sItem.is_fixed) continue
        const slotDef = getStudentSlotDefinition(pathway, sItem.slot, departmentId ?? '')
        if (!slotDef) throw new BadRequestException('The selected pathway does not define this slot')
        for (const choice of sItem.choices) {
          const course = courseMap.get(choice.course_id)
          if (!course) throw new BadRequestException(`Course ID ${choice.course_id} is invalid or does not exist`)
          if (!isCourseEligibleForSlot(course, slotDef.rule, slotDef.target || '', departmentId ?? '', deptMap, currentSemester, slotDef.name)) {
            throw new BadRequestException(`Course ${course.course_code} is not eligible for Slot ${sItem.slot} (${slotDef.name || slotDef.rule}) in Semester ${currentSemester}`)
          }
        }
      }

      // F20: Ensure no duplicate courses are chosen as rank 1 or fixed across slots
      const chosenRank1Map = new Map<string, number>()
      for (const sItem of unifiedPreferences) {
        const rank1 = sItem.choices.find((c) => c.rank === 1)
        if (rank1) {
          if (chosenRank1Map.has(rank1.course_id)) {
            const prevSlot = chosenRank1Map.get(rank1.course_id)
            const cInfo = courseMap.get(rank1.course_id) || fixedCoursesMap[rank1.course_id]
            throw new BadRequestException(
              `Duplicate paper selected: "${cInfo?.title || rank1.course_id}" is selected for both Paper ${prevSlot} and Paper ${sItem.slot}. Each paper must be unique.`,
            )
          }
          chosenRank1Map.set(rank1.course_id, sItem.slot)
        }
      }

      const rank1ElectiveIds = unifiedPreferences
        .filter((s) => !s.is_fixed)
        .map((s) => s.choices.find((c) => c.rank === 1)?.course_id)
        .filter((id): id is string => !!id)

      const rank1Courses = (electiveCourses ?? []).filter((c) => rank1ElectiveIds.includes(c.id))
      evaluatedCourses.push(...rank1Courses)
    }

    // F16, D08: Separate core pathway credits from additional papers 7-8
    let coreCredits = 0
    let additionalCredits = 0

    for (const sItem of unifiedPreferences) {
      const rank1CourseId = sItem.choices.find((c) => c.rank === 1)?.course_id
      if (!rank1CourseId) continue
      const course =
        (sItem.is_fixed
          ? fixedCoursesMap[normalizeCourseCode(pathway.slots[sItem.slot - 1]?.target)] ||
            fixedCoursesMap[pathway.slots[sItem.slot - 1]?.target?.trim()]
          : null) || evaluatedCourses.find((c) => c.id === rank1CourseId)
      const credits = Number(course?.credits) || 0

      if (sItem.slot <= pathway.slots.length) {
        coreCredits += credits
      } else {
        additionalCredits += credits
      }
    }

    const totalCredits = coreCredits + additionalCredits

    const minCredits = blueprint.min_credits ?? settings.min_credits ?? 20
    const maxCredits = blueprint.max_credits ?? settings.max_credits ?? 24

    if (coreCredits < minCredits || coreCredits > maxCredits) {
      throw new BadRequestException(
        `Total registered credits for core pathway components (${coreCredits}) must be between ${minCredits} and ${maxCredits}`,
      )
    }

    const isUpdate = !!(existingPref || existingReg)

    // F17: Atomic persistence via RPC submit_student_registration
    // R10/R11: Execute atomic transaction RPC submit_student_registration; do NOT bypass with direct table writes
    if (typeof this.supabase.admin.rpc !== 'function') {
      throw new InternalServerErrorException('Database RPC submit_student_registration is required')
    }

    const { data: rpcRes, error: rpcErr } = await termOperation(this.supabase.admin, user, 'submit_student_registration', {
      p_student_id: user.userId,
      p_campus_id: campusId || user.campus_id,
      p_semester: semester,
      p_academic_year: settings.academic_year,
      p_pathway_id: pathway_id,
      p_preferences: unifiedPreferences,
      p_allocation_metadata: {
        registration_state: 'pending_allocation',
        preference_credit_breakdown: { core_credits: coreCredits, additional_credits: additionalCredits, total_credits: totalCredits },
      },
      // Fixed choices are saved in preferences, and become enrollments only in the allocation transaction.
      p_fixed_assignments: {},
      p_total_credits: 0,
      p_submitted_at: submittedAt,
    })

    if (rpcErr || !rpcRes?.success) {
      const errMsg = rpcErr?.message || 'Registration transaction failed'
      if (errMsg.includes('capacity') || errMsg.includes('seat')) {
        throw new ConflictException(errMsg)
      }
      if (errMsg.includes('Registration window') || errMsg.includes('closed') || errMsg.includes('Timetable')) {
        throw new ForbiddenException(errMsg)
      }
      if (errMsg.includes('Duplicate') || errMsg.includes('Invalid')) {
        throw new BadRequestException(errMsg)
      }
      throw new InternalServerErrorException(errMsg)
    }

    await this.auditLogger.log({
      eventType: AuditEvents.REGISTRATION_SUBMITTED,
      userId: user.userId,
      userRole: user.role,
      action: isUpdate
        ? `updated course registration preferences for semester ${semester}`
        : `submitted course registration preferences for semester ${semester}`,
      resourceType: 'registration',
      status: 'success',
      metadata: { totalCredits, coreCredits, additionalCredits, coursesCount: evaluatedCourses.length, isUpdate },
    })

    return {
      success: true,
      isUpdate,
      message: isUpdate
        ? 'Course registration preferences updated successfully'
        : 'Course registration preferences submitted successfully',
      total_credits: totalCredits,
    }
  }

  // ──────────────── Post-Allocation: Available Seats ────────────────
  async getAvailableSeats(
    semester: number,
    slotKey: string,
    pathwayId: string | undefined,
    user: AuthUser,
  ) {
    if (!slotKey || !/^slot_[1-8]$/.test(slotKey)) {
      throw new BadRequestException('Invalid slot_key. Expected slot_1 to slot_8')
    }

    let campusId = user.campus_id
    let departmentId = user.department_id
    let currentSem = user.current_semester

    if (!campusId || !departmentId || !currentSem) {
      const { data: student } = await this.supabase.admin
        .from('students')
        .select('campus_id, department_id, current_semester')
        .eq('id', user.userId)
        .single()

      if (student) {
        campusId = campusId || student.campus_id
        departmentId = departmentId || student.department_id
        currentSem = currentSem || student.current_semester
      }
    }

    if (semester && semester !== currentSem) throw new BadRequestException('Courses must match your current semester')
    const sem = currentSem || 1

    const { data: settings } = await this.supabase.admin
      .from('campus_settings')
      .select('academic_year')
      .eq('campus_id', campusId)
      .maybeSingle()

    if (!settings?.academic_year) {
      throw new NotFoundException('Campus settings not configured')
    }

    let candidateCourses: any[] = []
    const slotNumber = parseInt(slotKey.replace('slot_', ''), 10)

    const { data: blueprint, error: blueprintError } = await this.supabase.admin
      .from('semester_blueprints').select('*')
      .eq('department_id', departmentId).eq('semester', sem).maybeSingle()
    if (blueprintError) throw new InternalServerErrorException('Could not load semester blueprint')
    if (!blueprint) throw new NotFoundException('Semester blueprint not found')
    const pathways = getBlueprintPathways(blueprint)
    const chosenPathway = pathways.find(p => p.id === pathwayId) || (!pathwayId && pathways.length === 1 ? pathways[0] : undefined)
    if (!chosenPathway) throw new BadRequestException('Pathway not found')
    const slotDef = getStudentSlotDefinition(chosenPathway, slotNumber, departmentId ?? '')
    if (!slotDef) throw new BadRequestException('The selected pathway does not define this slot')

    if (slotDef.rule === 'LEGACY_MINOR') {
      candidateCourses = await fetchAllPaginated<any>(this.supabase.admin.from('courses')
        .select('id, course_code, title, department_id, semester, credits, category, seat_limit, prerequisites')
        .eq('semester', sem).neq('department_id', departmentId)
        .in('category', ['DSC', 'DSE', 'DSS', 'MDC']).order('id'))
    } else {
      const { data: depts } = await this.supabase.admin.from('departments').select('id, name, code')
      const deptMap = new Map<string, string>()
      const deptIdToName = new Map<string, string>()
      for (const d of depts ?? []) {
        if (d.code) {
          deptMap.set(d.code, d.id)
          deptMap.set(d.code.toUpperCase(), d.id)
          deptMap.set(d.code.toLowerCase(), d.id)
        }
        if (d.id) {
          deptMap.set(d.id, d.id)
          deptIdToName.set(d.id, d.name)
        }
      }

      const effectiveUser: AuthUser = {
        ...user,
        campus_id: campusId,
        department_id: departmentId,
        current_semester: sem,
      }

      const slots = await this.resolvePathwaySlots(chosenPathway, effectiveUser, deptMap, deptIdToName, slotNumber)
      const targetSlot = slots.find((s) => s.slot === slotNumber)

      if (!targetSlot) {
        throw new NotFoundException(`Slot ${slotKey} not found in blueprint`)
      }

      if (
        targetSlot.rule === SLOT_RULES.FIXED ||
        targetSlot.rule === SLOT_RULES.CAMPUS_FIXED ||
        targetSlot.rule === SLOT_RULES.AEC_ELECT
      ) {
        return {
          success: true,
          courses: [],
          isFixed: true,
          message: 'Fixed core slots cannot be changed.',
        }
      }

      candidateCourses = targetSlot.options ?? []
    }

    const seatCounts: Record<string, number> = {}
    // Keep RPC result sets below the API row limit even for large catalogues.
    const candidateIds = [...new Set(candidateCourses.map((course) => course.id))]
    for (let offset = 0; offset < candidateIds.length; offset += 200) {
      const { data: counts, error } = await this.supabase.admin.rpc('course_enrollment_counts', {
        p_course_ids: candidateIds.slice(offset, offset + 200),
        p_academic_year: settings.academic_year,
        p_semester: sem,
      })
      if (error || !counts) {
        throw new InternalServerErrorException('Unable to load course seat availability')
      }
      for (const row of counts) {
        seatCounts[row.course_id] = Number(row.enrolled)
      }
    }

    const availableCourses = candidateCourses
      .map((c) => {
        const seatLimit = c.seat_limit == null ? 60 : Number(c.seat_limit)
        const enrolled = seatCounts[c.id] || 0
        const remainingSeats = Math.max(0, seatLimit - enrolled)
        return {
          id: c.id,
          course_code: c.course_code,
          title: c.title,
          credits: c.credits,
          department_id: c.department_id,
          department_name: c.department_name,
          category: c.category,
          seat_limit: seatLimit,
          remaining_seats: remainingSeats,
          prerequisites: c.prerequisites || [],
        }
      })
      .filter((c) => c.remaining_seats > 0)

    return {
      success: true,
      courses: availableCourses,
      isFixed: false,
    }
  }

  // ──────────────── Post-Allocation: Direct Slot Update ────────────────
  async updateSlot(
    body: { slot_key: string; course_id: string },
    user: AuthUser,
  ) {
    const { slot_key, course_id } = body
    if (!slot_key || !/^slot_[1-8]$/.test(slot_key)) {
      throw new BadRequestException('Invalid slot_key. Expected slot_1 to slot_8')
    }
    if (!course_id) {
      throw new BadRequestException('course_id is required')
    }

    let campusId = user.campus_id
    let departmentId = user.department_id
    let currentSemester = user.current_semester

    if (!campusId || !departmentId || !currentSemester) {
      const { data: student } = await this.supabase.admin
        .from('students')
        .select('campus_id, department_id, current_semester')
        .eq('id', user.userId)
        .single()

      if (student) {
        campusId = campusId || student.campus_id
        departmentId = departmentId || student.department_id
        currentSemester = currentSemester || student.current_semester
      }
    }

    if (!campusId || !currentSemester) {
      throw new BadRequestException('Incomplete student academic profile')
    }

    const { data: settings } = await this.supabase.admin
      .from('campus_settings')
      .select('deadline, academic_year, min_credits, max_credits')
      .eq('campus_id', campusId)
      .maybeSingle()

    if (!settings?.academic_year) {
      throw new NotFoundException('Campus registration settings not configured')
    }

    // F30: Enforce campus registration window
    const deadline = settings.deadline ? new Date(settings.deadline) : null
    if (!deadline || new Date() >= deadline) {
      throw new ForbiddenException(
        'Registration window is closed for your campus. Course changes are not permitted after the deadline.',
      )
    }

    // F30 & R15: Enforce unpublished cohort state (scoped to student's host campus)
    let pubQuery = this.supabase.admin
      .from('current_timetable_entries')
      .select('id')
      .eq('academic_year', settings.academic_year)
      .eq('semester', currentSemester)
      .eq('status', 'published')

    if (campusId) {
      pubQuery = pubQuery.eq('campus_id', campusId)
    }

    const { data: publishedEntries } = await pubQuery.limit(1)

    if (publishedEntries && publishedEntries.length > 0) {
      throw new ForbiddenException(
        'Timetable has been published for this cohort. Registrations are locked and direct course changes are no longer allowed.',
      )
    }

    // Step 2: Fetch student's existing registration record
    const { data: reg, error: regErr } = await this.supabase.admin
      .from('current_student_registrations')
      .select('*')
      .eq('student_id', user.userId)
      .eq('semester', currentSemester)
      .eq('academic_year', settings.academic_year)
      .maybeSingle()

    if (regErr || !reg) {
      throw new NotFoundException('Student registration record not found for this semester. Please contact your HOD.')
    }

    const allocationMeta = (reg.allocation_metadata as Record<string, any>) || {}
    if (allocationMeta[slot_key]?.allocated_by === 'fixed') {
      throw new ForbiddenException('Cannot modify a fixed core course slot.')
    }

    if (reg[`${slot_key}_course_id`] === course_id) {
      return {
        success: true,
        message: 'Course is already assigned to this slot',
        total_credits: reg.total_credits,
      }
    }

    // Step 2.5: Enforce 27-hour rolling rate limit (max 3 changes per 27 hours) (F31)
    const WINDOW_MS = 27 * 60 * 60 * 1000
    const now = Date.now()
    const history = Array.isArray(allocationMeta.slot_change_history)
      ? allocationMeta.slot_change_history
      : []

    const recentChanges = history.filter(
      (entry: any) => entry?.at && now - new Date(entry.at).getTime() < WINDOW_MS,
    )

    if (recentChanges.length >= 3) {
      const sorted = [...recentChanges].sort(
        (a: any, b: any) => new Date(a.at).getTime() - new Date(b.at).getTime(),
      )
      const oldest = sorted[0]
      const unlockTime = new Date(new Date(oldest.at).getTime() + WINDOW_MS)
      const diffMs = Math.max(0, unlockTime.getTime() - now)
      const hours = Math.floor(diffMs / (60 * 60 * 1000))
      const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000))
      const timeStr = `${hours}h ${minutes}m`

      throw new ForbiddenException(
        `Rate limit exceeded: You have reached the maximum limit of 3 course changes within a 27-hour window. Your next change unlocks in ${timeStr} (${unlockTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).`,
      )
    }

    // Step 3: Ensure student doesn't choose the same course in multiple slots (F20)
    for (let s = 1; s <= 8; s++) {
      const k = `slot_${s}`
      if (k !== slot_key && reg[`${k}_course_id`] === course_id) {
        throw new BadRequestException('You are already registered for this course in another slot.')
      }
    }

    // Step 4: Verify the target course exists and belongs to current semester
    const { data: course, error: cErr } = await this.supabase.admin
      .from('courses')
      .select('id, course_code, title, credits, department_id, semester, seat_limit, category, prerequisites')
      .eq('id', course_id)
      .single()

    if (cErr || !course) {
      throw new NotFoundException('Selected course not found')
    }

    if (course.semester !== currentSemester) {
      throw new BadRequestException(
        `Course belongs to semester ${course.semester}, but your current semester is ${currentSemester}`,
      )
    }

    // A configured pathway rule takes precedence over legacy minor behavior in every slot.
    const slotNum = parseInt(slot_key.replace('slot_', ''), 10)
    const { data: blueprint, error: blueprintError } = await this.supabase.admin
      .from('semester_blueprints').select('*')
      .eq('department_id', departmentId).eq('semester', currentSemester).maybeSingle()
    if (blueprintError) throw new InternalServerErrorException('Could not verify semester slot rules')
    if (!blueprint) throw new NotFoundException('Semester blueprint not configured')
    const pathways = getBlueprintPathways(blueprint)
    const pathwayId = reg.pathway_id
    const pathway = pathways.find(p => p.id === pathwayId) || (!pathwayId && pathways.length === 1 ? pathways[0] : undefined)
    const slotDef = getStudentSlotDefinition(pathway, slotNum, departmentId)
    if (!slotDef) throw new BadRequestException('The selected pathway does not define this slot')
    const { data: depts } = await this.supabase.admin.from('departments').select('id, code')
    const deptMap = new Map<string, string>((depts || []).map((d: any) => [d.code.toUpperCase(), d.id]))
    if (!isCourseEligibleForSlot(course, slotDef.rule, slotDef.target || '', departmentId, deptMap, currentSemester, slotDef.name)) {
      throw new BadRequestException(`Course ${course.course_code} is not eligible for ${slot_key} (${slotDef.name || slotDef.rule})`)
    }

    // Step 5: Global capacity check across ALL campuses for active academic year (F21)
    const seatLimit = course.seat_limit ? Number(course.seat_limit) : 60
    const { count: enrolledCount } = await this.supabase.admin
      .from('current_student_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('academic_year', settings.academic_year)
      .eq('semester', currentSemester)
      .or(
        `slot_1_course_id.eq.${course.id},slot_2_course_id.eq.${course.id},slot_3_course_id.eq.${course.id},slot_4_course_id.eq.${course.id},slot_5_course_id.eq.${course.id},slot_6_course_id.eq.${course.id},slot_7_course_id.eq.${course.id},slot_8_course_id.eq.${course.id}`,
      )

    if ((enrolledCount ?? 0) >= seatLimit) {
      throw new ConflictException(
        `Course ${course.course_code} (${course.title}) has reached maximum global capacity (${seatLimit}/${seatLimit} seats). Please select another available course.`,
      )
    }

    // Step 5.5: Atomic RPC transaction execution (F21, F31, R11)
    if (typeof this.supabase.admin.rpc !== 'function') {
      throw new InternalServerErrorException('Database RPC execute_student_course_change is required')
    }

    const { data: rpcRes, error: rpcErr } = await termOperation(this.supabase.admin, user, 'execute_student_course_change', {
      p_student_id: user.userId,
      p_campus_id: campusId,
      p_semester: currentSemester,
      p_academic_year: settings.academic_year,
      p_slot_key: slot_key,
      p_new_course_id: course_id,
      p_client_idempotency_key: (body as any).idempotency_key || null,
    })

    if (rpcErr || !rpcRes?.success) {
      const errMsg = rpcErr?.message || 'Course change transaction failed'
      if (errMsg.includes('capacity') || errMsg.includes('seat')) {
        throw new ConflictException(errMsg)
      }
      if (errMsg.includes('Rate limit') || errMsg.includes('deadline') || errMsg.includes('closed') || errMsg.includes('published')) {
        throw new ForbiddenException(errMsg)
      }
      if (errMsg.includes('already assigned') || errMsg.includes('Duplicate') || errMsg.includes('Invalid') || errMsg.includes('Idempotency key')) {
        throw new BadRequestException(errMsg)
      }
      throw new InternalServerErrorException(errMsg)
    }

    return rpcRes
  }
}
