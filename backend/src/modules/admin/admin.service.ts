import { fetchAllPaginated } from '../../core/database/pagination.util'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { SupabaseService } from '../../core/database/supabase.service'
import { assertPasswordNotCompromised } from '../../core/security/password-security'
import { AuditLoggerService, AuditEvents } from '../../core/logging/audit-logger.service'
import { ServerLoggerService } from '../../core/logging/server-logger.service'
import { AuthUser } from '../../core/auth/types'

@Injectable()
export class AdminService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService,
    private readonly serverLogger: ServerLoggerService,
  ) {}

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Campuses â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getCampuses() {
    const { data, error } = await this.supabase.admin
      .from('campuses')
      .select('*')
      .order('name')
    if (error) throw new InternalServerErrorException('Failed to fetch campuses')
    return data ?? []
  }

  async createCampus(name: string, code: string, user: AuthUser) {
    const { data: createdCampus, error } = await this.supabase.admin
      .from('campuses')
      .insert({ name, code: code.toUpperCase() })
      .select('id, name, code')
      .single()

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('Campus name or code already exists')
      }
      throw new InternalServerErrorException('Failed to add campus')
    }

    // Ensure campus_settings exists as fallback even if trigger was bypassed (F54)
    await this.supabase.admin
      .from('campus_settings')
      .upsert(
        {
          campus_id: createdCampus.id,
          academic_year: '2025-26',
          min_credits: 18,
          max_credits: 26,
        },
        { onConflict: 'campus_id' },
      )

    // Inspect setup status
    const { data: settings } = await this.supabase.admin
      .from('campus_settings')
      .select('latitude, longitude, geofence_radius, registration_start, registration_end')
      .eq('campus_id', createdCampus.id)
      .maybeSingle()

    const hasGeofence = !!(
      settings &&
      settings.latitude != null &&
      settings.longitude != null &&
      settings.geofence_radius != null
    )
    const hasRegWindow = !!(
      settings &&
      settings.registration_start &&
      settings.registration_end
    )
    const isReady = hasGeofence && hasRegWindow
    const setupStatus = isReady
      ? 'ready'
      : !hasGeofence
      ? 'incomplete_geofence'
      : 'incomplete_registration_window'

    await this.auditLogger.log({
      eventType: AuditEvents.CAMPUS_CREATED,
      userId: user.userId,
      userRole: user.role,
      action: `created campus: ${name} (${code.toUpperCase()})`,
      resourceType: 'campus',
      resourceId: createdCampus?.id,
      status: 'success',
      metadata: {
        setup_status: setupStatus,
        is_ready: isReady,
      },
    })

    return {
      success: true,
      message: 'Campus added successfully',
      campus_id: createdCampus.id,
      setup_status: setupStatus,
      is_ready: isReady,
    }
  }

  async updateCampus(id: string, name: string, code: string, user: AuthUser) {
    const { error } = await this.supabase.admin
      .from('campuses')
      .update({ name, code: code.toUpperCase() })
      .eq('id', id)

    if (error) throw new InternalServerErrorException('Failed to update campus')

    await this.auditLogger.log({
      eventType: AuditEvents.CAMPUS_UPDATED,
      userId: user.userId,
      userRole: user.role,
      action: `updated campus: ${name} (${code.toUpperCase()})`,
      resourceType: 'campus',
      resourceId: id,
      status: 'success',
    })

    return { success: true, message: 'Campus updated successfully' }
  }

  async deleteCampus(campusId: string, user: AuthUser) {
    const { data: students } = await this.supabase.admin
      .from('students')
      .select('id')
      .eq('campus_id', campusId)

    const { data: faculty } = await this.supabase.admin
      .from('faculty')
      .select('id')
      .eq('campus_id', campusId)

    const { error } = await this.supabase.admin.rpc('delete_campus_cascade', {
      p_campus_id: campusId,
    })

    if (error) throw new InternalServerErrorException('Failed to delete campus')

    const allUserIds = [
      ...(students ?? []).map((s) => s.id),
      ...(faculty ?? []).map((f) => f.id),
    ]

    if (allUserIds.length > 0) {
      const deleteResults = await Promise.allSettled(
        allUserIds.map((id) => this.supabase.admin.auth.admin.deleteUser(id)),
      )
      const failedDeletions = deleteResults.filter((r) => r.status === 'rejected')
      if (failedDeletions.length > 0) {
        this.serverLogger.warn(
          `deleteCampus: ${failedDeletions.length} user auth deletions failed out of ${allUserIds.length}`,
        )
      }
    }

    await this.auditLogger.log({
      eventType: AuditEvents.CAMPUS_DELETED,
      userId: user.userId,
      userRole: user.role,
      action: `deleted campus: ${campusId}`,
      resourceType: 'campus',
      resourceId: campusId,
      status: 'success',
    })

    return { success: true, message: 'Campus deleted successfully' }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Departments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getDepartments() {
    const { data, error } = await this.supabase.admin
      .from('departments')
      .select('id, name, code, campus_id, campuses (name)')
      .order('name')
    if (error) throw new InternalServerErrorException('Failed to fetch departments')
    return data ?? []
  }

  private async validateDepartment(name: string, code: string, excludeId?: string) {
    if (!name || !code) throw new BadRequestException('Department name and code are required')
    const rows = await fetchAllPaginated<{ id: string; name: string; code: string }>(
      this.supabase.admin.from('departments').select('id, name, code').order('id'),
    )
    if (rows.some(row => row.id !== excludeId && row.code.trim().toUpperCase() === code)) {
      throw new ConflictException(`Department code '${code}' is already in use. Choose another code.`)
    }
    if (rows.some(row => row.id !== excludeId && row.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(`A department named '${name}' already exists. Choose another name.`)
    }
  }

  private departmentWriteError(error: { code?: string; message?: string }, name: string, code: string): never {
    if (error.code === '23505') {
      if (error.message?.includes('name')) throw new ConflictException(`A department named '${name}' already exists. Choose another name.`)
      if (error.message?.includes('code')) throw new ConflictException(`Department code '${code}' is already in use. Choose another code.`)
      throw new ConflictException('This department name or code is already in use. Choose a different value.')
    }
    if (error.code === '23503') throw new BadRequestException('The selected campus is no longer available. Choose a valid campus.')
    if (error.code === 'PGRST116') throw new NotFoundException('Department no longer exists. Refresh the list and retry.')
    throw new InternalServerErrorException('Unable to save the department. Please retry.')
  }

  async createDepartment(name: string, code: string, campus_id: string, user: AuthUser) {
    name = name.trim()
    code = code.trim().toUpperCase()
    await this.validateDepartment(name, code)
    const { data: campus, error: campusError } = await this.supabase.admin.from('campuses').select('id').eq('id', campus_id).maybeSingle()
    if (campusError) throw new InternalServerErrorException('Unable to verify the selected campus. Please retry.')
    if (!campus) throw new BadRequestException('The selected campus is no longer available. Choose a valid campus.')
    const { data: createdDept, error } = await this.supabase.admin
      .from('departments')
      .insert({
        name,
        code: code.toUpperCase(),
        campus_id,
      })
      .select('id')
      .single()

    if (error) this.departmentWriteError(error, name, code)

    await this.auditLogger.log({
      eventType: AuditEvents.DEPARTMENT_CREATED,
      userId: user.userId,
      userRole: user.role,
      action: `created department: ${name} (${code.toUpperCase()})`,
      resourceType: 'department',
      resourceId: createdDept?.id,
      status: 'success',
      metadata: { campus_id },
    })

    return { success: true, message: 'Department added successfully' }
  }

  async updateDepartment(id: string, name: string, code: string, user: AuthUser) {
    name = name.trim()
    code = code.trim().toUpperCase()
    const { data: existing, error: lookupError } = await this.supabase.admin.from('departments').select('id').eq('id', id).maybeSingle()
    if (lookupError) throw new InternalServerErrorException('Unable to load the department. Please retry.')
    if (!existing) throw new NotFoundException('Department no longer exists. Refresh the list and retry.')
    await this.validateDepartment(name, code, id)
    const { error } = await this.supabase.admin
      .from('departments')
      .update({ name, code })
      .eq('id', id)
      .select('id')
      .single()

    if (error) this.departmentWriteError(error, name, code)

    await this.auditLogger.log({
      eventType: AuditEvents.DEPARTMENT_UPDATED,
      userId: user.userId,
      userRole: user.role,
      action: `updated department: ${name} (${code.toUpperCase()})`,
      resourceType: 'department',
      resourceId: id,
      status: 'success',
    })

    return { success: true, message: 'Department updated successfully' }
  }

  async deleteDepartment(deptId: string, user: AuthUser) {
    const { data: students } = await this.supabase.admin
      .from('students')
      .select('id')
      .eq('department_id', deptId)

    const { data: faculty } = await this.supabase.admin
      .from('faculty')
      .select('id')
      .eq('department_id', deptId)

    const { error } = await this.supabase.admin.rpc('delete_department_cascade', {
      p_dept_id: deptId,
    })

    if (error) throw new InternalServerErrorException('Failed to delete department')

    const allUserIds = [
      ...(students ?? []).map((s) => s.id),
      ...(faculty ?? []).map((f) => f.id),
    ]

    if (allUserIds.length > 0) {
      await Promise.allSettled(
        allUserIds.map((id) => this.supabase.admin.auth.admin.deleteUser(id)),
      )
    }

    await this.auditLogger.log({
      eventType: AuditEvents.DEPARTMENT_DELETED,
      userId: user.userId,
      userRole: user.role,
      action: `deleted department: ${deptId}`,
      resourceType: 'department',
      resourceId: deptId,
      status: 'success',
    })

    return { success: true, message: 'Department deleted successfully' }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Faculty â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  private async checkAdministrativeFaculty(role: string, campusId: string, departmentId?: string | null, excludeId?: string) {
    if (role === 'teacher') throw new ForbiddenException('Teachers are managed by their HOD and are read-only here')
    if (!['hod', 'campus_director', 'teaching_staff'].includes(role)) throw new BadRequestException('Invalid administrative faculty role')
    const { data: campus, error: campusError } = await this.supabase.admin.from('campuses').select('id').eq('id', campusId).maybeSingle()
    if (campusError) throw new InternalServerErrorException('Unable to verify campus')
    if (!campus) throw new BadRequestException('Invalid campus selected')
    if (role === 'hod') {
      if (!departmentId) throw new BadRequestException('HOD must be assigned to a department')
      const { data: dept, error } = await this.supabase.admin.from('departments').select('campus_id').eq('id', departmentId).maybeSingle()
      if (error) throw new InternalServerErrorException('Unable to verify department')
      if (!dept || dept.campus_id !== campusId) throw new BadRequestException('Department must belong to the selected campus')
    } else if (departmentId) throw new BadRequestException('Directors and Teaching Staff cannot have a department assignment')
    let query = this.supabase.admin.from('faculty').select('id').eq('role', role)
    query = role === 'hod' ? query.eq('department_id', departmentId!) : query.eq('campus_id', campusId)
    if (excludeId) query = query.neq('id', excludeId)
    const { data: occupied, error } = await query.limit(1)
    if (error) throw new InternalServerErrorException('Unable to verify role availability')
    if (occupied?.length) throw new ConflictException(this.occupiedRoleMessage(role))
  }

  private occupiedRoleMessage(role: string) {
    return role === 'hod' ? 'This department already has an HOD' : `This campus already has a ${role === 'campus_director' ? 'Director' : 'Teaching Staff'} account`
  }

  private async editableFaculty(id: string) {
    const { data, error } = await this.supabase.admin.from('faculty').select('id, role').eq('id', id).maybeSingle()
    if (error) throw new InternalServerErrorException('Unable to verify faculty account')
    if (!data) throw new NotFoundException('Faculty account not found')
    if (data.role === 'teacher') throw new ForbiddenException('Teachers are managed by their HOD and are read-only here')
    return data
  }

  async getFacultyList() {
    const { data, error } = await this.supabase.admin
      .from('faculty')
      .select('id, full_name, email, role, department_id, campus_id, departments!faculty_department_id_fkey(name), campuses (name)')
      .order('full_name')
    if (error) throw new InternalServerErrorException('Failed to fetch faculty list')
    return data ?? []
  }

  async createFaculty(body: {
    full_name: string
    email: string
    password: string
    role: string
    department_id?: string | null
    campus_id: string
  }, user: AuthUser) {
    const { full_name, email, password, role, department_id, campus_id } = body

    await this.checkAdministrativeFaculty(role, campus_id, department_id)
    const assignedDeptId = role === 'hod' ? department_id! : null

    await assertPasswordNotCompromised(password)

    const { data: authData, error: authError } = await this.supabase.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        role,
        campus_id,
        department_id: assignedDeptId,
      },
    })

    if (authError || !authData?.user) {
      const isDuplicate = authError?.message?.toLowerCase().includes('already') || authError?.status === 422
      throw new BadRequestException(isDuplicate ? 'A user with this email address has already been registered' : 'Failed to create auth account')
    }

    const authUserId = authData.user.id

    let facultyError: any
    try {
      const result = await this.supabase.admin
      .from('faculty')
      .insert({
        id: authUserId,
        full_name,
        email,
        role,
        department_id: assignedDeptId,
        campus_id,
      })

      facultyError = result.error
    } catch { facultyError = { code: 'network' } }

    if (facultyError) {
      let cleanupFailed = false
      try {
        const cleanup = await this.supabase.admin.auth.admin.deleteUser(authUserId)
        cleanupFailed = !!cleanup.error
      } catch { cleanupFailed = true }
      const message = facultyError.code === '23505' ? this.occupiedRoleMessage(role)
        : facultyError.code === '23503' || facultyError.code === '23514' ? 'Invalid department or campus selected' : 'Failed to create faculty record'
      const detail = cleanupFailed ? `${message}. Cleanup failed for newly created Auth account ${authUserId}; administrator action is required.` : message
      if (facultyError.code === '23505') throw new ConflictException(detail)
      throw new BadRequestException(detail)
    }

    await this.auditLogger.log({
      eventType: AuditEvents.FACULTY_CREATED,
      userId: user.userId,
      userRole: user.role,
      action: `created faculty: ${full_name} (${role})`,
      resourceType: 'faculty',
      resourceId: authUserId,
      status: 'success',
      metadata: { role, campus_id, department_id },
    })

    return {
      success: true,
      id: authUserId,
      message: `${role === 'hod' ? 'HOD' : role === 'campus_director' ? 'Campus Director' : role === 'teaching_staff' ? 'Teaching Staff' : 'Teacher'} account created successfully`,
    }
  }

  async updateFaculty(id: string, body: {
    full_name: string
    role: string
    department_id?: string | null
    campus_id: string
  }, user: AuthUser) {
    const { full_name, role, department_id, campus_id } = body

    const existing = await this.editableFaculty(id)
    await this.checkAdministrativeFaculty(role, campus_id, department_id, id)
    const assignedDeptId = role === 'hod' ? department_id! : null

    const { error } = await this.supabase.admin
      .from('faculty')
      .update({
        full_name,
        role,
        department_id: assignedDeptId,
        campus_id,
      })
      .eq('id', id)
      .eq('role', existing.role)
      .select('id')
      .single()

    if (error?.code === '23505') throw new ConflictException(this.occupiedRoleMessage(role))
    if (error?.code === '23514' || error?.code === '23503') throw new BadRequestException('Department must belong to the selected campus')
    if (error) throw new InternalServerErrorException('Failed to update faculty record')

    await this.supabase.admin.auth.admin.updateUserById(id, {
      app_metadata: {
        role,
        campus_id,
        department_id: assignedDeptId,
      },
    })

    await this.auditLogger.log({
      eventType: AuditEvents.FACULTY_UPDATED,
      userId: user.userId,
      userRole: user.role,
      action: `updated faculty: ${full_name}`,
      resourceType: 'faculty',
      resourceId: id,
      status: 'success',
    })

    return { success: true, message: 'Faculty updated successfully' }
  }

  async deleteFaculty(facultyId: string, user: AuthUser) {
    const existing = await this.editableFaculty(facultyId)
    const { error } = await this.supabase.admin
      .from('faculty')
      .delete()
      .eq('id', facultyId)
      .eq('role', existing.role)
      .select('id')
      .single()

    if (error) throw new InternalServerErrorException('Failed to delete faculty record')

    await this.supabase.admin.auth.admin.deleteUser(facultyId)

    await this.auditLogger.log({
      eventType: AuditEvents.FACULTY_DELETED,
      userId: user.userId,
      userRole: user.role,
      action: `deleted faculty: ${facultyId}`,
      resourceType: 'faculty',
      resourceId: facultyId,
      status: 'success',
    })

    return { success: true, message: 'Faculty deleted successfully' }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Promote Students â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async promoteStudents(director: AuthUser, expectedTerm: number) {
    if (director.role !== 'campus_director' || !director.campus_id) throw new ForbiddenException('Campus director required')
    const { data, error } = await this.supabase.admin.rpc('promote_campus_students_atomic', {
      p_campus_id: director.campus_id, p_director_id: director.userId, p_expected_term: expectedTerm,
    })
    if (error) {
      if (error.code === 'P4030') throw new ForbiddenException(error.message)
      if (['P4090','40001','40P01'].includes(error.code)) throw new ConflictException(error.message)
      throw new InternalServerErrorException('Promotion did not complete. Refresh campus settings to verify its outcome.')
    }
    if (data?.success !== true) throw new InternalServerErrorException('Promotion was not confirmed')
    return data
  }

  async graduationCandidates(user: AuthUser) {
    if (user.role !== 'campus_director' || !user.campus_id) throw new ForbiddenException('Campus director required')
    const candidates = await fetchAllPaginated<any>(this.supabase.admin.from('students')
      .select('id, full_name, cap_application_number, department_id, departments(name), current_semester')
      .eq('campus_id', user.campus_id).eq('current_semester', 11).order('id'))
    return { candidates }
  }

  async graduateStudents(campusId: string, studentIds: string[], user: AuthUser) {
    if (user.role !== 'superadmin' && (user.role !== 'campus_director' || campusId !== user.campus_id)) {
      throw new ForbiddenException('Graduation is outside your campus')
    }
    const { data, error } = await this.supabase.admin.rpc('delete_graduating_students', {
      p_campus_id: campusId, p_student_ids: [...new Set(studentIds)], p_actor_id: user.userId,
    })
    if (error) {
      if (error.code === 'P4030') throw new ForbiddenException(error.message)
      if (['22023','23503'].includes(error.code)) throw new BadRequestException(error.message)
      if (['P4090','40001','40P01'].includes(error.code)) throw new ConflictException(error.message)
      throw new InternalServerErrorException('Graduation deletion did not complete. Refresh the candidate list to verify the outcome.')
    }
    if (data?.success !== true) throw new InternalServerErrorException('Graduation deletion was not confirmed')
    return data
  }

  async getSystemLogs(query: {
    page?: number
    limit?: number
    logType?: string
    status?: string
    search?: string
  }) {
    const page = Math.max(1, query.page || 1)
    const limit = Math.min(100, Math.max(1, query.limit || 50))
    const offset = (page - 1) * limit

    let dbQuery = this.supabase.admin
      .from('system_logs')
      .select('*', { count: 'exact' })

    if (query.logType && query.logType !== 'all') {
      dbQuery = dbQuery.eq('log_type', query.logType)
    }

    if (query.status && query.status !== 'all') {
      dbQuery = dbQuery.eq('status', query.status)
    }

    if (query.search && query.search.trim()) {
      const sanitized = query.search.trim().replace(/[^a-zA-Z0-9_\-\s@.]/g, '')
      if (sanitized) {
        dbQuery = dbQuery.or(`action.ilike.%${sanitized}%,event_type.ilike.%${sanitized}%,error_message.ilike.%${sanitized}%`)
      }
    }

    const { data, count, error } = await dbQuery
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw new InternalServerErrorException('Failed to fetch system logs: ' + error.message)
    }

    return {
      logs: data ?? [],
      total: count ?? 0,
      page,
      limit,
      totalPages: Math.ceil((count ?? 0) / limit),
    }
  }
}
