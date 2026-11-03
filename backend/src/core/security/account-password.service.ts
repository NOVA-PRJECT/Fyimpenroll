import { Injectable, BadRequestException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common'
import { SupabaseService } from '../database/supabase.service'
import { AuthUser, Role } from '../auth/types'
import { assertAuthProviderAvailable, authProviderCall } from '../auth/provider-error'
import { AuditLoggerService } from '../logging/audit-logger.service'
import { assertPasswordNotCompromised } from './password-security'
import { RecoveryPasswordSchema, ChangePasswordSchema } from '@fyimp/contracts'
@Injectable()
export class AccountPasswordService {
  constructor(private readonly supabase: SupabaseService, private readonly auditLogger: AuditLoggerService) {}
  async changePassword(currentPassword: string, newPassword: string, user: AuthUser) {
    const parsed = ChangePasswordSchema.safeParse({ current_password: currentPassword, new_password: newPassword })
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message)
    if (!currentPassword || !newPassword) {
      throw new BadRequestException('Current password and new password are required.')
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException({ code: 'PASSWORD_UNCHANGED', field: 'new_password', message: 'Your new password must be different from your current password.' })
    }

    // 1. Verify current password
    const verifyAuthClient = this.supabase.createAuthClient()
    const { error: verifyError } = await authProviderCall(verifyAuthClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    }))
    assertAuthProviderAvailable(verifyError)

    if (verifyError) {
      if (!verifyError.code || verifyError.code === 'invalid_credentials') {
        throw new BadRequestException({ code: 'CURRENT_PASSWORD_INCORRECT', field: 'current_password', message: 'Current password is incorrect. Check it and try again.' })
      }
      throw new BadRequestException({ code: 'PASSWORD_VERIFICATION_FAILED', message: 'Your current password could not be verified. Sign in again or contact your campus administrator.' })
    }

    await assertPasswordNotCompromised(newPassword)
    // 2. Update to new password in Supabase Auth.
    // NOTE (R02): Mark pending_profile_sync: true as server-trusted proof before clearing must_change_password
    const { error: pwError } = await authProviderCall(this.supabase.admin.auth.admin.updateUserById(
      user.userId,
      {
        password: newPassword,
        app_metadata: {
          role: user.role,
          department_id: user.department_id,
          campus_id: user.campus_id,
          must_change_password: true,
          pending_profile_sync: true,
        },
      },
    ))

    assertAuthProviderAvailable(pwError)
    if (pwError) {
      const code = pwError.code === 'same_password' ? 'PASSWORD_UNCHANGED' : pwError.code === 'weak_password' ? 'PASSWORD_TOO_WEAK' : 'NEW_PASSWORD_REJECTED'
      const message = code === 'PASSWORD_UNCHANGED' ? 'Your new password must be different from your current password.'
        : code === 'PASSWORD_TOO_WEAK' ? 'Choose a stronger new password. Avoid common or previously leaked passwords.'
        : 'The new password was not accepted. Choose a different password and try again.'
      throw new BadRequestException({ code, field: 'new_password', message })
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

    // 4. Since database sync succeeded, clear must_change_password and pending_profile_sync in Auth metadata
    const { error: metadataError } = await this.supabase.admin.auth.admin.updateUserById(user.userId, {
      app_metadata: {
        role: user.role,
        department_id: user.department_id,
        campus_id: user.campus_id,
        must_change_password: false,
        pending_profile_sync: false,
      },
    })

    if (metadataError) return { success: false, code: 'SYNC_FAILED', canRetrySync: true, message: 'Password updated; authentication metadata synchronization needs retry.' }

    // 5. Sign in to obtain fresh session tokens
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
      message: 'Password changed successfully',
    }
  }

  // ── Password Reset Flow (F09, F10, R02) ─────────────────────────────────────

  async completePasswordReset(_untrustedUserId: string | undefined, body?: { newPassword?: string; token_hash?: string }) {
    const parsed = RecoveryPasswordSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException('A valid recovery link and new password are required.')
    // Screen before consuming the single-use provider token. Ordinary login JWTs are never recovery proof.
    await assertPasswordNotCompromised(parsed.data.newPassword)
    const { data: recovered, error: recoveryError } = await authProviderCall(this.supabase.createAuthClient().auth.verifyOtp({
      token_hash: parsed.data.token_hash, type: 'recovery',
    }))
    assertAuthProviderAvailable(recoveryError)
    if (recoveryError || !recovered?.user || !recovered.session) throw new UnauthorizedException('The recovery link has expired or has already been used. Request a new link.')
    const userId = recovered.user.id
    const authUser = recovered.user
    const role = (authUser.app_metadata?.role as Role) || 'student'
    const recoverySession = { token: recovered.session.access_token, refreshToken: recovered.session.refresh_token }
    const { error: pwError } = await authProviderCall(this.supabase.admin.auth.admin.updateUserById(userId, {
      password: parsed.data.newPassword,
      app_metadata: { ...(authUser.app_metadata || {}), must_change_password: true, pending_profile_sync: true },
    }))
    assertAuthProviderAvailable(pwError)
    if (pwError) throw new BadRequestException('Password update failed. Request a new recovery link before retrying.')
    // 2. Clear must_change_password in database tables if student
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
          canRetrySync: true, ...recoverySession,
        }
      }
    }

    // 3. Database synchronization succeeded: clear must_change_password and pending_profile_sync
    const { error: metadataError } = await this.supabase.admin.auth.admin.updateUserById(userId, {
      app_metadata: {
        ...(authUser.app_metadata || {}),
        must_change_password: false,
        pending_profile_sync: false,
      },
    })

    if (metadataError) return { success: false, code: 'SYNC_FAILED', canRetrySync: true, ...recoverySession, message: 'Password updated; authentication metadata synchronization needs retry.' }
    return { success: true, ...recoverySession }
  }

  async syncPasswordStatus(userId: string) {
    // Allows safe retry of synchronization ONLY after Auth password update succeeded (R02)
    const { data: authUserData, error: userError } = await this.supabase.admin.auth.admin.getUserById(userId)
    if (userError || !authUserData?.user) {
      throw new BadRequestException('User authentication record not found.')
    }

    const authUser = authUserData.user
    const role = (authUser.app_metadata?.role as Role) || 'student'

    // Server-trusted proof check (R02): caller cannot call sync without prior verified Auth update
    const hasPendingSync = authUser.app_metadata?.pending_profile_sync === true
    if (!hasPendingSync) {
      throw new BadRequestException('No verified pending password update found for synchronization. Please complete the password change process.')
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

    // Database update succeeded: clear metadata flags
    const { error: authError } = await this.supabase.admin.auth.admin.updateUserById(userId, {
      app_metadata: {
        ...(authUser.app_metadata || {}),
        must_change_password: false,
        pending_profile_sync: false,
      },
    })

    if (authError) {
      throw new InternalServerErrorException('Failed to update authentication metadata on sync retry.')
    }

    return { success: true, message: 'Password synchronization complete.' }
  }
}
