import { Module } from '@nestjs/common'
import { HodService } from './hod.service'
import { HodController } from './hod.controller'
import { AuthCoreModule } from '../../core/auth/auth-core.module'

@Module({
  imports: [AuthCoreModule],
  controllers: [HodController],
  providers: [HodService],
  exports: [HodService],
})
export class HodModule {}
