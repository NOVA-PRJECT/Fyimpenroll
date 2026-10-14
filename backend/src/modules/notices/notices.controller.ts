import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { AuthGuard } from '../../core/auth/guards/auth.guard'
import { RolesGuard } from '../../core/auth/guards/roles.guard'
import { Roles } from '../../core/auth/decorators/roles.decorator'
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator'
import { AuthUser } from '../../core/auth/types'
import { NoticesService } from './notices.service'

const NoticeSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(10000),
  department_id: z.string().uuid().optional(),
})

@Controller('api/notices')
@UseGuards(AuthGuard, RolesGuard)
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  @Roles('student', 'teacher', 'teaching_staff', 'hod')
  list(@CurrentUser() user: AuthUser, @Query('department_id') departmentId?: string) {
    return this.notices.list(user, departmentId)
  }

  @Post()
  @Roles('hod')
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = NoticeSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message)
    return this.notices.create(user, { title: parsed.data.title!, content: parsed.data.content!, department_id: parsed.data.department_id })
  }
}
