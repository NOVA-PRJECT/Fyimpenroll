const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
require('reflect-metadata')
const { requestPasswordRecovery } = require('../frontend/src/core/security/password-recovery.ts')
const { apiFetch } = require('../frontend/src/core/security/refresh-coordinator.ts')
const { AuthController } = require('../backend/dist/modules/auth/auth.controller')
const { AuthService } = require('../backend/dist/modules/auth/auth.service')
const { assertPasswordNotCompromised } = require('../backend/dist/core/security/password-security')
const provider = { auth: { getSession: async () => ({ data: { session: { access_token: 'recovery-token' } } }) } }
const logger = { log: async () => {}, warn() {}, error() {} }
const safeResponse = () => new Response('A'.repeat(35) + ':0\r\n')

test('reset and synchronization use the recovery bearer session without old logout cookies', async () => {
  for (const endpoint of ['/api/auth/complete-password-reset', '/api/auth/sync-password-status']) {
    const response = await requestPasswordRecovery(provider, endpoint, endpoint.endsWith('reset') ? { newPassword: 'Synthetic-Permanent-Password-381' } : undefined, async (url, options) => {
      assert.equal(url, endpoint)
      const request = new Request('https://portal.example.test' + url, options)
      assert.equal(request.credentials, 'omit')
      assert.equal(request.headers.get('Authorization'), 'Bearer recovery-token')
      assert.equal(request.headers.has('Cookie'), false)
      if (endpoint.endsWith('reset')) assert.deepEqual(await request.json(), { newPassword: 'Synthetic-Permanent-Password-381' })
      return Response.json({ success: true })
    })
    assert.equal(response.ok, true)
  }
})

test('an expired recovery session never falls back to the cookie account', async () => {
  await assert.rejects(requestPasswordRecovery({ auth: { getSession: async () => ({ data: { session: null } }) } }, '/api/auth/complete-password-reset', { newPassword: 'unused' }, async () => { assert.fail('must not make an ambient request') }), /expired/)
})

test('explicit recovery authorization is never replaced by cookie refresh on 401', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ code: 'AUTH_SESSION_REJECTED' }, { status: 401 }) })
  const response = await apiFetch('/api/auth/complete-password-reset', { method: 'POST', credentials: 'omit', headers: { Authorization: 'Bearer recovery-token' } })
  assert.equal(response.status, 401)
  assert.equal(calls, 1)
})

test('the controller accepts the reset contract and rejects the old unverified assertion', async () => {
  const controller = new AuthController({ completePasswordReset: async (user, body) => ({ user, body }) })
  const result = await controller.completePasswordReset({ userId: 'student' }, { newPassword: 'Synthetic-Password-381' })
  assert.equal(result.body.newPassword, 'Synthetic-Password-381')
  await assert.rejects(controller.completePasswordReset({ userId: 'student' }, { passwordUpdated: true }), error => error.getStatus() === 400)
})

test('a partially synchronized reset retries account status without setting the password twice', async t => {
  t.mock.method(globalThis, 'fetch', async () => safeResponse())
  let metadata = { role: 'student', must_change_password: true }
  let passwordsChanged = 0, profileWrites = 0
  const supabase = { admin: {
    auth: { admin: {
      getUserById: async () => ({ data: { user: { app_metadata: { ...metadata } } }, error: null }),
      updateUserById: async (_id, patch) => { if (patch.password) passwordsChanged++; metadata = { ...metadata, ...patch.app_metadata }; return { error: null } },
    } },
    from: () => ({ update: () => ({ eq: async () => ({ error: ++profileWrites === 1 ? { message: 'temporary database failure' } : null }) }) }),
  } }
  const service = new AuthService(supabase, {}, logger, logger)
  const first = await service.completePasswordReset('student', { newPassword: 'Synthetic-Permanent-Password-381' })
  assert.equal(first.canRetrySync, true)
  assert.equal(metadata.pending_profile_sync, true)
  assert.equal((await service.syncPasswordStatus('student')).success, true)
  assert.equal(passwordsChanged, 1)
  assert.equal(metadata.must_change_password, false)
  assert.equal(metadata.pending_profile_sync, false)
})

test('compromised-password checking sends only a padded hash-prefix query and rejects known leaks', async t => {
  const password = 'synthetic-compromised-regression-value'
  const digest = createHash('sha1').update(password).digest('hex').toUpperCase()
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.pwnedpasswords.com/range/' + digest.slice(0,5))
    assert.equal(options.headers['Add-Padding'], 'true')
    assert.equal(options.body, undefined)
    return new Response(digest.slice(5) + ':15\r\n')
  })
  await assert.rejects(assertPasswordNotCompromised(password), error => error.getStatus() === 400 && error.getResponse().code === 'PASSWORD_COMPROMISED')
})

test('password screening fails closed on outages and malformed responses', async t => {
  for (const response of [() => new Response('unavailable', { status: 503 }), () => new Response('malformed')]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => response())
    await assert.rejects(assertPasswordNotCompromised('Synthetic-Permanent-Password-381'), error => error.getStatus() === 503)
    mock.mock.restore()
  }
})
