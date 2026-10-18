const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const ts = require('typescript')
const { NextRequest } = require('next/server')

// Run the actual middleware with real Next request/response cookies and a fake
// backend. No server, credentials or database are needed for these regressions.
function harness(responses = []) {
  const calls = [], cache = new Map()
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const localRequire = createRequire(filename)
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    vm.runInNewContext(source, {
      module, exports: module.exports, process, URL, AbortSignal,
      require: name => name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.ts')) : localRequire(name),
      fetch: async (url, options) => {
        calls.push({ url, options })
        assert.ok(responses.length, `Unexpected backend request: ${url}`)
        const { status = 200, body = {} } = responses.shift()
        return new Response(JSON.stringify(body), { status })
      },
    }, { filename })
    return module.exports
  }
  return { middleware: load(path.resolve(__dirname, '../middleware.ts')).middleware, calls }
}

const session = (role = 'hod', accepted = true) => ({ body: { role, consent: { accepted } } })
const request = (pathname, cookies = 'auth_token=valid-access; refresh_token=valid-refresh; user_role=hod') =>
  new NextRequest(`https://portal.example${pathname}`, { headers: { cookie: cookies } })
function unchanged(response) {
  assert.equal(response.headers.get('set-cookie'), null, 'Navigation must not clear or replace valid cookies')
}

test('unknown dashboard routes preserve every authorized role session and fall through to the router', async () => {
  for (const role of ['hod', 'student', 'teacher', 'campus_director', 'teaching_staff', 'superadmin']) {
    const { middleware } = harness([session(role)])
    const response = await middleware(request('/dashboard/gibberish'))
    assert.equal(response.headers.get('x-middleware-next'), '1', role)
    assert.equal(response.headers.get('location'), null)
    unchanged(response)
  }
})

test('dashboard spelling mistakes are ordinary unmatched routes without session requests', async () => {
  for (const route of ['/dashboardv/gibberish', '/dashboard-other', '/new-page']) {
    const { middleware, calls } = harness()
    const response = await middleware(request(route))
    assert.equal(response.headers.get('x-middleware-next'), '1')
    unchanged(response)
    assert.equal(calls.length, 0)
  }
})

test('valid own-role routes and missing own-role subpages preserve the session', async () => {
  for (const route of ['/dashboard/hod', '/dashboard/hod/unknown']) {
    const { middleware } = harness([session()])
    const response = await middleware(request(route))
    assert.equal(response.headers.get('x-middleware-next'), '1')
    unchanged(response)
  }
})

test('known routes belonging to another role still redirect to the user dashboard', async () => {
  const { middleware } = harness([session()])
  const response = await middleware(request('/dashboard/director'))
  assert.equal(response.headers.get('location'), 'https://portal.example/dashboard/hod')
  unchanged(response)
})

test('shared dashboard routes retain their role restrictions', async () => {
  const { middleware } = harness([session('teaching_staff')])
  const response = await middleware(request('/dashboard/credit-ledger/student-id'))
  assert.equal(response.headers.get('location'), 'https://portal.example/dashboard/teaching_staff')
  unchanged(response)
})

test('a refreshed session on an unknown dashboard route keeps rotated credentials', async () => {
  const { middleware } = harness([
    { status: 401 },
    { body: { token: 'rotated-access', refreshToken: 'rotated-refresh', role: 'hod' } },
    session(),
  ])
  const response = await middleware(request('/dashboard/gibberish'))
  assert.equal(response.headers.get('x-middleware-next'), '1')
  assert.equal(response.cookies.get('auth_token').value, 'rotated-access')
  assert.equal(response.cookies.get('refresh_token').value, 'rotated-refresh')
})

test('genuinely invalid sessions still redirect to login and clear auth cookies', async () => {
  const { middleware } = harness([{ status: 401 }, { status: 401 }])
  const response = await middleware(request('/dashboard/hod'))
  assert.equal(response.headers.get('location'), 'https://portal.example/login')
  for (const cookie of ['auth_token', 'refresh_token', 'user_role']) assert.equal(response.cookies.get(cookie).value, '')
})

test('backend outages preserve cookies and display service unavailable', async () => {
  const { middleware } = harness([{ status: 503 }])
  const response = await middleware(request('/dashboard/gibberish'))
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('x-middleware-rewrite'), 'https://portal.example/service-unavailable')
  unchanged(response)
})

test('unknown dashboard routes cannot bypass password or consent requirements', async () => {
  for (const [backendResponse, destination] of [
    [{ status: 403, body: { must_change_password: true, role: 'hod' } }, '/change-password'],
    [session('hod', false), '/consent'],
  ]) {
    const { middleware } = harness([backendResponse])
    const response = await middleware(request('/dashboard/gibberish'))
    assert.equal(response.headers.get('location'), `https://portal.example${destination}`)
    unchanged(response)
  }
})

test('the logout fence rejects late restored cookies without refreshing them',async()=>{
  for(const route of ['/dashboard/hod','/login']) {
    const {middleware,calls}=harness()
    const req=request(route)
    req.cookies.set('session_ended','1')
    const res=await middleware(req)
    assert.equal(calls.length,0)
    assert.equal(res.headers.get('location'),route==='/login'?null:'https://portal.example/login')
    assert.match(res.headers.get('set-cookie'),/auth_token=;/)
  }
})
