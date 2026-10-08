import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { RateLimiterService } from './rate-limiter.service'
import { RATE_LIMIT_KEY, RateLimitType } from './rate-limit.decorator'

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rateLimitType = this.reflector.getAllAndOverride<RateLimitType>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!rateLimitType) {
      return true
    }

    const request = context.switchToHttp().getRequest()
    const user = request.user
    const ip =
      request.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
      request.socket?.remoteAddress ||
      'unknown-ip'

    const identifier = user?.userId || ip

    let limiter = this.rateLimiter.adminCrudLimiter
    if (rateLimitType === 'timetable') {
      limiter = this.rateLimiter.timetableGenerateLimiter
    } else if (rateLimitType === 'registration') {
      limiter = this.rateLimiter.registrationSubmitLimiter
    } else if (rateLimitType === 'password_change') {
      limiter = this.rateLimiter.passwordChangeLimiter
    } else if (rateLimitType === 'campus_sign_in') {
      limiter = this.rateLimiter.campusSignInLimiter
    }

    const result = await this.rateLimiter.checkLimit(limiter, identifier)
    if (!result.success) {
      throw new HttpException(
        'Rate limit exceeded. Please wait a moment before trying again.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    return true
  }
}
