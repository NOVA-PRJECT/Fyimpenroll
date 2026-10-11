const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AuthService } = require('../dist/modules/auth/auth.service')
const { AuthController } = require('../dist/modules/auth/auth.controller')
const { AuthGuard } = require('../dist/core/auth/guards/auth.guard')
const { StudentService } = require('../dist/modules/student/student.service')
const { CURRENT_POLICY_VERSION } = require('../dist/modules/consent/consent.constants')

function fixture({ role = 'student', consent = true, restricted = false, staleMetadata = false, consentError = null } = {}) {
  const counts = { updates: 0, queries: [], audits: 0, resets: 0 }
  const metadata = { role, campus_id: 'campus', department_id: 'dept', must_change_password: restricted }
  if (consent) metadata.accepted_policy_version = CURRENT_POLICY_VERSION
  if (staleMetadata) metadata.campus_id = 'old-campus'
  const record = { id: 'account', role, campus_id: 'campus', department_id: 'dept', must_change_password: restricted }
  const user = { id: 'account', email: 'account@example.test', app_metadata: metadata }
  const supabase = {
    admin: { auth: {
      getUser: async () => ({ data: { user }, error: null }),
      admin: { updateUserById: async () => { counts.updates++; return { error: null } } },
    }, from(table) {
      counts.queries.push(table)
      const q = { select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: table === 'consent_records' ? null : table === (role === 'student' ? 'students' : 'faculty') ? record : null, error: table === 'consent_records' ? consentError : null }),
      }
      return q
    } },
    createAuthClient: () => ({ auth: { signInWithPassword: async () => ({ data: { user, session: { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 } }, error: null }) } }),
  }
  const limiter = { checkLimit: async () => ({ success: true }), resetLoginLimits: async () => { counts.resets++ } }
  const auth = new AuthService(supabase, limiter, { log: async () => { counts.audits++ } }, {})
  return { auth, supabase, counts }
}
for (const [role, destination] of [['student','student'], ['hod','hod'], ['campus_director','director']]) {
  test(`${role} login skips unchanged metadata while retaining account verification, rate limits and audit`, async () => {
    const { auth, counts } = fixture({ role })
    const result = await auth.login('account@example.test', 'password', '127.0.0.1')
    assert.equal(result.redirectTo, `/dashboard/${destination}`)
    assert.equal(counts.updates, 0)
    assert.equal(counts.audits, 1)
    assert.equal(counts.resets, 1)
    assert.deepEqual(counts.queries, [role === 'student' ? 'students' : 'faculty'])
  })
}
test('stale account metadata is still synchronized', async () => {
  const { auth, counts } = fixture({ staleMetadata: true })
  await auth.login('account@example.test', 'password', '127.0.0.1')
  assert.equal(counts.updates, 1)
})
test('login returns consent and password destinations, with password taking priority', async () => {
  for (const restricted of [false, true]) {
    const { auth } = fixture({ consent: false, restricted })
    const result = await auth.login('account@example.test', 'password', '127.0.0.1')
    assert.equal(result.redirectTo, restricted ? '/change-password' : '/consent')
    assert.equal(result.consent.accepted, false)
  }
})
test('consent lookup outage fails closed with 503', async () => {
  const { auth } = fixture({ consent: false, consentError: { message: 'unavailable' } })
  await assert.rejects(auth.login('account@example.test', 'password', '127.0.0.1'), error => error.getStatus() === 503)
})
test('login starts independent role, consent and rate-limit operations before awaiting any one', async () => {
  const { auth, supabase } = fixture({ consent: false })
  const started = []; const release = []
  const defer = name => { started.push(name); return new Promise(resolve => release.push(resolve)) }
  auth.determineUserRoute = () => defer('role')
  auth.rateLimiter.resetLoginLimits = () => defer('reset')
  supabase.admin.from = () => { const q = { select: () => q, eq: () => q, maybeSingle: () => defer('consent') }; return q }
  const login = auth.login('account@example.test', 'password', '127.0.0.1')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(started, ['role', 'consent', 'reset'])
  release[0]({ role: 'student', redirectTo: '/dashboard/student', campus_id: 'campus', department_id: 'dept', must_change_password: false })
  release[1]({ data: null, error: null }); release[2]()
  assert.equal((await login).redirectTo, '/consent')
})
test('session endpoint uses the guard account check without loading a full profile', async () => {
  const { supabase, counts, auth } = fixture()
  const request = { headers: { authorization: 'Bearer access' }, method: 'GET', originalUrl: '/api/auth/session' }
  await new AuthGuard(supabase).canActivate({ switchToHttp: () => ({ getRequest: () => request }) })
  const headers = {}
  const result = new AuthController(auth).session(request.user, { setHeader: (key, value) => { headers[key] = value } })
  assert.deepEqual(result, { role: 'student', must_change_password: false, consent: { accepted: true, currentVersion: CURRENT_POLICY_VERSION } })
  assert.deepEqual(counts.queries, ['students'])
  assert.equal(headers['Cache-Control'], 'private, no-store')
})
test('session facts remain available when consent or initial password change is required', async () => {
  const { supabase } = fixture({ consent: false, restricted: true })
  const request = { headers: { authorization: 'Bearer access' }, method: 'GET', originalUrl: '/api/auth/session' }
  await new AuthGuard(supabase).canActivate({ switchToHttp: () => ({ getRequest: () => request }) })
  assert.equal(request.user.must_change_password, true)
  assert.equal(request.user.consent.accepted, false)
})
test('dashboard settings overlap student loading and use the actual campus after a concurrent campus change', async () => {
  let finishStudent; const settingsCampuses = []
  const supabase = { admin: { from(table) {
    let campus
    const q = { select: () => q, eq: (key, value) => { if (key === 'campus_id') campus = value; return q }, order: () => q, limit: () => q,
      single: () => new Promise(resolve => { finishStudent = resolve }),
      maybeSingle: async () => {
        if (table === 'campus_settings') { settingsCampuses.push(campus); return { data: { academic_year: campus === 'campus' ? '2025-26' : '2026-27' } } }
        return { data: null, error: null }
      },
    }; return q
  } } }
  const summary = new StudentService(supabase, {}, {}).getDashboardSummary({ userId: 'account', campus_id: 'campus' })
  assert.deepEqual(settingsCampuses, ['campus'])
  finishStudent({ data: { campus_id: 'new-campus', current_semester: 1, full_name: 'Student' }, error: null })
  const result = await summary
  assert.deepEqual(settingsCampuses, ['campus', 'new-campus'])
  assert.equal(result.registrationWindow.academicYear, '2026-27')
})
