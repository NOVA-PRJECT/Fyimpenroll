import { QueryClient, isCancelledError, type Query } from '@tanstack/react-query'
import { canonicalDataUrl, dataReadDomains, dataChangeDomains, type DataDomain } from '@fyimp/contracts'

export const dataClient = new QueryClient({ defaultOptions: { queries: {
  staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false,
  refetchOnReconnect: false, refetchInterval: false,
}, mutations: { retry: false } } })
interface StoredResponse { body: string; status: number; headers: [string, string][] }
class ResponseFailure { constructor(readonly response: StoredResponse) {} }
let epoch = 0
let scope = 'session'
const fresh = new Set<string>()
const domainsOf = (query: Query) => (query.meta?.domains || []) as DataDomain[]
const matches = (domains: readonly string[]) => (query: Query) => domainsOf(query).some(domain => domains.includes(domain))
const makeResponse = (value: StoredResponse) => new Response(value.body, { status: value.status, headers: value.headers })

export function clearDataCache() { epoch++; scope = 'session'; fresh.clear(); dataClient.clear() }
export function cachedData<T>(endpoint: string): T | undefined {
  const query = dataClient.getQueryCache().find({ queryKey: ['data', epoch, scope, canonicalDataUrl(endpoint)], exact: true })
  const value = query?.state.data as StoredResponse | undefined
  try { return value ? JSON.parse(value.body) as T : undefined } catch { return undefined }
}
export function primeData(endpoint: string, value: unknown) {
  const url = canonicalDataUrl(endpoint), domains = dataReadDomains(url)
  if (!domains.length) return
  dataClient.setQueryDefaults(['data', epoch, scope, url], { meta: { domains } })
  dataClient.setQueryData(['data', epoch, scope, url], { body: JSON.stringify(value), status: 200, headers: [['content-type', 'application/json']] })
}
export async function invalidateData(domains: readonly DataDomain[]) {
  if (!domains.length) return
  const predicate = matches(domains)
  await dataClient.cancelQueries({ predicate })
  await dataClient.invalidateQueries({ predicate, refetchType: 'none' })
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('fyimp:data-change', { detail: [...domains] }))
}
/** Refresh only the explicitly selected URLs. Never loads another tab or filter. */
export async function refreshDatasets(endpoints: readonly string[], reload: () => unknown | Promise<unknown>) {
  const urls = new Set(endpoints.map(canonicalDataUrl))
  const predicate = (query: Query) => query.queryKey[0] === 'data' && urls.has(String(query.queryKey[3]))
  for (const url of urls) fresh.add(url)
  await dataClient.cancelQueries({ predicate })
  await dataClient.invalidateQueries({ predicate, refetchType: 'none' })
  await reload()
}

/** One transport cache for legacy fetch consumers and query hooks; credentials never enter a key. */
export async function cachedDataFetch(input: RequestInfo | URL, init: RequestInit | undefined,
  network: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): Promise<Response> {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url
  const parsed = new URL(raw, window.location.origin)
  if (parsed.origin !== window.location.origin) return network(input, init)
  const url = canonicalDataUrl(parsed.href)
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (/\/auth\/(login|logout|complete-password-reset)$/.test(parsed.pathname) && method !== 'GET') clearDataCache()
  if (method !== 'GET') {
    const response = await network(input, init)
    if (response.ok && parsed.pathname !== '/api/timetable/manual/preview') {
      await invalidateData(dataChangeDomains(url))
    }
    return response
  }
  const domains = dataReadDomains(url)
  if (!domains.length || headers.has('Authorization') || init?.credentials === 'omit') return network(input, init)
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const key = ['data', epoch, scope, url] as const
  const currentEpoch = epoch
  const query = dataClient.getQueryCache().find({ queryKey: key, exact: true })
  const force = headers.get('X-Refresh-Data') === '1' || fresh.has(url)
  if (force) fresh.delete(url)
  if (force && query) { await dataClient.cancelQueries({ queryKey: key, exact: true }); await dataClient.invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' }) }
  const request = dataClient.fetchQuery<StoredResponse>({ queryKey: key, meta: { domains }, queryFn: async ({ signal }) => {
    if (force) headers.set('X-Refresh-Data', '1')
    const response = await network(url, { ...init, headers, signal })
    const result = { body: await response.text(), status: response.status, headers: [...response.headers.entries()] as [string, string][] }
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new ResponseFailure(result)
    if (currentEpoch !== epoch) throw new DOMException('Session changed', 'AbortError')
    return result
  } }).then(value => {
    if (currentEpoch !== epoch) throw new DOMException('Session changed', 'AbortError')
    return makeResponse(value)
  }).catch(error => {
    if (isCancelledError(error)) throw new DOMException('Request superseded', 'AbortError')
    if (error instanceof ResponseFailure) {
      if (error.response.status === 401) clearDataCache()
      return makeResponse(error.response)
    }
    throw error
  })
  if (!init?.signal) return request
  const signal = init.signal
  return new Promise<Response>((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    request.then(value => { signal.removeEventListener('abort', abort); signal.aborted ? abort() : resolve(value) }, error => {
      signal.removeEventListener('abort', abort); reject(error)
    })
  })
}
