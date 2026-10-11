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
  expect((await apiFetch('/api/a')).status).toBe(401);expect(fetch).toHaveBeenCalledTimes(2)
})
