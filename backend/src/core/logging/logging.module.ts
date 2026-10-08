import { Global, Module } from '@nestjs/common'
import { AuditLoggerService } from './audit-logger.service'
import { ServerLoggerService } from './server-logger.service'

@Global()
@Module({
  providers: [AuditLoggerService, ServerLoggerService],
  exports: [AuditLoggerService, ServerLoggerService],
})
export class LoggingModule {}
