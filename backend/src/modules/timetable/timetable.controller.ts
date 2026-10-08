import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { TimetableService } from './timetable.service'
import { AuthGuard } from '../../core/auth/guards/auth.guard'
import { RolesGuard } from '../../core/auth/guards/roles.guard'
import { Roles } from '../../core/auth/decorators/roles.decorator'
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator'
import { AuthUser } from '../../core/auth/types'
import { RateLimitGuard } from '../../core/security/rate-limit.guard'
import { RateLimit } from '../../core/security/rate-limit.decorator'

@Controller('api/timetable')
@UseGuards(AuthGuard, RolesGuard)
export class TimetableController {
  constructor(private readonly timetableService: TimetableService) {}

  // ──────────────── Constraints (F39) ────────────────
  @Get('constraints')
  @Roles('superadmin', 'campus_director', 'hod')
  async getConstraints(
    @Query('semester') semester: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetableService.getConstraints(semester, user)
  }

  @Put('constraints')
  @Roles('superadmin', 'campus_director')
  async updateConstraints(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.timetableService.updateConstraints(body, user)
  }

  // ──────────────── Teacher Substitution (F33, F37) ────────────────
  @Put('entries/:id/teacher')
  @Roles('superadmin', 'campus_director', 'hod')
  async substituteTeacher(
    @Param('id') id: string,
    @Body() body: { teacherId: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetableService.substituteTeacher(id, body.teacherId, user)
  }

  // ──────────────── Entries ────────────────
  @Get('entries')
  @Roles('superadmin', 'campus_director', 'hod', 'teaching_staff', 'teacher', 'student')
  async getEntries(
    @Query('academicYear') academicYear: string,
    @Query('semester') semester: string,
    @Query('departmentId') departmentId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetableService.getEntries(academicYear, Number(semester), departmentId, user)
  }

  // ──────────────── Generate ────────────────
  @Post('generate')
  @Roles('superadmin', 'campus_director')
  @RateLimit('timetable')
  @UseGuards(RateLimitGuard)
  async generate(
    @Body() body: { academicYear: string; semester: number; dynamicConstraints?: any[] },
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetableService.generate(body.academicYear, body.semester, body.dynamicConstraints, user)
  }

  // ──────────────── Job Status ────────────────
  @Get('job-status')
  @Roles('superadmin', 'campus_director')
  async getJobStatus(
    @Query('academicYear') academicYear: string,
    @Query('semester') semester: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetableService.getJobStatus(academicYear, Number(semester), user)
  }

  // ──────────────── Publish ────────────────
  @Post('publish')
  @Roles('superadmin', 'campus_director')
  async publish(
    @Body() body: { academicYear: string; semester: number; force?: boolean },
    @CurrentUser() user: AuthUser,
  ) {
    return this.timetableService.publish(body.academicYear, Number(body.semester), user, body.force)
  }
}
