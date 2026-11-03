import { AccountPasswordService } from '../../core/security/account-password.service'
import { withDeadline } from '../../core/security/deadline'
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { SupabaseService } from '../../core/database/supabase.service'
import { RateLimiterService } from '../../core/security/rate-limiter.service'
import { AuditLoggerService, AuditEvents } from '../../core/logging/audit-logger.service'
import { ServerLoggerService } from '../../core/logging/server-logger.service'
import { AuthUser, Role } from '../../core/auth/types'
import { createHash } from 'crypto'
import { assertPasswordNotCompromised } from '../../core/security/password-security'
import { currentConsentStatus } from '../../core/auth/consent-status'
import { assertAuthProviderAvailable, authProviderCall } from '../../core/auth/provider-error'

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
    const { data: authData, error: authError } = await authProviderCall(authClient.auth.signInWithPassword({
      email,
      password,
    }))
    assertAuthProviderAvailable(authError)

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

    const userId = authData.user.id
    const existingRole = authData.user.app_metadata?.role as Role | undefined
    const existingMustChange = authData.user.app_metadata?.must_change_password as boolean | undefined
    const [userRoleInfo, consent] = await Promise.all([
      this.determineUserRoute(userId, existingRole, existingMustChange),
      currentConsentStatus(this.supabase, userId, authData.user.app_metadata?.accepted_policy_version),
      this.rateLimiter.resetLoginLimits(ip, email),
    ])

    if (!userRoleInfo.role || !userRoleInfo.redirectTo) {
      throw new ForbiddenException('Account configuration mismatch: user role not found in portal database.')
    }

    const { role, redirectTo, department_id, campus_id, must_change_password } = userRoleInfo
    const effectiveMustChange = (role === 'student' || role === 'teacher') ? (must_change_password ?? false) : false

    const metadata = {
      role,
      department_id: department_id ?? null,
      campus_id: campus_id ?? null,
      must_change_password: effectiveMustChange,
    }
    const metadataChanged = Object.entries(metadata).some(([key, value]) => authData.user.app_metadata?.[key] !== value)
    // Keep synchronization failures recoverable; established accounts need no write.
    const [metadataResult] = await Promise.all([
      metadataChanged
        ? this.supabase.admin.auth.admin.updateUserById(userId, { app_metadata: metadata })
        : Promise.resolve({ error: null }),
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
    assertAuthProviderAvailable(metadataResult?.error)
    if (metadataResult?.error) throw new ServiceUnavailableException('Account synchronization failed. Please retry login.')

    return {
      token: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      expiresIn: authData.session.expires_in,
      role,
      redirectTo: effectiveMustChange ? '/change-password' : consent.accepted ? redirectTo : '/consent',
      consent,
      userId,
      department_id,
      campus_id,
      must_change_password: effectiveMustChange,
    }
  }

  // In-flight refresh promises and short-lived rotation cache for concurrency handling (F11)
  private refreshInFlight = new Map<string, Promise<any>>()
  private recentRefreshes = new Map<string, { result: any; expiresAt: number }>()
  private blockedRefreshes = new Map<string, number>()
  private refreshGeneration = 0
  private logoutGenerations = new Map<string, { generation: number; expiresAt: number }>()

  private invalidateUserRefreshes(userId: string) {
    this.logoutGenerations.set(userId, { generation: ++this.refreshGeneration, expiresAt: Date.now() + 60000 })
    for (const [key, cached] of this.recentRefreshes) {
      if (cached.result.userId === userId) this.recentRefreshes.delete(key)
    }
  }

  private refreshKey(token: string) { return createHash('sha256').update(token).digest('hex') }

  private pruneRefreshes(now: number) {
    for (const [key, entry] of this.logoutGenerations) if (entry.expiresAt <= now && this.refreshInFlight.size === 0) this.logoutGenerations.delete(key)
    for (const [key, entry] of this.recentRefreshes) {
      if (entry.expiresAt <= now) this.recentRefreshes.delete(key)
    }
    while (this.recentRefreshes.size >= 1000) {
      this.recentRefreshes.delete(this.recentRefreshes.keys().next().value!)
    }
  }

  async refreshSession(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing')
    }

    this.assertRefreshAllowed(refreshToken)
    const now = Date.now()
    this.pruneRefreshes(now)
    const key = this.refreshKey(refreshToken)
    const generation = this.refreshGeneration
    const cached = this.recentRefreshes.get(key)
    if (cached && cached.expiresAt > now) {
      return cached.result
    }

    const pending = this.refreshInFlight.get(key)
    if (pending) {
      return pending
    }
    if (this.refreshInFlight.size >= 1000 || this.logoutGenerations.size >= 10000) {
      throw new ServiceUnavailableException('Authentication is busy. Please retry shortly.')
    }

    const refreshPromise = (async () => {
      try {
        const authClient = this.supabase.createAuthClient()
        const { data, error } = await authProviderCall(authClient.auth.refreshSession({
          refresh_token: refreshToken,
        }))
        assertAuthProviderAvailable(error)

        if (error || !data?.session || !data?.user) {
          throw new UnauthorizedException('Session expired or revoked. Please log in again.')
        }

        const user = data.user
        const existingRole = user.app_metadata?.role as Role | undefined
        const existingMustChange = user.app_metadata?.must_change_password as boolean | undefined
        const userRoleInfo = await this.determineUserRoute(user.id, existingRole, existingMustChange)
        if (!userRoleInfo.role) throw new UnauthorizedException('Account no longer exists')

        const role = userRoleInfo.role || existingRole || 'student'
        const mustChange = (role === 'student' || role === 'teacher')
          ? (userRoleInfo.must_change_password ?? existingMustChange ?? false)
          : false

        const metadata = {
          role,
          department_id: userRoleInfo.department_id ?? null,
          campus_id: userRoleInfo.campus_id ?? null,
          must_change_password: mustChange,
        }
        if (Object.entries(metadata).some(([key, value]) => user.app_metadata?.[key] !== value)) {
          await this.supabase.admin.auth.admin.updateUserById(user.id, { app_metadata: metadata }).catch(() => {})
        }

        const result = {
          token: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresIn: data.session.expires_in,
          role,
          userId: user.id,
          must_change_password: mustChange,
        }

        this.assertRefreshAllowed(refreshToken)
        // Cache result for 10 seconds to handle concurrent requests using the same token
        if ((this.logoutGenerations.get(user.id)?.generation ?? 0) > generation) {
          throw new UnauthorizedException('Session changed during refresh. Please retry.')
        }
        this.pruneRefreshes(Date.now())
        this.recentRefreshes.set(key, { result, expiresAt: Date.now() + 10000 })
        if (data.session.refresh_token) {
          this.recentRefreshes.set(this.refreshKey(data.session.refresh_token), { result, expiresAt: Date.now() + 10000 })
        }

        return result
      } finally {
        if (this.refreshInFlight.get(key) === refreshPromise) this.refreshInFlight.delete(key)
      }
    })()

    this.refreshInFlight.set(key, refreshPromise)
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

  assertRefreshAllowed(token: string) {
    for (const [key, expiry] of this.blockedRefreshes) if (expiry <= Date.now()) this.blockedRefreshes.delete(key)
    if (this.blockedRefreshes.has(this.refreshKey(token))) throw new UnauthorizedException('Session has been signed out')
  }

  /** No profile lookup or credential cache: renew only to revoke an expired JWT. */
  async refreshForLogout(refreshToken: string, signal?: AbortSignal): Promise<AuthUser | undefined> {
    const cached = this.recentRefreshes.get(this.refreshKey(refreshToken))
    if (cached && cached.expiresAt > Date.now()) return { userId: cached.result.userId, role: cached.result.role, email: '', token: cached.result.token }
    const request = this.supabase.createAuthClient(signal).auth.refreshSession({ refresh_token: refreshToken })
    const { data, error } = await (signal ? withDeadline(request, signal) : request)
    if (error || !data?.user || !data?.session) return undefined
    this.invalidateUserRefreshes(data.user.id)
    return { userId: data.user.id, email: data.user.email || '', role: data.user.app_metadata?.role as Role, token: data.session.access_token }
  }

  async logout(userOrToken: AuthUser | string | undefined, ip: string, options?: { startedAt: number; refreshToken?: string }) {
    const startedAt = options?.startedAt ?? performance.now()
    const providerSignal = AbortSignal.timeout(Math.max(1, Math.floor(3000 - (performance.now() - startedAt))))
    let resolvedUser = typeof userOrToken === 'object' ? userOrToken : undefined
    let jwt = typeof userOrToken === 'string' ? userOrToken : userOrToken?.token
    const refreshToken = options?.refreshToken
    // Fence an in-flight refresh before making any provider call.
    if (refreshToken) {
      for (const [key, expiry] of this.blockedRefreshes) if (expiry <= Date.now()) this.blockedRefreshes.delete(key)
      if (this.blockedRefreshes.size >= 10000) this.blockedRefreshes.delete(this.blockedRefreshes.keys().next().value!)
      this.blockedRefreshes.set(this.refreshKey(refreshToken), Date.now() + 60000)
    }
    if (resolvedUser?.userId) this.invalidateUserRefreshes(resolvedUser.userId)
    const timings = { authentication: 0, revocation: 0, audit: 0 }
    let revoked = false
    let revocationError = 'Provider revocation could not be confirmed'
    let stageStart = performance.now()
    try {
      const client = this.supabase.createLogoutClient(providerSignal)
      if (jwt && !resolvedUser) {
        const { data } = await withDeadline(client.auth.getUser(jwt), providerSignal)
        if (data?.user) resolvedUser = { userId: data.user.id, email: data.user.email || '', role: data.user.app_metadata?.role as Role, token: jwt }
        else jwt = undefined
      }
      if (!jwt && refreshToken && !providerSignal.aborted) {
        resolvedUser = await this.refreshForLogout(refreshToken, providerSignal)
        jwt = resolvedUser?.token
      }
      timings.authentication = performance.now() - stageStart
      if (resolvedUser?.userId) this.invalidateUserRefreshes(resolvedUser.userId)
      stageStart = performance.now()
      if (jwt) {
        const { error } = await withDeadline(client.auth.admin.signOut(jwt, 'global'), providerSignal)
        revoked = !error
        if (error) revocationError = error.message
      }
      timings.revocation = performance.now() - stageStart
    } catch {
      if (!timings.authentication) timings.authentication = performance.now() - stageStart
      else timings.revocation = performance.now() - stageStart
    }
    if (!revoked) this.serverLogger.warn('Logout provider revocation could not be confirmed within its deadline')
    const auditStart = performance.now()
    if (resolvedUser?.userId) {
      this.invalidateUserRefreshes(resolvedUser.userId)
      const auditSignal = AbortSignal.timeout(Math.max(1, Math.floor(5000 - (performance.now() - startedAt))))
      try {
        await withDeadline(this.auditLogger.log({
          eventType: AuditEvents.USER_LOGOUT, userId: resolvedUser.userId, userRole: resolvedUser.role,
          action: 'user logged out', resourceType: 'user', resourceId: resolvedUser.userId,
          status: revoked ? 'success' : 'failure', ipAddress: ip,
          metadata: revoked ? undefined : { error: revocationError },
        }, { signal: auditSignal }), auditSignal)
      } catch { this.serverLogger.warn('Logout audit delivery exceeded its deadline') }
    }
    timings.audit = performance.now() - auditStart
    return { success: true, revoked, timings }
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
        .select('full_name, campus_id, department_id, departments!faculty_department_id_fkey(name), campuses(name)')
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

  private get passwords() { return new AccountPasswordService(this.supabase, this.auditLogger) }
  changePassword(currentPassword: string, newPassword: string, user: AuthUser) {
    return this.passwords.changePassword(currentPassword, newPassword, user)
  }
  completePasswordReset(userId: string | undefined, body?: { newPassword?: string; token_hash?: string }) {
    return this.passwords.completePasswordReset(userId, body)
  }
  syncPasswordStatus(userId: string) { return this.passwords.syncPasswordStatus(userId) }
}
