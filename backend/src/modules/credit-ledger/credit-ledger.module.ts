import { Module } from '@nestjs/common'
import { DatabaseModule } from '../../core/database/database.module'
import { SecurityModule } from '../../core/security/security.module'
import { CreditLedgerService } from './credit-ledger.service'
import { CreditLedgerController } from './credit-ledger.controller'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [CreditLedgerController],
  providers: [CreditLedgerService],
  exports: [CreditLedgerService],
})
export class CreditLedgerModule {}
