import { CreditLedgerModule } from '../credit-ledger/credit-ledger.module'
import { Module } from '@nestjs/common'
import { HodService } from './hod.service'
import { HodController } from './hod.controller'
import { AuthCoreModule } from '../../core/auth/auth-core.module'

@Module({
  imports: [AuthCoreModule, CreditLedgerModule],
  controllers: [HodController],
  providers: [HodService],
  exports: [HodService],
})
export class HodModule {}
