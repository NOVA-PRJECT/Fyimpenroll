import { Injectable, Logger } from '@nestjs/common'
import { SupabaseService } from '../database/supabase.service'

@Injectable()
export class ServerLoggerService {
  private readonly logger = new Logger(ServerLoggerService.name)

  constructor(private readonly supabase: SupabaseService) {}

  async logServerError(
    route: string,
    error: unknown,
    context?: { userId?: string; method?: string; body?: unknown; [key: string]: unknown },
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined

    this.logger.error(`[${route}] ${errorMessage}`, errorStack)

    try {
      const { error: dbError } = await this.supabase.admin.from('system_logs').insert({
        log_type: 'server_error',
        status: 'failure',
        route,
        error_message: errorMessage,
        error_stack: errorStack ?? null,
        user_id: context?.userId ?? null,
        metadata: context ?? null,
      })

      if (dbError) {
        // Fallback to legacy server_error_logs table
        await this.supabase.admin.from('server_error_logs').insert({
          route,
          error_message: errorMessage,
          error_stack: errorStack ?? null,
          user_id: context?.userId ?? null,
          context: context ?? null,
        })
      }
    } catch {
      // Fire-and-forget: do not let logging failure crash the request
    }
  }

  error(message: string, context?: string): void {
    this.logger.error(message, context)
  }

  warn(message: string, context?: string): void {
    this.logger.warn(message, context)
  }

  log(message: string, context?: string): void {
    this.logger.log(message, context)
  }
}
