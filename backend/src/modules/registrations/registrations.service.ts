import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { SupabaseService } from '../../core/database/supabase.service'
import { AuditLoggerService, AuditEvents } from '../../core/logging/audit-logger.service'
import { ServerLoggerService } from '../../core/logging/server-logger.service'
import { AuthUser } from '../../core/auth/types'
import { SLOT_RULES } from '../../core/constants/courseCategories'
import { Pathway, PathwaySlot } from '../../core/types/course.types'
import { isCourseEligibleForSlot, normalizeCourseCode } from '../../core/utils/slotRules'

@Injectable()
export class RegistrationsService {
  private readonly logger = new Logger(RegistrationsService.name)

  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService,
    private readonly serverLogger: ServerLoggerService,
  ) {}

  async resolvePathwaySlots(
    pathway: Pathway,
    user: AuthUser,
    deptMap: Map<string, string>,
    deptIdToName: Map<string, string>,
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
        .select('id, course_code, title, department_id, semester, credits, category, tag')
        .in('course_code', fixedTargets)

      if (fixedCourses) {
        fixedCourseIds = fixedCourses.map((c) => c.id)
        for (const c of fixedCourses) {
          fixedCoursesMap[c.course_code] = c
          fixedCoursesMap[normalizeCourseCode(c.course_code)] = c
        }
      }
    }

    const resolvedSlots = await Promise.all(
      slotsInfo.map(async ({ slot, rule, target, name }) => {
        if (
          rule === SLOT_RULES.FIXED ||
          rule === SLOT_RULES.AEC_ELECT ||
          rule === SLOT_RULES.CAMPUS_FIXED
        ) {
          const normTarget = normalizeCourseCode(target)
          const c = fixedCoursesMap[normTarget] || fixedCoursesMap[target?.trim()]
          return {
            slot,
            rule,
            name,
            course: c
              ? {
                  ...c,
                  department_name: deptIdToName.get(c.department_id) || 'Unknown',
                }
              : undefined,
          }
        }

        let query = this.supabase.admin
          .from('courses')
          .select('id, course_code, title, department_id, semester, credits, category, tag, seat_limit, prerequisite_course_ids')

        if (fixedCourseIds.length > 0) {
          query = query.not('id', 'in', `(${fixedCourseIds.join(',')})`)
        }

        if (rule === SLOT_RULES.DEPT_RESTRICTED) {
          const deptCodes = ((target as string) ?? '').split(',').map((code: string) => code.trim().toUpperCase())
          const deptIds = deptCodes
            .map((code: string) => deptMap.get(code) || (Array.from(deptMap.values()).includes(code) ? code : undefined))
            .filter((id): id is string => id !== undefined)
          if (deptIds.length === 0) return { slot, rule, name, options: [] }
          const { data: options } = await query
            .in('department_id', deptIds)
            .eq('semester', user.current_semester)
            .in('category', ['DSC', 'DSE', 'DSS'])

          const filtered = (options ?? []).filter((c) =>
            isCourseEligibleForSlot(c, rule, target, user.department_id ?? '', deptMap, name),
          )
          const mapped = filtered.map((c) => ({
            ...c,
            department_name: deptIdToName.get(c.department_id) || 'Unknown',
          }))
          return { slot, rule, name, options: mapped }
        }

        if (rule === SLOT_RULES.EXCLUDE_DEPT) {
          const deptCodes = ((target as string) ?? '').split(',').map((code: string) => code.trim().toUpperCase())
          const deptIds = deptCodes
            .map((code: string) => deptMap.get(code) || (Array.from(deptMap.values()).includes(code) ? code : undefined))
            .filter((id): id is string => id !== undefined)
          if (deptIds.length === 0) return { slot, rule, name, options: [] }

          const isMdc = (name && name.toUpperCase().includes('MDC')) || ((target as string) ?? '').toUpperCase().includes('MDC')

          let queryEx = query
            .not('department_id', 'in', `(${deptIds.join(',')})`)
            .eq('semester', user.current_semester)

          if (isMdc) {
            queryEx = queryEx.eq('category', 'MDC')
          } else {
            queryEx = queryEx.in('category', ['DSC', 'DSE', 'DSS'])
          }

          const { data: options } = await queryEx

          const filtered = (options ?? []).filter((c) =>
            isCourseEligibleForSlot(c, rule, target, user.department_id ?? '', deptMap, name),
          )
          const mapped = filtered.map((c) => ({
            ...c,
            department_name: deptIdToName.get(c.department_id) || 'Unknown',
          }))
          return { slot, rule, name, options: mapped }
        }

        // POOL_RESTRICTED — own department by tag
        if (rule === SLOT_RULES.POOL_RESTRICTED) {
          const { data: options } = await query
            .eq('department_id', user.department_id)
            .eq('tag', target?.trim())
            .eq('semester', user.current_semester)

          const filtered = (options ?? []).filter((c) =>
            isCourseEligibleForSlot(c, rule, target, user.department_id ?? '', deptMap, name),
          )
          const mapped = filtered.map((c) => ({
            ...c,
            department_name: deptIdToName.get(c.department_id) || 'Unknown',
          }))
          return { slot, rule, name, options: mapped }
        }

        // GLOBAL_BASKET — other departments by tag
        if (rule === SLOT_RULES.GLOBAL_BASKET) {
          const trimmedTarget = ((target as string) ?? '').trim()
          let q = query.eq('semester', user.current_semester)

          if (trimmedTarget.includes('-')) {
            q = q.eq('tag', trimmedTarget)
          } else {
            q = q.or(`tag.eq.${trimmedTarget},course_code.eq.${trimmedTarget}`)
          }

          if (trimmedTarget.toUpperCase().includes('MDC')) {
            q = q.neq('department_id', user.department_id)
          }
          const { data: options } = await q
          const filtered = (options ?? []).filter((c) =>
            isCourseEligibleForSlot(c, rule, target, user.department_id ?? '', deptMap, name),
          )
          const mapped = filtered.map((c) => ({
            ...c,
            department_name: deptIdToName.get(c.department_id) || 'Unknown',
          }))
          return { slot, rule, name, options: mapped }
        }

        return { slot, rule, name, options: [] }
      }),
    )

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

    const pathways = (blueprint.pathways as Pathway[]) || []
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

    const [prefRes, regResWith8] = await Promise.all([
      this.supabase.admin
        .from('registration_preferences')
        .select('id, pathway_id, preferences, allocation_metadata, submitted_at')
        .eq('student_id', user.userId)
        .eq('semester', semester)
        .eq('academic_year', settings.academic_year)
        .maybeSingle(),
      this.supabase.admin
        .from('student_registrations')
        .select('id, pathway_id, selections, allocation_metadata, submitted_at, total_credits, slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id')
        .eq('student_id', user.userId)
        .eq('semester', semester)
        .eq('academic_year', settings.academic_year)
        .maybeSingle(),
    ])

    const existingPref = prefRes.data
    let existingReg: any = regResWith8.data

    // Gracefully handle if slot_7/slot_8 columns are not yet in DB schema
    if (regResWith8.error && (regResWith8.error.message?.includes('slot_7_course_id') || regResWith8.error.message?.includes('slot_8_course_id'))) {
      const { data: fallbackReg } = await this.supabase.admin
        .from('student_registrations')
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
      .select('id, course_code, title, department_id, semester, credits, category, tag')
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
      ...(typeof existingPref?.allocation_metadata === 'object' && existingPref?.allocation_metadata ? existingPref.allocation_metadata : {}),
      ...(typeof existingReg?.allocation_metadata === 'object' && existingReg?.allocation_metadata ? existingReg.allocation_metadata : {}),
    }

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
    } else if (existingReg?.selections && Object.keys(existingReg.selections).length > 0) {
      preferences = existingReg.selections as any
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
      submittedAt: submittedAt,
      student: {
        full_name: user.full_name || '',
        current_semester: user.current_semester ?? 1,
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

    const pathways = blueprint.pathways as Pathway[] | null
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

    const slots = await this.resolvePathwaySlots(pathway, user, deptMap, deptIdToName)

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

    const pathways = (blueprint.pathways as Pathway[]) || []
    const pathway = pathways.find((p) => p.id === pathway_id)
    if (!pathway) throw new BadRequestException('Invalid pathway selected')

    // Fetch existing preferences record to freeze submitted_at
    const [existingPrefRes, existingRegRes] = await Promise.all([
      this.supabase.admin
        .from('registration_preferences')
        .select('id, submitted_at, allocation_metadata, preferences')
        .eq('student_id', user.userId)
        .eq('semester', semester)
        .eq('academic_year', settings.academic_year)
        .maybeSingle(),
      this.supabase.admin
        .from('student_registrations')
        .select('id, submitted_at, allocation_metadata')
        .eq('student_id', user.userId)
        .eq('semester', semester)
        .eq('academic_year', settings.academic_year)
        .maybeSingle(),
    ])

    const existingPref = existingPrefRes.data
    const existingReg = existingRegRes.data

    // Step 3 tiebreaker rule: frozen on first submission. Re-ranking preferences never resets this timestamp.
    const submittedAt = existingPref?.submitted_at ?? existingReg?.submitted_at ?? new Date().toISOString()
    const allocationMetadata: Record<string, any> = {
      ...(typeof existingPref?.allocation_metadata === 'object' && existingPref?.allocation_metadata ? existingPref.allocation_metadata : {}),
      ...(typeof existingReg?.allocation_metadata === 'object' && existingReg?.allocation_metadata ? existingReg.allocation_metadata : {}),
    }

    // Resolve fixed targets from blueprint
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
        .select('id, course_code, title, credits, department_id, category')
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
    const fixedCourseAssignments: Record<string, string> = {}

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
        allocationMetadata[slotKey] = { allocated_by: 'fixed' }
        fixedCourseAssignments[slotKey] = fc.id
        evaluatedCourses.push(fc)
      } else {
        // Elective slot: student submits up to 3 preferences
        let slotChoices: { course_id: string; rank: number }[] = []
        if (preferences && preferences[slotKey]) {
          slotChoices = preferences[slotKey]
        } else if (courses && courses[i]) {
          slotChoices = [{ course_id: courses[i], rank: 1 }]
        }

        if (slotChoices.length > 3) {
          throw new BadRequestException(`Maximum 3 preferences allowed for ${slotKey}`)
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

    // Optional Slot 7 (Paper 7 - Minor Elective)
    if (preferences && preferences['slot_7'] && preferences['slot_7'].length > 0) {
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

    // Optional Slot 8 (Paper 8 - Minor Elective)
    if (preferences && preferences['slot_8'] && preferences['slot_8'].length > 0) {
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

    // Collect all elective courses mentioned to validate department restriction
    const allElectiveCourseIds = new Set<string>()
    unifiedPreferences.forEach((sItem) => {
      if (!sItem.is_fixed) {
        sItem.choices.forEach((p) => allElectiveCourseIds.add(p.course_id))
      }
    })

    if (allElectiveCourseIds.size > 0) {
      const { data: electiveCourses, error: elecErr } = await this.supabase.admin
        .from('courses')
        .select('id, course_code, title, credits, department_id, semester, category, tag')
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

      // Validate each elective choice against slot eligibility rules (FND-05)
      for (const sItem of unifiedPreferences) {
        if (sItem.is_fixed) continue
        const slotDef =
          sItem.slot <= pathway.slots.length
            ? pathway.slots[sItem.slot - 1]
            : {
                rule: SLOT_RULES.EXCLUDE_DEPT,
                target: departmentId ?? '',
                name: sItem.name || `Paper ${sItem.slot} (Minor Elective)`,
              }

        if (!slotDef) continue

        for (const choice of sItem.choices) {
          const course = courseMap.get(choice.course_id)
          if (!course) {
            throw new BadRequestException(`Course ID ${choice.course_id} is invalid or does not exist`)
          }

          if (sItem.slot > 6) {
            // Hardcoded Minor Rule for Paper 7 and Paper 8:
            // Exclude student's own department; course must match current semester
            if (course.department_id === departmentId) {
              throw new BadRequestException(
                `Course ${course.course_code} - ${course.title} is not eligible for Slot ${sItem.slot}. Minor papers cannot be from your own department.`,
              )
            }
            if (course.semester !== currentSemester) {
              throw new BadRequestException(
                `Course ${course.course_code} - ${course.title} is for Semester ${course.semester}, but you are registering for Semester ${currentSemester}.`,
              )
            }
          } else {
            const isEligible = isCourseEligibleForSlot(
              course,
              slotDef.rule,
              slotDef.target || '',
              departmentId ?? '',
              deptMap,
              slotDef.name || sItem.name,
            )

            if (!isEligible) {
              throw new BadRequestException(
                `Course ${course.course_code} - ${course.title} is not eligible for Slot ${sItem.slot} (${slotDef.name || slotDef.rule})`,
              )
            }
          }
        }
      }

      // Ensure no duplicate courses are chosen as rank 1 or fixed across slots
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

      // Compute total credits based on fixed courses + rank 1 electives
      const rank1ElectiveIds = unifiedPreferences
        .filter((s) => !s.is_fixed)
        .map((s) => s.choices.find((c) => c.rank === 1)?.course_id)
        .filter((id): id is string => !!id)

      const rank1Courses = (electiveCourses ?? []).filter((c) => rank1ElectiveIds.includes(c.id))
      evaluatedCourses.push(...rank1Courses)
    }

    // Per user instruction: credit validation for submission is calculated strictly on the first 6 papers
    let base6Credits = 0
    let totalCredits = 0

    for (const sItem of unifiedPreferences) {
      const rank1CourseId = sItem.choices.find((c) => c.rank === 1)?.course_id
      if (!rank1CourseId) continue
      const course =
        (sItem.is_fixed
          ? fixedCoursesMap[normalizeCourseCode(pathway.slots[sItem.slot - 1]?.target)] ||
            fixedCoursesMap[pathway.slots[sItem.slot - 1]?.target?.trim()]
          : null) || evaluatedCourses.find((c) => c.id === rank1CourseId)
      const credits = course?.credits ?? 0
      totalCredits += credits
      if (sItem.slot <= 6) {
        base6Credits += credits
      }
    }

    const minCredits = blueprint.min_credits ?? settings.min_credits ?? 20
    const maxCredits = blueprint.max_credits ?? settings.max_credits ?? 24

    if (base6Credits < minCredits || base6Credits > maxCredits) {
      throw new BadRequestException(
        `Total registered credits for core 6 papers (${base6Credits}) must be between ${minCredits} and ${maxCredits}`,
      )
    }

    const isUpdate = !!(existingPref || existingReg)

    // 1. Save unified preferences to registration_preferences table
    const prefUpsertPayload = {
      student_id: user.userId,
      campus_id: campusId || user.campus_id,
      semester,
      academic_year: settings.academic_year,
      pathway_id,
      preferences: unifiedPreferences,
      allocation_metadata: allocationMetadata,
      submitted_at: submittedAt,
      updated_at: new Date().toISOString(),
    }

    const { error: prefErr } = await this.supabase.admin
      .from('registration_preferences')
      .upsert(prefUpsertPayload, { onConflict: 'student_id,semester,academic_year' })

    if (prefErr) {
      this.logger.error(`Failed to save registration preferences: ${prefErr.message}`)
      throw new InternalServerErrorException('Failed to save course preferences')
    }

    // 2. Write confirmed fixed slots to student_registrations table (keeping elective slots NULL until allocation runs)
    const regPayload: Record<string, any> = {
      student_id: user.userId,
      campus_id: campusId || user.campus_id,
      semester,
      academic_year: settings.academic_year,
      pathway_id,
      total_credits: totalCredits,
      allocation_metadata: allocationMetadata,
      submitted_at: submittedAt,
      slot_1_course_id: fixedCourseAssignments.slot_1 ?? null,
      slot_2_course_id: fixedCourseAssignments.slot_2 ?? null,
      slot_3_course_id: fixedCourseAssignments.slot_3 ?? null,
      slot_4_course_id: fixedCourseAssignments.slot_4 ?? null,
      slot_5_course_id: fixedCourseAssignments.slot_5 ?? null,
      slot_6_course_id: fixedCourseAssignments.slot_6 ?? null,
      slot_7_course_id: fixedCourseAssignments.slot_7 ?? null,
      slot_8_course_id: fixedCourseAssignments.slot_8 ?? null,
    }

    let { error: regErr } = await this.supabase.admin
      .from('student_registrations')
      .upsert(regPayload, { onConflict: 'student_id,semester,academic_year' })

    if (regErr && (regErr.message?.includes('slot_7_course_id') || regErr.message?.includes('slot_8_course_id'))) {
      const { slot_7_course_id, slot_8_course_id, ...legacyPayload } = regPayload
      const fallbackRes = await this.supabase.admin
        .from('student_registrations')
        .upsert(legacyPayload, { onConflict: 'student_id,semester,academic_year' })
      regErr = fallbackRes.error
    }

    if (regErr) {
      this.logger.error(`Failed to write confirmed fixed slots to student_registrations: ${regErr.message}`)
      // Not fatal to preferences, but log error
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
      metadata: { totalCredits, coursesCount: evaluatedCourses.length, isUpdate },
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
}
