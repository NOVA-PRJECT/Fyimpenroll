import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common'
import { FacultyService } from './faculty.service'
import { AuthGuard } from '../../core/auth/guards/auth.guard'
import { RolesGuard } from '../../core/auth/guards/roles.guard'
import { Roles } from '../../core/auth/decorators/roles.decorator'
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator'
import { AuthUser } from '../../core/auth/types'

@Controller('api/faculty')
@UseGuards(AuthGuard, RolesGuard)
@Roles('teacher', 'teaching_staff', 'hod')
export class FacultyController {
  constructor(private readonly facultyService: FacultyService) {}

  @Get('courses')
  async getCourses(@CurrentUser() user: AuthUser) {
    return this.facultyService.getCourses(user)
  }

  @Get('attendance')
  async getAttendance(@Query('course_id') courseId: string, @CurrentUser() user: AuthUser) {
    return this.facultyService.getClassRoster(courseId, user)
  }

  @Get('defaulters')
  @Roles('hod')
  async getDefaulters(
    @Query('semester') semester: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.facultyService.getDefaulters(semester ? Number(semester) : undefined, user)
  }
}
