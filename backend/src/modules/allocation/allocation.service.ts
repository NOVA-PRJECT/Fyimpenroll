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
import { ServerLoggerService } from '../../core/logging/server-logger.service'
import { AuthUser } from '../../core/auth/types'

export interface CourseItem {
  id: string
  course_code: string
  title: string
  semester: number
  department_id: string
  seat_limit: number
}

export interface PrerequisiteRule {
  id: string
  course_id: string
  rule: 'COMPLETED_COURSE' | 'COMPLETED_SEMESTER' | 'DEPARTMENT'
  target: string
  created_at?: string
}

export interface PreferenceChoice {
  course_id: string
  rank: number
}

export interface UnifiedSlotPreference {
  slot: number
  rule?: string
  name?: string
  is_fixed?: boolean
  choices: PreferenceChoice[]
}

@Injectable()
export class AllocationService {
  private readonly logger = new Logger(AllocationService.name)

  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService,
    private readonly serverLogger: ServerLoggerService,
  ) {}

  // ──────────────── Prerequisite Rule Engine Endpoints ────────────────

  async getPrerequisites(courseId: string, user: AuthUser) {
    const { data: rules, error } = await this.supabase.admin
      .from('course_prerequisite_rules')
      .select('*')
      .eq('course_id', courseId)
      .order('created_at', { ascending: true })

    if (error) {
      this.logger.error(`Failed to fetch prerequisites for course ${courseId}: ${error.message}`)
      throw new InternalServerErrorException('Failed to fetch course prerequisite rules')
    }

    return {
      success: true,
      rules: rules ?? [],
    }
  }

  async addPrerequisite(
    courseId: string,
    body: { rule: string; target: string },
    user: AuthUser,
  ) {
    const { rule, target } = body
    if (!rule || !target) {
      throw new BadRequestException('Both rule and target are required')
    }

    const validRules = ['COMPLETED_COURSE', 'COMPLETED_SEMESTER', 'DEPARTMENT']
    if (!validRules.includes(rule)) {
      throw new BadRequestException(
        `Invalid rule type "${rule}". Must be one of: ${validRules.join(', ')}`,
      )
    }

    let cleanTarget = target.trim()
    if (!cleanTarget) {
      throw new BadRequestException('Target cannot be empty')
    }

    if (rule === 'COMPLETED_SEMESTER') {
      const semNum = parseInt(cleanTarget, 10)
      if (isNaN(semNum) || semNum < 1 || semNum > 8) {
        throw new BadRequestException('Target for COMPLETED_SEMESTER must be an integer between 1 and 8')
      }
      cleanTarget = String(semNum)
    } else if (rule === 'DEPARTMENT') {
      cleanTarget = cleanTarget
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
        .join(',')
      if (!cleanTarget) {
        throw new BadRequestException('At least one department code must be selected')
      }
    } else {
      cleanTarget = cleanTarget.toUpperCase()
    }

    // Verify course exists
    const { data: course, error: courseErr } = await this.supabase.admin
      .from('courses')
      .select('id, course_code, department_id')
      .eq('id', courseId)
      .single()

    if (courseErr || !course) {
      throw new NotFoundException('Course not found')
    }

    // If HOD, check department ownership
    if (user.role === 'hod' && user.department_id && course.department_id !== user.department_id) {
      throw new ForbiddenException('You can only configure prerequisite rules for courses in your department')
    }

    // If DEPARTMENT rule already exists for this course, update it
    if (rule === 'DEPARTMENT') {
      const { data: existingDeptRule } = await this.supabase.admin
        .from('course_prerequisite_rules')
        .select('*')
        .eq('course_id', courseId)
        .eq('rule', 'DEPARTMENT')
        .maybeSingle()

      if (existingDeptRule) {
        const { data: updatedRule, error: updErr } = await this.supabase.admin
          .from('course_prerequisite_rules')
          .update({ target: cleanTarget })
          .eq('id', existingDeptRule.id)
          .select('*')
          .single()

        if (updErr) {
          this.logger.error(`Failed to update department rule: ${updErr.message}`)
          throw new InternalServerErrorException('Failed to update department rule')
        }

        await this.auditLogger.log({
          eventType: AuditEvents.COURSE_UPDATED,
          userId: user.userId,
          userRole: user.role,
          action: `updated prerequisite rule ${rule} (${cleanTarget}) on course ${course.course_code}`,
          resourceType: 'course',
          resourceId: courseId,
          status: 'success',
        })

        return {
          success: true,
          message: 'Department constraint updated successfully',
          rule: updatedRule,
        }
      }
    }

    const { data: newRule, error: insertErr } = await this.supabase.admin
      .from('course_prerequisite_rules')
      .insert({
        course_id: courseId,
        rule,
        target: cleanTarget,
      })
      .select('*')
      .single()

    if (insertErr) {
      if (insertErr.code === '23505') {
        throw new ConflictException('This prerequisite rule already exists for this course')
      }
      this.logger.error(`Failed to add prerequisite rule: ${insertErr.message}`)
      throw new InternalServerErrorException('Failed to create prerequisite rule')
    }

    await this.auditLogger.log({
      eventType: AuditEvents.COURSE_UPDATED,
      userId: user.userId,
      userRole: user.role,
      action: `added prerequisite rule ${rule} (${cleanTarget}) to course ${course.course_code}`,
      resourceType: 'course',
      resourceId: courseId,
      status: 'success',
      metadata: { rule, target: cleanTarget },
    })

    return {
      success: true,
      rule: newRule,
    }
  }

  async deletePrerequisite(ruleId: string, user: AuthUser) {
    const { data: rule, error: fetchErr } = await this.supabase.admin
      .from('course_prerequisite_rules')
      .select('id, course_id, rule, target, courses(department_id, course_code)')
      .eq('id', ruleId)
      .single()

    if (fetchErr || !rule) {
      throw new NotFoundException('Prerequisite rule not found')
    }

    const courseDeptId = (rule.courses as any)?.department_id
    if (user.role === 'hod' && user.department_id && courseDeptId !== user.department_id) {
      throw new ForbiddenException('You can only delete prerequisite rules for courses in your department')
    }

    const { error: delErr } = await this.supabase.admin
      .from('course_prerequisite_rules')
      .delete()
      .eq('id', ruleId)

    if (delErr) {
      this.logger.error(`Failed to delete prerequisite rule: ${delErr.message}`)
      throw new InternalServerErrorException('Failed to delete prerequisite rule')
    }

    await this.auditLogger.log({
      eventType: AuditEvents.COURSE_UPDATED,
      userId: user.userId,
      userRole: user.role,
      action: `deleted prerequisite rule ${rule.rule} (${rule.target}) from course ${(rule.courses as any)?.course_code}`,
      resourceType: 'course',
      resourceId: rule.course_id,
      status: 'success',
      metadata: { rule: rule.rule, target: rule.target },
    })

    return {
      success: true,
      message: 'Prerequisite rule deleted successfully',
    }
  }

  // ──────────────── Campus Director: Trigger 3-Round Allocation ────────────────
  async runAllocation(
    body: { academicYear: string; semester: number },
    user: AuthUser,
  ) {
    const campusId = user.campus_id
    if (!campusId) {
      throw new BadRequestException('Campus ID is required to run course allocation')
    }

    // Validate academicYear format: must be YYYY-YY (e.g. 2026-27)
    if (!body.academicYear || !/^\d{4}-\d{2}$/.test(body.academicYear)) {
      throw new BadRequestException(
        'Invalid academic year format. Expected format: YYYY-YY (e.g. 2026-27)',
      )
    }

    // Validate that the two parts are consecutive years (e.g. 2026-27, not 2026-99)
    const [startYearStr, shortEndStr] = body.academicYear.split('-')
    const startYear = parseInt(startYearStr, 10)
    const expectedShortEnd = String(startYear + 1).slice(2)
    if (shortEndStr !== expectedShortEnd) {
      throw new BadRequestException(
        `Invalid academic year: ${body.academicYear}. The year must be consecutive (e.g. 2026-27)`,
      )
    }

    // Validate semester range
    const sem = Number(body.semester)
    if (isNaN(sem) || sem < 1 || sem > 8) {
      throw new BadRequestException('Semester must be between 1 and 8')
    }

    // Step A: Check if a run is already in progress
    const { data: activeRun } = await this.supabase.admin
      .from('allocation_runs')
      .select('id')
      .eq('campus_id', campusId)
      .eq('academic_year', body.academicYear)
      .eq('semester', body.semester)
      .eq('status', 'running')
      .maybeSingle()

    if (activeRun) {
      throw new ConflictException(
        'An allocation run is already in progress for this academic year and semester',
      )
    }

    // Step A.2: Check if allocation has already been completed for this semester and academic year
    const { data: completedRun } = await this.supabase.admin
      .from('allocation_runs')
      .select('id, completed_at')
      .eq('campus_id', campusId)
      .eq('academic_year', body.academicYear)
      .eq('semester', body.semester)
      .eq('status', 'completed')
      .maybeSingle()

    if (completedRun) {
      throw new ConflictException(
        `Allocation has already been completed for Semester ${body.semester} (${body.academicYear}). ` +
        `In production, allocation can only be executed once per semester per academic year.`,
      )
    }

    // Step B: Insert allocation_runs row with status 'running'
    const { data: run, error: runErr } = await this.supabase.admin
      .from('allocation_runs')
      .insert({
        academic_year: body.academicYear,
        semester: body.semester,
        campus_id: campusId,
        triggered_by: user.userId,
        status: 'running',
      })
      .select('id')
      .single()

    if (runErr || !run) {
      this.logger.error(`Failed to initialize allocation run: ${runErr?.message}`, runErr?.details)
      throw new InternalServerErrorException(
        `Failed to initialize allocation run: ${runErr?.message || 'Unknown database error'}`,
      )
    }

    try {
      // Step C: Fetch all courses offered in this semester
      const { data: coursesData, error: courseErr } = await this.supabase.admin
        .from('courses')
        .select('id, course_code, title, semester, department_id, seat_limit')
        .eq('semester', body.semester)

      if (courseErr) throw courseErr

      const courses: CourseItem[] = (coursesData ?? []).map((c) => ({
        id: c.id,
        course_code: c.course_code,
        title: c.title,
        semester: c.semester,
        department_id: c.department_id,
        seat_limit: c.seat_limit ? Number(c.seat_limit) : 60,
      }))

      const courseMap = new Map<string, CourseItem>(courses.map((c) => [c.id, c]))
      const courseIds = courses.map((c) => c.id)

      // Step D: Fetch all prerequisite rules for these courses
      const courseRulesMap = new Map<string, PrerequisiteRule[]>()
      if (courseIds.length > 0) {
        const { data: rulesData, error: rulesErr } = await this.supabase.admin
          .from('course_prerequisite_rules')
          .select('id, course_id, rule, target')
          .in('course_id', courseIds)

        if (!rulesErr && rulesData) {
          for (const r of rulesData) {
            if (!courseRulesMap.has(r.course_id)) {
              courseRulesMap.set(r.course_id, [])
            }
            courseRulesMap.get(r.course_id)!.push(r as PrerequisiteRule)
          }
        }
      }

      // Step E: Fetch all student preference submissions from registration_preferences
      // Only students who have a row in registration_preferences are processed!
      const { data: rawPrefList, error: prefErr } = await this.supabase.admin
        .from('registration_preferences')
        .select('id, student_id, campus_id, semester, academic_year, pathway_id, preferences, allocation_metadata, submitted_at')
        .eq('campus_id', campusId)
        .eq('academic_year', body.academicYear)
        .eq('semester', body.semester)

      if (prefErr) {
        this.logger.error(`Failed to fetch registration preferences: ${prefErr.message}`)
        throw new InternalServerErrorException(
          `Failed to fetch registration preferences: ${prefErr.message}`,
        )
      }

      const rawPrefs = rawPrefList ?? []
      const studentIds = Array.from(new Set(rawPrefs.map((p) => p.student_id)))

      // Fetch student details for all candidates
      const studentMap = new Map<string, any>()
      if (studentIds.length > 0) {
        const { data: studentsData, error: stuErr } = await this.supabase.admin
          .from('students')
          .select(`
            id,
            department_id,
            current_semester,
            departments (
              id,
              code
            )
          `)
          .in('id', studentIds)

        if (!stuErr && studentsData) {
          for (const s of studentsData) {
            studentMap.set(s.id, s)
          }
        }
      }

      // Attach student details to preference records
      const studentPrefList = rawPrefs.map((p) => ({
        ...p,
        students: studentMap.get(p.student_id) || null,
      }))

      // Helper to normalize preferences into slot array
      const extractSlots = (rawPrefs: any): UnifiedSlotPreference[] => {
        if (Array.isArray(rawPrefs)) {
          return rawPrefs.map((item: any, idx: number) => ({
            slot: item.slot ?? idx + 1,
            rule: item.rule,
            name: item.name,
            is_fixed: item.is_fixed ?? (item.rule === 'FIXED' || item.rule === 'CAMPUS_FIXED' || item.rule === 'AEC_ELECT'),
            choices: Array.isArray(item.choices) ? item.choices : [],
          }))
        } else if (rawPrefs && typeof rawPrefs === 'object') {
          // Object format { slot_1: [...] }
          return Object.entries(rawPrefs).map(([k, v]: [string, any]) => {
            const slotNum = parseInt(k.replace('slot_', ''), 10) || 1
            const choices = Array.isArray(v) ? v : []
            return {
              slot: slotNum,
              is_fixed: false,
              choices,
            }
          })
        }
        return []
      }

      // Step F: Fetch prior completed registrations for scoring COMPLETED_COURSE
      // We check courses the student was enrolled in prior semesters (semester < body.semester)
      const studentCompletedCourseCodesMap = new Map<string, Set<string>>()
      if (studentIds.length > 0) {
        const { data: priorRegs } = await this.supabase.admin
          .from('student_registrations')
          .select('student_id, slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id')
          .in('student_id', studentIds)
          .lt('semester', body.semester)

        const priorCourseIds = new Set<string>()
        for (const pr of priorRegs ?? []) {
          for (let s = 1; s <= 6; s++) {
            const cid = (pr as any)[`slot_${s}_course_id`]
            if (cid) priorCourseIds.add(cid)
          }
        }

        const courseCodeLookup = new Map<string, string>()
        if (priorCourseIds.size > 0) {
          const { data: codeData } = await this.supabase.admin
            .from('courses')
            .select('id, course_code')
            .in('id', Array.from(priorCourseIds))

          for (const cd of codeData ?? []) {
            courseCodeLookup.set(cd.id, cd.course_code.toUpperCase())
          }
        }

        for (const pr of priorRegs ?? []) {
          if (!studentCompletedCourseCodesMap.has(pr.student_id)) {
            studentCompletedCourseCodesMap.set(pr.student_id, new Set())
          }
          const set = studentCompletedCourseCodesMap.get(pr.student_id)!
          for (let s = 1; s <= 6; s++) {
            const cid = (pr as any)[`slot_${s}_course_id`]
            if (cid && courseCodeLookup.has(cid)) {
              set.add(courseCodeLookup.get(cid)!)
            }
          }
        }
      }

      // Track slot resolution status per registration/student:
      // student_id -> slotKey -> { resolved: boolean, course_id: string | null }
      const studentSlotState = new Map<string, Map<string, { resolved: boolean; course_id: string | null }>>()
      for (const pref of studentPrefList) {
        const slotMap = new Map<string, { resolved: boolean; course_id: string | null }>()
        for (let s = 1; s <= 6; s++) {
          slotMap.set(`slot_${s}`, { resolved: false, course_id: null })
        }
        studentSlotState.set(pref.student_id, slotMap)
      }

      // Track available seats per course
      const remainingElectiveSeats = new Map<string, number>()
      for (const course of courses) {
        remainingElectiveSeats.set(course.id, course.seat_limit)
      }

      // Step 1: Fixed Slot Write-Through
      // Read all fixed slots from registration_preferences and write them directly to student_registrations
      // Sets allocation_metadata on the slot to { allocated_by: 'fixed' }
      // Deducts these seats from the course's available capacity before elective allocation begins
      for (const pref of studentPrefList) {
        const slots = extractSlots(pref.preferences)
        const slotMap = studentSlotState.get(pref.student_id)!
        const fixedPayload: Record<string, any> = {
          student_id: pref.student_id,
          campus_id: campusId,
          semester: body.semester,
          academic_year: body.academicYear,
          pathway_id: pref.pathway_id,
        }
        const updatedMeta: Record<string, any> = {
          ...(typeof pref.allocation_metadata === 'object' && pref.allocation_metadata ? pref.allocation_metadata : {}),
        }

        let hasFixedUpdates = false

        for (const slotItem of slots) {
          const slotKey = `slot_${slotItem.slot}`
          if (slotItem.is_fixed && slotItem.choices.length > 0) {
            const fixedCourseId = slotItem.choices[0].course_id
            fixedPayload[`${slotKey}_course_id`] = fixedCourseId
            updatedMeta[slotKey] = { allocated_by: 'fixed' }
            slotMap.set(slotKey, { resolved: true, course_id: fixedCourseId })

            // Deduct seat
            const curRem = remainingElectiveSeats.get(fixedCourseId) ?? 0
            remainingElectiveSeats.set(fixedCourseId, Math.max(0, curRem - 1))
            hasFixedUpdates = true
          }
        }

        if (hasFixedUpdates) {
          fixedPayload.allocation_metadata = updatedMeta

          // Upsert into student_registrations
          await this.supabase.admin
            .from('student_registrations')
            .upsert(fixedPayload, { onConflict: 'student_id,semester,academic_year' })

          // Update registration_preferences allocation_metadata
          await this.supabase.admin
            .from('registration_preferences')
            .update({ allocation_metadata: updatedMeta })
            .eq('id', pref.id)
        }
      }

      // Scoring Function:
      // Uses course_prerequisite_rules (+1 per matched rule) + semester proximity points
      const calculateStudentScore = (
        studentId: string,
        studentSemester: number,
        studentDeptCode: string,
        course: CourseItem,
      ): number => {
        const rules = courseRulesMap.get(course.id) || []
        let prereqPoints = 0
        const priorCodes = studentCompletedCourseCodesMap.get(studentId)

        for (const r of rules) {
          if (r.rule === 'COMPLETED_COURSE') {
            if (priorCodes && priorCodes.has(r.target.trim().toUpperCase())) {
              prereqPoints += 1
            }
          } else if (r.rule === 'COMPLETED_SEMESTER') {
            const targetSem = parseInt(r.target.trim(), 10)
            if (!isNaN(targetSem) && studentSemester > targetSem) {
              prereqPoints += 1
            }
          } else if (r.rule === 'DEPARTMENT') {
            const allowedCodes = r.target.split(',').map((c: string) => c.trim().toUpperCase())
            if (studentDeptCode && allowedCodes.includes(studentDeptCode.toUpperCase())) {
              prereqPoints += 1
            }
          }
        }

        // Proximity points
        const proximityPoints = Math.max(0, studentSemester - course.semester)
        return prereqPoints + proximityPoints
      }

      const finalAllocations: {
        student_id: string
        preference_id: string
        slot_key: string
        course_id: string
        metadata: any
      }[] = []

      // ──────────────── Pre-Round Optimization: Direct Confirmation ────────────────
      // If the total number of students who registered for a course is <= available seats,
      // skip scoring entirely and confirm all of them directly.
      const directlyConfirmedCourseIds = new Set<string>()

      for (const course of courses) {
        const availableSeats = remainingElectiveSeats.get(course.id) ?? 0
        if (availableSeats <= 0) continue

        // Collect all demands from students who listed this course in any unresolved elective slot
        const demandingStudents: {
          prefId: string
          studentId: string
          studentDeptId: string
          slotKey: string
          rank: number
        }[] = []

        for (const pref of studentPrefList) {
          const slotMap = studentSlotState.get(pref.student_id)!
          const slots = extractSlots(pref.preferences)
          const studentDeptId = (pref.students as any)?.department_id ?? ''
          const studentDeptCode = (pref.students as any)?.departments?.code ?? ''

          // Check if course has DEPARTMENT constraint
          const deptRules = (courseRulesMap.get(course.id) || []).filter((r) => r.rule === 'DEPARTMENT')
          if (deptRules.length > 0) {
            const allAllowed = deptRules.flatMap((r) => r.target.split(',').map((c) => c.trim().toUpperCase()))
            if (studentDeptCode && !allAllowed.includes(studentDeptCode.toUpperCase())) {
              continue
            }
          }

          for (const slotItem of slots) {
            const slotKey = `slot_${slotItem.slot}`
            const currentSlot = slotMap.get(slotKey)
            if (!currentSlot || currentSlot.resolved || slotItem.is_fixed) continue

            const prefChoice = slotItem.choices.find((c) => c.course_id === course.id)
            if (prefChoice) {
              demandingStudents.push({
                prefId: pref.id,
                studentId: pref.student_id,
                studentDeptId,
                slotKey,
                rank: prefChoice.rank,
              })
            }
          }
        }

        const uniqueStudentIds = new Set(demandingStudents.map((d) => d.studentId))
        const registeredCount = uniqueStudentIds.size

        if (registeredCount > 0 && registeredCount <= availableSeats) {
          // Confirm all registered students immediately
          for (const demand of demandingStudents) {
            const slotMap = studentSlotState.get(demand.studentId)!
            if (slotMap.get(demand.slotKey)?.resolved) continue

            slotMap.set(demand.slotKey, { resolved: true, course_id: course.id })
            remainingElectiveSeats.set(
              course.id,
              Math.max(0, (remainingElectiveSeats.get(course.id) ?? 0) - 1),
            )

            finalAllocations.push({
              student_id: demand.studentId,
              preference_id: demand.prefId,
              slot_key: demand.slotKey,
              course_id: course.id,
              metadata: {
                allocated_by: 'algorithm',
                run_id: run.id,
                direct_confirm: true,
                allocated_at: new Date().toISOString(),
              },
            })
          }

          directlyConfirmedCourseIds.add(course.id)
          this.logger.log(
            `Course ${course.course_code} directly confirmed for ${registeredCount} student(s) (${availableSeats} seats available) — skipped scoring`,
          )
        }
      }

      // Step 2 & 3: Run 3 Allocation Rounds for Elective Slots
      const executeRound = (roundNumber: 1 | 2 | 3) => {
        const courseCandidates = new Map<
          string,
          {
            prefId: string
            studentId: string
            studentDeptId: string
            studentDeptCode: string
            studentSemester: number
            submittedAt: string
            slotKey: string
            score: number
          }[]
        >()

        for (const pref of studentPrefList) {
          const slotMap = studentSlotState.get(pref.student_id)!
          const slots = extractSlots(pref.preferences)
          const studentDeptId = (pref.students as any)?.department_id ?? ''
          const studentDeptCode = (pref.students as any)?.departments?.code ?? ''
          const studentSemester = (pref.students as any)?.current_semester ?? body.semester

          for (const slotItem of slots) {
            const slotKey = `slot_${slotItem.slot}`
            const currentSlot = slotMap.get(slotKey)
            if (!currentSlot || currentSlot.resolved) continue
            if (slotItem.is_fixed) continue

            const targetPref = slotItem.choices.find((c) => c.rank === roundNumber)
            if (!targetPref) continue

            const course = courseMap.get(targetPref.course_id)
            if (!course) continue
            // Enforce course-level DEPARTMENT constraint
            const deptRules = (courseRulesMap.get(course.id) || []).filter((r) => r.rule === 'DEPARTMENT')
            if (deptRules.length > 0) {
              const allAllowed = deptRules.flatMap((r) => r.target.split(',').map((c) => c.trim().toUpperCase()))
              if (studentDeptCode && !allAllowed.includes(studentDeptCode.toUpperCase())) {
                continue
              }
            }

            // Enforce course-level COMPLETED_COURSE prerequisites
            const coursePrereqs = (courseRulesMap.get(course.id) || []).filter((r) => r.rule === 'COMPLETED_COURSE')
            if (coursePrereqs.length > 0) {
              const priorCodes = studentCompletedCourseCodesMap.get(pref.student_id) || new Set()
              const hasAllPrereqs = coursePrereqs.every((r) => priorCodes.has(r.target.trim().toUpperCase()))
              if (!hasAllPrereqs) {
                continue
              }
            }

            const score = calculateStudentScore(
              pref.student_id,
              studentSemester,
              studentDeptCode,
              course,
            )

            if (!courseCandidates.has(course.id)) {
              courseCandidates.set(course.id, [])
            }

            courseCandidates.get(course.id)!.push({
              prefId: pref.id,
              studentId: pref.student_id,
              studentDeptId,
              studentDeptCode,
              studentSemester,
              submittedAt: pref.submitted_at,
              slotKey,
              score,
            })
          }
        }

        // For each course, sort candidates and allocate available seats
        for (const [courseId, candidates] of courseCandidates.entries()) {
          const remSeats = remainingElectiveSeats.get(courseId) ?? 0
          if (remSeats <= 0 || candidates.length === 0) continue

          // Sort by score DESC, then tiebreaker submitted_at ASC (earlier wins)
          candidates.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score
            return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
          })

          const winnersCount = Math.min(remSeats, candidates.length)
          for (let i = 0; i < winnersCount; i++) {
            const winner = candidates[i]
            const slotMap = studentSlotState.get(winner.studentId)!
            if (slotMap.get(winner.slotKey)?.resolved) continue

            slotMap.set(winner.slotKey, { resolved: true, course_id: courseId })
            remainingElectiveSeats.set(courseId, remainingElectiveSeats.get(courseId)! - 1)

            finalAllocations.push({
              student_id: winner.studentId,
              preference_id: winner.prefId,
              slot_key: winner.slotKey,
              course_id: courseId,
              metadata: {
                allocated_by: `rank_${roundNumber}`,
                run_id: run.id,
                round: roundNumber,
                score: winner.score,
                allocated_at: new Date().toISOString(),
              },
            })
          }
        }
      }

      // Execute rounds 1, 2, 3
      executeRound(1)
      executeRound(2)
      executeRound(3)

      // Collect unallocated slots
      const unallocatedSlots: {
        student_id: string
        preference_id: string
        slot_key: string
        metadata: any
      }[] = []

      for (const pref of studentPrefList) {
        const slotMap = studentSlotState.get(pref.student_id)!
        const slots = extractSlots(pref.preferences)

        for (const slotItem of slots) {
          const slotKey = `slot_${slotItem.slot}`
          const cur = slotMap.get(slotKey)
          if (!cur?.resolved && !slotItem.is_fixed) {
            unallocatedSlots.push({
              student_id: pref.student_id,
              preference_id: pref.id,
              slot_key: slotKey,
              metadata: {
                allocated_by: 'unallocated',
                run_id: run.id,
                attempted_at: new Date().toISOString(),
              },
            })
          }
        }
      }

      // Step H: Commit allocations atomically via RPC
      const { data: rpcRes, error: rpcErr } = await this.supabase.admin.rpc(
        'apply_course_allocation',
        {
          p_run_id: run.id,
          p_campus_id: campusId,
          p_academic_year: body.academicYear,
          p_semester: body.semester,
          p_allocations: finalAllocations,
          p_unallocated: unallocatedSlots,
        },
      )

      if (rpcErr) {
        this.logger.warn(
          `RPC apply_course_allocation failed (${rpcErr.message}); executing direct fallback`,
        )

        // Direct Fallback:
        // Update student_registrations with winning allocations
        const affectedStudentIds = new Set<string>()

        for (const alloc of finalAllocations) {
          affectedStudentIds.add(alloc.student_id)
          const { data: currentReg } = await this.supabase.admin
            .from('student_registrations')
            .select('allocation_metadata')
            .eq('student_id', alloc.student_id)
            .eq('semester', body.semester)
            .eq('academic_year', body.academicYear)
            .maybeSingle()

          const mergedMeta = {
            ...(currentReg?.allocation_metadata || {}),
            [alloc.slot_key]: alloc.metadata,
          }

          await this.supabase.admin
            .from('student_registrations')
            .update({
              [`${alloc.slot_key}_course_id`]: alloc.course_id,
              allocation_metadata: mergedMeta,
            })
            .eq('student_id', alloc.student_id)
            .eq('semester', body.semester)
            .eq('academic_year', body.academicYear)

          // Also update registration_preferences allocation_metadata
          const { data: currentPref } = await this.supabase.admin
            .from('registration_preferences')
            .select('allocation_metadata')
            .eq('id', alloc.preference_id)
            .single()

          const mergedPrefMeta = {
            ...(currentPref?.allocation_metadata || {}),
            [alloc.slot_key]: alloc.metadata,
          }

          await this.supabase.admin
            .from('registration_preferences')
            .update({ allocation_metadata: mergedPrefMeta, updated_at: new Date().toISOString() })
            .eq('id', alloc.preference_id)
        }

        // Record unallocated status in registration_preferences
        for (const unalloc of unallocatedSlots) {
          const { data: currentPref } = await this.supabase.admin
            .from('registration_preferences')
            .select('allocation_metadata')
            .eq('id', unalloc.preference_id)
            .single()

          const mergedPrefMeta = {
            ...(currentPref?.allocation_metadata || {}),
            [unalloc.slot_key]: unalloc.metadata,
          }

          await this.supabase.admin
            .from('registration_preferences')
            .update({ allocation_metadata: mergedPrefMeta, updated_at: new Date().toISOString() })
            .eq('id', unalloc.preference_id)
        }

        // Safely recalculate total_credits for affected students in student_registrations
        for (const sId of affectedStudentIds) {
          try {
            const { data: reg } = await this.supabase.admin
              .from('student_registrations')
              .select('slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id')
              .eq('student_id', sId)
              .eq('semester', body.semester)
              .eq('academic_year', body.academicYear)
              .maybeSingle()

            if (reg) {
              const assignedIds = [
                reg.slot_1_course_id,
                reg.slot_2_course_id,
                reg.slot_3_course_id,
                reg.slot_4_course_id,
                reg.slot_5_course_id,
                reg.slot_6_course_id,
              ].filter(Boolean)

              if (assignedIds.length > 0) {
                const { data: courses } = await this.supabase.admin
                  .from('courses')
                  .select('credits')
                  .in('id', assignedIds)

                const calculatedTotal = (courses || []).reduce((acc: number, c: any) => acc + (c.credits || 0), 0)

                await this.supabase.admin
                  .from('student_registrations')
                  .update({ total_credits: calculatedTotal })
                  .eq('student_id', sId)
                  .eq('semester', body.semester)
                  .eq('academic_year', body.academicYear)
              }
            }
          } catch (calcErr: any) {
            this.logger.warn(`Failed to recalculate total_credits for student ${sId} in fallback: ${calcErr.message}`)
          }
        }
      }

      // Mark allocation run as completed
      await this.supabase.admin
        .from('allocation_runs')
        .update({
          status: 'completed',
          total_students: studentPrefList.length,
          fully_allocated: studentPrefList.length - unallocatedSlots.length,
          unallocated: unallocatedSlots.length,
          completed_at: new Date().toISOString(),
        })
        .eq('id', run.id)

      await this.auditLogger.log({
        eventType: AuditEvents.ALLOCATION_RUN_COMPLETED,
        userId: user.userId,
        userRole: user.role,
        action: `completed course allocation run for semester ${body.semester} (${body.academicYear})`,
        resourceType: 'allocation_run',
        resourceId: run.id,
        status: 'success',
        metadata: {
          allocated_count: finalAllocations.length,
          unallocated_count: unallocatedSlots.length,
          total_students: studentPrefList.length,
        },
      })

      return {
        success: true,
        run_id: run.id,
        allocated_count: finalAllocations.length,
        unallocated_count: unallocatedSlots.length,
        total_students: studentPrefList.length,
      }
    } catch (err: any) {
      await this.supabase.admin
        .from('allocation_runs')
        .update({
          status: 'failed',
          error_message: err?.message ?? 'Allocation algorithm execution encountered an error',
        })
        .eq('id', run.id)

      this.logger.error(`Allocation run failed: ${err?.message}`, err?.stack)
      throw new InternalServerErrorException(
        err?.message ?? 'Failed to execute course allocation algorithm',
      )
    }
  }

  // ──────────────── Status Polling ────────────────
  async getRunStatus(academicYear: string, semester: number, user: AuthUser) {
    const campusId = user.campus_id
    if (!campusId) {
      throw new BadRequestException('Campus ID missing')
    }

    const { data: run, error } = await this.supabase.admin
      .from('allocation_runs')
      .select('*')
      .eq('campus_id', campusId)
      .eq('academic_year', academicYear)
      .eq('semester', semester)
      .order('triggered_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      throw new InternalServerErrorException('Failed to query allocation run status')
    }

    return {
      success: true,
      run: run ?? null,
    }
  }

  // ──────────────── Clear Stale Failed Run ────────────────
  async clearFailedRun(runId: string, user: AuthUser) {
    const campusId = user.campus_id
    if (!campusId) {
      throw new BadRequestException('Campus ID missing')
    }

    // Fetch the run to verify it belongs to this campus and is actually failed
    const { data: run, error: fetchErr } = await this.supabase.admin
      .from('allocation_runs')
      .select('id, campus_id, status')
      .eq('id', runId)
      .maybeSingle()

    if (fetchErr || !run) {
      throw new NotFoundException('Allocation run not found')
    }

    if (run.campus_id !== campusId) {
      throw new ForbiddenException('You can only clear allocation runs for your campus')
    }

    if (run.status === 'running') {
      throw new BadRequestException('Cannot clear a run that is currently in progress')
    }

    // Delete from system_logs (allocation_runs is a view backed by system_logs)
    const { error: delErr } = await this.supabase.admin
      .from('system_logs')
      .delete()
      .eq('id', runId)
      .eq('log_type', 'allocation_run')

    if (delErr) {
      this.logger.error(`Failed to clear allocation run ${runId}: ${delErr.message}`)
      throw new InternalServerErrorException('Failed to clear allocation run record')
    }

    await this.auditLogger.log({
      eventType: AuditEvents.ALLOCATION_RUN_COMPLETED,
      userId: user.userId,
      userRole: user.role,
      action: `cleared stale failed allocation run ${runId}`,
      resourceType: 'allocation_run',
      resourceId: runId,
      status: 'success',
    })

    return { success: true, message: 'Allocation run record cleared' }
  }

  // ──────────────── HOD: Unresolved Students ────────────────
  async getUnresolvedStudents(semesterId: string | number, user: AuthUser) {
    const departmentId = user.department_id
    if (!departmentId) {
      throw new ForbiddenException('Department affiliation required')
    }

    const sem = Number(semesterId)
    if (isNaN(sem)) throw new BadRequestException('Invalid semester')

    // Find students in HOD's department
    const { data: students, error: studentErr } = await this.supabase.admin
      .from('students')
      .select('id, full_name, cap_application_number, current_semester')
      .eq('department_id', departmentId)
      .eq('current_semester', sem)

    if (studentErr) throw new InternalServerErrorException('Failed to fetch department students')

    const studentIds = (students ?? []).map((s) => s.id)
    if (studentIds.length === 0) {
      return { success: true, unresolvedStudents: [] }
    }

    // Fetch preferences from registration_preferences
    const { data: prefList, error: prefErr } = await this.supabase.admin
      .from('registration_preferences')
      .select('id, student_id, preferences, allocation_metadata')
      .in('student_id', studentIds)
      .eq('semester', sem)

    if (prefErr) throw new InternalServerErrorException('Failed to fetch registration preferences')

    // Fetch confirmed registrations from student_registrations
    const { data: regList } = await this.supabase.admin
      .from('student_registrations')
      .select('id, student_id, slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id, allocation_metadata')
      .in('student_id', studentIds)
      .eq('semester', sem)

    const regMap = new Map((regList ?? []).map((r) => [r.student_id, r]))

    // Gather course IDs to fetch titles
    const courseIdsToFetch = new Set<string>()
    for (const pRow of prefList ?? []) {
      const raw = pRow.preferences
      if (Array.isArray(raw)) {
        for (const sItem of raw) {
          for (const c of sItem.choices || []) {
            if (c.course_id) courseIdsToFetch.add(c.course_id)
          }
        }
      } else if (raw && typeof raw === 'object') {
        for (const cList of Object.values(raw) as any[]) {
          if (Array.isArray(cList)) {
            for (const c of cList) {
              if (c.course_id) courseIdsToFetch.add(c.course_id)
            }
          }
        }
      }
    }

    let courseNameMap = new Map<string, { code: string; title: string }>()
    if (courseIdsToFetch.size > 0) {
      const { data: courseMeta } = await this.supabase.admin
        .from('courses')
        .select('id, course_code, title')
        .in('id', Array.from(courseIdsToFetch))

      for (const cm of courseMeta ?? []) {
        courseNameMap.set(cm.id, { code: cm.course_code, title: cm.title })
      }
    }

    const studentMap = new Map(students!.map((s) => [s.id, s]))
    const unresolvedList: any[] = []

    for (const pRow of prefList ?? []) {
      const student = studentMap.get(pRow.student_id)
      if (!student) continue

      const confirmedReg = regMap.get(pRow.student_id)
      const meta = (pRow.allocation_metadata as Record<string, any>) || {}
      const unresolvedSlots: any[] = []

      // Extract slot preferences
      const rawPrefs = pRow.preferences
      const slotItems: { slot: number; is_fixed: boolean; choices: PreferenceChoice[] }[] = []
      if (Array.isArray(rawPrefs)) {
        for (const item of rawPrefs) {
          slotItems.push({
            slot: item.slot,
            is_fixed: item.is_fixed ?? (item.rule === 'FIXED' || item.rule === 'CAMPUS_FIXED' || item.rule === 'AEC_ELECT'),
            choices: item.choices || [],
          })
        }
      } else if (rawPrefs && typeof rawPrefs === 'object') {
        for (const [k, v] of Object.entries(rawPrefs)) {
          const slotNum = parseInt(k.replace('slot_', ''), 10) || 1
          slotItems.push({
            slot: slotNum,
            is_fixed: false,
            choices: Array.isArray(v) ? v : [],
          })
        }
      }

      for (const slotItem of slotItems) {
        const slotKey = `slot_${slotItem.slot}`
        const confirmedCourseId = confirmedReg ? (confirmedReg as any)[`${slotKey}_course_id`] : null
        const slotMeta = meta[slotKey]

        // Unresolved if not fixed and not confirmed
        const isFixed = slotItem.is_fixed || slotMeta?.allocated_by === 'fixed'
        if (!isFixed && !confirmedCourseId && slotItem.choices.length > 0) {
          const submittedPrefs = slotItem.choices.map((c) => ({
            rank: c.rank,
            course_id: c.course_id,
            course_code: courseNameMap.get(c.course_id)?.code ?? 'Unknown',
            course_title: courseNameMap.get(c.course_id)?.title ?? 'Course',
          }))

          unresolvedSlots.push({
            slot_key: slotKey,
            slot_number: slotItem.slot,
            submitted_preferences: submittedPrefs,
          })
        }
      }

      if (unresolvedSlots.length > 0) {
        unresolvedList.push({
          preference_id: pRow.id,
          registration_id: confirmedReg?.id ?? null,
          student_id: student.id,
          full_name: student.full_name,
          cap_application_number: student.cap_application_number,
          current_semester: student.current_semester,
          unresolved_slots: unresolvedSlots,
        })
      }
    }

    return {
      success: true,
      unresolvedStudents: unresolvedList,
    }
  }

  // ──────────────── HOD: Remaining Course Seats ────────────────
  async getRemainingSeats(semesterId: string | number, user: AuthUser) {
    const departmentId = user.department_id
    if (!departmentId) {
      throw new ForbiddenException('Department affiliation required')
    }

    const sem = Number(semesterId)
    if (isNaN(sem)) throw new BadRequestException('Invalid semester')

    // Fetch courses owned by HOD's department for this semester
    const { data: courses, error: courseErr } = await this.supabase.admin
      .from('courses')
      .select('id, course_code, title, credits, category, seat_limit')
      .eq('department_id', departmentId)
      .eq('semester', sem)

    if (courseErr) throw new InternalServerErrorException('Failed to fetch courses')

    const courseList = courses ?? []
    const results: any[] = []

    // Fetch registrations once for this semester to avoid N+1 queries (L3)
    const { data: registrations, error: regError } = await this.supabase.admin
      .from('student_registrations')
      .select('slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id')
      .eq('semester', sem)

    if (regError) {
      this.logger.error(`Failed to fetch student registrations: ${regError.message}`)
      throw new InternalServerErrorException('Failed to fetch student registrations')
    }

    const allocationCounts = new Map<string, number>()
    if (registrations) {
      for (const reg of registrations) {
        for (let i = 1; i <= 6; i++) {
          const cId = (reg as any)[`slot_${i}_course_id`]
          if (cId) {
            allocationCounts.set(cId, (allocationCounts.get(cId) || 0) + 1)
          }
        }
      }
    }

    for (const course of courseList) {
      const seatLimit = course.seat_limit ? Number(course.seat_limit) : 60
      const totalAllocated = allocationCounts.get(course.id) || 0
      const remaining = Math.max(0, seatLimit - totalAllocated)

      results.push({
        id: course.id,
        course_code: course.course_code,
        title: course.title,
        category: course.category,
        credits: course.credits,
        seat_limit: seatLimit,
        total_allocated: totalAllocated,
        remaining_seats: remaining,
      })
    }

    return {
      success: true,
      courses: results,
    }
  }

  // ──────────────── HOD: Manual Allocation ────────────────
  async manualAllocate(
    body: { student_id: string; slot_key: string; course_id: string },
    user: AuthUser,
  ) {
    const departmentId = user.department_id
    if (!departmentId) {
      throw new ForbiddenException('Department affiliation required')
    }

    const { student_id, slot_key, course_id } = body
    if (!student_id || !slot_key || !course_id) {
      throw new BadRequestException('Missing required fields (student_id, slot_key, course_id)')
    }

    const validSlots = ['slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8']
    if (!validSlots.includes(slot_key)) {
      throw new BadRequestException(`Invalid slot key: ${slot_key}`)
    }

    // Validate student exists and belongs to HOD's department (H1)
    const { data: student, error: studentErr } = await this.supabase.admin
      .from('students')
      .select('id, department_id, campus_id, campuses(academic_year)')
      .eq('id', student_id)
      .single()

    if (studentErr || !student) {
      throw new NotFoundException('Student not found')
    }

    if (student.department_id !== departmentId) {
      throw new ForbiddenException('You may only allocate courses to students in your department')
    }

    // Validate course belongs to HOD's department
    const { data: course, error: courseErr } = await this.supabase.admin
      .from('courses')
      .select('id, course_code, title, department_id, seat_limit, semester')
      .eq('id', course_id)
      .single()

    if (courseErr || !course) {
      throw new NotFoundException('Course not found')
    }

    if (course.department_id !== departmentId) {
      throw new ForbiddenException('You may only allocate courses belonging to your department')
    }

    // Validate course capacity in student_registrations
    const seatLimit = course.seat_limit ? Number(course.seat_limit) : 60
    const { count: allocatedCount } = await this.supabase.admin
      .from('student_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('semester', course.semester)
      .or(
        `slot_1_course_id.eq.${course.id},slot_2_course_id.eq.${course.id},slot_3_course_id.eq.${course.id},slot_4_course_id.eq.${course.id},slot_5_course_id.eq.${course.id},slot_6_course_id.eq.${course.id}`,
      )

    if ((allocatedCount ?? 0) >= seatLimit) {
      throw new BadRequestException(
        `Course ${course.course_code} has no remaining seats (${seatLimit}/${seatLimit})`,
      )
    }

    // Ensure student_registrations record exists
    const { data: reg } = await this.supabase.admin
      .from('student_registrations')
      .select('id, allocation_metadata, pathway_id, campus_id, academic_year')
      .eq('student_id', student_id)
      .eq('semester', course.semester)
      .maybeSingle()

    const regMeta = (reg?.allocation_metadata as Record<string, any>) || {}
    if (regMeta[slot_key]?.allocated_by === 'fixed') {
      throw new BadRequestException('Cannot manually override a fixed slot assignment')
    }

    const hodMeta = {
      allocated_by: 'hod',
      by_user: user.userId,
      at: new Date().toISOString(),
    }

    // If student_registrations row doesn't exist yet, get student's campus and academic_year
    if (!reg) {
      const { data: settings } = await this.supabase.admin
        .from('campus_settings')
        .select('academic_year')
        .eq('campus_id', student?.campus_id)
        .maybeSingle()

      const academicYear = settings?.academic_year || '2026-27'

      await this.supabase.admin.from('student_registrations').insert({
        student_id,
        campus_id: student?.campus_id,
        semester: course.semester,
        academic_year: academicYear,
        [`${slot_key}_course_id`]: course_id,
        allocation_metadata: { [slot_key]: hodMeta },
      })
    } else {
      const updatedMeta = {
        ...regMeta,
        [slot_key]: hodMeta,
      }

      await this.supabase.admin
        .from('student_registrations')
        .update({
          [`${slot_key}_course_id`]: course_id,
          allocation_metadata: updatedMeta,
        })
        .eq('id', reg.id)
    }

    // Also update registration_preferences allocation_metadata
    const { data: prefRow } = await this.supabase.admin
      .from('registration_preferences')
      .select('id, allocation_metadata')
      .eq('student_id', student_id)
      .eq('semester', course.semester)
      .maybeSingle()

    if (prefRow) {
      const updatedPrefMeta = {
        ...(typeof prefRow.allocation_metadata === 'object' && prefRow.allocation_metadata ? prefRow.allocation_metadata : {}),
        [slot_key]: hodMeta,
      }

      await this.supabase.admin
        .from('registration_preferences')
        .update({
          allocation_metadata: updatedPrefMeta,
          updated_at: new Date().toISOString(),
        })
        .eq('id', prefRow.id)
    }

    // Audit log
    await this.auditLogger.log({
      eventType: AuditEvents.MANUAL_ALLOCATION,
      userId: user.userId,
      userRole: user.role,
      action: `manually allocated ${course.course_code} to student ${student_id} for ${slot_key}`,
      resourceType: 'registration',
      resourceId: reg?.id || student_id,
      status: 'success',
      metadata: {
        student_id,
        slot_key,
        course_id,
        course_code: course.course_code,
      },
    })

    return {
      success: true,
      message: `Course ${course.course_code} successfully allocated to student`,
    }
  }
}
