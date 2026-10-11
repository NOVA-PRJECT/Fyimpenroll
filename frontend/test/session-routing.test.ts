import { afterEach, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../middleware'
import { sessionRedirect } from '../src/core/security/session-response'

afterEach(() => vi.unstubAllGlobals())
function request(path: string, cookie = 'auth_token=access') {
  return new NextRequest(`https://portal.test${path}`, { headers: { cookie } })
}
function session(role = 'student', accepted = true, restricted = false) {
  return Response.json({ role, must_change_password: restricted, consent: { accepted, currentVersion: 'current' } })
}

test('dashboard routing uses one lightweight session request, without loading a profile', async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) => { expect(String(input)).toContain("/api/auth/session"); return session() })
  vi.stubGlobal('fetch', fetch)
  const response = await middleware(request('/dashboard/student/register'))
  expect(response.headers.get('x-middleware-next')).toBe('1')
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch.mock.calls[0][0]).toContain('/api/auth/session')
})

test.each([
  ['/dashboard/director/timetable', 'student', true, false, '/dashboard/student'],
  ['/dashboard/student', 'student', false, false, '/consent'],
  ['/dashboard/student', 'student', false, true, '/change-password'],
  ['/login', 'teacher', true, true, '/change-password'],
  ['/consent', 'hod', true, false, '/dashboard/hod'],
  ['/dashboard/credit-ledger', 'teaching_staff', true, false, '/dashboard/teaching_staff'],
])('routing %s preserves role, consent and password gates', async (path, role, accepted, restricted, destination) => {
  vi.stubGlobal('fetch', vi.fn(async () => session(role, accepted, restricted)))
  const response = await middleware(request(path))
  expect(response.headers.get('location')).toBe(`https://portal.test${destination}`)
})

test('restricted users can open password and consent pages', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => session('student', false, true)))
  for (const path of ['/change-password', '/consent']) {
    expect((await middleware(request(path))).headers.get('x-middleware-next')).toBe('1')
  }
})

test('expired access refreshes credentials and rechecks consent before entering a dashboard', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ token: 'new', refreshToken: 'rotated', role: 'student' }))
    .mockResolvedValueOnce(session('student', false))
  vi.stubGlobal('fetch', fetch)
  const response = await middleware(request('/dashboard/student', 'auth_token=expired; refresh_token=old'))
  expect(response.headers.get('location')).toBe('https://portal.test/consent')
  expect(response.cookies.get('auth_token')?.value).toBe('new')
  expect(fetch).toHaveBeenCalledTimes(3)
})

test.each([503, 429])('provider status %s displays a retry page without deleting credentials', async (status) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status })))
  const response = await middleware(request('/dashboard/hod'))
  expect(response.status).toBe(503)
  expect(response.headers.get('x-middleware-rewrite')).toBe('https://portal.test/service-unavailable')
  expect(response.cookies.get('auth_token')).toBeUndefined()
})

test('invalid sessions redirect to login and clear credentials', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 401 })))
  const response = await middleware(request('/dashboard/student'))
  expect(response.headers.get('location')).toBe('https://portal.test/login')
  expect(response.cookies.get('auth_token')?.value).toBe('')
})

test('transient dashboard failures do not masquerade as invalid sessions', () => {
  expect(sessionRedirect(503, {})).toBeNull()
  expect(sessionRedirect(500, {})).toBeNull()
  expect(sessionRedirect(403, {})).toBeNull()
  expect(sessionRedirect(401, {})).toBe('/login')
  expect(sessionRedirect(403, { consent_required: true })).toBe('/consent')
})


test('malformed routing facts preserve the session and show a recoverable error', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ role: 'student' })))
  const response = await middleware(request('/dashboard/student'))
  expect(response.status).toBe(503)
  expect(response.cookies.get('auth_token')).toBeUndefined()
})

test('network outages keep authentication cookies and offer retry', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
  const response = await middleware(request('/dashboard/hod'))
  expect(response.status).toBe(503)
  expect(response.cookies.get('auth_token')).toBeUndefined()
})
