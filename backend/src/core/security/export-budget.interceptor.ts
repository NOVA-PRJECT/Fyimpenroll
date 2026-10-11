import { CallHandler, ExecutionContext, Injectable, NestInterceptor, ServiceUnavailableException } from '@nestjs/common'
import { finalize } from 'rxjs/operators'

/** Bound simultaneous in-memory workbook construction across all export controllers. */
@Injectable()
export class ExportBudgetInterceptor implements NestInterceptor {
  private static active = 0
  intercept(_context: ExecutionContext, next: CallHandler) {
    if (ExportBudgetInterceptor.active >= 2) throw new ServiceUnavailableException('Two reports are already running. Please retry shortly.')
    ExportBudgetInterceptor.active++
    return next.handle().pipe(finalize(() => { ExportBudgetInterceptor.active-- }))
  }
}
