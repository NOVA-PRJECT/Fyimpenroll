import { databaseChangeDomains } from '@fyimp/contracts'
import { DataCacheService } from './data-cache.service'
import { readContext, requestOnce } from './read-context'
interface StoredResponse { body: string; status: number; headers: [string, string][] }
class UncachedResponse { constructor(readonly response: StoredResponse) {} }
export function databaseFetch(native: typeof fetch, cache?: DataCacheService): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const name = url.pathname.split('/').pop() || '', rest = url.pathname.startsWith('/rest/v1/'), context = readContext.getStore()
    const load = async (): Promise<StoredResponse> => {
      const response = await native(input, init)
      const result = { body: await response.text(), status: response.status, headers: [...response.headers.entries()] as [string, string][] }
      if (!response.ok) throw new UncachedResponse(result)
      return result
    }
    try {
      let result: StoredResponse
      if (rest && method === 'GET' && context) {
        const headers = new Headers(init?.headers)
        const verified = context.verifiedCampusSettings
        const columns = (url.searchParams.get('select') || '').split(',')
        if (name === 'campus_settings' && verified && columns.every(column => Object.prototype.hasOwnProperty.call(verified, column)) &&
          url.searchParams.get('campus_id') === 'eq.' + verified.campus_id &&
          [...url.searchParams.keys()].every(key => ['select', 'campus_id'].includes(key)) &&
          !headers.has('range') && !headers.has('prefer')) {
          const row = Object.fromEntries(columns.map(column => [column, verified[column]]))
          return Response.json(headers.get('accept')?.includes('vnd.pgrst.object') ? row : [row])
        }
        const key = url.toString() + ':' + (headers.get('range') || '') + ':' + (headers.get('prefer') || '')
        const tags = /^(courses|departments|semester_blueprints|time_slots)$/.test(name) ? ['catalogue'] : name === 'campuses' ? ['settings'] : []
        result = await requestOnce(key, () => cache && tags.length && context.cacheReferences
          ? cache.get(context.scope + ':reference:' + key, tags, load, context.force) : load())
      } else {
        result = await load()
        if (rest && !['GET', 'HEAD', 'OPTIONS'].includes(method)) context?.pending.clear()
        if (cache && rest && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
          let operation = name
          if (name === 'run_current_term_operation' && typeof init?.body === 'string') {
            try { operation = JSON.parse(init.body).p_operation || name } catch {}
          }
          await cache.invalidate(databaseChangeDomains(operation))
        }
      }
      return new Response(result.status === 204 ? null : result.body, { status: result.status, headers: result.headers })
    } catch (error) {
      if (error instanceof UncachedResponse) return new Response(error.response.body, { status: error.response.status, headers: error.response.headers })
      throw error
    }
  }
}
