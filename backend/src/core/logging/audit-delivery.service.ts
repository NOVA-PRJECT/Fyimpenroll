import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Redis } from '@upstash/redis'
import { SupabaseService } from '../database/supabase.service'

const CLAIM = `
local messages = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 20)
for _, message in ipairs(messages) do
  redis.call('ZADD', KEYS[1], ARGV[2], message)
end
return messages`

/** Leased Redis messages survive restarts; UUID upserts make redelivery safe. */
@Injectable()
export class AuditDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditDeliveryService.name)
  private readonly redis: Redis | null
  private readonly key: string
  private readonly connection?: { url: string; token: string }
  private timer?: ReturnType<typeof setInterval>
  private pending?: Promise<void>

  constructor(private readonly supabase: SupabaseService, config: ConfigService) {
    const url = config.get<string>('UPSTASH_REDIS_REST_URL')
    const token = config.get<string>('UPSTASH_REDIS_REST_TOKEN')
    if (url && token && !url.includes('dummy')) this.connection = { url, token }
    this.key = `audit:delivery:${config.get<string>('SUPABASE_URL') || 'local'}`
    this.redis = url && token && !url.includes('dummy')
      ? new Redis({ url, token, automaticDeserialization: false, retry: false, signal: () => AbortSignal.timeout(2000) }) : null
  }

  async enqueue(payload: Record<string, unknown>, signal?: AbortSignal): Promise<boolean> {
    if (!this.redis) return false
    try {
      const client = signal && this.connection ? new Redis({ ...this.connection, automaticDeserialization: false, retry: false, signal: () => AbortSignal.any([signal, AbortSignal.timeout(1000)]) }) : this.redis
      await client.zadd(this.key, { nx: true }, { score: Date.now(), member: JSON.stringify(payload) })
      setImmediate(() => { void this.flush() })
      return true
    } catch {
      this.logger.warn('Audit queue unavailable; persisting synchronously.')
      return false
    }
  }

  onModuleInit() {
    if (!this.redis) return
    this.timer = setInterval(() => { void this.flush() }, 30000)
    this.timer.unref()
    void this.flush()
  }

  flush(): Promise<void> {
    if (this.pending) return this.pending
    this.pending = this.deliver().finally(() => { this.pending = undefined })
    return this.pending
  }

  private async deliver() {
    if (!this.redis) return
    try {
      const now = Date.now()
      const messages = await this.redis.eval<number[], string[]>(CLAIM, [this.key], [now, now + 60000])
      if (!messages.length) return
      const payloads = messages.map(message => JSON.parse(message))
      const { error } = await this.supabase.admin.from('system_logs')
        .upsert(payloads, { onConflict: 'id', ignoreDuplicates: true })
      if (error) throw error
      await this.redis.zrem(this.key, ...messages)
    } catch {
      // A crashed worker or failed write becomes retryable when its lease expires.
      this.logger.warn('Audit delivery failed; queued events remain available for retry.')
    }
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
    await this.pending
  }
}
