import { Global, Module } from '@nestjs/common'
import { AuditLoggerService } from './audit-logger.service'
import { ServerLoggerService } from './server-logger.service'
import { AuditDeliveryService } from './audit-delivery.service'

@Global()
@Module({
  providers: [AuditDeliveryService, AuditLoggerService, ServerLoggerService],
  exports: [AuditLoggerService, ServerLoggerService],
})
export class LoggingModule {}
