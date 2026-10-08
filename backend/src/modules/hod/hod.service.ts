import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { SupabaseService } from '../../core/database/supabase.service'
import { AuditLoggerService, AuditEvents } from '../../core/logging/audit-logger.service'
import { ServerLoggerService } from '../../core/logging/server-logger.service'
import { AuthUser } from '../../core/auth/types'
import { SEMESTERS } from '../../core/constants/semesters'
import { validatePathwaySlots } from '../../core/utils/slotRules'

function generatePathwayId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${slug}-${suffix}`
}

@Injectable()
export class HodService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService,
    private readonly serverLogger: ServerLoggerService,
  ) {}

  // ──────────────── Catalog Readiness Checklist (F53, D07) ────────────────
  async getCatalogReadiness(user: AuthUser) {
    const departmentId = user.department_id
    if (!departmentId) {
      throw new ForbiddenException('User is not affiliated with any academic department.')
    }

    // 1. Fetch blueprints across all semesters
    const { data: blueprints, error: bpError } = await this.supabase.admin
      .from('semester_blueprints')
      .select('semester, min_credits, max_credits, pathways')
      .eq('department_id', departmentId)

    if (bpError) {
      throw new InternalServerErrorException(`Failed to fetch blueprints: ${bpError.message}`)
    }

    const bpMap = new Map((blueprints || []).map((b) => [b.semester, b]))

    // 2. Fetch courses across all semesters
    const { data: courses, error: courseError } = await this.supabase.admin
      .from('courses')
      .select('id, course_code, title, semester, category, credits, seat_limit')
      .eq('department_id', departmentId)

    if (courseError) {
      throw new InternalServerErrorException(`Failed to fetch courses: ${courseError.message}`)
    }

    const coursesBySem = new Map<number, any[]>()
    for (const c of courses || []) {
      const s = c.semester
      if (!coursesBySem.has(s)) coursesBySem.set(s, [])
      coursesBySem.get(s)!.push(c)
    }

    // 3. Build readiness matrix for all 10 semesters without fabricating placeholder curriculum
    const semestersReport = SEMESTERS.map((sem) => {
      const bp = bpMap.get(sem)
      const semCourses = coursesBySem.get(sem) || []
      const hasBlueprint = !!bp
      const hasCourses = semCourses.length > 0

      const missingElements: string[] = []
      if (!hasBlueprint) missingElements.push('semester_blueprint')
      if (!hasCourses) missingElements.push('courses')

      let status: 'ready' | 'partial' | 'missing' = 'missing'
      if (hasBlueprint && hasCourses) {
        status = 'ready'
      } else if (hasBlueprint || hasCourses) {
        status = 'partial'
      }

      const pathways = (bp?.pathways || []) as any[]
      const hasResearchPathway = pathways.some((p: any) =>
        /research|dissertation|project|internship/i.test(p.name || ''),
      )

      return {
        semester: sem,
        status,
        has_blueprint: hasBlueprint,
        course_count: semCourses.length,
        min_credits: bp?.min_credits ?? null,
        max_credits: bp?.max_credits ?? null,
        pathway_count: pathways.length,
        has_research_or_project_pathway: hasResearchPathway,
        missing_elements: missingElements,
      }
    })

    const readyCount = semestersReport.filter((r) => r.status === 'ready').length
    const partialCount = semestersReport.filter((r) => r.status === 'partial').length
    const missingCount = semestersReport.filter((r) => r.status === 'missing').length

    // D01, D02, D06: Configuration & catalog consistency checks
    const advisoryWarnings: Array<{ type: string; semester?: number; course_code?: string; message: string }> = []

    // D01: Mismatched course code prefix vs semester
    for (const c of courses || []) {
      const codeMatch = (c.course_code || '').match(/^KU0?(\d+)/i)
      if (codeMatch) {
        const codeSem = parseInt(codeMatch[1], 10)
        if (codeSem !== c.semester && codeSem >= 1 && codeSem <= 10) {
          advisoryWarnings.push({
            type: 'CODE_SEMESTER_MISMATCH',
            semester: c.semester,
            course_code: c.course_code,
            message: `Course ${c.course_code} (${c.title}) code prefix indicates semester ${codeSem}, but is assigned to semester ${c.semester}. HOD should verify syllabus semester and align code or semester.`,
          })
        }
      }
    }

    // D02: Duplicate fixed paper in blueprint
    for (const b of blueprints || []) {
      for (const p of (b.pathways || []) as any[]) {
        const { valid, errors } = validatePathwaySlots(p.slots || [])
        if (!valid) {
          for (const err of errors) {
            advisoryWarnings.push({
              type: 'BLUEPRINT_DUPLICATE_FIXED',
              semester: b.semester,
              message: `Semester ${b.semester} blueprint pathway "${p.name || 'Unnamed'}": ${err}`,
            })
          }
        }
      }
    }

    // D06: AEC capacity inspection
    for (const c of courses || []) {
      if (c.category === 'AEC' && (c.seat_limit ?? 60) <= 60) {
        advisoryWarnings.push({
          type: 'AEC_CAPACITY_CONSTRAINED',
          semester: c.semester,
          course_code: c.course_code,
          message: `AEC course ${c.course_code} has global capacity ${c.seat_limit ?? 60}. Verify combined inter-campus demand before registration closure.`,
        })
      }
    }

    return {
      department_id: departmentId,
      summary: {
        total_semesters: SEMESTERS.length,
        ready: readyCount,
        partial: partialCount,
        missing: missingCount,
        advisory_warning_count: advisoryWarnings.length,
      },
      semesters: semestersReport,
      advisory_warnings: advisoryWarnings,
    }
  }

  // ──────────────── Blueprint ────────────────
  async getBlueprint(semester: number, user: AuthUser) {
    const { data, error } = await this.supabase.admin
      .from('semester_blueprints')
      .select('*')
      .eq('department_id', user.department_id)
      .eq('semester', semester)
      .maybeSingle()

    if (error) {
      throw new InternalServerErrorException('Failed to fetch blueprint')
    }
    return data ?? null
  }

  async updateBlueprint(
    body: {
      semester: number
      min_credits: number
      max_credits: number
      pathways: any[]
    },
    user: AuthUser,
  ) {
    const { semester, min_credits, max_credits, pathways } = body

    const pathwaysWithIds = (pathways || []).map((p: any) => ({
      ...p,
      id: p.id && p.id.trim() !== '' ? p.id : generatePathwayId(p.name),
      slots: (p.slots || []).map((s: any, idx: number) => ({
        ...s,
        slot: s.slot ?? idx + 1,
      })),
    }))

    // F20, D02: Validate each pathway against duplicate fixed courses and valid slot constraints
    for (const p of pathwaysWithIds) {
      const { valid, errors } = validatePathwaySlots(p.slots || [])
      if (!valid) {
        throw new BadRequestException(
          `Blueprint pathway "${p.name || 'Pathway'}" validation failed: ${errors.join('; ')}`,
        )
      }
    }

    // Synchronize flat legacy slot columns with the first/default pathway's reordered slots
    const defaultPathway = pathwaysWithIds[0]
    const flatSlots: Record<string, any> = {}
    for (let i = 1; i <= 6; i++) {
      const s = defaultPathway?.slots?.[i - 1]
      flatSlots[`slot_${i}_rule`] = s?.rule || null
      flatSlots[`slot_${i}_target`] = s?.target || null
      flatSlots[`slot_${i}_name`] = s?.name || null
    }

    const payload = {
      department_id: user.department_id,
      semester,
      min_credits,
      max_credits,
      pathways: pathwaysWithIds,
      ...flatSlots,
    }

    const { error } = await this.supabase.admin
      .from('semester_blueprints')
      .upsert(payload, { onConflict: 'department_id,semester' })

    if (error) throw new InternalServerErrorException('Failed to save blueprint')

    await this.auditLogger.log({
      eventType: AuditEvents.BLUEPRINT_SAVED,
      userId: user.userId,
      userRole: user.role,
      action: `saved blueprint for semester ${semester}`,
      resourceType: 'blueprint',
      status: 'success',
      metadata: { semester, department_id: user.department_id },
    })

    return { success: true, message: 'Blueprint saved successfully' }
  }

  // ──────────────── Courses ────────────────
  async getCourses(semester: number, user: AuthUser, ownOnly?: boolean, maxSemester?: number) {
    if (ownOnly) {
      let query = this.supabase.admin
        .from('courses')
        .select('*, departments(name, code, campus_id)')
        .eq('department_id', user.department_id)

      if (maxSemester !== undefined && !isNaN(maxSemester) && maxSemester > 0) {
        query = query.lt('semester', maxSemester)
      } else {
        query = query.eq('semester', semester)
      }

      const { data, error } = await query.order('semester').order('category')
      if (error) throw new InternalServerErrorException('Failed to fetch courses')

      return (data ?? []).map((c: any) => ({
        ...c,
        department_name: c.departments?.name ?? '',
        department_code: c.departments?.code ?? '',
        is_own_campus: true,
        is_own_dept: true,
      }))
    }

    const { data: depts } = await this.supabase.admin
      .from('departments')
      .select('id')
      .eq('campus_id', user.campus_id)

    const campusDeptIds = depts && depts.length > 0 ? depts.map((d) => d.id) : [user.department_id]

    let query = this.supabase.admin
      .from('courses')
      .select('*, departments(name, code, campus_id)')
      .or(`department_id.in.(${campusDeptIds.join(',')}),category.eq.AEC`)

    if (maxSemester !== undefined && !isNaN(maxSemester) && maxSemester > 0) {
      query = query.lt('semester', maxSemester)
    } else {
      query = query.eq('semester', semester)
    }

    const { data, error } = await query.order('semester').order('category')
    if (error) throw new InternalServerErrorException('Failed to fetch courses')

    return (data ?? []).map((c: any) => ({
      ...c,
      department_name: c.departments?.name ?? '',
      department_code: c.departments?.code ?? '',
      is_own_campus: campusDeptIds.includes(c.department_id),
      is_own_dept: c.department_id === user.department_id,
    }))
  }

  async createCourse(body: any, user: AuthUser) {
    const {
      course_code,
      title,
      semester,
      credits,
      theory_hours_per_week,
      practical_hours_per_week,
      category,
      tag,
      seat_limit,
      prerequisite_course_ids,
    } = body

    if (!user.department_id) {
      throw new ForbiddenException('HOD has no assigned department affiliation (access denied)')
    }

    if (body.department_id && body.department_id !== user.department_id) {
      throw new ForbiddenException('HODs cannot create courses under a foreign department')
    }

    const targetDeptId = user.department_id

    const { data: created, error } = await this.supabase.admin
      .from('courses')
      .insert({
        course_code: course_code.toUpperCase(),
        title,
        semester,
        credits,
        theory_hours_per_week: theory_hours_per_week ?? 0,
        practical_hours_per_week: practical_hours_per_week ?? 0,
        category,
        tag: tag || null,
        department_id: targetDeptId,
        seat_limit: seat_limit ? Number(seat_limit) : 60,
        prerequisite_course_ids: Array.isArray(prerequisite_course_ids) ? prerequisite_course_ids : [],
      })
      .select('id')
      .single()

    if (error) {
      this.serverLogger.error(`Failed to create course: ${JSON.stringify(error)}`, 'HodService')
      if (error.code === '23505') {
        throw new ConflictException('Course code already exists')
      }
      if (error.code === '23514') {
        throw new BadRequestException(`Course constraint violation: ${error.message || 'Check category, semester, or credit values'}`)
      }
      if (error.code === '23503') {
        throw new BadRequestException(`Foreign key violation: ${error.message || 'Department or prerequisite does not exist'}`)
      }
      if (error.code === '23502') {
        throw new BadRequestException(`Missing required field: ${error.message || 'Required field missing'}`)
      }
      throw new BadRequestException(error.message || 'Failed to add course')
    }

    await this.auditLogger.log({
      eventType: AuditEvents.COURSE_CREATED,
      userId: user.userId,
      userRole: user.role,
      action: `created course: ${course_code.toUpperCase()}`,
      resourceType: 'course',
      resourceId: created?.id,
      status: 'success',
    })

    return { success: true, message: 'Course added successfully', id: created?.id }
  }

  async updateCourse(id: string, body: any, user: AuthUser) {
    const {
      course_code,
      title,
      credits,
      theory_hours_per_week,
      practical_hours_per_week,
      category,
      tag,
      seat_limit,
      prerequisite_course_ids,
    } = body

    const updatePayload: Record<string, any> = {
      course_code: course_code.toUpperCase(),
      title,
      credits,
      theory_hours_per_week: theory_hours_per_week ?? 0,
      practical_hours_per_week: practical_hours_per_week ?? 0,
      category,
      tag: tag || null,
    }

    if (seat_limit !== undefined) {
      updatePayload.seat_limit = seat_limit ? Number(seat_limit) : 60
    }
    if (prerequisite_course_ids !== undefined) {
      updatePayload.prerequisite_course_ids = Array.isArray(prerequisite_course_ids) ? prerequisite_course_ids : []
    }

    if (!user.department_id) {
      throw new ForbiddenException('HOD has no assigned department affiliation (access denied)')
    }

    // 1. Verify target course exists and belongs to the authenticated HOD's department
    const { data: existingCourse, error: fetchErr } = await this.supabase.admin
      .from('courses')
      .select('id, course_code, department_id')
      .eq('id', id)
      .maybeSingle()

    if (fetchErr || !existingCourse) {
      throw new NotFoundException('Course not found')
    }

    if (existingCourse.department_id !== user.department_id) {
      throw new ForbiddenException('You can only update courses belonging to your own department')
    }

    if (body.department_id && body.department_id !== user.department_id) {
      throw new ForbiddenException('Course department ownership cannot be transferred via update')
    }

    const { error } = await this.supabase.admin
      .from('courses')
      .update(updatePayload)
      .eq('id', id)
      .eq('department_id', user.department_id)

    if (error) {
      this.serverLogger.error(`Failed to update course: ${JSON.stringify(error)}`, 'HodService')
      if (error.code === '23505') throw new ConflictException('Course code already exists')
      if (error.code === '23514') throw new BadRequestException(`Course constraint violation: ${error.message || 'Check category or credit values'}`)
      throw new BadRequestException(error.message || 'Failed to update course')
    }

    await this.auditLogger.log({
      eventType: AuditEvents.COURSE_UPDATED,
      userId: user.userId,
      userRole: user.role,
      action: `updated course: ${course_code.toUpperCase()}`,
      resourceType: 'course',
      resourceId: id,
      status: 'success',
    })

    return { success: true, message: 'Course updated successfully' }
  }

  async deleteCourse(courseId: string, user: AuthUser) {
    if (!user.department_id) {
      throw new ForbiddenException('HOD has no assigned department affiliation (access denied)')
    }

    // 1. Verify target course exists and belongs to the authenticated HOD's department
    const { data: existingCourse, error: fetchErr } = await this.supabase.admin
      .from('courses')
      .select('id, course_code, department_id')
      .eq('id', courseId)
      .maybeSingle()

    if (fetchErr || !existingCourse) {
      throw new NotFoundException('Course not found')
    }

    if (existingCourse.department_id !== user.department_id) {
      throw new ForbiddenException('You can only delete courses belonging to your own department')
    }

    const { error } = await this.supabase.admin
      .from('courses')
      .delete()
      .eq('id', courseId)
      .eq('department_id', user.department_id)

    if (error) {
      this.serverLogger.error(`Failed to delete course ${courseId}: ${error.message}`, 'HodService')
      throw new BadRequestException(`Failed to delete course: ${error.message}`)
    }

    await this.auditLogger.log({
      eventType: AuditEvents.COURSE_DELETED,
      userId: user.userId,
      userRole: user.role,
      action: `deleted course: ${courseId}`,
      resourceType: 'course',
      resourceId: courseId,
      status: 'success',
    })

    return { success: true, message: 'Course deleted successfully' }
  }

  // ──────────────── Departments ────────────────
  async getDepartments(user: AuthUser) {
    const { data, error } = await this.supabase.admin
      .from('departments')
      .select('id, name, code, campus_id, campuses (name)')
      .eq('campus_id', user.campus_id)
      .order('name')

    if (error) throw new InternalServerErrorException('Failed to fetch departments')
    return data ?? []
  }

  // ──────────────── Students ────────────────
  async getStudents(semester: number | undefined, user: AuthUser) {
    let query = this.supabase.admin
      .from('students')
      .select('id, full_name, current_semester, cap_application_number')
      .eq('department_id', user.department_id)

    if (semester) {
      query = query.eq('current_semester', semester)
    }

    const { data, error } = await query.order('full_name')
    if (error) {
      this.serverLogger.error('Failed to fetch students in HOD getStudents', error.message)
      throw new InternalServerErrorException('Failed to fetch students')
    }
    return data ?? []
  }

  async addStudent(
    body: {
      full_name: string
      cap_application_number: string
      email: string
      password?: string
      current_semester: number
      academic_year_joined: string
    },
    user: AuthUser,
  ) {
    const { full_name, cap_application_number, email, current_semester, academic_year_joined } = body
    if (!body.password || body.password.trim().length < 8) {
      throw new BadRequestException('A password of at least 8 characters is required to create a student account')
    }
    const password = body.password.trim()

    const { data: authData, error: authError } = await this.supabase.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError || !authData?.user) {
      throw new BadRequestException(authError?.message || 'Failed to create auth user')
    }

    const studentId = authData.user.id

    const { error: insertError } = await this.supabase.admin
      .from('students')
      .insert({
        id: studentId,
        full_name,
        cap_application_number: cap_application_number.trim(),
        current_semester,
        academic_year_joined,
        department_id: user.department_id,
        campus_id: user.campus_id,
        must_change_password: true,
      })

    if (insertError) {
      await this.supabase.admin.auth.admin.deleteUser(studentId)
      throw new BadRequestException(insertError.message || 'Failed to insert student record')
    }

    await this.supabase.admin.auth.admin.updateUserById(studentId, {
      app_metadata: {
        role: 'student',
        department_id: user.department_id,
        campus_id: user.campus_id,
        must_change_password: true,
      },
    })

    await this.auditLogger.log({
      eventType: AuditEvents.STUDENT_CREATED,
      userId: user.userId,
      userRole: user.role,
      action: `added student: ${full_name} (${email})`,
      resourceType: 'student',
      resourceId: studentId,
      status: 'success',
    })

    return { success: true, message: 'Student added successfully' }
  }

  async updateStudent(
    body: { id: string; full_name: string; cap_application_number?: string; current_semester: number },
    user: AuthUser,
  ) {
    const { id, full_name, cap_application_number, current_semester } = body

    const updates: Record<string, any> = {
      full_name,
      current_semester,
    }

    if (cap_application_number) {
      const cleanCap = cap_application_number.trim()
      // Check if CAP number is already used by another student
      const { data: existingStudent } = await this.supabase.admin
        .from('students')
        .select('id, full_name')
        .eq('cap_application_number', cleanCap)
        .neq('id', id)
        .maybeSingle()

      if (existingStudent) {
        throw new BadRequestException(
          `CAP number "${cleanCap}" is already assigned to student "${existingStudent.full_name}".`,
        )
      }

      updates.cap_application_number = cleanCap
    }

    const { error } = await this.supabase.admin
      .from('students')
      .update(updates)
      .eq('id', id)
      .eq('department_id', user.department_id)

    if (error) {
      if (error.code === '23505') {
        throw new BadRequestException('A student with this CAP Application Number already exists.')
      }
      throw new InternalServerErrorException('Failed to update student')
    }

    await this.auditLogger.log({
      eventType: 'student_updated',
      userId: user.userId,
      userRole: user.role,
      action: `updated student record: ${full_name}`,
      resourceType: 'student',
      resourceId: id,
      status: 'success',
      metadata: { updates },
    })

    return { success: true, message: 'Student updated successfully' }
  }

  async removeStudent(studentId: string, user: AuthUser) {
    if (!user.department_id) {
      throw new ForbiddenException('HOD has no assigned department affiliation (access denied)')
    }

    // 1. Load target student and verify existence & student identity
    const { data: student, error: fetchError } = await this.supabase.admin
      .from('students')
      .select('id, full_name, department_id, campus_id')
      .eq('id', studentId)
      .maybeSingle()

    if (fetchError || !student) {
      throw new NotFoundException('Student not found')
    }

    // 2. Authorize student against HOD department & campus
    if (student.department_id !== user.department_id) {
      throw new ForbiddenException('Cannot remove a student from another department')
    }
    if (user.campus_id && student.campus_id && student.campus_id !== user.campus_id) {
      throw new ForbiddenException('Cannot remove a student from another campus')
    }

    // 3. Delete student record from database
    const { error: deleteError } = await this.supabase.admin
      .from('students')
      .delete()
      .eq('id', studentId)
      .eq('department_id', user.department_id)

    if (deleteError) {
      this.serverLogger.error(`Failed to delete student ${studentId}: ${deleteError.message}`, 'HodService')
      throw new BadRequestException(`Failed to delete student: ${deleteError.message}`)
    }

    // 4. Only after verified database deletion, remove user from Supabase Auth
    const { error: authDeleteError } = await this.supabase.admin.auth.admin.deleteUser(studentId)
    if (authDeleteError) {
      this.serverLogger.warn(
        `Student database record was removed, but Supabase Auth deletion returned warning: ${authDeleteError.message}`,
        'HodService',
      )
    }

    await this.auditLogger.log({
      eventType: 'student_deleted',
      userId: user.userId,
      userRole: user.role,
      action: `deleted student: ${student.full_name} (${studentId})`,
      resourceType: 'student',
      resourceId: studentId,
      status: 'success',
      metadata: { department_id: user.department_id, campus_id: user.campus_id },
    })

    return { success: true, message: 'Student removed successfully' }
  }

  async bulkCreateStudents(rows: any[], batchPassword: string, user: AuthUser) {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('No student data provided')
    }
    if (rows.length > 100) {
      throw new BadRequestException('Bulk student creation is limited to a maximum of 100 students per batch')
    }

    if (!batchPassword || batchPassword.trim().length < 8) {
      throw new BadRequestException('A batch default password of at least 8 characters is required for bulk creation')
    }
    const defaultPassword = batchPassword.trim()
    const results: any[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const fullName = row.full_name || row['Full Name'] || row.name
      const email = row.email || row['Email']
      const semester = Number(row.current_semester || row['Current Semester'] || row.semester || 1)
      const academicYear = String(row.academic_year_joined || row['Academic Year Joined'] || '2026-27')
      const capNumber = String(
        row.cap_application_number ||
        row['CAP Number'] ||
        row['cap_application_number'] ||
        row['cap_number'] ||
        `CAP${Date.now().toString().slice(-6)}${i + 1}`
      ).trim()

      if (!fullName || !email) {
        results.push({ row: i + 1, email: email || '', status: 'error', issues: ['Missing name or email'] })
        continue
      }

      try {
        const { data: authData, error: authErr } = await this.supabase.admin.auth.admin.createUser({
          email: String(email).trim().toLowerCase(),
          password: defaultPassword,
          email_confirm: true,
        })

        if (authErr || !authData?.user) {
          results.push({ row: i + 1, email, status: 'error', issues: [authErr?.message || 'Auth creation failed'] })
          continue
        }

        const sid = authData.user.id
        const { error: dbErr } = await this.supabase.admin.from('students').insert({
          id: sid,
          full_name: fullName,
          cap_application_number: capNumber,
          current_semester: semester,
          academic_year_joined: academicYear,
          department_id: user.department_id,
          campus_id: user.campus_id,
          must_change_password: true,
        })

        if (dbErr) {
          await this.supabase.admin.auth.admin.deleteUser(sid)
          results.push({ row: i + 1, email, status: 'error', issues: [dbErr.message] })
          continue
        }

        await this.supabase.admin.auth.admin.updateUserById(sid, {
          app_metadata: {
            role: 'student',
            department_id: user.department_id,
            campus_id: user.campus_id,
            must_change_password: true,
          },
        })

        results.push({ row: i + 1, email, status: 'success' })
      } catch (err: any) {
        results.push({ row: i + 1, email, status: 'error', issues: [err.message] })
      }
    }

    await this.auditLogger.log({
      eventType: AuditEvents.STUDENT_BULK_CREATED,
      userId: user.userId,
      userRole: user.role,
      action: `bulk created students in department ${user.department_id}`,
      resourceType: 'student',
      status: 'success',
      metadata: { count: results.filter((r) => r.status === 'success').length },
    })

    return { success: true, results }
  }

  async exportStudentsExcel(semester: number | undefined, user: AuthUser) {
    let query = this.supabase.admin
      .from('student_registrations')
      .select(`
        student_id,
        semester,
        slot_1_course_id,
        slot_2_course_id,
        slot_3_course_id,
        slot_4_course_id,
        slot_5_course_id,
        slot_6_course_id,
        slot_7_course_id,
        slot_8_course_id,
        selections,
        students!inner(full_name, department_id)
      `)
      .eq('students.department_id', user.department_id)

    if (semester) {
      query = query.eq('semester', semester)
    }

    let { data: registrations, error } = await query
    if (error && (error.message?.includes('slot_7_course_id') || error.message?.includes('slot_8_course_id'))) {
      let fallbackQuery = this.supabase.admin
        .from('student_registrations')
        .select(`
          student_id,
          semester,
          slot_1_course_id,
          slot_2_course_id,
          slot_3_course_id,
          slot_4_course_id,
          slot_5_course_id,
          slot_6_course_id,
          selections,
          students!inner(full_name, department_id)
        `)
        .eq('students.department_id', user.department_id)
      if (semester) fallbackQuery = fallbackQuery.eq('semester', semester)
      const fallbackRes = await fallbackQuery
      registrations = fallbackRes.data as any
      error = fallbackRes.error
    }
    if (error) throw new InternalServerErrorException('Failed to fetch registration records')

    // Collect all course IDs from registrations to lookup titles
    const allCourseIds = new Set<string>()
    for (const reg of registrations ?? []) {
      for (let i = 1; i <= 8; i++) {
        const cid = (reg as any)[`slot_${i}_course_id`]
        if (cid) allCourseIds.add(cid)
      }
      const rawSel = (reg as any).selections
      const list = Array.isArray(rawSel) ? rawSel : Array.isArray(rawSel?.courses) ? rawSel.courses : []
      for (const item of list) {
        const cid = typeof item === 'string' ? item : item?.id || item?.course_id
        if (cid) allCourseIds.add(cid)
      }
    }

    const courseTitleMap = new Map<string, string>()
    if (allCourseIds.size > 0) {
      const { data: courseList } = await this.supabase.admin
        .from('courses')
        .select('id, title, course_code')
        .in('id', Array.from(allCourseIds))
      for (const c of courseList ?? []) {
        courseTitleMap.set(c.id, `${c.title} (${c.course_code})`)
      }
    }

    const rows = (registrations ?? []).map((reg: any) => {
      const student = reg.students
      const papers: string[] = []
      for (let i = 1; i <= 6; i++) {
        const cid = reg[`slot_${i}_course_id`]
        if (cid && courseTitleMap.has(cid)) {
          papers.push(courseTitleMap.get(cid)!)
        }
      }
      if (papers.length === 0) {
        const rawSel = reg.selections
        const list = Array.isArray(rawSel) ? rawSel : Array.isArray(rawSel?.courses) ? rawSel.courses : []
        for (const item of list) {
          const cid = typeof item === 'string' ? item : item?.id || item?.course_id
          const title = item?.title || (cid ? courseTitleMap.get(cid) : '')
          if (title) papers.push(title)
        }
      }

      return {
        name: student?.full_name ?? '—',
        sem: reg.semester,
        paper_1: papers[0] ?? '',
        paper_2: papers[1] ?? '',
        paper_3: papers[2] ?? '',
        paper_4: papers[3] ?? '',
        paper_5: papers[4] ?? '',
        paper_6: papers[5] ?? '',
      }
    })

    return rows
  }

  // ──────────────── Teachers Management ────────────────
  async getDepartmentTeachers(user: AuthUser) {
    const departmentId = user.department_id
    if (!departmentId) {
      throw new ForbiddenException('User is not affiliated with any academic department.')
    }

    const { data, error } = await this.supabase.admin
      .from('faculty')
      .select('id, full_name, email, role')
      .eq('department_id', departmentId)
      .eq('role', 'teacher')
      .order('full_name', { ascending: true })

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch teachers: ${error.message}`)
    }

    return data || []
  }

  async createDepartmentTeacher(
    body: { full_name: string; email: string; password: string },
    user: AuthUser,
  ) {
    const departmentId = user.department_id
    const campusId = user.campus_id
    if (!departmentId || !campusId) {
      throw new ForbiddenException('User is missing department or campus affiliation.')
    }

    const { full_name, email, password } = body

    // 1. Create auth user with Supabase admin API
    const { data: authData, error: authError } = await this.supabase.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        role: 'teacher',
        department_id: departmentId,
        campus_id: campusId,
        must_change_password: true,
      },
    })

    if (authError || !authData?.user) {
      const isDuplicate = authError?.message?.toLowerCase().includes('already') || authError?.status === 422
      throw new BadRequestException(
        isDuplicate ? 'A user with this email address has already been registered' : 'Failed to create auth account: ' + authError?.message,
      )
    }

    const teacherId = authData.user.id

    // 2. Insert into faculty table with role 'teacher'
    const { error: facultyError } = await this.supabase.admin
      .from('faculty')
      .insert({
        id: teacherId,
        full_name,
        email,
        role: 'teacher',
        department_id: departmentId,
        campus_id: campusId,
      })

    if (facultyError) {
      await this.supabase.admin.auth.admin.deleteUser(teacherId)
      throw new BadRequestException('Failed to create faculty record: ' + facultyError.message)
    }

    // 3. Set app_metadata
    await this.supabase.admin.auth.admin.updateUserById(teacherId, {
      app_metadata: {
        role: 'teacher',
        department_id: departmentId,
        campus_id: campusId,
      },
    })

    await this.auditLogger.log({
      eventType: 'teacher_created',
      userId: user.userId,
      userRole: user.role,
      action: `Created department teacher: ${full_name} (${email})`,
      resourceType: 'faculty',
      resourceId: teacherId,
      status: 'success',
    })

    return {
      success: true,
      message: `Teacher ${full_name} added successfully to your department.`,
      teacher: {
        id: teacherId,
        full_name,
        email,
        role: 'teacher',
      },
    }
  }

  async deleteDepartmentTeacher(teacherId: string, user: AuthUser) {
    const departmentId = user.department_id
    if (!departmentId) {
      throw new ForbiddenException('User is missing department affiliation.')
    }

    // Verify teacher belongs to this department and is NOT HOD
    const { data: teacher, error: findError } = await this.supabase.admin
      .from('faculty')
      .select('id, full_name, role, department_id')
      .eq('id', teacherId)
      .single()

    if (findError || !teacher) {
      throw new NotFoundException('Teacher not found.')
    }

    if (teacher.department_id !== departmentId) {
      throw new ForbiddenException('Cannot remove a teacher from another department.')
    }

    if (teacher.role === 'hod') {
      throw new BadRequestException('Cannot remove department Head of Department.')
    }

    // Clear any assigned_by references pointing to this teacher
    await this.supabase.admin
      .from('teacher_course_assignments')
      .update({ assigned_by: null })
      .eq('assigned_by', teacherId)

    // Delete any course assignments for this teacher
    await this.supabase.admin
      .from('teacher_course_assignments')
      .delete()
      .eq('teacher_id', teacherId)

    // Delete from faculty table
    const { error: deleteFacultyError } = await this.supabase.admin
      .from('faculty')
      .delete()
      .eq('id', teacherId)

    if (deleteFacultyError) {
      throw new InternalServerErrorException(`Failed to delete teacher record: ${deleteFacultyError.message}`)
    }

    // Delete auth account and verify outcome (F68)
    const { error: authDeleteError } = await this.supabase.admin.auth.admin.deleteUser(teacherId)

    if (authDeleteError) {
      this.serverLogger.warn(
        `Faculty deleted but Auth account deletion failed for teacher ${teacherId}: ${authDeleteError.message}`,
      )
      await this.auditLogger.log({
        eventType: 'teacher_deleted_partial_warning',
        userId: user.userId,
        userRole: user.role,
        action: `Deleted department teacher faculty profile for ${teacher.full_name} (${teacherId}), but Auth deletion failed: ${authDeleteError.message}`,
        resourceType: 'faculty',
        resourceId: teacherId,
        status: 'failure',
      })
      return {
        success: true,
        warning: `Teacher profile was deleted, but Auth account cleanup failed: ${authDeleteError.message}`,
        message: `Teacher ${teacher.full_name} removed from department (auth cleanup incomplete).`,
      }
    }

    await this.auditLogger.log({
      eventType: 'teacher_deleted',
      userId: user.userId,
      userRole: user.role,
      action: `Deleted department teacher: ${teacher.full_name} (${teacherId})`,
      resourceType: 'faculty',
      resourceId: teacherId,
      status: 'success',
    })

    return {
      success: true,
      message: `Teacher ${teacher.full_name} removed successfully.`,
    }
  }
}
