import {
  Controller,
  Get,
  Query,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common'
import { Response } from 'express'
import { AuthGuard } from '../../core/auth/guards/auth.guard'
import { RolesGuard } from '../../core/auth/guards/roles.guard'
import { Roles } from '../../core/auth/decorators/roles.decorator'
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator'
import { AuthUser } from '../../core/auth/types'
import { ExportService } from './export.service'

@Controller('api/export')
@UseGuards(AuthGuard, RolesGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  private handleFileResponse(res: Response, result: any) {
    if (result && result.buffer && result.contentType) {
      res.setHeader('Content-Type', result.contentType)
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
      return res.send(result.buffer)
    }
    return res.json(result)
  }

  // 1. Final Registrations Export
  @Get('registrations')
  @Roles('student', 'hod', 'campus_director', 'superadmin', 'teacher')
  async exportRegistrations(
    @Query('semester') semester: string | undefined,
    @Query('academic_year') academicYear: string | undefined,
    @Query('campus_id') campusId: string | undefined,
    @Query('department_id') departmentId: string | undefined,
    @Query('format') format: 'csv' | 'xlsx' | 'json' | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.exportService.exportFinalRegistrations(
      {
        semester: semester ? Number(semester) : undefined,
        academic_year: academicYear,
        campus_id: campusId,
        department_id: departmentId,
        format,
      },
      user,
    )
    return this.handleFileResponse(res, result)
  }

  // 2. Unresolved Allocations Export
  @Get('unresolved-allocations')
  @Roles('hod', 'campus_director', 'superadmin', 'teacher')
  async exportUnresolvedAllocations(
    @Query('semester') semester: string | undefined,
    @Query('academic_year') academicYear: string | undefined,
    @Query('format') format: 'csv' | 'xlsx' | 'json' | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.exportService.exportUnresolvedAllocations(
      {
        semester: semester ? Number(semester) : undefined,
        academic_year: academicYear,
        format,
      },
      user,
    )
    return this.handleFileResponse(res, result)
  }

  // 3. Campus-Class Roster Export
  @Get('class-roster')
  @Roles('teacher', 'teaching_staff', 'hod', 'campus_director', 'superadmin')
  async exportClassRoster(
    @Query('course_id') courseId: string,
    @Query('academic_year') academicYear: string | undefined,
    @Query('semester') semester: string | undefined,
    @Query('format') format: 'csv' | 'xlsx' | 'json' | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.exportService.exportCampusClassRoster(
      {
        course_id: courseId,
        academic_year: academicYear,
        semester: semester ? Number(semester) : undefined,
        format,
      },
      user,
    )
    return this.handleFileResponse(res, result)
  }

  // 4. Timetable Export
  @Get('timetable')
  @Roles('student', 'teacher', 'teaching_staff', 'hod', 'campus_director', 'superadmin')
  async exportTimetable(
    @Query('campus_id') campusId: string | undefined,
    @Query('academic_year') academicYear: string | undefined,
    @Query('semester') semester: string | undefined,
    @Query('department_id') departmentId: string | undefined,
    @Query('format') format: 'csv' | 'xlsx' | 'json' | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.exportService.exportTimetable(
      {
        campus_id: campusId,
        academic_year: academicYear,
        semester: semester ? Number(semester) : undefined,
        department_id: departmentId,
        format,
      },
      user,
    )
    return this.handleFileResponse(res, result)
  }

  // 5. Period Attendance Export
  @Get('period-attendance')
  @Roles('teacher', 'hod', 'campus_director', 'superadmin')
  async exportPeriodAttendance(
    @Query('semester') semester: string | undefined,
    @Query('academic_year') academicYear: string | undefined,
    @Query('course_id') courseId: string | undefined,
    @Query('start_date') startDate: string | undefined,
    @Query('end_date') endDate: string | undefined,
    @Query('format') format: 'csv' | 'xlsx' | 'json' | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.exportService.exportPeriodAttendance(
      {
        semester: semester ? Number(semester) : undefined,
        academic_year: academicYear,
        course_id: courseId,
        start_date: startDate,
        end_date: endDate,
        format,
      },
      user,
    )
    return this.handleFileResponse(res, result)
  }

  // 6. GPS Sign-ins Export
  @Get('gps-signins')
  @Roles('campus_director', 'superadmin')
  async exportGpsSignIns(
    @Query('campus_id') campusId: string | undefined,
    @Query('date') date: string | undefined,
    @Query('start_date') startDate: string | undefined,
    @Query('end_date') endDate: string | undefined,
    @Query('format') format: 'csv' | 'xlsx' | 'json' | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.exportService.exportGpsSignIns(
      {
        campus_id: campusId,
        date,
        start_date: startDate,
        end_date: endDate,
        format,
      },
      user,
    )
    return this.handleFileResponse(res, result)
  }

  // 7. Registered-Credit Ledger Export
  @Get('credit-ledger/:studentId')
  @Roles('student', 'teacher', 'hod', 'campus_director', 'superadmin')
  async exportCreditLedger(
    @Param('studentId') studentId: string,
    @Query('format') format: 'csv' | 'xlsx' | 'json' | undefined,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const targetId = studentId === 'me' ? user.userId : studentId
    const result = await this.exportService.exportCreditLedger(targetId, user, format)
    return this.handleFileResponse(res, result)
  }
}
