import { afterEach, expect, test, vi } from 'vitest'
import { saveDashboardEntry, takeDashboardEntry } from '../src/core/security/dashboard-entry'

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
const entry={path:'/dashboard/student',endpoint:'/api/student/dashboard-summary',data:{studentInfo:{full_name:'Student മലയാളം'}}}
function storage() {
  const values=new Map<string,string>()
  vi.stubGlobal('sessionStorage',{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)})
}
test('login dashboard data survives navigation and Unicode, and is consumed exactly once',()=>{
  storage();saveDashboardEntry(entry)
  expect(takeDashboardEntry(entry.path,entry.endpoint)?.data).toEqual(entry.data)
  expect(takeDashboardEntry(entry.path,entry.endpoint)).toBeNull()
})
test('old data cannot be replayed after another login, a different route or expiry',()=>{
  storage();saveDashboardEntry(entry);saveDashboardEntry(undefined)
  expect(takeDashboardEntry(entry.path,entry.endpoint)).toBeNull()
  saveDashboardEntry(entry);expect(takeDashboardEntry('/dashboard/hod',entry.endpoint)).toBeNull()
  expect(takeDashboardEntry(entry.path,entry.endpoint)).toBeNull()
  vi.useFakeTimers();saveDashboardEntry(entry);vi.advanceTimersByTime(60001)
  expect(takeDashboardEntry(entry.path,entry.endpoint)).toBeNull()
})
test('storage failures fall back to authenticated dashboard API requests',()=>{
  vi.stubGlobal('sessionStorage',{getItem:()=>{throw Error('blocked')},removeItem:()=>{throw Error('blocked')}})
  expect(()=>saveDashboardEntry(entry)).not.toThrow()
  expect(takeDashboardEntry(entry.path,entry.endpoint)).toBeNull()
})
