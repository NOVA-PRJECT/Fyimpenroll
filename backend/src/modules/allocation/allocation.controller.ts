import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { AllocationService } from './allocation.service'
import { AuthGuard } from '../../core/auth/guards/auth.guard'
import { RolesGuard } from '../../core/auth/guards/roles.guard'
import { Roles } from '../../core/auth/decorators/roles.decorator'
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator'
import { AuthUser } from '../../core/auth/types'

@Controller('api/allocation')
@UseGuards(AuthGuard, RolesGuard)
export class AllocationController {
  constructor(private readonly allocationService: AllocationService) {}

  // ──────────────── Prerequisite Rule Engine Endpoints ────────────────
  @Get('config/prerequisites/:courseId')
  @Roles('hod', 'superadmin')
  async getPrerequisites(
    @Param('courseId') courseId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.allocationService.getPrerequisites(courseId, user)
  }

  @Post('config/prerequisites/:courseId')
  @Roles('hod', 'superadmin')
  async addPrerequisite(
    @Param('courseId') courseId: string,
    @Body() body: { rule: string; target: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.allocationService.addPrerequisite(courseId, body, user)
  }

  @Delete('config/prerequisites/:ruleId')
  @Roles('hod', 'superadmin')
  async deletePrerequisite(
    @Param('ruleId') ruleId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.allocationService.deletePrerequisite(ruleId, user)
  }

  // ──────────────── Campus Director: Run Allocation ────────────────
  @Post('run')
  @Roles('campus_director')
  async runAllocation(
    @Body() body: { academicYear: string; semester: number },
    @CurrentUser() user: AuthUser,
  ) {
    return this.allocationService.runAllocation(body, user)
  }

  // ──────────────── Status Polling (Director & HOD) ────────────────
  @Get('status')
  @Roles('campus_director', 'hod')
  async getRunStatus(
    @Query('academicYear') academicYear: string,
    @Query('semester') semester: string,
    @CurrentUser() user: AuthUser,
  ) {
    const sem = semester ? Number(semester) : 1
    return this.allocationService.getRunStatus(academicYear || '', isNaN(sem) ? 1 : sem, user)
  }

  // ──────────────── Clear Stale Failed Run ────────────────
  @Delete('runs/:runId')
  @Roles('campus_director')
  async clearFailedRun(
    @Param('runId') runId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.allocationService.clearFailedRun(runId, user)
  }

  // ──────────────── HOD: Unresolved Students ────────────────
  @Get('unresolved')
  @Roles('hod')
  async getUnresolvedStudents(
    @Query('semesterId') semesterId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.allocationService.getUnresolvedStudents(semesterId, user)
  }

  // ──────────────── HOD: Remaining Seats ────────────────
  @Get('remaining-seats')
  @Roles('hod')
  async getRemainingSeats(
    @Query('semesterId') semesterId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.allocationService.getRemainingSeats(semesterId, user)
  }

  // ──────────────── Manual Allocation (HOD / Assigned Class Teacher) ────────────────
  @Post('manual-allocate')
  @Roles('hod', 'teacher', 'superadmin')
  async manualAllocate(
    @Body() body: { student_id: string; slot_key: string; course_id: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.allocationService.manualAllocate(body, user)
  }
}
