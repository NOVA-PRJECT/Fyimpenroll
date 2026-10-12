import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { AuthService } from './auth.service'
import { AuthGuard } from '../../core/auth/guards/auth.guard'
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator'
import { AuthUser } from '../../core/auth/types'
import { z } from 'zod'
import { RateLimitGuard } from '../../core/security/rate-limit.guard'
import { RateLimit } from '../../core/security/rate-limit.decorator'
import { Optional } from '@nestjs/common'
import { DashboardEntryService } from './dashboard-entry.service'

const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  preloadDashboard: z.boolean().optional(),
})

const ChangePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(8, 'New password must be at least 8 characters'),
})

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService, @Optional() private readonly entry?: DashboardEntryService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = LoginSchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message)
    }

    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    const startedAt = performance.now()
    const result = await this.authService.login(parsed.data.email, parsed.data.password, ip)
    const authenticatedAt = performance.now()

    const cookieBase = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    }

    // Access token cookie (expires according to Supabase JWT expiresIn or 1 hr)
    res.cookie('auth_token', result.token, {
      ...cookieBase,
      maxAge: (result.expiresIn || 3600) * 1000,
    })

    // Refresh token cookie (7 days)
    if (result.refreshToken) {
      res.cookie('refresh_token', result.refreshToken, {
        ...cookieBase,
        maxAge: 60 * 60 * 24 * 7 * 1000,
      })
    }

    const dashboardEntry = parsed.data.preloadDashboard
      ? await this.entry?.load({
        userId: result.userId, email: parsed.data.email, role: result.role,
        department_id: result.department_id, campus_id: result.campus_id,
        must_change_password: result.must_change_password, consent: result.consent,
      }, result.redirectTo)
      : undefined

    res.setHeader?.('Server-Timing', `authentication;dur=${(authenticatedAt - startedAt).toFixed(1)}, dashboard_preload;dur=${(performance.now() - authenticatedAt).toFixed(1)}`)

    return {
      dashboardEntry,
      redirectTo: result.redirectTo,
      role: result.role,
      token: result.token,
      refreshToken: result.refreshToken,
      must_change_password: result.must_change_password,
      consent: result.consent,
    }
  }

  /** Routing facts only: AuthGuard already verified the account and consent. */
  @Get('session')
  @UseGuards(AuthGuard)
  session(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'private, no-store')
    return {
      role: user.role,
      must_change_password: !!user.must_change_password,
      consent: user.consent,
    }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: any,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req as any).cookies?.refresh_token || body?.refreshToken || body?.refresh_token
    if (typeof token !== 'string' || !token || token.length > 8192) {
      throw new BadRequestException('Refresh token is required')
    }

    const result = await this.authService.refreshSession(token)

    const cookieBase = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    }

    res.cookie('auth_token', result.token, {
      ...cookieBase,
      maxAge: (result.expiresIn || 3600) * 1000,
    })

    if (result.refreshToken) {
      res.cookie('refresh_token', result.refreshToken, {
        ...cookieBase,
        maxAge: 60 * 60 * 24 * 7 * 1000,
      })
    }

    return {
      token: result.token,
      refreshToken: result.refreshToken,
      role: result.role,
      must_change_password: result.must_change_password,
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const startedAt = performance.now()
    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    const authHeader = (req.headers as any).authorization as string | undefined
    let token = (req as any).cookies?.auth_token || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined)
    let user = (req as any).user as AuthUser | undefined

    // An expired access cookie must not prevent logout from revoking the
    // remaining refresh session. Renew internally without issuing new cookies.
    const refreshToken = (req as any).cookies?.refresh_token
    if (!token && typeof refreshToken === 'string' && refreshToken && refreshToken.length <= 8192) {
      try {
        user = await this.authService.refreshForLogout(refreshToken)
        token = user?.token
      } catch {
        // Even an invalid/unavailable provider must allow local cookie cleanup.
      }
    }

    const userWithToken = user ? { ...user, token: user.token || token } : token
    const result = await this.authService.logout(userWithToken, ip)

    res.clearCookie('auth_token', { path: '/' })
    res.clearCookie('refresh_token', { path: '/' })
    res.clearCookie('user_role', { path: '/' })
    res.setHeader?.('Server-Timing', `logout;dur=${(performance.now() - startedAt).toFixed(1)}`)

    return result
  }

  @Get('profile')
  @UseGuards(AuthGuard)
  async getProfile(@CurrentUser() user: AuthUser) {
    return this.authService.getProfile(user)
  }

  @Post('change-password')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit('password_change')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = ChangePasswordSchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message)
    }

    const result = await this.authService.changePassword(
      parsed.data.current_password,
      parsed.data.new_password,
      user,
    )

    if (result.token) {
      const cookieBase = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
      }
      res.cookie('auth_token', result.token, {
        ...cookieBase,
        maxAge: (result.expiresIn || 3600) * 1000,
      })
      if (result.refreshToken) {
        res.cookie('refresh_token', result.refreshToken, {
          ...cookieBase,
          maxAge: 60 * 60 * 24 * 7 * 1000,
        })
      }
    }

    return result
  }

  @Post('complete-password-reset')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit('password_change')
  @HttpCode(HttpStatus.OK)
  async completePasswordReset(
    @CurrentUser() user: AuthUser,
    @Body() body?: { newPassword?: string; passwordUpdated?: boolean },
  ) {
    const parsed = z.object({ newPassword: z.string().min(8).max(256) }).safeParse(body)
    if (!parsed.success) throw new BadRequestException('A new password of 8–256 characters is required')
    return this.authService.completePasswordReset(user.userId, parsed.data)
  }

  @Post('sync-password-status')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit('password_change')
  @HttpCode(HttpStatus.OK)
  async syncPasswordStatus(@CurrentUser() user: AuthUser) {
    return this.authService.syncPasswordStatus(user.userId)
  }
}
