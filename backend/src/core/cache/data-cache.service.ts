import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Redis } from '@upstash/redis'
import { createHash, randomUUID } from 'node:crypto'
const READ = `if redis.call('GET',KEYS[4])~=ARGV[3] then return nil end
local raw=redis.call('HGET',KEYS[1],ARGV[1]); if not raw then return nil end
local entry=cjson.decode(raw)
for tag,version in pairs(entry.versions) do
 if (redis.call('HGET',KEYS[2],tag) or '0')~=version then return nil end
end
redis.call('ZADD',KEYS[3],ARGV[2],ARGV[1]); return entry.payload`
const WRITE = `if redis.call('GET',KEYS[6])~=ARGV[5] then return 0 end
local versions=cjson.decode(ARGV[2])
for tag,version in pairs(versions) do if (redis.call('HGET',KEYS[2],tag) or '0')~=version then return 0 end end
local previous=tonumber(redis.call('HGET',KEYS[4],ARGV[1]) or '0')
local size=string.len(ARGV[3]); local bytes=tonumber(redis.call('GET',KEYS[5]) or '0')-previous+size
redis.call('HSET',KEYS[1],ARGV[1],ARGV[3]); redis.call('HSET',KEYS[4],ARGV[1],size)
redis.call('ZADD',KEYS[3],ARGV[4],ARGV[1])
while redis.call('ZCARD',KEYS[3])>512 or bytes>33554432 do
 local oldest=redis.call('ZRANGE',KEYS[3],0,0)[1]; if not oldest then break end
 bytes=bytes-tonumber(redis.call('HGET',KEYS[4],oldest) or '0')
 redis.call('ZREM',KEYS[3],oldest); redis.call('HDEL',KEYS[1],oldest); redis.call('HDEL',KEYS[4],oldest)
end
redis.call('SET',KEYS[5],bytes); return 1`
const INVALIDATE = `for _,tag in ipairs(ARGV) do redis.call('HINCRBY',KEYS[1],tag,1) end return 1`
const ROTATE = `local old=redis.call('GET',KEYS[1])
redis.call('SET',KEYS[1],ARGV[2])
if old then for _,suffix in ipairs({'entries','versions','lru','sizes','bytes'}) do
 redis.call('DEL',ARGV[1]..':'..old..':'..suffix)
end end
return 1`
@Injectable()
export class DataCacheService {
  private readonly logger = new Logger(DataCacheService.name)
  private readonly redis?: Redis
  private readonly prefix: string
  private recoveryRequired = false
  private readonly pending = new Map<string, Promise<unknown>>()
  constructor(config: ConfigService) {
    const url = config.get<string>('UPSTASH_REDIS_REST_URL'), token = config.get<string>('UPSTASH_REDIS_REST_TOKEN')
    this.prefix = 'fyimp:data:v1:' + createHash('sha256').update(config.get<string>('SUPABASE_URL') || 'local').digest('hex').slice(0, 16)
    if (url && token && !url.includes('dummy')) this.redis = new Redis({ url, token, automaticDeserialization: false,
      retry: false, signal: () => AbortSignal.timeout(2000) })
  }
  private async namespace(): Promise<string> {
    if (!this.redis) return ''
    if (this.recoveryRequired) {
      await this.redis.eval(ROTATE, [this.prefix + ':epoch'], [this.prefix, randomUUID()])
      this.recoveryRequired = false
    }
    await this.redis.set(this.prefix + ':epoch', randomUUID(), { nx: true })
    return this.prefix + ':' + await this.redis.get<string>(this.prefix + ':epoch')
  }
  private failure() {
    if (!this.recoveryRequired) this.logger.warn('Data cache unavailable; using authoritative reads until cache namespace recovery.')
    this.recoveryRequired = true
  }
  async invalidate(tags: readonly string[]): Promise<void> {
    if (!this.redis || !tags.length) return
    try { const base = await this.namespace(); await this.redis.eval(INVALIDATE, [base + ':versions'], [...new Set(tags)]) }
    catch { this.failure() }
  }
  async get<T>(key: string, tags: readonly string[], load: () => Promise<T>, force = false): Promise<T> {
    if (!this.redis || !tags.length) return load()
    let base: string, versions: Record<string, string>, hash: string
    try {
      base = await this.namespace()
      const values = await this.redis.hmget<Record<string, string | null>>(base + ':versions', ...tags)
      versions = Object.fromEntries(tags.map(tag => [tag, String(values?.[tag] ?? '0')]))
      hash = createHash('sha256').update(key).digest('hex')
      if (!force) {
        const hit = await this.redis.eval<string[], string | null>(READ,
          [base + ':entries', base + ':versions', base + ':lru', this.prefix + ':epoch'], [hash, String(Date.now()), base.slice(this.prefix.length + 1)])
        if (hit != null) return JSON.parse(hit) as T
      }
    } catch { this.failure(); return load() }
    const pendingKey = base + hash + JSON.stringify(versions)
    if (!force && this.pending.has(pendingKey)) return this.pending.get(pendingKey) as Promise<T>
    const operation = (async () => {
      const value = await load()
      const payload = JSON.stringify(value), entry = JSON.stringify({ versions, payload })
      if (Buffer.byteLength(entry) <= 1048576) {
        try { await this.redis!.eval(WRITE, [base + ':entries', base + ':versions', base + ':lru', base + ':sizes', base + ':bytes', this.prefix + ':epoch'],
          [hash, JSON.stringify(versions), entry, String(Date.now()), base.slice(this.prefix.length + 1)]) } catch { this.failure() }
      }
      return value
    })()
    this.pending.set(pendingKey, operation)
    try { return await operation } finally { if (this.pending.get(pendingKey) === operation) this.pending.delete(pendingKey) }
  }
}
