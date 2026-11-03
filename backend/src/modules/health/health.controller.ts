import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common'
import { execFile } from 'node:child_process'
import { SupabaseService } from '../../core/database/supabase.service'
import { FileConstraintStoreService } from '../timetable/solver/file-constraint-store.service'

@Controller('api/health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name)
  private lastCheck?: { expires: number; result: Record<string, unknown>; ready: boolean }
  private pending?: Promise<{ result: Record<string, unknown>; ready: boolean }>
  private solverAvailable = false
  private lastSolverError?: string
  constructor(private readonly supabase: SupabaseService) {}

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

  private async checkSolver(): Promise<boolean> {
    // Installed dependencies and repository rules are immutable for this process.
    // Cache success, but retry a failed cold-start check on the next readiness cycle.
    if (this.solverAvailable) return true
    const binary = process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3')
    const failure = await new Promise<string | null>((resolve) => {
      execFile(binary, ['-c', 'from ortools.sat.python import cp_model'],
        { timeout: 30000, windowsHide: true }, (error, _stdout, stderr) => {
          resolve(error ? (stderr.trim() || error.message).slice(0, 1500) : null)
        })
    })
    let detail = failure
    if (!detail) {
      try { new FileConstraintStoreService().getBaseConstraints() }
      catch (error) { detail = error instanceof Error ? error.message : 'Repository scheduling rules could not be loaded' }
    }
    if (detail) {
      if (detail !== this.lastSolverError) this.logger.warn(`Timetable runtime readiness failed (${binary}): ${detail}`)
      this.lastSolverError = detail
      return false
    }
    if (this.lastSolverError) this.logger.log('Timetable runtime readiness recovered')
    this.lastSolverError = undefined
    this.solverAvailable = true
    return true
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.admin.rpc('production_readiness')
      return !error && data?.ready === true && data?.schema?.version === 1 && data?.schema?.compatible === true
    } catch { return false }
  }

  private async checkWorker(): Promise<boolean> {
    try { const { data, error } = await this.supabase.admin.rpc('review_worker_health'); return !error && data === true }
    catch { return false }
  }

  private async checkDependencies() {
    const [database, solverAndRules, worker] = await Promise.all([this.checkDatabase(), this.checkSolver(), this.checkWorker()])
    const ready = database && solverAndRules && worker
    return { ready, result: { status: ready ? 'ready' : 'unavailable', database, solverAndRules, worker,
      rateLimiter: process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? 'shared-with-local-fallback' : 'single-process',
      authenticationProvider: 'checked-on-authentication-requests' } }
  }
}
