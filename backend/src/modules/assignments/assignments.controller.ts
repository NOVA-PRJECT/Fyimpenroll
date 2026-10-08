import {
  Controller,
  Delete,
  Get,
  Post,
  Patch,
  Body,
  Param,
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
import { AssignmentsService } from './assignments.service';
import { AssignTeacherSchema, BatchAssignTeacherSchema, BatchAssignmentItem } from './dto/assign-teacher.dto';
import { ReassignTeacherSchema } from './dto/reassign-teacher.dto';

@Controller('api/assignments')
@UseGuards(AuthGuard, RolesGuard)
export class AssignmentsController {
  constructor(private readonly assignmentsService: AssignmentsService) {}

  @Get('courses')
  @Roles('hod', 'superadmin')
  async getCoursesAndAssignments(@CurrentUser() user: AuthUser) {
    return this.assignmentsService.getCoursesAndAssignments(user);
  }

  @Post('assign')
  @Roles('hod', 'superadmin')
  async assignTeacher(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Req() req: Request
  ) {
    const parsed = AssignTeacherSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message || 'Invalid payload');
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || 'unknown';
    return this.assignmentsService.assignTeacher(
      user,
      parsed.data.teacher_id,
      parsed.data.course_id,
      ip,
      {
        campus_id: parsed.data.campus_id,
        academic_year: parsed.data.academic_year,
        semester: parsed.data.semester,
      }
    );
  }

  @Post('batch-assign')
  @Roles('hod', 'superadmin')
  async batchAssignTeachers(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Req() req: Request
  ) {
    const parsed = BatchAssignTeacherSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message || 'Invalid batch payload');
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || 'unknown';
    return this.assignmentsService.batchAssignTeachers(user, parsed.data.assignments as BatchAssignmentItem[], ip);
  }


  @Patch(':id/reassign')
  @Roles('hod', 'superadmin')
  async reassignTeacher(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request
  ) {
    const parsed = ReassignTeacherSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message || 'Invalid payload');
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || 'unknown';
    return this.assignmentsService.reassignTeacher(user, id, parsed.data.teacher_id, ip);
  }

  @Delete(':id')
  @Roles('hod', 'superadmin')
  async removeAssignment(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() req: Request
  ) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || 'unknown';
    return this.assignmentsService.removeAssignment(user, id, ip);
  }
}
