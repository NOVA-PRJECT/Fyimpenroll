import { ExportBudgetInterceptor } from '../../core/security/export-budget.interceptor'
import {
  Controller,
  UseInterceptors,
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
  @UseInterceptors(ExportBudgetInterceptor)
  @Roles('hod', 'superadmin')
  async exportStatement(
    @CurrentUser() user: AuthUser,
    @Query('semesterId') semesterId: string,
    @Query('departmentId') departmentId: string,
    @Res() res: Response
  ) {
    return this.exportService.sendStatement(user, { semesterId, departmentId }, res)
  }
}
