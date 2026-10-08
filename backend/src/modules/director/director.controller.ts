import {
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common'
import { DirectorService } from './director.service'
import { AuthGuard } from '../../core/auth/guards/auth.guard'
import { RolesGuard } from '../../core/auth/guards/roles.guard'
import { Roles } from '../../core/auth/decorators/roles.decorator'
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator'
import { AuthUser } from '../../core/auth/types'

@Controller('api/director')
@UseGuards(AuthGuard, RolesGuard)
@Roles('campus_director')
export class DirectorController {
  constructor(private readonly directorService: DirectorService) {}

  @Get('settings')
  async getSettings(@CurrentUser() user: AuthUser) {
    return this.directorService.getSettings(user)
  }

  @Put('settings')
  async updateSettings(
    @Body()
    body: {
      deadline?: string | null
      min_credits?: number
      max_credits?: number
      academic_year?: string
    },
    @CurrentUser() user: AuthUser,
  ) {
    return this.directorService.updateSettings(body, user)
  }
}
