import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common'

@Controller('api/health')
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  check() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }
  }
}
