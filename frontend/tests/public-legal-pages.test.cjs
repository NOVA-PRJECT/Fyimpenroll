const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { NextRequest } = require('next/server')

function loadTypeScript(filename) {
  const exports = {}
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(source, {
    exports, URL, AbortSignal, process,
    fetch: (...args) => globalThis.fetch(...args),
    require: name => name.startsWith('.')
      ? loadTypeScript(path.resolve(path.dirname(filename), name + '.ts'))
      : require(name),
  }, { filename })
  return exports
}

const { middleware } = loadTypeScript(path.join(__dirname, '../middleware.ts'))
const origin = 'https://portal.example'

test('legal pages stay public before login, after logout and with stale session cookies', async t => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('legal pages must not depend on the auth backend'))
  for (const page of ['/terms-of-use', '/privacy-policy']) {
    for (const cookie of ['', 'session_ended=1', 'session_ended=1; auth_token=stale; refresh_token=stale', 'auth_token=stale; refresh_token=stale']) {
      for (const suffix of ['', '?source=pwa']) {
        const response = await middleware(new NextRequest(origin + page + suffix, { headers: { cookie } }))
        assert.equal(response.status, 200, `${page}${suffix}: ${cookie}`)
        assert.equal(response.headers.get('x-middleware-next'), '1')
        assert.equal(response.headers.get('location'), null)
      }
    }
  }
})

test('protected pages still redirect to login without a session or after logout', async t => {
  t.mock.method(globalThis, 'fetch', async () => assert.fail('ended sessions must not be refreshed'))
  for (const page of ['/dashboard/student', '/consent', '/change-password', '/terms-of-use/private', '/privacy-policy-private']) {
    const cookies = page.startsWith('/dashboard') || page === '/consent' || page === '/change-password'
      ? ['', 'session_ended=1; auth_token=stale; refresh_token=stale']
      : ['session_ended=1']
    for (const cookie of cookies) {
      const response = await middleware(new NextRequest(origin + page, { headers: { cookie } }))
      assert.equal(response.status, 307, page)
      assert.equal(response.headers.get('location'), origin + '/login')
    }
  }
})
