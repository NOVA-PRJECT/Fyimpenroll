import { termOperation } from '../../core/database/term-operation'
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
import { Pathway } from '../../core/types/course.types'
import {
  isCourseEligibleForSlot,
  getStudentSlotDefinition,
  getBlueprintPathways,
} from '../../core/utils/slotRules'
import { allocationRunResponse } from '../../core/logging/allocation-run'
import * as crypto from 'crypto'
import { revalidateAllocationChoices } from '../../core/utils/allocationEligibility'
import { fetchAllPaginated, fetchByIdChunks } from '../../core/database/pagination.util'

export interface CourseItem {
  id: string
  course_code: string
  title: string
  semester: number
  department_id: string
  seat_limit: number
  category: string
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
  ) {}

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

    // Validate semester range (supporting all 10 semesters)
    const sem = Number(body.semester)
    if (isNaN(sem) || sem < 1 || sem > 10) {
      throw new BadRequestException('Semester must be between 1 and 10')
    }

    // F22: Registration window must be closed before allocation can run
    const { data: campusSettings } = await this.supabase.admin
      .from('campus_settings')
      .select('deadline')
      .eq('campus_id', campusId)
      .maybeSingle()

    if (!campusSettings?.deadline || new Date() < new Date(campusSettings.deadline)) {
      throw new BadRequestException(
        'Registration window is still open for this campus. Allocation can only be run after registration closes.',
      )
    }

    // F22 & R15: Verify timetable has not already been published for this campus cohort
    let timetablePubQuery = this.supabase.admin
      .from('current_timetable_entries')
      .select('*', { count: 'exact', head: true })
      .eq('academic_year', body.academicYear)
      .eq('semester', sem)
      .eq('status', 'published')

    if (campusId && typeof (timetablePubQuery as any)?.eq === 'function') {
      try {
        const scoped = (timetablePubQuery as any).eq('campus_id', campusId)
        if (scoped) timetablePubQuery = scoped
      } catch (_) {}
    }

    const { count: publishedCount } = await timetablePubQuery

    if ((publishedCount ?? 0) > 0) {
      throw new ConflictException(
        `Timetable has already been published for Semester ${body.semester} (${body.academicYear}). Allocation is locked.`,
      )
    }

    // F23 & R16: Atomically claim allocation run via claim_allocation_run RPC with worker fencing token
    const fencingToken = crypto.randomUUID()
    let runId: string
    const { data: claimedRunId, error: claimErr } = await termOperation(this.supabase.admin, user, 'claim_allocation_run',
      {
        p_campus_id: campusId,
        p_academic_year: body.academicYear,
        p_semester: sem,
        p_user_id: user.userId,
        p_lease_seconds: 300,
        p_fencing_token: fencingToken,
      },
    )

    if (claimErr) {
      const errMsg = claimErr.message || ''
      if (errMsg.includes('already in progress')) {
        throw new ConflictException(
          'An allocation run is already in progress for this academic year and semester',
        )
      }
      if (errMsg.includes('already been completed')) {
        throw new ConflictException(
          `Allocation has already been completed for Semester ${body.semester} (${body.academicYear}). In production, allocation can only be executed once per semester per academic year.`,
        )
      }
      if (errMsg.includes('still open')) {
        throw new BadRequestException(
          'Registration window is still open for this campus. Allocation can only be run after registration closes.',
        )
      }
      if (errMsg.includes('already been published')) {
        throw new ConflictException(
          `Timetable has already been published for Semester ${body.semester} (${body.academicYear}). Allocation is locked.`,
        )
      }

      throw new InternalServerErrorException(`Allocation claim failed: ${errMsg}`)
    }
    if (typeof claimedRunId !== 'string' || !claimedRunId) throw new InternalServerErrorException('Allocation claim returned no run ID')
    runId = claimedRunId

    try {
      // Step C: Fetch all courses offered in this semester
      const coursesData = await fetchAllPaginated<any>(this.supabase.admin.from('courses')
        .select('id, course_code, title, semester, department_id, seat_limit, category').eq('semester', body.semester).order('id'))

      const courses: CourseItem[] = (coursesData ?? []).map((c) => ({
        id: c.id,
        course_code: c.course_code,
        title: c.title,
        semester: c.semester,
        category: c.category,
        department_id: c.department_id,
        seat_limit: c.seat_limit ? Number(c.seat_limit) : 60,
      }))

      const courseMap = new Map<string, CourseItem>(courses.map((c) => [c.id, c]))

      // Step E & R36: Fetch all student preference submissions from registration_preferences (paginated)
      // Only students who have a row in registration_preferences are processed!
      const prefQuery = this.supabase.admin
        .from('registration_preferences')
        .select('id, student_id, campus_id, semester, academic_year, pathway_id, preferences, submitted_at')
        .eq('campus_id', campusId)
        .eq('academic_year', body.academicYear)
        .eq('semester', body.semester)

      const rawPrefs = await fetchAllPaginated<any>(prefQuery.order('id'))
      const studentIds = Array.from(new Set(rawPrefs.map((p) => p.student_id)))

      // Fetch student details for all candidates
      const studentMap = new Map<string, any>()
      if (studentIds.length > 0) {
        const studentsData = await fetchByIdChunks<any>(studentIds, ids => this.supabase.admin.from('students')
          .select('id, department_id, current_semester').in('id', ids).order('id'))
        if (studentsData) {
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

      const departmentIds = [...new Set(studentPrefList.map(p => p.students?.department_id).filter(Boolean))] as string[]
      const blueprints = await fetchByIdChunks<any>(departmentIds, ids => this.supabase.admin
        .from('semester_blueprints').select('*')
        .in('department_id', ids).eq('semester', body.semester).order('id'))
      const blueprintByDepartment = new Map(blueprints.map(b => [b.department_id, b]))
      const departments = await fetchAllPaginated<any>(this.supabase.admin.from('departments').select('id, code').order('id'))
      const departmentMap = new Map<string, string>(departments.map(d => [d.code.toUpperCase(), d.id]))
      const skippedChoices: Array<{ student_id: string; slot: number; course_id: string; rank: number; reason: string }> = []
      for (const pref of studentPrefList) {
        const pathways = getBlueprintPathways(blueprintByDepartment.get(pref.students?.department_id))
        const pathway = pathways.find((p: Pathway) => p.id === pref.pathway_id)
          || (!pref.pathway_id && pathways.length === 1 ? pathways[0] : undefined)
        const checked = revalidateAllocationChoices(extractSlots(pref.preferences), pathway, {
          department_id: pref.students?.department_id ?? '',
          current_semester: pref.students?.current_semester ?? 0,
        }, courseMap, departmentMap)
        pref.preferences = checked.slots
        skippedChoices.push(...checked.skipped.map(choice => ({ student_id: pref.student_id, ...choice })))
      }
      if (skippedChoices.length) this.logger.warn(`Skipped ${skippedChoices.length} saved choices that no longer satisfy blueprint eligibility`)

      // Track slot resolution status per registration/student across all 8 slots (F15):
      // student_id -> slotKey -> { resolved: boolean, course_id: string | null }
      const studentSlotState = new Map<string, Map<string, { resolved: boolean; course_id: string | null }>>()
      for (const pref of studentPrefList) {
        const slotMap = new Map<string, { resolved: boolean; course_id: string | null }>()
        for (let s = 1; s <= 8; s++) {
          slotMap.set(`slot_${s}`, { resolved: false, course_id: null })
        }
        studentSlotState.set(pref.student_id, slotMap)
      }

      // F21 & R36: Baseline capacity calculation across all campuses for active academic year & semester
      const existingRegQuery = this.supabase.admin
        .from('current_student_registrations')
        .select('student_id, slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id')
        .eq('academic_year', body.academicYear)
        .eq('semester', body.semester)

      const existingRegistrations = await fetchAllPaginated<any>(existingRegQuery.order('id'))

      const existingEnrollmentCounts = new Map<string, number>()
      const existingStudentFixedCourses = new Map<string, Set<string>>()
      for (const reg of existingRegistrations ?? []) {
        const studentCourseSet = new Set<string>()
        for (let s = 1; s <= 8; s++) {
          const cid = (reg as any)[`slot_${s}_course_id`]
          if (cid) {
            existingEnrollmentCounts.set(cid, (existingEnrollmentCounts.get(cid) || 0) + 1)
            studentCourseSet.add(cid)
          }
        }
        existingStudentFixedCourses.set(reg.student_id, studentCourseSet)
      }

      // Track available seats per course initialized with true cross-campus remaining capacity (F21)
      const remainingElectiveSeats = new Map<string, number>()
      for (const course of courses) {
        const seatLimit = course.seat_limit ? Number(course.seat_limit) : 60
        const alreadyEnrolled = existingEnrollmentCounts.get(course.id) || 0
        remainingElectiveSeats.set(course.id, Math.max(0, seatLimit - alreadyEnrolled))
      }

      // Step 1: Fixed Slot Resolution in memory
      // Deducts fixed seats from the course's available capacity before elective allocation begins.
      // Fixed course enrollments are committed atomically via the allocation transaction, not via premature pre-run writes (R10).
      // R13: If this fixed course was ALREADY enrolled by this student in existingRegistrations,
      // it is already counted in existingEnrollmentCounts! Do NOT deduct it a second time.
      for (const pref of studentPrefList) {
        const slots = extractSlots(pref.preferences)
        const slotMap = studentSlotState.get(pref.student_id)!
        const alreadyEnrolledCoursesForStudent = existingStudentFixedCourses.get(pref.student_id)

        for (const slotItem of slots) {
          const slotKey = `slot_${slotItem.slot}`
          if (slotItem.is_fixed && slotItem.choices.length > 0) {
            const fixedCourseId = slotItem.choices[0].course_id
            slotMap.set(slotKey, { resolved: true, course_id: fixedCourseId })

            // Deduct seat in memory ONLY if not already counted in existingEnrollmentCounts for this student (R13)
            const isAlreadyEnrolled = alreadyEnrolledCoursesForStudent?.has(fixedCourseId)
            if (!isAlreadyEnrolled) {
              const curRem = remainingElectiveSeats.get(fixedCourseId) ?? 0
              remainingElectiveSeats.set(fixedCourseId, Math.max(0, curRem - 1))
            }
          }
        }
      }

      const finalAllocations: {
        student_id: string
        preference_id: string
        slot_key: string
        course_id: string
        metadata: any
      }[] = []

      // F18: Pure rank-first rounds (direct confirmation pre-round shortcut removed)

      // Step 2 & 3: Run 3 Allocation Rounds for Elective Slots
      const executeRound = (roundNumber: 1 | 2 | 3) => {
        const courseCandidates = new Map<
          string,
          {
            prefId: string
            studentId: string
            submittedAt: string
            slotKey: string
            score: number
          }[]
        >()

        for (const pref of studentPrefList) {
          const slotMap = studentSlotState.get(pref.student_id)!
          const slots = extractSlots(pref.preferences)
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

            // F20: Duplicate check - ensure student doesn't already have this course resolved
            let alreadyAssignedThisCourse = false
            for (let s = 1; s <= 8; s++) {
              if (slotMap.get(`slot_${s}`)?.course_id === course.id) {
                alreadyAssignedThisCourse = true
                break
              }
            }
            if (alreadyAssignedThisCourse) continue

            const score = Math.max(0, studentSemester - course.semester)

            if (!courseCandidates.has(course.id)) {
              courseCandidates.set(course.id, [])
            }

            courseCandidates.get(course.id)!.push({
              prefId: pref.id,
              studentId: pref.student_id,
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

          // F18: Deterministic sorting - Score DESC, primary tiebreaker original submitted_at ASC, secondary tiebreaker student_id ASC
          candidates.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score
            const timeA = new Date(a.submittedAt).getTime()
            const timeB = new Date(b.submittedAt).getTime()
            if (timeA !== timeB) return timeA - timeB
            return a.studentId.localeCompare(b.studentId)
          })

          const winnersCount = Math.min(remSeats, candidates.length)
          for (let i = 0; i < winnersCount; i++) {
            const winner = candidates[i]
            const slotMap = studentSlotState.get(winner.studentId)!
            if (slotMap.get(winner.slotKey)?.resolved) continue

            // F20: Duplicate check in case student won another slot in the same round with this same course
            let alreadyAssignedThisCourse = false
            for (let s = 1; s <= 8; s++) {
              if (slotMap.get(`slot_${s}`)?.course_id === courseId) {
                alreadyAssignedThisCourse = true
                break
              }
            }
            if (alreadyAssignedThisCourse) continue

            slotMap.set(winner.slotKey, { resolved: true, course_id: courseId })
            remainingElectiveSeats.set(courseId, remainingElectiveSeats.get(courseId)! - 1)

            finalAllocations.push({
              student_id: winner.studentId,
              preference_id: winner.prefId,
              slot_key: winner.slotKey,
              course_id: courseId,
              metadata: {
                allocated_by: `rank_${roundNumber}`,
                run_id: runId,
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
                run_id: runId,
                attempted_at: new Date().toISOString(),
              },
            })
          }
        }
      }

      // F26: Calculate non-negative distinct student metrics
      const totalStudents = studentPrefList.length
      let fullyAllocatedStudents = 0
      let partiallyAllocatedStudents = 0
      let unallocatedStudents = 0
      let unresolvedCoreSlots = 0
      let unresolvedOptionalSlots = 0

      for (const pref of studentPrefList) {
        const slots = extractSlots(pref.preferences)
        const electiveSlots = slots.filter((s) => !s.is_fixed)
        if (electiveSlots.length === 0) {
          // If student only had fixed slots, they are fully resolved
          fullyAllocatedStudents += 1
          continue
        }

        const slotMap = studentSlotState.get(pref.student_id)!
        let resolvedCount = 0
        for (const s of electiveSlots) {
          const slotKey = `slot_${s.slot}`
          if (slotMap.get(slotKey)?.resolved) {
            resolvedCount += 1
          }
        }

        if (resolvedCount === electiveSlots.length) {
          fullyAllocatedStudents += 1
        } else if (resolvedCount > 0) {
          partiallyAllocatedStudents += 1
        } else {
          unallocatedStudents += 1
        }
      }

      for (const unalloc of unallocatedSlots) {
        const slotNum = parseInt(unalloc.slot_key.replace('slot_', ''), 10) || 1
        if (slotNum <= 6) {
          unresolvedCoreSlots += 1
        } else {
          unresolvedOptionalSlots += 1
        }
      }

      const summaryPayload = {
        total_students: totalStudents,
        fully_allocated: fullyAllocatedStudents,
        partially_allocated: partiallyAllocatedStudents,
        unallocated: unallocatedStudents,
        summary: {
          allocated_slots_count: finalAllocations.length,
          unallocated_slots_count: unallocatedSlots.length,
          unresolved_core_slots: unresolvedCoreSlots,
          unresolved_optional_slots: unresolvedOptionalSlots,
          skipped_choices_count: skippedChoices.length,
          skipped_choices: skippedChoices.slice(0, 100),
          skipped_choices_truncated: skippedChoices.length > 100,
        },
      }

      // Step H: Commit allocations atomically via RPC (F24, F70, R16 Fencing)
      const { error: rpcErr } = await this.supabase.admin.rpc(
        'apply_course_allocation',
        {
          p_run_id: runId,
          p_campus_id: campusId,
          p_academic_year: body.academicYear,
          p_semester: body.semester,
          p_allocations: finalAllocations,
          p_unallocated: unallocatedSlots,
          p_summary: summaryPayload,
          p_fencing_token: fencingToken,
        },
      )

      if (rpcErr) {
        // F24: Fail-fast without partial write fallback; preserve consistent database state
        this.logger.error(`RPC apply_course_allocation failed: ${rpcErr.message}`)
        throw new InternalServerErrorException(
          `Failed to commit course allocations atomically: ${rpcErr.message}`,
        )
      }

      // The RPC commits enrollment, summary and completion in one transaction.
      await this.auditLogger.log({
        eventType: AuditEvents.ALLOCATION_RUN_COMPLETED,
        userId: user.userId,
        userRole: user.role,
        action: `completed course allocation run for semester ${body.semester} (${body.academicYear})`,
        resourceType: 'allocation_run',
        resourceId: runId,
        status: 'success',
        metadata: {
          allocated_count: finalAllocations.length,
          unallocated_count: unallocatedSlots.length,
          total_students: totalStudents,
          fully_allocated: fullyAllocatedStudents,
          partially_allocated: partiallyAllocatedStudents,
          unallocated: unallocatedStudents,
        },
      })

      return {
        success: true,
        run_id: runId,
        skipped_choices_count: skippedChoices.length,
        allocated_count: finalAllocations.length,
        unallocated_count: unallocatedSlots.length,
        total_students: totalStudents,
        fully_allocated: fullyAllocatedStudents,
        partially_allocated: partiallyAllocatedStudents,
        unallocated: unallocatedStudents,
      }
    } catch (err: any) {
      if (runId) {
        try {
          const { error } = await this.supabase.admin.rpc('fail_allocation_worker', {
            p_run_id: runId, p_fencing_token: fencingToken,
            p_error: err?.message ?? 'Allocation execution failed',
          })
          if (error) this.logger.warn('Could not record allocation failure; the lease will allow recovery')
        } catch { this.logger.warn('Allocation failure recording unavailable; the lease will allow recovery') }
      }

      this.logger.error(`Allocation run failed: ${err?.message}`, err?.stack)
      if (
        err instanceof BadRequestException ||
        err instanceof ConflictException ||
        err instanceof ForbiddenException ||
        err instanceof NotFoundException ||
        err instanceof InternalServerErrorException
      ) {
        throw err
      }
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
      .from('current_system_logs')
      .select('id,status,academic_year,semester,campus_id,user_id,started_at,completed_at,created_at,error_message,metadata')
      .eq('log_type', 'allocation_run')
      .eq('campus_id', campusId)
      .eq('academic_year', academicYear)
      .eq('semester', semester)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      throw new InternalServerErrorException('Failed to query allocation run status')
    }

    return {
      success: true,
      run: allocationRunResponse(run),
    }
  }

  // ──────────────── Clear Stale Failed Run ────────────────
  async clearFailedRun(runId: string, user: AuthUser) {
    const campusId = user.campus_id
    if (!campusId) {
      throw new BadRequestException('Campus ID missing')
    }

    // Fetch the run to verify it belongs to this campus and is actually failed (F25)
    const { data: run, error: fetchErr } = await this.supabase.admin
      .from('current_system_logs')
      .select('id, campus_id, academic_year, semester, status')
      .eq('log_type', 'allocation_run')
      .eq('id', runId)
      .maybeSingle()

    if (fetchErr || !run) {
      throw new NotFoundException('Allocation run not found')
    }

    if (run.campus_id !== campusId) {
      throw new ForbiddenException('You can only clear allocation runs for your campus')
    }

    // F25: Completed runs must never be deleted, and running runs cannot be cleared
    if (run.status !== 'failed') {
      throw new BadRequestException(
        `Only failed allocation runs can be cleared. Completed or running runs cannot be deleted (status: "${run.status}").`,
      )
    }

    // F25 & R15: Published cohorts cannot be reallocated or cleared (scoped to campus)
    let publishedTimetableQuery = this.supabase.admin
      .from('current_timetable_entries')
      .select('*', { count: 'exact', head: true })
      .eq('academic_year', run.academic_year)
      .eq('semester', run.semester)
      .eq('status', 'published')

    if (run.campus_id && typeof (publishedTimetableQuery as any)?.eq === 'function') {
      try {
        const scoped = (publishedTimetableQuery as any).eq('campus_id', run.campus_id)
        if (scoped) publishedTimetableQuery = scoped
      } catch (_) {}
    }

    const { count: publishedCount } = await publishedTimetableQuery

    if ((publishedCount ?? 0) > 0) {
      throw new BadRequestException(
        'Cannot clear allocation run for a cohort with published timetable entries.',
      )
    }

    // Delete only the verified failed allocation log.
    const { error: delErr } = await this.supabase.admin
      .from('current_system_logs')
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

    const campusId = user.campus_id
    let academicYear = ''
    if (campusId) {
      const { data: settings } = await this.supabase.admin
        .from('campus_settings')
        .select('academic_year')
        .eq('campus_id', campusId)
        .maybeSingle()
      academicYear = settings?.academic_year || ''
    }

    // Find students in HOD's department
    if (!campusId || !academicYear) throw new BadRequestException('Active campus and academic year are required')
    const students = await fetchAllPaginated<any>(this.supabase.admin.from('students')
      .select('id, full_name, cap_application_number, current_semester')
      .eq('department_id', departmentId).eq('campus_id',campusId).eq('current_semester',sem).order('id'))

    const studentIds = (students ?? []).map((s) => s.id)
    if (studentIds.length === 0) {
      return { success: true, unresolvedStudents: [] }
    }

    const prefList = await fetchByIdChunks<any>(studentIds, ids => this.supabase.admin.from('registration_preferences')
      .select('id, student_id, preferences').in('student_id',ids)
      .eq('semester',sem).eq('academic_year',academicYear).order('id'))
    const regList = await fetchByIdChunks<any>(studentIds, ids => this.supabase.admin.from('current_student_registrations')
      .select('id, student_id, slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id, allocation_metadata')
      .in('student_id',ids).eq('semester',sem).eq('academic_year',academicYear).order('id'))

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
      const meta = (confirmedReg?.allocation_metadata as Record<string, any>) || {}
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
  async getRemainingSeats(semesterId: string | number, user: AuthUser, studentId?: string, slotKey?: string) {
    const departmentId = user.department_id
    if (!departmentId) {
      throw new ForbiddenException('Department affiliation required')
    }

    const sem = Number(semesterId)
    if (!Number.isInteger(sem) || sem < 1 || sem > 10) throw new BadRequestException('Invalid semester')
    if ((studentId || slotKey) && (!studentId || !slotKey || !/^slot_[1-8]$/.test(slotKey))) {
      throw new BadRequestException('A student and valid slot_key are required together')
    }

    const campusId = user.campus_id
    if (!campusId) {
      throw new BadRequestException('Campus ID missing')
    }

    const { data: settings } = await this.supabase.admin
      .from('campus_settings')
      .select('academic_year')
      .eq('campus_id', campusId)
      .maybeSingle()

    if (!settings?.academic_year) {
      throw new BadRequestException('Campus academic_year is not configured')
    }
    const academicYear = settings.academic_year

    let courseList: any[]
    let registration: any
    let slotName: string | undefined
    const departments = new Map<string, { code: string; name: string }>()
    if (studentId && slotKey) {
      // A placement is governed by the student's pathway, not the course-owning department.
      const [studentRes, registrationRes, blueprintRes] = await Promise.all([
        this.supabase.admin.from('students').select('id, campus_id, department_id, current_semester')
          .eq('id', studentId).eq('department_id', departmentId).eq('campus_id', campusId).maybeSingle(),
        this.supabase.admin.from('current_student_registrations').select('*')
          .eq('student_id', studentId).eq('campus_id', campusId).eq('semester', sem).eq('academic_year', academicYear).maybeSingle(),
        this.supabase.admin.from('semester_blueprints').select('*')
          .eq('department_id', departmentId).eq('semester', sem).maybeSingle(),
      ])
      if (studentRes.error || registrationRes.error || blueprintRes.error) {
        throw new InternalServerErrorException('Could not load manual allocation rules')
      }
      const student = studentRes.data
      if (!student) throw new ForbiddenException('You may only view allocation options for students in your department and campus')
      if (student.current_semester !== sem) throw new BadRequestException('Semester must match the student’s current semester')
      registration = registrationRes.data
      if (!registration) throw new NotFoundException('Student registration not found for this semester')
      if (!blueprintRes.data) throw new NotFoundException('Semester blueprint not configured')
      const pathways = getBlueprintPathways(blueprintRes.data)
      const pathwayId = registration.pathway_id
      const pathway = pathways.find(p => p.id === pathwayId) || (!pathwayId && pathways.length === 1 ? pathways[0] : undefined)
      const slotNumber = Number(slotKey.replace('slot_', ''))
      const definition = getStudentSlotDefinition(pathway, slotNumber, departmentId)
      if (!definition) throw new BadRequestException('The selected pathway does not define this slot')
      if ([SLOT_RULES.FIXED, SLOT_RULES.CAMPUS_FIXED, SLOT_RULES.AEC_ELECT].includes(definition.rule)
        || registration.allocation_metadata?.[slotKey]?.allocated_by === 'fixed') {
        throw new BadRequestException('Cannot manually override a fixed slot assignment')
      }
      slotName = definition.name || `Paper ${slotNumber}`
      const [departmentRows, semesterCourses] = await Promise.all([
        fetchAllPaginated<any>(this.supabase.admin.from('departments').select('id, code, name').order('id')),
        fetchAllPaginated<any>(this.supabase.admin.from('courses')
          .select('id, course_code, title, credits, department_id, semester, category, seat_limit, prerequisites')
          .eq('semester', sem).order('id')),
      ])
      const deptMap = new Map<string, string>()
      for (const department of departmentRows) {
        if (department.code) deptMap.set(department.code.toUpperCase(), department.id)
        deptMap.set(department.id, department.id)
        departments.set(department.id, department)
      }
      courseList = semesterCourses.filter(course => isCourseEligibleForSlot(
        course, definition.rule, definition.target || '', departmentId, deptMap, sem, definition.name,
      ))
    } else {
      // Keep the department-capacity overview separate from a particular placement.
      const { data: courses, error: courseErr } = await this.supabase.admin.from('courses')
        .select('id, course_code, title, credits, category, seat_limit, prerequisites')
        .eq('department_id', departmentId).eq('semester', sem)
      if (courseErr) throw new InternalServerErrorException('Failed to fetch courses')
      courseList = courses ?? []
    }
    const results: any[] = []

    // Fetch registrations across all campuses for this academic_year and semester (F21 global capacity across 8 slots)
    const registrations = await fetchAllPaginated<any>(this.supabase.admin
      .from('current_student_registrations')
      .select('id, slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id')
      .eq('academic_year', academicYear).eq('semester', sem).order('id'))

    const allocationCounts = new Map<string, number>()
    if (registrations) {
      for (const reg of registrations) {
        for (let i = 1; i <= 8; i++) {
          const cId = (reg as any)[`slot_${i}_course_id`]
          if (cId) {
            allocationCounts.set(cId, (allocationCounts.get(cId) || 0) + 1)
          }
        }
      }
    }

    for (const course of courseList) {
      const seatLimit = course.seat_limit == null ? 60 : Number(course.seat_limit)
      const totalAllocated = allocationCounts.get(course.id) || 0
      const remaining = Math.max(0, seatLimit - totalAllocated)
      let unavailableReason: string | null = null
      if (studentId && slotKey) {
        const alreadyAssignedElsewhere = Array.from({ length: 8 }, (_, i) => `slot_${i + 1}`)
          .some(key => key !== slotKey && registration[`${key}_course_id`] === course.id)
        unavailableReason = alreadyAssignedElsewhere ? 'Already assigned to another paper'
          : remaining === 0 && registration[`${slotKey}_course_id`] !== course.id ? `No remaining seats (${totalAllocated}/${seatLimit} allocated globally)` : null
      }

      results.push({
        id: course.id,
        course_code: course.course_code,
        title: course.title,
        category: course.category,
        credits: course.credits,
        prerequisites: course.prerequisites || [],
        seat_limit: seatLimit,
        total_allocated: totalAllocated,
        remaining_seats: remaining,
        ...(studentId && slotKey ? {
          department_name: departments.get(course.department_id)?.name || 'General',
          can_allocate: unavailableReason === null,
          unavailable_reason: unavailableReason,
        } : {}),
      })
    }

    return {
      success: true,
      courses: results,
      ...(studentId && slotKey ? { student_id: studentId, slot_key: slotKey, slot_name: slotName } : {}),
    }
  }

  // ──────────────── HOD / Teacher / Superadmin: Manual Allocation ────────────────
  async manualAllocate(
    body: { student_id: string; slot_key: string; course_id: string },
    user: AuthUser,
  ) {
    const { student_id, slot_key, course_id } = body
    if (!student_id || !slot_key || !course_id) {
      throw new BadRequestException('Missing required fields (student_id, slot_key, course_id)')
    }

    const validSlots = ['slot_1', 'slot_2', 'slot_3', 'slot_4', 'slot_5', 'slot_6', 'slot_7', 'slot_8']
    if (!validSlots.includes(slot_key)) {
      throw new BadRequestException(`Invalid slot key: ${slot_key}`)
    }

    // Validate student exists and retrieve department, campus, and current_semester
    const { data: student, error: studentErr } = await this.supabase.admin
      .from('students')
      .select(`
        id,
        department_id,
        campus_id,
        current_semester,
        departments (
          code
        )
      `)
      .eq('id', student_id)
      .single()

    if (studentErr || !student) {
      throw new NotFoundException('Student not found')
    }

    // F27: Derive academic_year from authoritative campus_settings (fail closed if missing)
    const { data: campusSettings } = await this.supabase.admin
      .from('campus_settings')
      .select('academic_year')
      .eq('campus_id', student.campus_id)
      .maybeSingle()

    if (!campusSettings?.academic_year) {
      throw new BadRequestException(
        `No active academic year found in campus settings for campus ${student.campus_id}`,
      )
    }
    const academicYear = campusSettings.academic_year

    // F28: Authorization check
    // - Superadmin: full authority
    // - HOD: authorized via student's home department (course catalog ownership is NOT required)
    // - Teacher: authorized ONLY if assigned to teach that course at student's campus for this academic year
    if (user.role === 'hod') {
      if (!user.department_id || student.department_id !== user.department_id) {
        throw new ForbiddenException('You may only allocate courses to students in your department')
      }
    } else if (user.role === 'teacher') {
      const { data: teacherAssignment } = await this.supabase.admin
        .from('current_teacher_course_assignments')
        .select('id')
        .eq('teacher_id', user.userId)
        .eq('course_id', course_id)
        .eq('campus_id', student.campus_id)
        .eq('academic_year', academicYear)
        .maybeSingle()

      if (!teacherAssignment) {
        throw new ForbiddenException(
          'Teacher is not assigned to teach this course at this campus for the active academic year',
        )
      }
    } else if (user.role !== 'superadmin') {
      throw new ForbiddenException('Unauthorized for manual course allocation')
    }

    // Fetch target course
    const { data: course, error: courseErr } = await this.supabase.admin
      .from('courses')
      .select('id, course_code, title, department_id, seat_limit, semester, credits, category, prerequisites')
      .eq('id', course_id)
      .single()

    if (courseErr || !course) {
      throw new NotFoundException('Course not found')
    }

    // R12: Course semester must match student's active semester
    if (course.semester !== student.current_semester) {
      throw new BadRequestException(
        `Course belongs to semester ${course.semester}, but student is active in semester ${student.current_semester}`,
      )
    }
    const activeSemester = student.current_semester

    // Fetch existing registration record if any
    const { data: reg } = await this.supabase.admin
      .from('current_student_registrations')
      .select('id, allocation_metadata, pathway_id, campus_id, academic_year, slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id')
      .eq('student_id', student_id)
      .eq('semester', activeSemester)
      .eq('academic_year', academicYear)
      .maybeSingle()

    const regMeta = (reg?.allocation_metadata as Record<string, any>) || {}
    if (regMeta[slot_key]?.allocated_by === 'fixed') {
      throw new BadRequestException('Cannot manually override a fixed slot assignment')
    }

    // F20: Duplicate course check across all slots 1..8
    for (let s = 1; s <= 8; s++) {
      const k = `slot_${s}`
      if (k !== slot_key) {
        const existingCourseId = (reg as any)?.[`${k}_course_id`]
        if (existingCourseId === course_id) {
          throw new BadRequestException(
            `Course ${course.course_code} is already assigned to student in ${k}. Duplicate course assignment across slots is not allowed.`,
          )
        }
      }
    }

    // A configured pathway rule takes precedence over legacy minor behavior in every slot.
    const slotNum = parseInt(slot_key.replace('slot_', ''), 10)
    const { data: blueprint, error: blueprintError } = await this.supabase.admin
      .from('semester_blueprints').select('*')
      .eq('department_id', student.department_id).eq('semester', activeSemester).maybeSingle()
    if (blueprintError) throw new InternalServerErrorException('Could not verify semester slot rules')
    if (!blueprint) throw new NotFoundException('Semester blueprint not configured')
    const pathways = getBlueprintPathways(blueprint)
    const pathwayId = reg?.pathway_id
    const pathway = pathways.find(p => p.id === pathwayId) || (!pathwayId && pathways.length === 1 ? pathways[0] : undefined)
    const slotDef = getStudentSlotDefinition(pathway, slotNum, student.department_id)
    if (!slotDef) throw new BadRequestException('The selected pathway does not define this slot')
    const { data: depts } = await this.supabase.admin.from('departments').select('id, code')
    const deptMap = new Map<string, string>((depts || []).map((d: any) => [d.code.toUpperCase(), d.id]))
    if (!isCourseEligibleForSlot(course, slotDef.rule, slotDef.target || '', student.department_id, deptMap, activeSemester, slotDef.name)) {
      throw new BadRequestException(`Course ${course.course_code} is not eligible for ${slot_key} (${slotDef.name || slotDef.rule})`)
    }

    // F21: Global capacity check across all campuses for this course (academic_year & semester, across all 8 slots)
    const seatLimit = course.seat_limit == null ? 60 : Number(course.seat_limit)
    const { count: allocatedCount } = await this.supabase.admin
      .from('current_student_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('academic_year', academicYear)
      .eq('semester', activeSemester)
      .or(
        `slot_1_course_id.eq.${course.id},slot_2_course_id.eq.${course.id},slot_3_course_id.eq.${course.id},slot_4_course_id.eq.${course.id},slot_5_course_id.eq.${course.id},slot_6_course_id.eq.${course.id},slot_7_course_id.eq.${course.id},slot_8_course_id.eq.${course.id}`,
      )

    const currentSlotCourse = (reg as any)?.[`${slot_key}_course_id`]
    const effectiveAllocated = currentSlotCourse === course.id ? (allocatedCount ?? 0) - 1 : (allocatedCount ?? 0)

    if (effectiveAllocated >= seatLimit) {
      throw new BadRequestException(
        `Course ${course.course_code} has no remaining seats globally (${seatLimit}/${seatLimit})`,
      )
    }

    const actorRole = user.role === 'hod' ? 'hod' : user.role === 'teacher' ? 'teacher' : 'admin'
    const allocMeta = {
      allocated_by: actorRole,
      by_user: user.userId,
      at: new Date().toISOString(),
    }

    // Determine credit division across all 8 slots (F15, F29)
    const assignedIds: { slotNum: number; courseId: string }[] = []
    for (let s = 1; s <= 8; s++) {
      const k = `slot_${s}`
      const cid = k === slot_key ? course_id : (reg as any)?.[`${k}_course_id`]
      if (cid) assignedIds.push({ slotNum: s, courseId: cid })
    }

    const uniqueCourseIds = Array.from(new Set(assignedIds.map((a) => a.courseId)))
    const { data: assignedCourses } = await this.supabase.admin
      .from('courses')
      .select('id, credits')
      .in('id', uniqueCourseIds)

    const courseCreditsMap = new Map((assignedCourses || []).map((c) => [c.id, c.credits || 0]))
    let coreCredits = 0
    let additionalCredits = 0
    for (const item of assignedIds) {
      const cr = courseCreditsMap.get(item.courseId) || 0
      if (item.slotNum <= 6) {
        coreCredits += cr
      } else {
        additionalCredits += cr
      }
    }
    const totalCredits = coreCredits + additionalCredits

    // R10/R09: Try atomic RPC execute_manual_course_allocation first if configured
    let rpcHandled = false
    if (typeof (this.supabase.admin as any).rpc === 'function') {
      try {
        const { data: rpcRes, error: rpcErr } = await termOperation(this.supabase.admin, user, 'execute_manual_course_allocation', {
          p_student_id: student_id,
          p_campus_id: student.campus_id,
          p_semester: activeSemester,
          p_academic_year: academicYear,
          p_slot_key: slot_key,
          p_course_id: course_id,
          p_actor_id: user.userId,
          p_actor_role: user.role,
          p_allocated_by: user.role === 'hod' ? 'hod_override' : user.role === 'teacher' ? 'teacher_manual' : 'admin_override',
        })

        if (!rpcErr && rpcRes?.success) {
          rpcHandled = true
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
              core_credits: rpcRes.core_credits ?? coreCredits,
              additional_credits: rpcRes.additional_credits ?? additionalCredits,
              total_credits: rpcRes.total_credits ?? totalCredits,
            },
          })
          return {
            success: true,
            message: rpcRes.message || `Course ${course.course_code} successfully allocated to student`,
            core_credits: rpcRes.core_credits ?? coreCredits,
            additional_credits: rpcRes.additional_credits ?? additionalCredits,
            total_credits: rpcRes.total_credits ?? totalCredits,
          }
        } else if (rpcErr) {
          const errMsg = rpcErr.message || ''
          if (errMsg.includes('capacity') || errMsg.includes('seat')) {
            throw new BadRequestException(errMsg)
          }
          if (errMsg.includes('already assigned') || errMsg.includes('Invalid') || errMsg.includes('Duplicate') || errMsg.includes('active semester')) {
            throw new BadRequestException(errMsg)
          }
          if (!errMsg.includes('could not find') && !errMsg.includes('function') && !errMsg.includes('does not exist')) {
            throw new InternalServerErrorException(`Failed to persist manual allocation: ${errMsg}`)
          }
        }
      } catch (e: any) {
        if (e instanceof BadRequestException || e instanceof ConflictException || e instanceof ForbiddenException || e instanceof InternalServerErrorException) {
          throw e
        }
      }
    }

    throw new InternalServerErrorException('Atomic allocation service unavailable. No allocation changes were saved.')
  }
}
