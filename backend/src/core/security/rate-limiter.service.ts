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
  private readonly localWindows = new Map<Ratelimit, Map<string, { count: number; reset: number }>>()

  private localLimit(limiter: Ratelimit, identifier: string) {
    const now = Date.now()
    const [limit, duration] = limiter === this.loginLimiter ? [10, 900000]
      : limiter === this.emailLoginLimiter || limiter === this.passwordChangeLimiter ? [5, 900000]
      : limiter === this.adminCrudLimiter ? [30, 10000]
      : limiter === this.timetableGenerateLimiter ? [3, 60000] : [5, 60000]
    let windows = this.localWindows.get(limiter)
    if (!windows) { windows = new Map(); this.localWindows.set(limiter, windows) }
    for (const [key, entry] of windows) if (entry.reset <= now) windows.delete(key)
    let entry = windows.get(identifier)
    if (!entry) {
      // Fail closed at capacity instead of evicting an attacker's active counters.
      if (windows.size >= 10000) return { success: false, remaining: 0, reset: now + duration }
      entry = { count: 0, reset: now + duration }
      windows.set(identifier, entry)
    }
    entry.count++
    return { success: entry.count <= limit, remaining: Math.max(0, limit - entry.count), reset: entry.reset }
  }

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
          'Upstash Redis is not configured. Using bounded per-process limits; configure Redis before scaling to multiple instances.'
        )
      } else {
        this.logger.warn(
          'Upstash Redis is not configured. Using bounded per-process rate limits.'
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
   * Retain per-process enforcement when the shared limiter is unavailable.
   */
  async checkLimit(
    limiter: Ratelimit,
    identifier: string,
  ): Promise<{ success: boolean; remaining: number; reset: number }> {
    const local = this.localLimit(limiter, identifier)
    if (!this.isConfigured || !this.redis) return local

    try {
      return await limiter.limit(identifier)
    } catch (err: any) {
      this.logger.warn('Shared rate limiter unavailable; applying per-process limit.')
      return local
    }
  }

  async resetLoginLimits(ip: string, email: string): Promise<void> {
    this.localWindows.get(this.loginLimiter)?.delete(ip)
    this.localWindows.get(this.emailLoginLimiter)?.delete(email.toLowerCase())
    if (!this.isConfigured || !this.redis) return

    try {
      await Promise.all([
        this.loginLimiter.resetUsedTokens(ip),
        this.emailLoginLimiter.resetUsedTokens(email.toLowerCase()),
      ])
    } catch (err: any) {
      this.logger.warn(`Failed to reset login rate limits: ${err.message}`)
    }
  }
}
