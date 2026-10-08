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

const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

const ChangePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required'),
  new_password: z.string().min(8, 'New password must be at least 8 characters'),
})

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || (req as any).ip || 'unknown'
    const result = await this.authService.login(parsed.data.email, parsed.data.password, ip)

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

    return {
      redirectTo: result.redirectTo,
      role: result.role,
      token: result.token,
      refreshToken: result.refreshToken,
      must_change_password: result.must_change_password,
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
    if (!token) {
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
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || (req as any).ip || 'unknown'
    const authHeader = (req.headers as any).authorization as string | undefined
    const token = (req as any).cookies?.auth_token || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined)
    const user = (req as any).user as AuthUser | undefined

    await this.authService.logout(user || token, ip)

    res.clearCookie('auth_token', { path: '/' })
    res.clearCookie('refresh_token', { path: '/' })
    res.clearCookie('user_role', { path: '/' })

    return { success: true }
  }

  @Get('profile')
  @UseGuards(AuthGuard)
  async getProfile(@CurrentUser() user: AuthUser) {
    return this.authService.getProfile(user)
  }

  @Post('change-password')
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async completePasswordReset(
    @CurrentUser() user: AuthUser,
    @Body() body?: { newPassword?: string; passwordUpdated?: boolean },
  ) {
    return this.authService.completePasswordReset(user.userId, body)
  }

  @Post('sync-password-status')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncPasswordStatus(@CurrentUser() user: AuthUser) {
    return this.authService.syncPasswordStatus(user.userId)
  }
}
