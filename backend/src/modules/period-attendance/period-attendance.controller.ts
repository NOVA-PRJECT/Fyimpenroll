import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '../../core/auth/guards/auth.guard';
import { RolesGuard } from '../../core/auth/guards/roles.guard';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { AuthUser } from '../../core/auth/types';
import { PeriodAttendanceService } from './period-attendance.service';
import { AttendanceExportService } from './attendance-export.service';
import { SubmitAttendanceSchema } from './dto/submit-attendance.dto';
import { UnlockPeriodSchema } from './dto/unlock-period.dto';

@Controller('api/attendance/period')
@UseGuards(AuthGuard, RolesGuard)
export class PeriodAttendanceController {
  constructor(
    private readonly periodService: PeriodAttendanceService,
    private readonly exportService: AttendanceExportService
  ) {}

  @Get('current')
  @Roles('teacher', 'teaching_staff', 'hod')
  async getCurrentPeriod(@CurrentUser() user: AuthUser) {
    return this.periodService.getCurrentPeriod(user);
  }

  @Get('teacher-schedule')
  @Roles('teacher', 'teaching_staff', 'hod')
  async getTeacherSchedule(
    @CurrentUser() user: AuthUser,
    @Query('date') date?: string
  ) {
    return this.periodService.getTeacherSchedule(user, date);
  }

  @Post('submit')
  @Roles('teacher', 'hod')
  async submitAttendance(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Req() req: Request
  ) {
    const parsed = SubmitAttendanceSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message || 'Invalid payload');
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || 'unknown';
    return this.periodService.submitAttendance(
      user,
      parsed.data.timetable_slot_id,
      parsed.data.absent_student_ids,
      ip,
      parsed.data.client_timestamp
    );
  }

  @Post('unlock')
  @Roles('hod', 'superadmin')
  async unlockPeriod(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Req() req: Request
  ) {
    const parsed = UnlockPeriodSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message || 'Invalid payload');
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || 'unknown';
    return this.periodService.unlockPeriod(
      user,
      parsed.data.timetable_slot_id,
      parsed.data.reason,
      ip
    );
  }

  @Get('roster')
  @Roles('hod', 'superadmin')
  async getSlotRosterForHod(
    @CurrentUser() user: AuthUser,
    @Query('slotId') slotId: string
  ) {
    if (!slotId) {
      throw new BadRequestException('slotId query parameter is required');
    }
    return this.periodService.getSlotRosterForHod(user, slotId);
  }

  @Get('slots')
  @Roles('hod', 'superadmin')
  async getDepartmentSlots(
    @CurrentUser() user: AuthUser,
    @Query('semester') semester?: string,
    @Query('dayOfWeek') dayOfWeek?: string
  ) {
    return this.periodService.getDepartmentSlots(
      user,
      semester ? parseInt(semester, 10) : undefined,
      dayOfWeek ? parseInt(dayOfWeek, 10) : undefined
    );
  }

  @Get('export/statement')
  @Roles('hod', 'superadmin')
  async exportStatement(
    @CurrentUser() user: AuthUser,
    @Query('semesterId') semesterId: string,
    @Query('departmentId') departmentId: string,
    @Res() res: Response
  ) {
    const sem = semesterId ? parseInt(semesterId, 10) : 1;
    const { buffer, filename } = await this.exportService.generateAttendanceStatement(
      user,
      sem,
      departmentId
    );

    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`)
    res.setHeader('Content-Length', buffer.length)
    return res.end(buffer);
  }
}
