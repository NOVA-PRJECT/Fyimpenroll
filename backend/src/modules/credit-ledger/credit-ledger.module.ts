import { Module } from '@nestjs/common'
import { DatabaseModule } from '../../core/database/database.module'
import { SecurityModule } from '../../core/security/security.module'
import { CreditLedgerService } from './credit-ledger.service'
import { CreditLedgerController } from './credit-ledger.controller'
import { ExportService } from './export.service'
import { ExportController } from './export.controller'

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [CreditLedgerController, ExportController],
  providers: [CreditLedgerService, ExportService],
  exports: [CreditLedgerService, ExportService],
})
export class CreditLedgerModule {}
