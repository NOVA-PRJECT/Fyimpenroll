import { Module } from '@nestjs/common'
import { RegistrationsService } from './registrations.service'
import { RegistrationsController } from './registrations.controller'
import { AuthCoreModule } from '../../core/auth/auth-core.module'

@Module({
  imports: [AuthCoreModule],
  controllers: [RegistrationsController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
