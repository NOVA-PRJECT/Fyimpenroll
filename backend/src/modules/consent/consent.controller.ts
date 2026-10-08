import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../core/auth/guards/auth.guard';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { AuthUser } from '../../core/auth/types';
import { ConsentService } from './consent.service';
import { AcceptConsentSchema } from './dto/accept-consent.dto';

@Controller('api/consent')
@UseGuards(AuthGuard)
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Get('status')
  async getStatus(@CurrentUser() user: AuthUser) {
    return this.consentService.getStatus(user.userId);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  async acceptConsent(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Req() req: Request
  ) {
    const parsed = AcceptConsentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message || 'Invalid consent payload'
      );
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || 'unknown';

    return this.consentService.acceptConsent(
      user,
      parsed.data.policy_version,
      ip
    );
  }
}
