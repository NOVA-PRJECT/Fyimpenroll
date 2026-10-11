import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { execFileSync } from 'node:child_process'
import { SupabaseService } from '../../core/database/supabase.service'
import { FileConstraintStoreService } from '../timetable/solver/file-constraint-store.service'

@Controller('api/health')
export class HealthController {
  private lastCheck?: { expires: number; result: Record<string, unknown>; ready: boolean }
  private pending?: Promise<{ result: Record<string, unknown>; ready: boolean }>
  private readonly solverAvailable: boolean
  constructor(private readonly supabase: SupabaseService) {
    try {
      execFileSync(process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', 'from ortools.sat.python import cp_model'], { timeout: 10000, stdio: 'ignore', windowsHide: true })
      new FileConstraintStoreService().getBaseConstraints()
      this.solverAvailable = true
    } catch { this.solverAvailable = false }
  }
  @Get()
  check() { return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() } }

  @Get('ready')
  async ready() {
    if (!this.lastCheck || this.lastCheck.expires <= Date.now()) {
      this.pending ??= this.checkDependencies().finally(() => { this.pending = undefined })
      const check = await this.pending
      this.lastCheck = { ...check, expires: Date.now() + 15000 }
    }
    if (!this.lastCheck.ready) throw new ServiceUnavailableException(this.lastCheck.result)
    return this.lastCheck.result
  }
  private async checkDependencies() {
    let database = false
    try {
      const { data, error } = await this.supabase.admin.rpc('production_readiness')
      database = !error && data?.ready === true
    } catch {}
    const ready = database && this.solverAvailable
    return { ready, result: { status: ready ? 'ready' : 'unavailable', database, solverAndRules: this.solverAvailable,
      rateLimiter: process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? 'shared-with-local-fallback' : 'single-process',
      authenticationProvider: 'checked-on-authentication-requests' } }
  }
}
