import { SetMetadata } from '@nestjs/common'

export type RateLimitType = 'admin' | 'timetable' | 'registration' | 'password_change' | 'campus_sign_in'

export const RATE_LIMIT_KEY = 'rate_limit_type'
export const RateLimit = (type: RateLimitType) => SetMetadata(RATE_LIMIT_KEY, type)
