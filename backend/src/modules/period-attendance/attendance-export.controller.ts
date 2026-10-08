import {
  Controller,
  Get,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '../../core/auth/guards/auth.guard';
import { RolesGuard } from '../../core/auth/guards/roles.guard';
import { Roles } from '../../core/auth/decorators/roles.decorator';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { AuthUser } from '../../core/auth/types';
import { AttendanceExportService } from './attendance-export.service';

@Controller('api/attendance')
@UseGuards(AuthGuard, RolesGuard)
export class AttendanceExportController {
  constructor(private readonly exportService: AttendanceExportService) {}

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

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.end(buffer);
  }
}
