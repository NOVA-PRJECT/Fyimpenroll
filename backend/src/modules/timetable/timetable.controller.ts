import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
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
import { GenerateRequestSchema, PublishRequestSchema, ManualTimetableSchema, ManualPublishSchema, ManualTimetableRequest, TimetableQuerySchema } from './solver/schemas'
import { ManualTimetableService } from './manual-timetable.service'
import { z } from 'zod'
import type { Request, Response } from 'express'

@Controller('api/timetable')
@UseGuards(AuthGuard, RolesGuard)
export class TimetableController {
  constructor(private readonly timetableService: TimetableService, private readonly manualTimetable: ManualTimetableService) {}

  @Get('manual')
  @Roles('campus_director')
  async getManual(@Query() query: unknown, @CurrentUser() user: AuthUser) {
    const parsed = TimetableQuerySchema.safeParse(query)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message)
    return this.manualTimetable.get(parsed.data.academicYear, parsed.data.semester, user)
  }

  @Post('manual/preview')
  @Roles('campus_director')
  async previewManual(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = ManualTimetableSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message)
    return this.manualTimetable.preview(parsed.data as ManualTimetableRequest, user)
  }

  @Put('manual')
  @Roles('campus_director')
  async saveManual(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = ManualTimetableSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message)
    return this.manualTimetable.save(parsed.data as ManualTimetableRequest, user)
  }

  @Post('manual/publish')
  @Roles('campus_director')
  async publishManual(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = ManualPublishSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message)
    return this.manualTimetable.publish(parsed.data, user)
  }

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
  @Roles('hod')
  async substituteTeacher(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = z.object({
      id: z.string().uuid(),
      teacherId: z.union([z.string().uuid(), z.literal(''), z.null()]),
    }).safeParse({ ...(body && typeof body === 'object' ? body : {}), id })
    if (!parsed.success) throw new BadRequestException('A valid entry and teacher ID (or null to unassign) are required')
    return this.timetableService.substituteTeacher(parsed.data.id, parsed.data.teacherId || null, user)
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
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = GenerateRequestSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message)
    return this.timetableService.generate(parsed.data.academicYear, parsed.data.semester, parsed.data.dynamicConstraints, user, parsed.data.rules)
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
  @Get('progress')
  @Roles('campus_director')
  async progress(@Query() query: unknown, @CurrentUser() user: AuthUser, @Req() req: Request, @Res() res: Response) {
    const parsed = TimetableQuerySchema.extend({ jobId: z.string().uuid() }).safeParse(query)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message)
    return this.timetableService.progress(parsed.data.academicYear, parsed.data.semester, parsed.data.jobId, user, req, res)
  }

  @Post('publish')
  @Roles('superadmin', 'campus_director')
  async publish(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = PublishRequestSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message)
    return this.timetableService.publish(parsed.data.academicYear, parsed.data.semester, user, parsed.data.force)
  }
}
