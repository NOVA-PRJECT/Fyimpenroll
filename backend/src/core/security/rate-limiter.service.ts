import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name)
  public readonly loginLimiter: Ratelimit
  public readonly emailLoginLimiter: Ratelimit
  public readonly adminCrudLimiter: Ratelimit
  public readonly timetableGenerateLimiter: Ratelimit
  public readonly registrationSubmitLimiter: Ratelimit
  public readonly passwordChangeLimiter: Ratelimit
  public readonly campusSignInLimiter: Ratelimit
  private readonly isConfigured: boolean
  private readonly redis: Redis | null = null

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('UPSTASH_REDIS_REST_URL') || process.env.UPSTASH_REDIS_REST_URL
    const token = this.config.get<string>('UPSTASH_REDIS_REST_TOKEN') || process.env.UPSTASH_REDIS_REST_TOKEN

    if (url && token && !url.includes('dummy')) {
      this.isConfigured = true
      this.redis = new Redis({ url, token })
    } else {
      this.isConfigured = false
      this.redis = null
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          'CRITICAL: Upstash Redis is not configured in PRODUCTION (missing UPSTASH_REDIS_REST_URL or TOKEN). Rate limiting will fail-open!'
        )
      } else {
        this.logger.warn(
          'Upstash Redis is not configured (missing UPSTASH_REDIS_REST_URL or TOKEN). Rate limiting will fail-open without remote network calls.'
        )
      }
    }

    const redisClient = this.redis || new Redis({ url: 'https://dummy.upstash.io', token: 'dummy_token' })

    this.loginLimiter = new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(10, '15 m'),
      prefix: 'ratelimit:login',
    })

    this.emailLoginLimiter = new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(5, '15 m'),
      prefix: 'ratelimit:email_login',
    })

    this.adminCrudLimiter = new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(30, '10 s'),
      prefix: 'ratelimit:admin_crud',
    })

    this.timetableGenerateLimiter = new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(3, '60 s'),
      prefix: 'ratelimit:timetable_generate',
    })

    this.registrationSubmitLimiter = new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(5, '60 s'),
      prefix: 'ratelimit:registration_submit',
    })

    this.passwordChangeLimiter = new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(5, '15 m'),
      prefix: 'ratelimit:password_change',
    })

    this.campusSignInLimiter = new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(5, '60 s'),
      prefix: 'ratelimit:campus_sign_in',
    })
  }

  /**
   * Safely check rate limit, failing open if Redis is unavailable or unconfigured.
   */
  async checkLimit(
    limiter: Ratelimit,
    identifier: string,
  ): Promise<{ success: boolean; remaining: number; reset: number }> {
    if (!this.isConfigured || !this.redis) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          `[RateLimit:UNCONFIGURED] Bypassing rate limit check for identifier "${identifier}" due to missing Redis configuration in production!`
        )
      }
      return { success: true, remaining: 100, reset: Date.now() + 60000 }
    }

    try {
      return await limiter.limit(identifier)
    } catch (err: any) {
      this.logger.warn(`Rate limiter check failed: ${err.message}. Failing open to avoid denial of service.`)
      return { success: true, remaining: 1, reset: Date.now() + 60000 }
    }
  }

  async resetLoginLimits(ip: string, email: string): Promise<void> {
    if (!this.isConfigured || !this.redis) return

    try {
      const sanitizedEmail = email.toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_')
      await Promise.all([
        this.redis.del(`ratelimit:login:${ip}`),
        this.redis.del(`ratelimit:email_login:${sanitizedEmail}`),
      ])
    } catch (err: any) {
      this.logger.warn(`Failed to reset login rate limits: ${err.message}`)
    }
  }
}
