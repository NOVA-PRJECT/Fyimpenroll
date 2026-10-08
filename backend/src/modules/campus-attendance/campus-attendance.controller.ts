import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../core/auth/guards/auth.guard';
import { RolesGuard } from '../../core/auth/guards/roles.guard';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { AuthUser } from '../../core/auth/types';
import { RateLimitGuard } from '../../core/security/rate-limit.guard';
import { RateLimit } from '../../core/security/rate-limit.decorator';
import { CampusAttendanceService } from './campus-attendance.service';
import { CampusSignInSchema } from './dto/campus-attendance.dto';

@Controller('api/attendance/campus')
@UseGuards(AuthGuard, RolesGuard)
export class CampusAttendanceController {
  constructor(private readonly campusService: CampusAttendanceService) {}

  /**
   * Student endpoint: Twice-daily GPS-verified campus sign-in.
   * Capped at 5 attempts per minute per student to mitigate geofence guessing/spoofing.
   */
  @Post('sign-in')
  @Roles('student')
  @RateLimit('campus_sign_in')
  @UseGuards(RateLimitGuard)
  async signIn(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Req() req: Request
  ) {
    const parsed = CampusSignInSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message || 'Invalid coordinates payload');
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.ip ||
      'unknown-ip';

    return this.campusService.recordCampusSignIn(
      user,
      parsed.data.latitude,
      parsed.data.longitude,
      parsed.data.accuracy,
      ip
    );
  }

  /**
   * Student / Staff query for today's morning & evening campus check status.
   */
  @Get('status/:studentId')
  @Roles('student', 'teacher', 'teaching_staff', 'hod', 'campus_director', 'superadmin')
  async getStatus(
    @CurrentUser() user: AuthUser,
    @Param('studentId') studentId: string
  ) {
    return this.campusService.getStudentCampusStatus(user, studentId);
  }

  /**
   * HOD department campus attendance roster.
   */
  @Get('roster')
  @Roles('hod', 'campus_director', 'superadmin')
  async getDepartmentRoster(
    @CurrentUser() user: AuthUser,
    @Query('date') queryDate?: string
  ) {
    return this.campusService.getDepartmentCampusRoster(user, queryDate);
  }
}
