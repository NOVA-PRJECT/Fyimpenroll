import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { z } from 'zod'
import { SupabaseService } from '../../core/database/supabase.service'
import { AuditLoggerService, AuditEvents } from '../../core/logging/audit-logger.service'
import { ServerLoggerService } from '../../core/logging/server-logger.service'
import { AuthUser } from '../../core/auth/types'
import { AuthorizationPolicy } from '../../core/auth/authorization-policy'
import { runGenerationJob } from './solver/job'
import { getRedisClient } from './solver/redisClient'
import { FileConstraintStoreService } from './solver/file-constraint-store.service'
import * as crypto from 'crypto'
import { RuleDefinitionSchema } from './solver/schemas'
import { readReviewDraft } from './solver/review-draft'
import { loadTimetableAudience, belongsToCohort } from './timetable-audience'
import { fetchAllPaginated } from '../../core/database/pagination.util'

@Injectable()
export class TimetableService implements OnModuleInit, OnModuleDestroy {
  private recoveryTimer?: ReturnType<typeof setInterval>
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService,
    private readonly serverLogger: ServerLoggerService,
  ) {}

  async onModuleInit() {
    await this.recoverExpiredWorkers()
    this.recoveryTimer = setInterval(() => { void this.recoverExpiredWorkers() }, 60000)
    this.recoveryTimer.unref()
  }
  onModuleDestroy() { if (this.recoveryTimer) clearInterval(this.recoveryTimer) }
  private async recoverExpiredWorkers() {
    try {
      const { error } = await this.supabase.admin.rpc('recover_expired_timetable_workers')
      if (error) this.serverLogger.warn(`Timetable worker recovery unavailable: ${error.message}`)
    } catch (error) { this.serverLogger.warn(`Timetable worker recovery unavailable: ${(error as Error).message}`) }
  }

  private readonly fileConstraintStore = new FileConstraintStoreService()

  // ──────────────── Constraints (R19, R20) ────────────────
  async getConstraints(semester: string | undefined, user?: AuthUser) {
    return { ...this.fileConstraintStore.getBaseConstraints(), campusId: user?.campus_id ?? user?.userId };
  }

  async updateConstraints(_body?: unknown, _user?: AuthUser) {
    throw new BadRequestException('Rules are saved in your browser and sent with generation requests. Server files are read-only.');
  }

  private async publicationState(campusId: string, academicYear: string, semester: number) {
    const { data, error, count } = await this.supabase.admin.from('timetable_entries')
      .select('id, published_at', { count: 'exact' })
      .eq('campus_id', campusId).eq('academic_year', academicYear).eq('semester', semester)
      .eq('status', 'published').order('published_at', { ascending: false }).limit(1)
    if (error) throw new ServiceUnavailableException('Could not verify timetable publication. Please retry.')
    return { published: !!data?.length, publishedAt: data?.[0]?.published_at ?? null, publishedCount: count ?? 0 }
  }

  async getEntries(academicYear: string, semester: number, departmentId: string | undefined, user: AuthUser) {
    const scope = AuthorizationPolicy.resolveTimetableScope(user)
    const publication = user.role === 'campus_director' && scope.campusId
      ? await this.publicationState(scope.campusId, academicYear, semester) : undefined

    let campusDeptIds: string[] = []
    let campusDepartments: any[] = []
    if (scope.campusId) {
      const { data: depts, error: deptsErr } = await this.supabase.admin
        .from('departments')
        .select('id, name, code')
        .eq('campus_id', scope.campusId)
        .order('name')

      if (deptsErr) {
        throw new InternalServerErrorException(`Failed to resolve campus departments: ${deptsErr.message}`)
      }
      campusDeptIds = (depts || []).map((d: any) => d.id)
      campusDepartments = depts || []
    }

    // If campus director and campus has no departments, return empty results immediately
    if (user.role === 'campus_director' && campusDeptIds.length === 0) {
      return {
        academicYear,
        semester,
        publication,
        departments: [],
        entries: [],
        conflicts: [],
      }
    }

    // Verify requested department parameter against actor's authorized scope
    if (departmentId) {
      if (user.role === 'campus_director') {
        if (!campusDeptIds.includes(departmentId)) {
          throw new ForbiddenException('Requested department does not belong to your campus')
        }
      } else if (user.role === 'hod') {
        if (departmentId !== user.department_id) {
          throw new ForbiddenException('HOD can only view timetable entries for their own department')
        }
      } else if (user.role === 'student') {
        if (user.department_id && departmentId !== user.department_id) {
          throw new ForbiddenException('Students can only view timetable entries for their enrolled department')
        }
      }
    }

    let audience: Awaited<ReturnType<typeof loadTimetableAudience>> | undefined
    if (user.role === 'campus_director' && scope.campusId) {
      try {
        audience = await loadTimetableAudience(this.supabase.admin, scope.campusId, academicYear, semester)
      } catch {
        throw new ServiceUnavailableException('Could not load timetable enrollment. Please retry.')
      }
      campusDepartments = campusDepartments.filter(d => audience!.departmentCounts.has(d.id))
        .map(d => ({ ...d, registeredStudentCount: audience!.departmentCounts.get(d.id) }))
      if (campusDepartments.length === 0 || (departmentId && !audience.departmentCounts.has(departmentId))) {
        return { academicYear, semester, publication, departments: campusDepartments, entries: [], conflicts: [] }
      }
      const review = publication?.published ? null : await readReviewDraft(this.supabase.admin, scope.campusId, academicYear, semester)
      if (review) {
        const decorate = <T extends { courseId: string }>(entry: T) => ({ ...entry,
          enrolledDepartmentIds: audience!.courseDepartments.get(entry.courseId) || [] })
        const entries = review.entries.map(decorate)
        const conflicts = review.conflicts.map(decorate)
        return {
          academicYear, semester, departments: campusDepartments, reviewDraft: true,
          publication,
          unscheduledPeriods: review.unscheduledPeriods, diagnostics: review.diagnostics,
          entries: departmentId ? entries.filter(entry => belongsToCohort(entry, departmentId)) : entries,
          conflicts: departmentId ? conflicts.filter(entry => belongsToCohort(entry, departmentId)) : conflicts,
        }
      }
    }

    // Check teacher assigned courses across campuses (supporting visiting cross-campus instruction)
    let teacherAssignedCourseIds: string[] = []
    if (user.role === 'teacher') {
      const { data: assignments } = await this.supabase.admin
        .from('teacher_course_assignments')
        .select('course_id')
        .eq('teacher_id', user.userId)
      teacherAssignedCourseIds = (assignments || []).map((a: any) => a.course_id)
    }

    let studentCourseIds: string[] = []
    if (user.role === 'student') {
      const fields = Array.from({ length: 8 }, (_, i) => `slot_${i + 1}_course_id`)
      const registrations = await fetchAllPaginated<any>(this.supabase.admin.from('student_registrations')
        .select(fields.join(',')).eq('student_id', user.userId).eq('campus_id', scope.campusId)
        .eq('academic_year', academicYear).eq('semester', semester).order('id'))
      studentCourseIds = [...new Set<string>(registrations.flatMap(row => fields.map(field => row[field]).filter(Boolean)))]
      if (!studentCourseIds.length) return { academicYear, semester, departments: [], entries: [], conflicts: [] }
    }

    let deptsFetchQuery = this.supabase.admin.from('departments').select('id, name, code').order('name')
    if (scope.campusId && campusDeptIds.length > 0) {
      deptsFetchQuery = deptsFetchQuery.in('id', campusDeptIds)
    }
    const { data: allDepartmentsData } = audience ? { data: campusDepartments } : await deptsFetchQuery

    let query = this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        academic_year,
        semester,
        time_slot_id,
        course_id,
        department_id,
        campus_id,
        teacher_id,
        is_lab_block,
        status,
        session_type,
        time_slots (
          id,
          day_of_week,
          period_number
        ),
        courses (
          id,
          course_code,
          title,
          category,
          tag,
          credits,
          department_id
        )
      `)
      .eq('academic_year', academicYear)
      .eq('semester', semester)

    // STUDENTS only see published entries, NEVER drafts or generated unreviewed schedules
    if (user.role === 'student') {
      query = query.eq('status', 'published').eq('campus_id', scope.campusId).in('course_id', studentCourseIds)
    }

    // Apply strict server-derived department / assignment scoping (R05, R06)
    if (user.role === 'student') {
      // Enrollment, rather than catalogue ownership, determines a student's courses.
    } else if (user.role === 'teacher') {
      if (teacherAssignedCourseIds.length === 0) {
        return {
          academicYear,
          semester,
          departments: allDepartmentsData || [],
          entries: [],
          conflicts: [],
        }
      }
      query = query.in('course_id', teacherAssignedCourseIds)
      if (departmentId) {
        query = query.eq('department_id', departmentId)
      }
    } else if (departmentId && !audience) {
      query = query.eq('department_id', departmentId)
    } else if (user.role === 'hod' && user.department_id) {
      query = query.eq('department_id', user.department_id)
    } else if (scope.campusId) {
      if (campusDeptIds.length > 0) {
        query = query.or(`campus_id.eq.${scope.campusId},and(campus_id.is.null,department_id.in.(${campusDeptIds.join(',')}))`)
      } else {
        query = query.eq('campus_id', scope.campusId)
      }
    } else if (!scope.isUniversityScope) {
      return {
        academicYear,
        semester,
        departments: allDepartmentsData || [],
        entries: [],
        conflicts: [],
      }
    }

    const entries = await fetchAllPaginated<any>(query.order('id'))

    const formattedEntries = (entries || []).map((entry: any) => ({
      id: entry.id,
      day: entry.time_slots?.day_of_week,
      period: entry.time_slots?.period_number,
      slotId: entry.time_slot_id,
      departmentId: entry.department_id,
      campusId: entry.campus_id,
      teacherId: entry.teacher_id,
      courseId: entry.courses?.id,
      courseCode: entry.courses?.course_code,
      courseName: entry.courses?.title,
      category: entry.courses?.category,
      tag: entry.courses?.tag,
      credits: entry.courses?.credits,
      isLabBlock: entry.is_lab_block,
      sessionType: entry.session_type,
      status: entry.status,
      ...(audience ? { enrolledDepartmentIds: audience.courseDepartments.get(entry.course_id) || [] } : {}),
    }))

    // STUDENTS never receive conflict rows!
    if (user.role === 'student') {
      return {
        academicYear,
        semester,
        departments: allDepartmentsData || [],
        entries: formattedEntries,
        conflicts: [],
      }
    }

    // Query unresolved conflicts for this academic year & semester
    let conflictQuery = this.supabase.admin
      .from('timetable_conflicts')
      .select(`
        id,
        course_id,
        blocking_course_id,
        reason,
        conflicting_student_count,
        courses:course_id (
          id,
          course_code,
          title,
          category,
          department_id,
          departments (
            id,
            name,
            code
          )
        )
      `)
      .eq('academic_year', academicYear)
      .eq('semester', semester)
      .eq('resolved', false)

    const { data: rawConflicts, error: conflictErr } = await conflictQuery
    if (conflictErr) {
      this.serverLogger.warn(`[Timetable getEntries conflictQuery error]: ${conflictErr.message}`)
    }

    let formattedConflicts = (rawConflicts || []).map((c: any) => ({
      id: c.id,
      courseId: c.course_id,
      courseCode: c.courses?.course_code,
      courseName: c.courses?.title || 'Unknown Course',
      category: c.courses?.category,
      departmentId: c.courses?.department_id,
      departmentName: c.courses?.departments?.name,
      departmentCode: c.courses?.departments?.code,
      reason: c.reason,
      conflictingStudentCount: c.conflicting_student_count || 0,
      ...(audience ? { enrolledDepartmentIds: audience.courseDepartments.get(c.course_id) || [] } : {}),
    }))

    if (scope.campusId && campusDeptIds.length > 0) {
      formattedConflicts = formattedConflicts.filter(
        (c: any) => !c.departmentId || campusDeptIds.includes(c.departmentId),
      )
    }

    if (departmentId) {
      formattedConflicts = formattedConflicts.filter((c: any) => audience ? belongsToCohort(c, departmentId) : c.departmentId === departmentId)
    }

    return {
      academicYear,
      semester,
      publication,
      departments: allDepartmentsData || [],
      entries: audience && departmentId ? formattedEntries.filter(entry => belongsToCohort(entry, departmentId)) : formattedEntries,
      conflicts: formattedConflicts,
    }
  }

  // ──────────────── Generate (F33, F41, F42) ────────────────
  async generate(academicYear: string, semester: number, dynamicConstraints: any[] | undefined, user: AuthUser, rules?: unknown) {
    if (!user.campus_id) throw new BadRequestException('An explicit campus is required for generation')
    if ((await this.publicationState(user.campus_id, academicYear, semester)).published) {
      throw new ConflictException('This timetable is already published. Generation is locked for this campus, academic year and semester.')
    }
    const parsedRules = rules === undefined ? undefined : z.array(RuleDefinitionSchema).min(1).max(100).safeParse(rules)
    if (parsedRules && !parsedRules.success) throw new BadRequestException(parsedRules.error.issues[0].message)
    const effectiveRules = parsedRules?.success ? parsedRules.data : undefined
    if (dynamicConstraints?.some(rule => !rule.typedRule)) throw new BadRequestException('Use structured scheduling rules; free-text rules cannot be enforced')
    let settingsQuery = this.supabase.admin
      .from('campus_settings')
      .select('deadline, academic_year')

    if (user.campus_id) {
      settingsQuery = settingsQuery.eq('campus_id', user.campus_id)
    }

    const { data: campusSettings } = await settingsQuery.maybeSingle()

    // Guard F41: Closed registration window precondition
    if (campusSettings?.deadline) {
      const deadline = new Date(campusSettings.deadline)
      if (new Date() < deadline) {
        throw new BadRequestException(
          `Registration window is still open until ${deadline.toLocaleString('en-IN')}. Please close registrations before generating timetable (F41).`,
        )
      }
    } else {
      throw new BadRequestException(
        'Campus registration window deadline is not configured. Registrations must be closed before generation (F41).',
      )
    }

    // The claim transaction checks completed allocation under the cohort lock.
    // F42 & R16: Atomically claim timetable generation job with worker fencing token
    const fencingToken = crypto.randomUUID()
    let newJobId: string | undefined

    const { data: claim, error: claimError } = await this.supabase.admin.rpc('claim_timetable_generation_job', {
      p_campus_id: user.campus_id, p_academic_year: academicYear, p_semester: semester,
      p_user_id: user.userId, p_lease_seconds: 600, p_fencing_token: fencingToken,
    })
    if (claimError) throw new BadRequestException(`Could not claim generation job: ${claimError.message}`)
    if (!claim?.job_id) throw new InternalServerErrorException('Generation claim returned no job ID')
    newJobId = claim.job_id

    const redis = getRedisClient()

    // Run the background generation job using local OR-Tools CP-SAT solver
    runGenerationJob(
      newJobId,
      academicYear,
      semester,
      user.userId,
      this.supabase.admin,
      redis,
      user.campus_id ?? undefined,
      dynamicConstraints || [],
      effectiveRules ? { rules: effectiveRules } : undefined,
      fencingToken,
    ).catch(async (err: any) => {
      this.serverLogger.error(
        `Background generation job error for job ${newJobId}`,
        err?.stack || String(err),
      )
      try {
        await this.supabase.admin.rpc('update_timetable_worker', {
          p_job_id: newJobId, p_fencing_token: fencingToken, p_status: 'failed', p_progress: 0,
          p_error: err?.message || 'Background generation failed',
        })
      } catch (updateErr: any) {
        this.serverLogger.error(
          `Failed to update failed status for job ${newJobId}`,
          updateErr?.stack || String(updateErr),
        )
      }
    })

    await this.auditLogger.log({
      eventType: AuditEvents.TIMETABLE_GENERATED,
      userId: user.userId,
      userRole: user.role,
      action: `initiated timetable generation for ${academicYear} sem ${semester}`,
      resourceType: 'timetable',
      status: 'success',
      metadata: { academicYear, semester, campusId: user.campus_id },
    })

    return {
      success: true,
      jobId: newJobId,
      status: 'queued',
      message: 'Timetable generation job initiated with OR-Tools CP-SAT solver',
      fencingToken,
      academicYear,
      semester,
    }
  }

  // ──────────────── Teacher Substitution (F33, F37, R08) ────────────────
  async substituteTeacher(entryId: string, newTeacherId: string, user: AuthUser) {
    const { data: entry, error: entryErr } = await this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        academic_year,
        semester,
        department_id,
        campus_id,
        course_id,
        time_slot_id,
        status,
        teacher_id,
        time_slots (
          id,
          day_of_week,
          period_number
        ),
        departments (
          id,
          campus_id
        )
      `)
      .eq('id', entryId)
      .single()

    if (entryErr || !entry) {
      throw new NotFoundException(`Timetable entry ${entryId} not found`)
    }

    const hostCampusId = (entry as any).campus_id || (entry as any).departments?.campus_id;

    if (user.role === 'campus_director' && hostCampusId !== user.campus_id) {
      throw new ForbiddenException('Campus directors can only assign teachers to entries within their own campus')
    }
    if (user.role === 'hod' && entry.department_id !== user.department_id) {
      throw new ForbiddenException('HODs can only assign teachers to entries within their own department')
    }

    const slot = (entry as any).time_slots

    // F37 & R08: Global Teacher Clash Check across all campuses and semesters for this academic year
    if (newTeacherId) {
      const { data: conflicts, error: clashErr } = await this.supabase.admin
        .from('timetable_entries')
        .select('id, course_id, academic_year, semester, department_id, campus_id, status')
        .eq('teacher_id', newTeacherId)
        .eq('academic_year', entry.academic_year)
        .eq('time_slot_id', entry.time_slot_id)
        .neq('id', entryId)

      if (clashErr) {
        this.serverLogger.warn(`[substituteTeacher clashErr]: ${clashErr.message}`)
      }

      if (conflicts && conflicts.length > 0) {
        throw new BadRequestException(
          `Teacher ${newTeacherId} already has a scheduled class at Day ${slot?.day_of_week} Period ${slot?.period_number} in Semester ${conflicts[0].semester} (F37 shared-teacher clash).`,
        )
      }
    }

    // F33 & R08: Update teacher_id in place, preserving entry identity, class identity and attendance
    const { error: updateErr } = await this.supabase.admin
      .from('timetable_entries')
      .update({
        teacher_id: newTeacherId || null,
      })
      .eq('id', entryId)

    if (updateErr) {
      throw new InternalServerErrorException(`Failed to update assigned teacher: ${updateErr.message}`)
    }

    // Atomically synchronize teacher assignment record so roster and attendance authorization match (R08)
    if (newTeacherId && hostCampusId) {
      const tcaTable = this.supabase.admin.from('teacher_course_assignments');
      if (typeof tcaTable?.upsert === 'function') {
        await tcaTable.upsert(
          {
            teacher_id: newTeacherId,
            course_id: entry.course_id,
            campus_id: hostCampusId,
            academic_year: entry.academic_year,
            semester: entry.semester,
            assigned_by: user.userId,
            assigned_at: new Date().toISOString(),
          },
          { onConflict: 'teacher_id,course_id,campus_id,academic_year,semester' }
        );
      }
    }

    await this.auditLogger.log({
      eventType: AuditEvents.TIMETABLE_GENERATED,
      userId: user.userId,
      userRole: user.role,
      action: `assigned teacher ${newTeacherId} to timetable entry ${entryId} (F33/F37)`,
      resourceType: 'timetable',
      status: 'success',
      metadata: { entryId, newTeacherId, academicYear: entry.academic_year, semester: entry.semester },
    })

    return {
      success: true,
      message: 'Teacher assigned successfully without modifying timetable session structure',
      entryId,
      teacherId: newTeacherId,
    }
  }

  // ──────────────── Job Status ────────────────
  async getJobStatus(academicYear: string, semester: number, user: AuthUser) {
    const redisKey = `timetable:job:${academicYear}:${semester}${user.campus_id ? `:${user.campus_id}` : ''}`
    const redis = getRedisClient()

    try {
      const cached = await redis.get(redisKey)
      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached
        return {
          status: parsed.status,
          progress: parsed.progress || 0,
          jobId: parsed.jobId || null,
          errorMessage: parsed.errorMessage || parsed.error || null,
          stepMessage: parsed.stepMessage || null,
          stats: parsed.stats || null,
        }
      }
    } catch {
      // Fall through to DB
    }

    let query = this.supabase.admin
      .from('timetable_generation_jobs')
      .select('id, status, progress, error_message, created_at')
      .eq('academic_year', academicYear)
      .eq('semester', semester)
      .order('created_at', { ascending: false })
      .limit(1)

    if (user.campus_id) {
      query = query.eq('campus_id', user.campus_id)
    }

    const { data: job } = await query.maybeSingle()

    if (!job) {
      return { status: 'idle', progress: 0, jobId: null }
    }

    return {
      status: job.status,
      progress: job.progress,
      jobId: job.id,
      errorMessage: job.error_message,
    }
  }

  // ──────────────── Publish ────────────────
  async publish(academicYear: string, semester: number, user: AuthUser, force = false) {
    if (!user.campus_id) throw new BadRequestException('Select an explicit campus before publication')
    if (await readReviewDraft(this.supabase.admin, user.campus_id, academicYear, semester)) {
      throw new UnprocessableEntityException('This review draft has unscheduled sessions. Resolve them and generate a complete verified timetable before publication.')
    }
    const { data, error } = await this.supabase.admin.rpc('publish_timetable_cohort', {
      p_campus_id: user.campus_id, p_academic_year: academicYear, p_semester: semester,
    })
    if (error) throw new BadRequestException(`Publication rejected: ${error.message}`)
    if (data?.success !== true || !Number.isInteger(data.published_count) || data.published_count < 1) {
      throw new InternalServerErrorException('Publication did not commit any timetable sessions.')
    }
    const { count, error: verificationError } = await this.supabase.admin.from('timetable_entries')
      .select('id', { count: 'exact', head: true }).eq('campus_id', user.campus_id)
      .eq('academic_year', academicYear).eq('semester', semester).eq('status', 'published')
    if (verificationError || count !== data.published_count) {
      throw new InternalServerErrorException('Publication could not be verified: the saved sessions are still drafts or do not match the reported count. Apply the timetable publication repair migration, then retry.')
    }
    const nowIso = data.published_at
    const publishedCount = data.published_count

    await this.auditLogger.log({
      eventType: AuditEvents.TIMETABLE_PUBLISHED,
      userId: user.userId,
      userRole: user.role,
      action: `published timetable for ${academicYear} sem ${semester}`,
      resourceType: 'timetable',
      status: 'success',
      metadata: { academicYear, semester, publishedCount: publishedCount, forced: force },
    })

    return {
      success: true,
      message: 'Timetable published successfully',
      publishedCount: publishedCount,
      publishedAt: nowIso,
    }
  }
}
