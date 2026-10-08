import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard } from '../../core/auth/guards/auth.guard'
import { RolesGuard } from '../../core/auth/guards/roles.guard'
import { Roles } from '../../core/auth/decorators/roles.decorator'
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator'
import { AuthUser } from '../../core/auth/types'
import { CreditLedgerService } from './credit-ledger.service'

@Controller('api/credit-ledger')
@UseGuards(AuthGuard, RolesGuard)
export class CreditLedgerController {
  constructor(private readonly creditLedgerService: CreditLedgerService) {}

  /**
   * Endpoint for logged-in students to fetch their own credit ledger.
   */
  @Get('me')
  @Roles('student')
  async getMyLedger(@CurrentUser() user: AuthUser) {
    return this.creditLedgerService.getCreditLedger(user.userId, user)
  }

  /**
   * Parameterized endpoint for students (own ID) or Faculty Advisors / HODs / Admins.
   * Access scoping is enforced inside CreditLedgerService.
   */
  @Get(':studentId')
  @Roles('student', 'teacher', 'hod', 'campus_director', 'superadmin')
  async getStudentLedger(
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthUser
  ) {
    const targetId = studentId === 'me' ? user.userId : studentId
    return this.creditLedgerService.getCreditLedger(targetId, user)
  }
}
