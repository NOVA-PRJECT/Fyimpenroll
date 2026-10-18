// Manual smoke test: node --env-file=backend/.env testing/testing-fixes-2026-10-18/verify-live-logout.cjs
// Creates one temporary Auth-only fixture, no campus/faculty/student records.
const assert = require('node:assert/strict')
const { randomUUID, randomBytes } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const url = process.env.SUPABASE_URL
  assert.equal(new URL(url).hostname, 'lhnjlwtdphugjaluzrsp.supabase.co', 'Unexpected project; refusing to create fixture')
  const options = { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } }
  const admin = createClient(url, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, options)
  const auth = () => createClient(url, process.env.SUPABASE_ANON_KEY, options)
  const base = process.env.LOGOUT_VERIFY_BASE_URL || 'https://fyimp-backend.onrender.com'
  assert.ok(['fyimp-backend.onrender.com','fyimpenroll.vercel.app','localhost','127.0.0.1'].includes(new URL(base).hostname), 'Unexpected logout destination')
  const email = `logout-verification-${randomUUID()}@example.invalid`
  const password = randomBytes(32).toString('base64url') + '!Aa1'
  const report = { base_url: base, started_at: new Date().toISOString(), checks: [], fixture_removed: false }
  const file = path.join(__dirname, 'LIVE_LOGOUT_VERIFICATION.json')
  let fixtureId
  const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
  async function signIn() {
    const result = await auth().auth.signInWithPassword({ email, password })
    assert.equal(result.error, null, 'Fixture login failed')
    return result.data.session
  }
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: 'teacher', verification_fixture: true } })
    assert.equal(created.error, null, 'Could not create isolated Auth fixture')
    fixtureId = created.data.user.id
    report.fixture_id = fixtureId
    save()
    for (const fallback of [false, true]) {
      const first = await signIn(), second = await signIn()
      const response = await fetch(base + '/api/auth/logout', { method: 'POST', signal: AbortSignal.timeout(12000), headers: {
        Authorization: 'Bearer ' + (fallback ? 'invalid-expired-access-token' : first.access_token),
        ...(fallback ? { Cookie: 'refresh_token=' + first.refresh_token } : {}),
      } })
      const body = await response.json(), timing = response.headers.get('server-timing')
      assert.equal(response.status, 200)
      assert.deepEqual(body, { success: true, revoked: true })
      assert.match(timing, /authentication;dur=.*revocation;dur=.*audit;dur=.*logout;dur=/)
      assert.ok(Number(timing.match(/logout;dur=([\d.]+)/)[1]) <= 5050, 'Handler exceeded five-second budget')
      const cookies = response.headers.getSetCookie()
      for (const name of ['auth_token', 'refresh_token', 'user_role']) assert.ok(cookies.some(c => c.startsWith(name + '=;')), 'Missing cookie cleanup: ' + name)
      assert.ok(cookies.some(c => c.startsWith('session_ended=1;')))
      for (const session of [first, second]) {
        const refreshed = await auth().auth.refreshSession({ refresh_token: session.refresh_token })
        assert.ok(refreshed.error && !refreshed.data.session, 'Global refresh revocation failed')
      }
      report.checks.push({ scenario: fallback ? 'invalid_access_refresh_fallback' : 'global_logout_two_sessions', passed: true, server_timing: timing, all_browser_cookies_cleared: true, both_sessions_revoked: true })
      save()
    }
    const blocked = await fetch(base + '/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'session_ended=1' }, body: JSON.stringify({ refreshToken: 'stale-refresh-fixture' }), signal: AbortSignal.timeout(12000) })
    assert.equal(blocked.status, 401)
    assert.equal(blocked.headers.getSetCookie().length, 0)
    report.checks.push({ scenario: 'logout_fence_blocks_refresh_cookie_restoration', passed: true })
  } finally {
    if (fixtureId) {
      const removed = await admin.auth.admin.deleteUser(fixtureId)
      assert.equal(removed.error, null, 'New Auth fixture cleanup failed: ' + fixtureId)
      const verify = await admin.auth.admin.getUserById(fixtureId)
      report.fixture_removed = !verify.data?.user && !!verify.error
      assert.equal(report.fixture_removed, true)
    }
    report.completed_at = new Date().toISOString()
    save()
  }
  console.log(JSON.stringify({ checks: report.checks, fixture_removed: report.fixture_removed }))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
