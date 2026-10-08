import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { RegistrationsService } from './registrations.service'
import { AuthGuard } from '../../core/auth/guards/auth.guard'
import { RolesGuard } from '../../core/auth/guards/roles.guard'
import { Roles } from '../../core/auth/decorators/roles.decorator'
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator'
import { AuthUser } from '../../core/auth/types'
import { RateLimitGuard } from '../../core/security/rate-limit.guard'
import { RateLimit } from '../../core/security/rate-limit.decorator'

@Controller('api/registrations')
@UseGuards(AuthGuard, RolesGuard)
@Roles('student')
export class RegistrationsController {
  constructor(private readonly registrationsService: RegistrationsService) {}

  @Get('blueprint')
  async getBlueprint(@CurrentUser() user: AuthUser) {
    return this.registrationsService.getBlueprint(user)
  }

  @Get('my')
  async getMyRegistration(@CurrentUser() user: AuthUser) {
    return this.registrationsService.getMyRegistration(user)
  }

  @Get('pathway-slots')
  async getPathwaySlots(
    @Query('pathway_id') pathwayId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.registrationsService.getPathwaySlots(pathwayId, user)
  }

  @Post('submit')
  @RateLimit('registration')
  @UseGuards(RateLimitGuard)
  async submitCourses(
    @Body()
    body: {
      semester: number
      pathway_id: string
      courses?: string[]
      preferences?: Record<string, { course_id: string; rank: number }[]>
    },
    @CurrentUser() user: AuthUser,
  ) {
    return this.registrationsService.submitCourses(body, user)
  }

  @Get('available-seats')
  async getAvailableSeats(
    @Query('semester') semester: string,
    @Query('slot_key') slotKey: string,
    @Query('pathway_id') pathwayId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.registrationsService.getAvailableSeats(
      Number(semester),
      slotKey,
      pathwayId,
      user,
    )
  }

  @Post('update-slot')
  @RateLimit('registration')
  @UseGuards(RateLimitGuard)
  async updateSlot(
    @Body() body: { slot_key: string; course_id: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.registrationsService.updateSlot(body, user)
  }
}
