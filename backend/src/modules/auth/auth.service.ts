import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { SupabaseService } from '../../core/database/supabase.service'
import { RateLimiterService } from '../../core/security/rate-limiter.service'
import { AuditLoggerService, AuditEvents } from '../../core/logging/audit-logger.service'
import { ServerLoggerService } from '../../core/logging/server-logger.service'
import { AuthUser, Role } from '../../core/auth/types'

export const ROLE_DASHBOARD_MAP: Record<Role, string> = {
  superadmin: '/dashboard/superadmin',
  campus_director: '/dashboard/director',
  hod: '/dashboard/hod',
  teaching_staff: '/dashboard/teaching_staff',
  teacher: '/dashboard/teacher',
  student: '/dashboard/student',
}

@Injectable()
export class AuthService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly rateLimiter: RateLimiterService,
    private readonly auditLogger: AuditLoggerService,
    private readonly serverLogger: ServerLoggerService,
  ) {}

  async login(email: string, password: string, ip: string) {
    const [ipLimit, emailLimit] = await Promise.all([
      this.rateLimiter.checkLimit(this.rateLimiter.loginLimiter, ip),
      this.rateLimiter.checkLimit(this.rateLimiter.emailLoginLimiter, email.toLowerCase()),
    ])

    if (!ipLimit.success) {
      throw new HttpException('Too many attempts. Please try again later.', HttpStatus.TOO_MANY_REQUESTS)
    }

    if (!emailLimit.success) {
      throw new HttpException('Too many attempts for this account. Please try again later.', HttpStatus.TOO_MANY_REQUESTS)
    }

    const authClient = this.supabase.createAuthClient()
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email,
      password,
    })

    if (authError || !authData?.user || !authData?.session) {
      await this.auditLogger.log({
        eventType: 'login_failed',
        userId: 'unknown',
        userRole: 'unknown',
        action: 'failed login attempt',
        resourceType: 'user',
        status: 'failure',
        ipAddress: ip,
        metadata: { email },
      })
      throw new UnauthorizedException('Invalid email or password. Please try again.')
    }

    await this.rateLimiter.resetLoginLimits(ip, email)

    const userId = authData.user.id
    const existingRole = authData.user.app_metadata?.role as Role | undefined
    const existingMustChange = authData.user.app_metadata?.must_change_password as boolean | undefined
    const userRoleInfo = await this.determineUserRoute(userId, existingRole, existingMustChange)

    if (!userRoleInfo.role || !userRoleInfo.redirectTo) {
      throw new ForbiddenException('Account configuration mismatch: user role not found in portal database.')
    }

    const { role, redirectTo, department_id, campus_id, must_change_password } = userRoleInfo
    const effectiveMustChange = (role === 'student' || role === 'teacher') ? (must_change_password ?? false) : false

    // Update Supabase Auth metadata (parallelised with audit log)
    await Promise.all([
      this.supabase.admin.auth.admin.updateUserById(userId, {
        app_metadata: {
          role,
          department_id: department_id ?? null,
          campus_id: campus_id ?? null,
          must_change_password: effectiveMustChange,
        },
      }),
      this.auditLogger.log({
        eventType: AuditEvents.USER_LOGIN,
        userId,
        userRole: role,
        action: 'user logged in',
        resourceType: 'user',
        resourceId: userId,
        status: 'success',
        ipAddress: ip,
      }),
    ])

    return {
      token: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      expiresIn: authData.session.expires_in,
      role,
      redirectTo,
      userId,
      must_change_password: effectiveMustChange,
    }
  }

  // In-flight refresh promises and short-lived rotation cache for concurrency handling (F11)
  private refreshInFlight = new Map<string, Promise<any>>()
  private recentRefreshes = new Map<string, { result: any; expiresAt: number }>()

  async refreshSession(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing')
    }

    const now = Date.now()
    const cached = this.recentRefreshes.get(refreshToken)
    if (cached && cached.expiresAt > now) {
      return cached.result
    }

    const pending = this.refreshInFlight.get(refreshToken)
    if (pending) {
      return pending
    }

    const refreshPromise = (async () => {
      try {
        const authClient = this.supabase.createAuthClient()
        const { data, error } = await authClient.auth.refreshSession({
          refresh_token: refreshToken,
        })

        if (error || !data?.session || !data?.user) {
          throw new UnauthorizedException('Session expired or revoked. Please log in again.')
        }

        const user = data.user
        const existingRole = user.app_metadata?.role as Role | undefined
        const existingMustChange = user.app_metadata?.must_change_password as boolean | undefined
        const userRoleInfo = await this.determineUserRoute(user.id, existingRole, existingMustChange)

        const role = userRoleInfo.role || existingRole || 'student'
        const mustChange = (role === 'student' || role === 'teacher')
          ? (userRoleInfo.must_change_password ?? existingMustChange ?? false)
          : false

        // Preserve app_metadata during refresh
        await this.supabase.admin.auth.admin.updateUserById(user.id, {
          app_metadata: {
            role,
            department_id: userRoleInfo.department_id ?? null,
            campus_id: userRoleInfo.campus_id ?? null,
            must_change_password: mustChange,
          },
        }).catch(() => {})

        const result = {
          token: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresIn: data.session.expires_in,
          role,
          userId: user.id,
          must_change_password: mustChange,
        }

        // Cache result for 10 seconds to handle concurrent requests using the same token
        this.recentRefreshes.set(refreshToken, { result, expiresAt: now + 10000 })
        if (data.session.refresh_token) {
          this.recentRefreshes.set(data.session.refresh_token, { result, expiresAt: now + 10000 })
        }

        return result
      } finally {
        this.refreshInFlight.delete(refreshToken)
      }
    })()

    this.refreshInFlight.set(refreshToken, refreshPromise)
    return refreshPromise
  }

  async determineUserRoute(
    authUserId: string,
    existingRole?: Role,
    existingMustChangePassword?: boolean,
  ): Promise<{
    role: Role | null
    redirectTo: string | null
    department_id?: string | null
    campus_id?: string | null
    must_change_password?: boolean
  }> {
    const VALID_ROLES = new Set<Role>(['superadmin', 'campus_director', 'hod', 'teaching_staff', 'teacher', 'student'])

    if (existingRole && VALID_ROLES.has(existingRole)) {
      if (existingRole === 'student') {
        const { data, error } = await this.supabase.admin
          .from('students')
          .select('id, department_id, campus_id, must_change_password')
          .eq('id', authUserId)
          .maybeSingle()
        if (error) throw new InternalServerErrorException('Could not verify the account role')
        if (!data) return { role: null, redirectTo: null }
        return {
          role: 'student',
          redirectTo: ROLE_DASHBOARD_MAP['student'],
          department_id: data.department_id,
          campus_id: data.campus_id,
          must_change_password: (data.must_change_password !== undefined) ? data.must_change_password : (existingMustChangePassword ?? false),
        }
      }

      if (existingRole === 'superadmin') {
        const { data, error } = await this.supabase.admin
          .from('admins')
          .select('id')
          .eq('id', authUserId)
          .maybeSingle()
        if (error) throw new InternalServerErrorException('Could not verify the account role')
        if (!data) return { role: null, redirectTo: null }
        return { role: 'superadmin', redirectTo: ROLE_DASHBOARD_MAP['superadmin'], must_change_password: false }
      }

      // campus_director | hod | teaching_staff | teacher
      const { data, error } = await this.supabase.admin
        .from('faculty')
        .select('id, role, department_id, campus_id')
        .eq('id', authUserId)
        .maybeSingle()
      if (error) throw new InternalServerErrorException('Could not verify the account role')
      if (!data) return { role: null, redirectTo: null }
      const role = data.role as Role
      // F08: Teacher preserves stored must_change_password; other faculty roles are never forced.
      const teacherMustChange = role === 'teacher' ? (existingMustChangePassword ?? false) : false
      return {
        role,
        redirectTo: ROLE_DASHBOARD_MAP[role],
        department_id: data.department_id,
        campus_id: data.campus_id,
        must_change_password: teacherMustChange,
      }
    }

    // Slow path: role unknown, query all three tables in parallel
    const [studentRes, facultyRes, adminRes] = await Promise.all([
      this.supabase.admin
        .from('students')
        .select('id, department_id, campus_id, must_change_password')
        .eq('id', authUserId)
        .maybeSingle(),
      this.supabase.admin
        .from('faculty')
        .select('id, role, department_id, campus_id')
        .eq('id', authUserId)
        .maybeSingle(),
      this.supabase.admin
        .from('admins')
        .select('id')
        .eq('id', authUserId)
        .maybeSingle(),
    ])

    if (studentRes.error || facultyRes.error || adminRes.error) {
      throw new InternalServerErrorException('Could not verify the account role')
    }

    const accountCount = Number(!!studentRes.data) + Number(!!facultyRes.data) + Number(!!adminRes.data)
    if (accountCount > 1) {
      return { role: null, redirectTo: null }
    }

    if (studentRes.data) {
      const s = studentRes.data
      return {
        role: 'student',
        redirectTo: ROLE_DASHBOARD_MAP['student'],
        department_id: s.department_id,
        campus_id: s.campus_id,
        must_change_password: (s.must_change_password !== undefined) ? s.must_change_password : (existingMustChangePassword ?? false),
      }
    }

    if (facultyRes.data) {
      const f = facultyRes.data
      const role = f.role as Role
      const teacherMustChange = role === 'teacher' ? (existingMustChangePassword ?? false) : false
      return {
        role,
        redirectTo: ROLE_DASHBOARD_MAP[role],
        department_id: f.department_id,
        campus_id: f.campus_id,
        must_change_password: teacherMustChange,
      }
    }

    if (adminRes.data) {
      return { role: 'superadmin', redirectTo: ROLE_DASHBOARD_MAP['superadmin'], must_change_password: false }
    }

    return { role: null, redirectTo: null }
  }

  async logout(userOrToken: AuthUser | string | undefined, ip: string) {
    let resolvedUser: AuthUser | undefined = typeof userOrToken === 'object' ? userOrToken : undefined

    if (!resolvedUser && typeof userOrToken === 'string' && userOrToken) {
      try {
        const { data } = await this.supabase.admin.auth.getUser(userOrToken)
        if (data?.user) {
          const role = data.user.app_metadata?.role as Role | undefined
          if (role) {
            resolvedUser = {
              userId: data.user.id,
              email: data.user.email || '',
              role,
            }
          }
        }
      } catch {
        // session may already be expired/invalid
      }
    }

    if (resolvedUser?.userId) {
      // F11: Explicitly revoke the session on Supabase Auth
      try {
        await this.supabase.admin.auth.admin.signOut(resolvedUser.userId, 'global')
      } catch (err) {
        this.serverLogger.warn(`Supabase session revocation on logout for user ${resolvedUser.userId}: ${err}`)
      }

      await this.auditLogger.log({
        eventType: AuditEvents.USER_LOGOUT,
        userId: resolvedUser.userId,
        userRole: resolvedUser.role,
        action: 'user logged out',
        resourceType: 'user',
        resourceId: resolvedUser.userId,
        status: 'success',
        ipAddress: ip,
      })
    }
    return { success: true }
  }

  async getProfile(user: AuthUser) {
    const role = user.role

    if (role === 'student') {
      const { data: student, error } = await this.supabase.admin
        .from('students')
        .select('full_name, current_semester, department_id, campus_id, must_change_password, departments(name), campuses(name)')
        .eq('id', user.userId)
        .single()
      if (error) throw new BadRequestException('Student profile not found')
      return {
        role,
        must_change_password: user.must_change_password,
        profile: student,
      }
    }

    if (role === 'hod' || role === 'campus_director' || role === 'teaching_staff' || role === 'teacher') {
      const { data: faculty, error } = await this.supabase.admin
        .from('faculty')
        .select('full_name, campus_id, department_id, departments(name), campuses(name)')
        .eq('id', user.userId)
        .single()
      if (error) throw new BadRequestException('Faculty profile not found')
      return {
        role,
        must_change_password: user.must_change_password,
        profile: faculty,
      }
    }

    if (role === 'superadmin') {
      const { data: admin, error } = await this.supabase.admin
        .from('admins')
        .select('full_name')
        .eq('id', user.userId)
        .single()
      if (error) throw new BadRequestException('Admin profile not found')
      return {
        role,
        must_change_password: false,
        profile: admin,
      }
    }

    throw new ForbiddenException('Role not found or invalid')
  }

  // ── Unified Authenticated Password Change (F07, F08, F10) ──────────────────

  async changePassword(currentPassword: string, newPassword: string, user: AuthUser) {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException('Current password and new password are required.')
    }

    // 1. Verify current password
    const verifyAuthClient = this.supabase.createAuthClient()
    const { error: verifyError } = await verifyAuthClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })

    if (verifyError) {
      throw new BadRequestException('Current password is incorrect')
    }

    // 2. Update to new password in Supabase Auth and clear must_change_password
    const { error: pwError } = await this.supabase.admin.auth.admin.updateUserById(
      user.userId,
      {
        password: newPassword,
        app_metadata: {
          role: user.role,
          department_id: user.department_id,
          campus_id: user.campus_id,
          must_change_password: false,
        },
      },
    )

    if (pwError) {
      throw new InternalServerErrorException('Failed to update password in authentication system')
    }

    // 3. Clear flag in database profile if student
    if (user.role === 'student') {
      const { error: flagError } = await this.supabase.admin
        .from('students')
        .update({ must_change_password: false })
        .eq('id', user.userId)

      if (flagError) {
        return {
          success: false,
          code: 'SYNC_FAILED',
          message: 'Password updated in auth system, but student profile synchronization failed. Please retry synchronization.',
          canRetrySync: true,
        }
      }
    }

    // 4. Sign in to obtain fresh session tokens
    const refreshAuthClient = this.supabase.createAuthClient()
    const { data: signInData } = await refreshAuthClient.auth.signInWithPassword({
      email: user.email,
      password: newPassword,
    })

    await this.auditLogger.log({
      eventType: 'password_changed',
      userId: user.userId,
      userRole: user.role,
      action: 'user changed password',
      resourceType: 'user',
      resourceId: user.userId,
      status: 'success',
      ipAddress: 'authenticated_session',
    })

    return {
      success: true,
      token: signInData?.session?.access_token,
      refreshToken: signInData?.session?.refresh_token,
      expiresIn: signInData?.session?.expires_in,
    }
  }

  // ── Password Reset Flow (F09, F10) ──────────────────────────────────────────

  async completePasswordReset(userId: string, body?: { newPassword?: string; passwordUpdated?: boolean }) {
    const { data: authUserData, error: userError } = await this.supabase.admin.auth.admin.getUserById(userId)
    if (userError || !authUserData?.user) {
      throw new BadRequestException('User authentication record not found.')
    }

    const authUser = authUserData.user
    const role = (authUser.app_metadata?.role as Role) || 'student'

    if (body?.newPassword) {
      const { error: pwError } = await this.supabase.admin.auth.admin.updateUserById(userId, {
        password: body.newPassword,
        app_metadata: {
          ...(authUser.app_metadata || {}),
          must_change_password: false,
        },
      })
      if (pwError) {
        throw new BadRequestException(pwError.message || 'Failed to update user password.')
      }
    } else {
      // F09: Require explicit verified password update operation confirmation rather than generic updated_at timestamp
      if (authUser.app_metadata?.must_change_password && !body?.passwordUpdated) {
        throw new BadRequestException('Verified password update confirmation required.')
      }

      const { error: authError } = await this.supabase.admin.auth.admin.updateUserById(userId, {
        app_metadata: {
          ...(authUser.app_metadata || {}),
          must_change_password: false,
        },
      })

      if (authError) {
        throw new BadRequestException(
          authError.message || 'Failed to update user authentication metadata.',
        )
      }
    }

    // Clear must_change_password in database tables if student
    if (role === 'student') {
      const { error: studentError } = await this.supabase.admin
        .from('students')
        .update({ must_change_password: false })
        .eq('id', userId)

      if (studentError) {
        return {
          success: false,
          code: 'SYNC_FAILED',
          message: 'Password was updated in auth system, but student profile synchronization failed. Please retry synchronization.',
          canRetrySync: true,
        }
      }
    }

    return { success: true }
  }

  async syncPasswordStatus(userId: string) {
    // Allows safe retry of synchronization after Auth password update succeeded (F09, F10)
    const { data: authUserData, error: userError } = await this.supabase.admin.auth.admin.getUserById(userId)
    if (userError || !authUserData?.user) {
      throw new BadRequestException('User authentication record not found.')
    }

    const authUser = authUserData.user
    const role = (authUser.app_metadata?.role as Role) || 'student'

    const { error: authError } = await this.supabase.admin.auth.admin.updateUserById(userId, {
      app_metadata: {
        ...(authUser.app_metadata || {}),
        must_change_password: false,
      },
    })

    if (authError) {
      throw new InternalServerErrorException('Failed to update authentication metadata on sync retry.')
    }

    if (role === 'student') {
      const { error: studentError } = await this.supabase.admin
        .from('students')
        .update({ must_change_password: false })
        .eq('id', userId)

      if (studentError) {
        return {
          success: false,
          code: 'SYNC_FAILED',
          message: 'Student profile synchronization failed on retry. Please try again.',
          canRetrySync: true,
        }
      }
    }

    return { success: true, message: 'Password synchronization complete.' }
  }
}
