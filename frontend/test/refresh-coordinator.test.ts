import { afterEach, expect, test, vi } from 'vitest'
import { apiFetch, coordinateRefresh, invalidateRefreshSession } from '../src/core/security/refresh-coordinator'
afterEach(() => { invalidateRefreshSession(); vi.unstubAllGlobals() })
test('parallel expired reads share one refresh and retry once', async () => {
  let reads=0, refreshes=0
  vi.stubGlobal('fetch',vi.fn(async (url: RequestInfo | URL) => {
    if(url==='/api/auth/refresh'){ refreshes++; await Promise.resolve(); return new Response('{}',{status:200}) }
    reads++; return new Response('{}',{status:reads<=2?401:200})
  }))
  const results=await Promise.all([apiFetch('/api/a'),apiFetch('/api/b')])
  expect(results.map(r=>r.status)).toEqual([200,200]);expect(refreshes).toBe(1);expect(reads).toBe(4)
})
test('Request-object POST is never silently replayed',async()=>{
  const fetch=vi.fn(async()=>new Response('{}',{status:401}));vi.stubGlobal('fetch',fetch)
  await apiFetch(new Request('https://portal.test/api/submit',{method:'POST'}))
  expect(fetch).toHaveBeenCalledTimes(1)
})
test('logout invalidates a pending refresh result',async()=>{
  let finish!: (r: Response)=>void
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve})))
  const pending=coordinateRefresh();invalidateRefreshSession();finish(new Response('{}',{status:200}))
  expect((await pending).success).toBe(false)
})
test('provider outages remain recoverable without replaying the request',async()=>{
  const fetch=vi.fn(async(url:RequestInfo|URL)=>new Response('{}',{status:url==='/api/auth/refresh'?503:401}))
  vi.stubGlobal('fetch',fetch)
  expect((await apiFetch('/api/a')).status).toBe(503);expect(fetch).toHaveBeenCalledTimes(2)
})

const rejected = () => Response.json({ message: 'Authentication token missing', code: 'AUTH_SESSION_REJECTED' }, { status: 401 })

test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('guard-rejected %s renews cookies and executes the operation once', async (method) => {
  let attempts = 0, executed = 0
  const fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (url === '/api/auth/refresh') return Response.json({ success: true })
    if (++attempts === 1) return rejected()
    executed++
    return Response.json({ status: 'queued' })
  })
  vi.stubGlobal('fetch', fetch)
  expect((await apiFetch('/api/timetable/generate', { method, body: '{}' })).status).toBe(200)
  expect(executed).toBe(1)
  expect(fetch).toHaveBeenCalledTimes(3)
})

test('a consumed Request body is preserved when the guard rejects generation', async () => {
  const bodies: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (input === '/api/auth/refresh') return Response.json({})
    bodies.push(await (input as Request).text())
    return bodies.length === 1 ? rejected() : Response.json({ status: 'queued' })
  }))
  const request = new Request('https://portal.test/api/timetable/generate', { method: 'POST', body: '{"semester":1}' })
  expect((await apiFetch(request)).status).toBe(200)
  expect(bodies).toEqual(['{"semester":1}', '{"semester":1}'])
})

test('a second rejection is returned without a retry loop', async () => {
  const fetch = vi.fn(async (url: RequestInfo | URL) => url === '/api/auth/refresh' ? Response.json({}) : rejected())
  vi.stubGlobal('fetch', fetch)
  expect((await apiFetch('/api/timetable/generate', { method: 'POST' })).status).toBe(401)
  expect(fetch).toHaveBeenCalledTimes(3)
})

test('a revoked refresh session does not replay generation and explains the sign-in requirement', async () => {
  const fetch = vi.fn(async (url: RequestInfo | URL) => url === '/api/auth/refresh' ? Response.json({}, { status: 401 }) : rejected())
  vi.stubGlobal('fetch', fetch)
  const response = await apiFetch('/api/timetable/generate', { method: 'POST' })
  expect(response.status).toBe(401)
  expect((await response.json()).message).toContain('sign in again')
  expect(fetch).toHaveBeenCalledTimes(2)
})

test('generation and progress polling share a refresh during access expiry', async () => {
  let renewed = false, refreshes = 0, generationRuns = 0
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    if (url === '/api/auth/refresh') { refreshes++; await Promise.resolve(); renewed = true; return Response.json({}) }
    if (!renewed) return rejected()
    if (url === '/api/timetable/generate') generationRuns++
    return Response.json({ status: 'running' })
  }))
  const results = await Promise.all([apiFetch('/api/timetable/generate', { method: 'POST' }), apiFetch('/api/timetable/job-status')])
  expect(results.map(r => r.status)).toEqual([200, 200])
  expect(refreshes).toBe(1)
  expect(generationRuns).toBe(1)
})

test('a late unauthorized response uses renewed cookies without rotating them again', async () => {
  let release!: (response: Response) => void, lateReads = 0, fastReads = 0, refreshes = 0
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
    if (url === '/api/auth/refresh') { refreshes++; return Response.json({}) }
    if (url === '/api/late' && ++lateReads === 1) return new Promise<Response>(resolve => { release = resolve })
    if (url === '/api/fast' && ++fastReads === 1) return rejected()
    return Response.json({})
  }))
  const late = apiFetch('/api/late')
  expect((await apiFetch('/api/fast')).status).toBe(200)
  release(rejected())
  expect((await late).status).toBe(200)
  expect(refreshes).toBe(1)
})

test('a request rejected after logout cannot start a new refresh', async () => {
  let release!: (response: Response) => void
  const fetch = vi.fn(() => new Promise<Response>(resolve => { release = resolve }))
  vi.stubGlobal('fetch', fetch)
  const pending = apiFetch('/api/timetable/generate', { method: 'POST' })
  invalidateRefreshSession()
  release(rejected())
  expect((await pending).status).toBe(401)
  expect(fetch).toHaveBeenCalledOnce()
})

test('network errors and ambiguous server failures never replay generation', async () => {
  const fetch = vi.fn(async (): Promise<Response> => { throw new TypeError('fetch failed') })
  vi.stubGlobal('fetch', fetch)
  await expect(apiFetch('/api/timetable/generate', { method: 'POST' })).rejects.toThrow('fetch failed')
  expect(fetch).toHaveBeenCalledOnce()
  fetch.mockReset().mockResolvedValue(Response.json({}, { status: 503 }))
  expect((await apiFetch('/api/timetable/generate', { method: 'POST' })).status).toBe(503)
  expect(fetch).toHaveBeenCalledOnce()
})

test.each([429, 503, 'network'])('refresh outage %s stays recoverable and never starts generation', async (failure) => {
  const fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (url !== '/api/auth/refresh') return rejected()
    if (failure === 'network') throw new TypeError('fetch failed')
    return Response.json({}, { status: failure as number })
  })
  vi.stubGlobal('fetch', fetch)
  const response = await apiFetch('/api/timetable/generate', { method: 'POST' })
  expect(response.status).toBe(503)
  expect((await response.json()).message).toContain('Please retry')
  expect(fetch).toHaveBeenCalledTimes(2)
})

test('logout during renewal prevents replaying a generation request', async () => {
  let finish!: (response: Response) => void
  const fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (url === '/api/auth/refresh') return new Promise<Response>(resolve => { finish = resolve })
    return rejected()
  })
  vi.stubGlobal('fetch', fetch)
  const pending = apiFetch('/api/timetable/generate', { method: 'POST' })
  await vi.waitFor(() => expect(finish).toBeDefined())
  invalidateRefreshSession()
  finish(Response.json({}))
  expect((await pending).status).toBe(401)
  expect(fetch).toHaveBeenCalledTimes(2)
})
