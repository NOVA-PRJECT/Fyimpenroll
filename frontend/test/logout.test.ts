import { afterEach, expect, test, vi } from 'vitest'
import { logoutPortal } from '../src/core/security/logout'
import { coordinateRefresh, resumeSessionAfterLogoutFailure } from '../src/core/security/refresh-coordinator'

afterEach(() => { vi.useRealTimers();vi.unstubAllGlobals();resumeSessionAfterLogoutFailure() })
function browser() {
  const assign=vi.fn(),alert=vi.fn(),clear=vi.fn()
  vi.stubGlobal('window',{location:{origin:'https://portal.test',assign},alert})
  vi.stubGlobal('sessionStorage',{clear});vi.stubGlobal('localStorage',{})
  return {assign,alert,clear}
}
test('concurrent logout clicks share one revocation and block background renewal',async()=>{
  const {assign,clear}=browser();let finish!: (value:Response)=>void
  const fetch=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve}));vi.stubGlobal('fetch',fetch)
  const a=logoutPortal(),b=logoutPortal();expect(a).toBe(b)
  expect((await coordinateRefresh()).success).toBe(false);expect(fetch).toHaveBeenCalledOnce()
  finish(Response.json({success:true,revoked:true}));expect(await a).toBe(true)
  expect(clear).toHaveBeenCalledOnce();expect(assign).toHaveBeenCalledWith('https://portal.test/login')
})
test('unconfirmed server revocation is distinguished from confirmed browser cookie cleanup',async()=>{
  const {assign}=browser();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({success:true,revoked:false})))
  expect(await logoutPortal()).toBe(true)
  expect(decodeURIComponent(assign.mock.calls[0][0])).toContain('Server session revocation could not be confirmed')
})
test('network failure leaves navigation alone and permits retry',async()=>{
  const {assign,alert}=browser();const fetch=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(Response.json({success:true,revoked:true}));vi.stubGlobal('fetch',fetch)
  expect(await logoutPortal()).toBe(false);expect(assign).not.toHaveBeenCalled();expect(alert).toHaveBeenCalledOnce()
  expect(await logoutPortal()).toBe(true)
})
test('a hung logout is aborted and releases the UI for another attempt',async()=>{
  vi.useFakeTimers();const {alert}=browser()
  vi.stubGlobal('fetch',vi.fn((_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted'))))))
  const pending=logoutPortal();await vi.advanceTimersByTimeAsync(12001)
  expect(await pending).toBe(false);expect(alert).toHaveBeenCalledOnce()
})
