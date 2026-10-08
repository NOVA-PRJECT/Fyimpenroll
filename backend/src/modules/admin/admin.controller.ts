import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { AdminService } from './admin.service'
import { AuthGuard } from '../../core/auth/guards/auth.guard'
import { RolesGuard } from '../../core/auth/guards/roles.guard'
import { Roles } from '../../core/auth/decorators/roles.decorator'
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator'
import { AuthUser } from '../../core/auth/types'

const CreateCampusSchema = z.object({
  name: z.string().trim().min(1, 'Campus name is required').max(100, 'Campus name too long'),
  code: z.string().trim().min(1, 'Campus code is required').max(20, 'Campus code too long'),
})

const UpdateCampusSchema = z.object({
  id: z.string().min(1, 'Campus ID is required'),
  name: z.string().trim().min(1, 'Campus name is required').max(100, 'Campus name too long'),
  code: z.string().trim().min(1, 'Campus code is required').max(20, 'Campus code too long'),
})

const DeleteCampusSchema = z.object({
  campus_id: z.string().min(1, 'Campus ID is required'),
})

const CreateDepartmentSchema = z.object({
  name: z.string().trim().min(1, 'Department name is required').max(100, 'Department name too long'),
  code: z.string().trim().min(1, 'Department code is required').max(20, 'Department code too long'),
  campus_id: z.string().min(1, 'Campus ID is required'),
})

const UpdateDepartmentSchema = z.object({
  id: z.string().min(1, 'Department ID is required'),
  name: z.string().trim().min(1, 'Department name is required').max(100, 'Department name too long'),
  code: z.string().trim().min(1, 'Department code is required').max(20, 'Department code too long'),
})

const DeleteDepartmentSchema = z.object({
  department_id: z.string().min(1, 'Department ID is required'),
})

@Controller('api/admin')
@UseGuards(AuthGuard, RolesGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ──────────────── Campuses ────────────────
  @Get('campuses')
  @Roles('superadmin')
  async getCampuses() {
    return this.adminService.getCampuses()
  }

  @Post('campuses')
  @Roles('superadmin')
  async createCampus(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = CreateCampusSchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message)
    }
    return this.adminService.createCampus(parsed.data.name, parsed.data.code, user)
  }

  @Put('campuses')
  @Roles('superadmin')
  async updateCampus(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = UpdateCampusSchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message)
    }
    return this.adminService.updateCampus(parsed.data.id, parsed.data.name, parsed.data.code, user)
  }

  @Delete('campuses')
  @Roles('superadmin')
  async deleteCampus(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = DeleteCampusSchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message)
    }
    return this.adminService.deleteCampus(parsed.data.campus_id, user)
  }

  // ──────────────── Departments ────────────────
  @Get('departments')
  @Roles('superadmin')
  async getDepartments() {
    return this.adminService.getDepartments()
  }

  @Post('departments')
  @Roles('superadmin')
  async createDepartment(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = CreateDepartmentSchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message)
    }
    return this.adminService.createDepartment(parsed.data.name, parsed.data.code, parsed.data.campus_id, user)
  }

  @Put('departments')
  @Roles('superadmin')
  async updateDepartment(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = UpdateDepartmentSchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message)
    }
    return this.adminService.updateDepartment(parsed.data.id, parsed.data.name, parsed.data.code, user)
  }

  @Delete('departments')
  @Roles('superadmin')
  async deleteDepartment(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = DeleteDepartmentSchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message)
    }
    return this.adminService.deleteDepartment(parsed.data.department_id, user)
  }

  // ──────────────── Faculty List ────────────────
  @Get('faculty-list')
  @Roles('superadmin')
  async getFacultyList() {
    return this.adminService.getFacultyList()
  }

  @Post('faculty-list')
  @Roles('superadmin')
  async createFaculty(
    @Body() body: {
      full_name: string
      email: string
      password: string
      role: string
      department_id?: string | null
      campus_id: string
    },
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.createFaculty(body, user)
  }

  @Put('faculty-list')
  @Roles('superadmin')
  async updateFaculty(
    @Body() body: {
      id: string
      full_name: string
      role: string
      department_id?: string | null
      campus_id: string
    },
    @CurrentUser() user: AuthUser,
  ) {
    return this.adminService.updateFaculty(body.id, body, user)
  }

  @Delete('faculty-list')
  @Roles('superadmin')
  async deleteFaculty(@Body() body: { faculty_id: string }, @CurrentUser() user: AuthUser) {
    return this.adminService.deleteFaculty(body.faculty_id, user)
  }

  // ──────────────── Promote Students ────────────────
  @Post('campus/promote-students')
  @Roles('campus_director')
  async promoteStudents(@CurrentUser() user: AuthUser) {
    return this.adminService.promoteStudents(user)
  }

  // ──────────────── System & Audit Logs ────────────────
  @Get('logs')
  @Roles('superadmin')
  async getLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('log_type') logType?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getSystemLogs({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      logType,
      status,
      search,
    })
  }
}
