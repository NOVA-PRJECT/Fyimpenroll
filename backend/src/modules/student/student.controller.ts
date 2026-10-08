import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common'
import { Response } from 'express'
import { StudentService } from './student.service'
import { AuthGuard } from '../../core/auth/guards/auth.guard'
import { RolesGuard } from '../../core/auth/guards/roles.guard'
import { Roles } from '../../core/auth/decorators/roles.decorator'
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator'
import { AuthUser } from '../../core/auth/types'
import { RateLimitGuard } from '../../core/security/rate-limit.guard'
import { RateLimit } from '../../core/security/rate-limit.decorator'
import { z } from 'zod'

const ChangePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: z
      .string()
      .min(10, 'Password must be at least 10 characters')
      .max(128, 'Password must not exceed 128 characters')
      .regex(/[A-Za-z]/, 'Password must contain at least one letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirm_password: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.new_password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  })

@Controller('api/student')
@UseGuards(AuthGuard, RolesGuard)
@Roles('student')
export class StudentController {
  constructor(private readonly studentService: StudentService) {}

  @Get('dashboard-summary')
  async getDashboardSummary(@CurrentUser() user: AuthUser) {
    return this.studentService.getDashboardSummary(user)
  }

  @Post('change-password')
  @RateLimit('password_change')
  @UseGuards(RateLimitGuard)
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

    const result = await this.studentService.changePassword(
      parsed.data.current_password,
      parsed.data.new_password,
      user,
    )

    if (!result.success) {
      return result
    }

    if (result.token) {
      res.cookie('auth_token', result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 3600 * 1000,
      })
    }

    if (result.refreshToken) {
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7 * 1000,
      })
    }

    return { success: true, message: result.message }
  }
}
