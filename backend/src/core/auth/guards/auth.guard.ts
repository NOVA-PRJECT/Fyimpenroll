import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { SupabaseService } from '../../database/supabase.service'
import { AuthUser, Role } from '../types'
import { CURRENT_POLICY_VERSION } from '../../../modules/consent/consent.constants'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const token = this.extractToken(request)

    if (!token) {
      throw new UnauthorizedException('Authentication token missing')
    }

    this.validateMutatingOrigin(request)

    const { data: authData, error: authError } = await this.supabaseService.admin.auth.getUser(token)
    if (authError || !authData?.user) {
      throw new UnauthorizedException('Invalid or expired authentication session')
    }

    const user = authData.user
    let mustChangePassword = user.app_metadata?.must_change_password as boolean | undefined
    let currentSemester: number | undefined
    let fullName: string | undefined
    let role: Role | undefined
    let departmentId: string | undefined
    let campusId: string | undefined

    const VALID_ROLES = new Set<Role>(['superadmin', 'campus_director', 'hod', 'teaching_staff', 'teacher', 'student'])
    const cachedRole = user.app_metadata?.role as Role | undefined

    if (cachedRole && VALID_ROLES.has(cachedRole)) {
      // Fast path: role already in app_metadata, query only the matching table
      if (cachedRole === 'student') {
        const { data, error } = await this.supabaseService.admin
          .from('students')
          .select('id, department_id, campus_id, must_change_password, current_semester, full_name')
          .eq('id', user.id)
          .maybeSingle()
        if (error) throw new InternalServerErrorException('Could not verify the account permissions')
        if (!data) throw new UnauthorizedException('User account not found in portal')
        role = 'student'
        departmentId = data.department_id ?? undefined
        campusId = data.campus_id ?? undefined
        mustChangePassword = data.must_change_password
        currentSemester = data.current_semester
        fullName = data.full_name
      } else if (cachedRole === 'superadmin') {
        const { data, error } = await this.supabaseService.admin
          .from('admins')
          .select('id')
          .eq('id', user.id)
          .maybeSingle()
        if (error) throw new InternalServerErrorException('Could not verify the account permissions')
        if (!data) throw new UnauthorizedException('User account not found in portal')
        role = 'superadmin'
      } else {
        // campus_director | hod | teaching_staff | teacher
        const { data, error } = await this.supabaseService.admin
          .from('faculty')
          .select('id, role, department_id, campus_id, full_name')
          .eq('id', user.id)
          .maybeSingle()
        if (error) throw new InternalServerErrorException('Could not verify the account permissions')
        if (!data) throw new UnauthorizedException('User account not found in portal')
        role = data.role as Role
        departmentId = data.department_id ?? undefined
        campusId = data.campus_id ?? undefined
        fullName = data.full_name
      }
    } else {
      // Slow path: role absent from app_metadata, check all three tables
      const [studentRes, facultyRes, adminRes] = await Promise.all([
        this.supabaseService.admin
          .from('students')
          .select('id, department_id, campus_id, must_change_password, current_semester, full_name')
          .eq('id', user.id)
          .maybeSingle(),
        this.supabaseService.admin
          .from('faculty')
          .select('id, role, department_id, campus_id, full_name')
          .eq('id', user.id)
          .maybeSingle(),
        this.supabaseService.admin
          .from('admins')
          .select('id')
          .eq('id', user.id)
          .maybeSingle(),
      ])

      if (studentRes.error || facultyRes.error || adminRes.error) {
        throw new InternalServerErrorException('Could not verify the account permissions')
      }

      const accountCount = Number(!!studentRes.data) + Number(!!facultyRes.data) + Number(!!adminRes.data)
      if (accountCount !== 1) {
        throw new UnauthorizedException('User account is missing or has conflicting portal roles')
      }

      if (studentRes.data) {
        role = 'student'
        departmentId = studentRes.data.department_id ?? undefined
        campusId = studentRes.data.campus_id ?? undefined
        mustChangePassword = studentRes.data.must_change_password
        currentSemester = studentRes.data.current_semester
        fullName = studentRes.data.full_name
      } else if (facultyRes.data) {
        role = facultyRes.data.role as Role
        departmentId = facultyRes.data.department_id ?? undefined
        campusId = facultyRes.data.campus_id ?? undefined
        fullName = facultyRes.data.full_name
      } else if (adminRes.data) {
        role = 'superadmin'
      }

      // Backfill app_metadata so the next request takes the fast path (fire-and-forget)
      if (role) {
        this.supabaseService.admin.auth.admin
          .updateUserById(user.id, { app_metadata: { role } })
          .catch(() => { /* non-critical, do not block the request */ })
      }
    }

    if (!role) {
      throw new UnauthorizedException('User account not registered in portal')
    }

    // Mandatory initial password change applies ONLY to students and teachers.
    // Other roles (superadmin, campus_director, hod, teaching_staff) are never forced.
    if (role !== 'student' && role !== 'teacher') {
      mustChangePassword = false
    }

    const authUser: AuthUser = {
      userId: user.id,
      email: user.email ?? '',
      role,
      department_id: departmentId ?? null,
      campus_id: campusId ?? null,
      must_change_password: mustChangePassword ?? false,
      current_semester: currentSemester,
      full_name: fullName,
      token,
    }

    const rawUrl = (request.originalUrl || request.path || request.url || '') as string
    const cleanPath = rawUrl.split(/[?#]/)[0]
    const normalizedPath = cleanPath ? cleanPath.replace(/\/+$/, '') : '/'

    const ALLOWED_RESTRICTED_PATHS = new Set([
      '/api/auth/profile',
      '/api/auth/me',
      '/api/auth/change-password',
      '/api/auth/sync-password-status',
      '/api/auth/complete-password-reset',
      '/auth/complete-password-reset',
      '/api/auth/logout',
      '/api/auth/refresh',
      '/api/student/change-password',
      '/api/consent/status',
      '/api/consent/accept',
    ])

    const isAllowedRestrictedPath = ALLOWED_RESTRICTED_PATHS.has(normalizedPath)

    if (authUser.must_change_password && !isAllowedRestrictedPath) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Password change is required before accessing other portal features.',
        must_change_password: true,
      })
    }

    // F12: Versioned consent enforcement on normal protected operations
    if (!isAllowedRestrictedPath) {
      const cachedConsentVersion = user.app_metadata?.accepted_policy_version as string | undefined
      let hasAcceptedCurrentConsent = cachedConsentVersion === CURRENT_POLICY_VERSION

      if (!hasAcceptedCurrentConsent) {
        const { data: consentRecord } = await this.supabaseService.admin
          .from('consent_records')
          .select('policy_version')
          .eq('user_id', user.id)
          .eq('policy_version', CURRENT_POLICY_VERSION)
          .maybeSingle()

        if (consentRecord) {
          hasAcceptedCurrentConsent = true
          this.supabaseService.admin.auth.admin
            .updateUserById(user.id, {
              app_metadata: {
                ...(user.app_metadata || {}),
                accepted_policy_version: CURRENT_POLICY_VERSION,
              },
            })
            .catch(() => {})
        }
      }

      if (!hasAcceptedCurrentConsent) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Acceptance of current policy terms is required before accessing portal operations.',
          consent_required: true,
          current_policy_version: CURRENT_POLICY_VERSION,
        })
      }
    }

    request.user = authUser
    return true
  }

  private extractToken(request: any): string | null {
    const authHeader = request.headers['authorization']
    if (authHeader && typeof authHeader === 'string') {
      const [type, token] = authHeader.split(' ')
      if (type?.toLowerCase() === 'bearer' && token) {
        return token
      }
    }

    if (request.cookies?.auth_token) {
      return request.cookies.auth_token
    }

    return null
  }

  private validateMutatingOrigin(request: any): void {
    const mutatingMethods = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])
    const method = (request.method || '').toUpperCase()

    // If method is not mutating or caller used Bearer token header, ambient cookie CSRF is not a concern
    const authHeader = request.headers['authorization']
    if (
      !mutatingMethods.has(method) ||
      (authHeader && typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer '))
    ) {
      return
    }

    // Request is using ambient cookies for state mutation
    const originHeader = (request.headers['origin'] || request.headers['referer'] || '') as string
    if (!originHeader) {
      // Non-browser or server-to-server proxy call
      return
    }

    const rawOrigins = process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(',').map((o) => o.trim()).filter(Boolean)
      : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001']

    try {
      const parsedOrigin = new URL(originHeader).origin
      const isAllowed = rawOrigins.some((allowed) => {
        try {
          return new URL(allowed).origin === parsedOrigin
        } catch {
          return allowed === parsedOrigin
        }
      })

      if (!isAllowed && process.env.NODE_ENV === 'production') {
        throw new ForbiddenException('Cross-site request rejected')
      }
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err
      // invalid URL in originHeader - ignore
    }
  }
}
