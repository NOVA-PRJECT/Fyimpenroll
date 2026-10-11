import { afterEach, expect, test, vi } from 'vitest'
import { clearSessionStorage, navigateAfterSessionChange } from '../src/core/security/session-navigation'
afterEach(() => vi.unstubAllGlobals())

test('logout clears session data while retaining only campus browser rules', () => {
  const local: Record<string, unknown> = { 'fyimp:rules:campus-a': '[{"id":"rule"}]', access_token: 'old', portal_cache: 'old' }
  Object.defineProperty(local, 'removeItem', { value: (key: string) => { delete local[key] } })
  const clear = vi.fn()
  vi.stubGlobal('localStorage', local)
  vi.stubGlobal('sessionStorage', { clear })
  clearSessionStorage()
  expect(clear).toHaveBeenCalledOnce()
  expect(Object.keys(local)).toEqual(['fyimp:rules:campus-a'])
})

test('session navigation reloads the portal and rejects external destinations', () => {
  const assign = vi.fn()
  vi.stubGlobal('window', { location: { origin: 'https://portal.test', assign } })
  navigateAfterSessionChange('/login')
  expect(assign).toHaveBeenCalledWith('https://portal.test/login')
  expect(() => navigateAfterSessionChange('https://external.test')).toThrow('Invalid portal destination')
  expect(assign).toHaveBeenCalledOnce()
})
