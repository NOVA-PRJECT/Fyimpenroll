import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import * as fs from 'fs'
import * as path from 'path'
import { z } from 'zod'
import { SupabaseService } from '../../core/database/supabase.service'
import { AuditLoggerService, AuditEvents } from '../../core/logging/audit-logger.service'
import { ServerLoggerService } from '../../core/logging/server-logger.service'
import { AuthUser } from '../../core/auth/types'
import { AuthorizationPolicy } from '../../core/auth/authorization-policy'
import { runGenerationJob } from './solver/job'
import { getRedisClient } from './solver/redisClient'

function resolveConstraintsPath(): string {
  const direct = path.join(__dirname, 'solver/constraints.base.json')
  if (fs.existsSync(direct)) return direct

  const candidates = [
    path.resolve(__dirname, '../../../../src/modules/timetable/solver/constraints.base.json'),
    path.resolve(process.cwd(), 'src/modules/timetable/solver/constraints.base.json'),
    path.resolve(process.cwd(), 'backend/src/modules/timetable/solver/constraints.base.json'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return direct
}

@Injectable()
export class TimetableService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService,
    private readonly serverLogger: ServerLoggerService,
  ) {}

  private readConstraintsFile() {
    const filePath = resolveConstraintsPath()
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'))
      }
    } catch (err: any) {
      this.serverLogger.error('Error reading constraints file', err?.stack || String(err))
    }
    return {
      schedule: {},
      hard_constraints: [],
      soft_constraints: [],
      semester_constraints: {},
    }
  }

  // ──────────────── Constraints (F39) ────────────────
  async getConstraints(semester: string | undefined, user?: AuthUser) {
    const raw = this.readConstraintsFile()
    let campusOverrides: Record<string, any> = {}

    if (user?.campus_id) {
      const { data: settings } = await this.supabase.admin
        .from('campus_settings')
        .select('timetable_constraints')
        .eq('campus_id', user.campus_id)
        .maybeSingle()

      if (settings?.timetable_constraints) {
        campusOverrides = settings.timetable_constraints
      }
    }

    // Deep merge campus overrides over raw baseline (F39)
    const merged = {
      ...raw,
      ...campusOverrides,
      schedule: { ...(raw.schedule || {}), ...(campusOverrides.schedule || {}) },
      semester_constraints: {
        ...(raw.semester_constraints || {}),
        ...(campusOverrides.semester_constraints || {}),
      },
    }

    const semKey = semester ? String(semester) : null
    const semSpecific = semKey && merged.semester_constraints?.[semKey] ? merged.semester_constraints[semKey] : null

    const universalHard = Array.from(new Set([
      ...(raw.hard_constraints || []),
      ...(campusOverrides.hard_constraints || []),
      ...(campusOverrides.universal_hard_constraints || []),
    ]))
    const universalSoft = Array.from(new Set([
      ...(raw.soft_constraints || []),
      ...(campusOverrides.soft_constraints || []),
      ...(campusOverrides.universal_soft_constraints || []),
    ]))
    const semHard = semSpecific?.hard_constraints || []
    const semSoft = semSpecific?.soft_constraints || []

    return {
      schedule: merged.schedule,
      universal_hard_constraints: universalHard,
      universal_soft_constraints: universalSoft,
      semester_constraints: merged.semester_constraints || {},
      hard_constraints: [...universalHard, ...semHard],
      soft_constraints: [...universalSoft, ...semSoft],
      selected_semester_hard: semHard,
      selected_semester_soft: semSoft,
    }
  }

  async updateConstraints(body: any, user?: AuthUser) {
    const ConstraintItemSchema = z.string().trim().min(1).max(500)
    const SemesterConstraintObjSchema = z.object({
      hard_constraints: z.array(ConstraintItemSchema).max(100).optional(),
      soft_constraints: z.array(ConstraintItemSchema).max(100).optional(),
    }).passthrough()

    const ConstraintsSchema = z.object({
      reset: z.boolean().optional(),
      campus_id: z.string().uuid().optional(),
      schedule: z.record(z.any()).optional(),
      universal_hard_constraints: z.array(ConstraintItemSchema).max(100).optional(),
      hard_constraints: z.array(ConstraintItemSchema).max(100).optional(),
      universal_soft_constraints: z.array(ConstraintItemSchema).max(100).optional(),
      soft_constraints: z.array(ConstraintItemSchema).max(100).optional(),
      semester_constraints: z.record(SemesterConstraintObjSchema).optional(),
    })

    const parsed = ConstraintsSchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException('Invalid constraints payload schema')
    }

    const targetCampusId = user?.campus_id || parsed.data.campus_id

    const updatedOverrides = {
      schedule: parsed.data.schedule,
      hard_constraints: parsed.data.universal_hard_constraints || parsed.data.hard_constraints,
      soft_constraints: parsed.data.universal_soft_constraints || parsed.data.soft_constraints,
      semester_constraints: parsed.data.semester_constraints,
    }

    if (targetCampusId) {
      // F39: Save to campus_settings for durable persistence across Render redeploys
      const { error: saveErr } = await this.supabase.admin
        .from('campus_settings')
        .update({
          timetable_constraints: updatedOverrides,
        })
        .eq('campus_id', targetCampusId)

      if (saveErr) {
        throw new InternalServerErrorException(`Failed to persist campus constraints: ${saveErr.message}`)
      }

      return {
        success: true,
        message: 'Campus constraints updated and persisted durably (F39)',
        constraints: updatedOverrides,
        campusId: targetCampusId,
      }
    } else {
      // Superadmin updating university baseline file
      try {
        const current = this.readConstraintsFile()
        const full = {
          schedule: parsed.data.schedule || current.schedule,
          hard_constraints: parsed.data.universal_hard_constraints || parsed.data.hard_constraints || current.hard_constraints,
          soft_constraints: parsed.data.universal_soft_constraints || parsed.data.soft_constraints || current.soft_constraints,
          semester_constraints: parsed.data.semester_constraints || current.semester_constraints,
        }
        fs.writeFileSync(resolveConstraintsPath(), JSON.stringify(full, null, 2), 'utf8')
        return { success: true, message: 'University baseline constraints updated successfully', constraints: full }
      } catch (err: any) {
        throw new InternalServerErrorException(`Failed to save baseline constraints: ${err.message}`)
      }
    }
  }

  // ──────────────── Entries ────────────────
  async getEntries(academicYear: string, semester: number, departmentId: string | undefined, user: AuthUser) {
    const scope = AuthorizationPolicy.resolveTimetableScope(user)

    let campusDeptIds: string[] = []
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
    }

    // If campus director and campus has no departments, return empty results immediately
    if (user.role === 'campus_director' && campusDeptIds.length === 0) {
      return {
        academicYear,
        semester,
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

    // Check teacher assigned courses across campuses (supporting visiting cross-campus instruction)
    let teacherAssignedCourseIds: string[] = []
    if (user.role === 'teacher') {
      const { data: assignments } = await this.supabase.admin
        .from('teacher_course_assignments')
        .select('course_id')
        .eq('teacher_id', user.userId)
      teacherAssignedCourseIds = (assignments || []).map((a: any) => a.course_id)
    }

    let deptsFetchQuery = this.supabase.admin.from('departments').select('id, name, code').order('name')
    if (scope.campusId && campusDeptIds.length > 0) {
      deptsFetchQuery = deptsFetchQuery.in('id', campusDeptIds)
    }
    const { data: allDepartmentsData } = await deptsFetchQuery

    let query = this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        academic_year,
        semester,
        time_slot_id,
        department_id,
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
      query = query.eq('status', 'published')
    }

    // Apply strict server-derived department / assignment scoping
    if (departmentId) {
      query = query.eq('department_id', departmentId)
    } else if (user.role === 'hod' && user.department_id) {
      query = query.eq('department_id', user.department_id)
    } else if (user.role === 'teacher' && teacherAssignedCourseIds.length > 0 && !user.campus_id && !user.department_id) {
      query = query.in('course_id', teacherAssignedCourseIds)
    } else if (scope.campusId && campusDeptIds.length > 0) {
      query = query.in('department_id', campusDeptIds)
    } else if (!scope.isUniversityScope) {
      return {
        academicYear,
        semester,
        departments: allDepartmentsData || [],
        entries: [],
        conflicts: [],
      }
    }

    const { data: entries, error } = await query

    if (error) {
      this.serverLogger.error('Failed to fetch timetable entries', error.message)
      throw new InternalServerErrorException('Failed to fetch timetable entries')
    }

    const formattedEntries = (entries || []).map((entry: any) => ({
      id: entry.id,
      day: entry.time_slots?.day_of_week,
      period: entry.time_slots?.period_number,
      slotId: entry.time_slot_id,
      departmentId: entry.department_id,
      courseId: entry.courses?.id,
      courseCode: entry.courses?.course_code,
      courseName: entry.courses?.title,
      category: entry.courses?.category,
      tag: entry.courses?.tag,
      credits: entry.courses?.credits,
      isLabBlock: entry.is_lab_block,
      status: entry.status,
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
      departmentId: c.courses?.department_id,
      departmentName: c.courses?.departments?.name,
      departmentCode: c.courses?.departments?.code,
      reason: c.reason,
      conflictingStudentCount: c.conflicting_student_count || 0,
    }))

    if (scope.campusId && campusDeptIds.length > 0) {
      formattedConflicts = formattedConflicts.filter(
        (c: any) => !c.departmentId || campusDeptIds.includes(c.departmentId),
      )
    }

    if (departmentId) {
      formattedConflicts = formattedConflicts.filter((c: any) => c.departmentId === departmentId)
    }

    return {
      academicYear,
      semester,
      departments: allDepartmentsData || [],
      entries: formattedEntries,
      conflicts: formattedConflicts,
    }
  }

  // ──────────────── Generate (F33, F41, F42) ────────────────
  async generate(academicYear: string, semester: number, dynamicConstraints: any[] | undefined, user: AuthUser) {
    let settingsQuery = this.supabase.admin
      .from('campus_settings')
      .select('deadline, academic_year, timetable_constraints')

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

    // Guard F41: Completed course allocation precondition (Plan 05)
    let allocQuery = this.supabase.admin
      .from('allocation_runs')
      .select('id, status')
      .eq('academic_year', academicYear)
      .eq('semester', semester)
      .eq('status', 'completed')

    if (user.campus_id) {
      allocQuery = allocQuery.eq('campus_id', user.campus_id)
    }

    const { data: completedAllocationRuns } = await allocQuery
    if (!completedAllocationRuns || completedAllocationRuns.length === 0) {
      throw new BadRequestException(
        `Timetable generation requires a completed course allocation run for ${academicYear} Semester ${semester} (Plan 05 / F41). Complete allocation before scheduling.`,
      )
    }

    // Guard F33: Immutable publication check — never regenerate if published timetable exists
    let pubCheckQuery = this.supabase.admin
      .from('timetable_entries')
      .select('id')
      .eq('academic_year', academicYear)
      .eq('semester', semester)
      .eq('status', 'published')
      .limit(1)

    if (user.campus_id) {
      const { data: depts } = await this.supabase.admin
        .from('departments')
        .select('id')
        .eq('campus_id', user.campus_id)
      const deptIds = (depts || []).map((d: any) => d.id)
      if (deptIds.length > 0) {
        pubCheckQuery = pubCheckQuery.in('department_id', deptIds)
      }
    }

    const { data: publishedEntries } = await pubCheckQuery
    if (publishedEntries && publishedEntries.length > 0) {
      throw new BadRequestException(
        `Cannot regenerate timetable: A published timetable already exists for ${academicYear} Semester ${semester}. Published timetables are strictly immutable (F33).`,
      )
    }

    // F42: Check for existing job and handle stale worker recovery
    let jobQuery = this.supabase.admin
      .from('timetable_generation_jobs')
      .select('id, status, updated_at, created_at')
      .eq('academic_year', academicYear)
      .eq('semester', semester)
      .in('status', ['queued', 'running'])

    if (user.campus_id) {
      jobQuery = jobQuery.eq('campus_id', user.campus_id)
    }

    const { data: existingJob } = await jobQuery.maybeSingle()
    if (existingJob) {
      const lastActive = new Date(existingJob.updated_at || existingJob.created_at).getTime()
      const now = Date.now()
      const isExpired = now - lastActive > 10 * 60 * 1000 // 10 minutes lease timeout
      if (isExpired) {
        await this.supabase.admin
          .from('timetable_generation_jobs')
          .update({
            status: 'failed',
            error_message: 'Previous worker lease expired due to inactivity or backend restart (F42 recovery).',
            completed_at: new Date().toISOString(),
          })
          .eq('id', existingJob.id)
      } else {
        throw new BadRequestException('A timetable generation job is currently running for this semester.')
      }
    }

    const { data: newJob, error: insertError } = await this.supabase.admin
      .from('timetable_generation_jobs')
      .insert({
        academic_year: academicYear,
        semester,
        campus_id: user.campus_id ?? null,
        status: 'queued',
        progress: 0,
        triggered_by: user.userId,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertError || !newJob) {
      throw new InternalServerErrorException(`Could not start generation job: ${insertError?.message || 'Database insert failed'}`)
    }

    const redis = getRedisClient()

    // Run the background generation job using local OR-Tools CP-SAT solver
    runGenerationJob(
      newJob.id,
      academicYear,
      semester,
      user.userId,
      this.supabase.admin,
      redis,
      user.campus_id ?? undefined,
      dynamicConstraints || [],
      campusSettings?.timetable_constraints || undefined,
    ).catch(async (err: any) => {
      this.serverLogger.error(
        `Background generation job error for job ${newJob.id}`,
        err?.stack || String(err),
      )
      try {
        await this.supabase.admin
          .from('timetable_generation_jobs')
          .update({
            status: 'failed',
            error_message: err?.message || 'Background generation job encountered an unhandled error',
            completed_at: new Date().toISOString(),
          })
          .eq('id', newJob.id)
      } catch (updateErr: any) {
        this.serverLogger.error(
          `Failed to update failed status for job ${newJob.id}`,
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
      jobId: newJob.id,
      status: 'queued',
      message: 'Timetable generation job initiated with OR-Tools CP-SAT solver',
      academicYear,
      semester,
    }
  }

  // ──────────────── Teacher Substitution (F33, F37) ────────────────
  async substituteTeacher(entryId: string, newTeacherId: string, user: AuthUser) {
    const { data: entry, error: entryErr } = await this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        academic_year,
        semester,
        department_id,
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

    if (user.role === 'campus_director' && (entry as any).departments?.campus_id !== user.campus_id) {
      throw new ForbiddenException('Campus directors can only assign teachers to entries within their own campus')
    }
    if (user.role === 'hod' && entry.department_id !== user.department_id) {
      throw new ForbiddenException('HODs can only assign teachers to entries within their own department')
    }

    const slot = (entry as any).time_slots

    // F37: Global Teacher Clash Check across all campuses and semesters for this academic year
    if (newTeacherId) {
      const { data: conflicts, error: clashErr } = await this.supabase.admin
        .from('timetable_entries')
        .select('id, course_id, academic_year, semester, department_id, status')
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

    // F33: Update teacher_id in place, preserving entry identity, class identity and attendance
    const { error: updateErr } = await this.supabase.admin
      .from('timetable_entries')
      .update({
        teacher_id: newTeacherId || null,
      })
      .eq('id', entryId)

    if (updateErr) {
      throw new InternalServerErrorException(`Failed to update assigned teacher: ${updateErr.message}`)
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
    let campusDeptIds: string[] = []
    if (user.campus_id) {
      const { data: depts, error: deptsErr } = await this.supabase.admin
        .from('departments')
        .select('id')
        .eq('campus_id', user.campus_id)

      if (deptsErr) {
        throw new InternalServerErrorException(`Failed to resolve campus departments: ${deptsErr.message}`)
      }
      campusDeptIds = (depts || []).map((d: any) => d.id)

      // Guard F05: If campus has no departments, do NOT fall back to global update across other campuses!
      if (campusDeptIds.length === 0) {
        return {
          success: true,
          message: 'Campus has no registered departments. No timetable entries to publish.',
          publishedCount: 0,
          publishedAt: new Date().toISOString(),
        }
      }
    } else if (user.role !== 'superadmin') {
      throw new ForbiddenException('Cannot publish timetable without authorized campus scope')
    }

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
          title,
          department_id
        )
      `)
      .eq('academic_year', academicYear)
      .eq('semester', semester)
      .eq('resolved', false)

    const { data: rawConflicts, error: conflictErr } = await conflictQuery
    if (conflictErr) {
      this.serverLogger.error(`[publish] Conflict query error: ${conflictErr.message}`, 'TimetableService')
    }

    let conflicts = rawConflicts || []
    if (user.campus_id && campusDeptIds.length > 0) {
      conflicts = conflicts.filter((c: any) =>
        !c.courses?.department_id || campusDeptIds.includes(c.courses.department_id)
      )
    }

    if (!force && conflicts.length > 0) {
      throw new UnprocessableEntityException({
        error: 'Cannot publish timetable while unresolved conflicts exist',
        conflicts: conflicts.map((c: any) => ({
          courseId: c.course_id,
          courseName: c.courses?.title || 'Unknown',
          reason: c.reason,
          conflictingStudentCount: c.conflicting_student_count || 0,
        })),
      })
    }

    const nowIso = new Date().toISOString()
    let updateQuery = this.supabase.admin
      .from('timetable_entries')
      .update({
        status: 'published',
        published_at: nowIso,
      })
      .eq('academic_year', academicYear)
      .eq('semester', semester)
      .in('status', ['draft', 'generated'])

    if (campusDeptIds.length > 0) {
      updateQuery = updateQuery.in('department_id', campusDeptIds)
    } else if (user.role !== 'superadmin') {
      throw new ForbiddenException('Cannot perform un-scoped timetable publish')
    }

    const { data: updatedData, error: updateErr } = await updateQuery.select('id')
    if (updateErr) {
      this.serverLogger.error(`[publish] Failed to publish timetable entries: ${updateErr.message}`, 'TimetableService')
      throw new InternalServerErrorException('Failed to publish timetable entries')
    }

    await this.auditLogger.log({
      eventType: AuditEvents.TIMETABLE_PUBLISHED,
      userId: user.userId,
      userRole: user.role,
      action: `published timetable for ${academicYear} sem ${semester}`,
      resourceType: 'timetable',
      status: 'success',
      metadata: { academicYear, semester, publishedCount: updatedData?.length ?? 0, forced: force },
    })

    return {
      success: true,
      message: 'Timetable published successfully',
      publishedCount: updatedData?.length ?? 0,
      publishedAt: nowIso,
    }
  }
}
