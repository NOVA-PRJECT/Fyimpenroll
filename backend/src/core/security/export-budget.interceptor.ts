import { CallHandler, ExecutionContext, Injectable, NestInterceptor, ServiceUnavailableException } from '@nestjs/common'
import { defer } from 'rxjs'
import { finalize } from 'rxjs/operators'

@Injectable()
export class ExportBudgetInterceptor implements NestInterceptor {
  private static active = 0
  private static users = new Set<string>()
  intercept(context: ExecutionContext, next: CallHandler) {
    return defer(() => {
      const user = context.switchToHttp().getRequest().user?.userId || 'unknown'
      if (ExportBudgetInterceptor.active >= 2 || ExportBudgetInterceptor.users.has(user)) {
        throw new ServiceUnavailableException('Report capacity is busy. Wait for your current report and retry shortly.')
      }
      ExportBudgetInterceptor.active++; ExportBudgetInterceptor.users.add(user)
      const release = () => { ExportBudgetInterceptor.active--; ExportBudgetInterceptor.users.delete(user) }
      try { return next.handle().pipe(finalize(release)) } catch (error) { release(); throw error }
    })
  }
}
