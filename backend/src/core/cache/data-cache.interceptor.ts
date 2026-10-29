import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { defer, lastValueFrom, Observable } from 'rxjs'
import { canonicalDataUrl, dataReadDomains, dataChangeDomains, projectReadData } from '@fyimp/contracts'
import { DataCacheService } from './data-cache.service'
import { readContext } from './read-context'
@Injectable()
export class DataCacheInterceptor implements NestInterceptor {
  constructor(private readonly cache: DataCacheService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest(), res = context.switchToHttp().getResponse(), user = req.user
    if (!user) return next.handle()
    const path = canonicalDataUrl(req.originalUrl || req.url)
    const scope = [user.userId, user.role, user.campus_id, user.department_id, user.current_semester, user.term_version].join(':')
    res.setHeader('X-Data-Scope', scope)
    const domains = req.method === 'GET' ? dataReadDomains(path) : []
    if (/\/progress(?:\?|$)|\/export(?:\/|-)/.test(path)) return next.handle()
    return defer(() => readContext.run({ force: req.headers['x-refresh-data'] === '1', scope, cacheReferences: req.method === 'GET',
      verifiedCampusSettings: req.method === 'GET' ? user.verifiedCampusSettings : undefined, pending: new Map() }, async () => {
      const load = () => lastValueFrom(next.handle())
      if (req.method !== 'GET') {
        const result = await load()
        if (path !== '/api/timetable/manual/preview') await this.cache.invalidate(dataChangeDomains(path))
        return result
      }
      if (readContext.getStore()!.force) await this.cache.invalidate(domains)
      if (!domains.length) return load()
      const result = await this.cache.get(scope + ':' + path, domains,
        async () => ({ value: await load(), updatedAt: Date.now() }), readContext.getStore()!.force)
      res.setHeader('X-Data-Updated-At', String(result.updatedAt))
      return projectReadData(path, result.value)
    }))
  }
}
