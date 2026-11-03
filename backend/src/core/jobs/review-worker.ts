import { readContext } from '../cache/read-context'
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { SupabaseService } from '../database/supabase.service'
import { AllocationService } from '../../modules/allocation/allocation.service'
import { runGenerationJob } from '../../modules/timetable/solver/job'
import { getRedisClient } from '../../modules/timetable/solver/redisClient'

@Injectable()
export class ReviewWorker implements OnModuleDestroy {
  private readonly logger = new Logger(ReviewWorker.name)
  private stopped = false
  private controller?: AbortController
  private running?: Promise<void>
  constructor(private readonly supabase: SupabaseService, private readonly allocation: AllocationService) {}
  stop() { this.stopped = true; this.controller?.abort() }
  onModuleDestroy() { this.stop(); return this.running }
  run() {
    return this.running ??= this.poll()
  }
  private async poll() {
    const loop = async (work: () => Promise<void>) => {
      while (!this.stopped) {
        try { await work() } catch (error) { this.logger.error(error instanceof Error ? error.message : String(error)) }
        if (!this.stopped) await new Promise(resolve => setTimeout(resolve, 5000))
      }
    }
    await Promise.all([loop(() => this.expensiveWork()), loop(() => this.cleanupAccounts())])
  }
  async cleanupAccounts() {
    const { data: tasks, error } = await this.supabase.admin.rpc('claim_auth_cleanup')
    if (error) throw new Error(`Cleanup claim failed: ${error.message}`)
    await Promise.all((tasks || []).map(async task => {
      let failure: string | null = null
      try {
        const { error } = await this.supabase.admin.auth.admin.deleteUser(task.user_id)
        if (error && error.status !== 404 && error.code !== 'user_not_found') failure = error.message
      } catch (error) { failure = error instanceof Error ? error.message : 'Auth deletion failed' }
      const { error: acknowledgement } = await this.supabase.admin.rpc('finish_auth_cleanup', {
        p_id: task.id, p_fence: task.fence, p_error: failure,
      })
      if (acknowledgement) this.logger.warn(`Cleanup acknowledgement failed; lease will retry: ${acknowledgement.message}`)
    }))
  }
  async expensiveWork() {
    const { data: job, error } = await this.supabase.admin.rpc('claim_review_job')
    if (error) throw new Error(`Worker claim failed: ${error.message}`)
    if (!job || this.stopped) return
    const controller = this.controller = new AbortController()
    let renewing = false
    const heartbeat = setInterval(async () => {
      if (renewing) return
      renewing = true
      try {
        const { data, error } = await this.supabase.admin.rpc('renew_review_job', { p_id: job.id, p_fence: job.fence })
        if (error || data !== true) controller.abort()
      } catch { controller.abort() } finally { renewing = false }
    }, 15000)
    let failure: string | null = null
    try {
      const user = { userId: job.actor_id, email: '', role: 'campus_director' as const, campus_id: job.campus_id, term_version: job.term_version }
      await readContext.run({ scope: 'worker:' + job.id, actorId: job.actor_id, force: false, cacheReferences: false, pending: new Map() }, async () => {
        if (job.kind === 'allocation') {
          await this.allocation.runAllocation({ academicYear: job.academic_year, semester: job.semester }, user, { runId: job.id, fencingToken: job.fence })
        } else {
          await runGenerationJob(job.id, job.academic_year, job.semester, job.actor_id, this.supabase.admin,
            getRedisClient(), job.campus_id, job.payload.dynamicConstraints || [], job.payload.rules ? { rules: job.payload.rules } : undefined,
            job.fence, job.term_version, controller.signal)
        }
      })
      if (controller.signal.aborted) failure = 'Worker stopped or claim lost'
    } catch (error) { failure = error instanceof Error ? error.message : 'Worker failed' }
    finally { clearInterval(heartbeat); this.controller = undefined }
    if (this.stopped) return // The next process reconciles committed work or reclaims the expired lease.
    const { error: finishError } = await this.supabase.admin.rpc('finish_review_job', { p_id: job.id, p_fence: job.fence, p_error: failure })
    if (finishError) this.logger.warn(`Worker completion acknowledgement failed: ${finishError.message}`)
  }
}
