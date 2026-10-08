import { Global, Module } from '@nestjs/common'
import { RateLimiterService } from './rate-limiter.service'
import { RateLimitGuard } from './rate-limit.guard'

@Global()
@Module({
  providers: [RateLimiterService, RateLimitGuard],
  exports: [RateLimiterService, RateLimitGuard],
})
export class SecurityModule {}
