const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

function sourceModule(source) {
  const filename = path.resolve(source), module = new Module(filename)
  module.filename = filename; module.paths = Module._nodeModulePaths(path.dirname(filename))
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename)
  return module.exports
}
function browser(t, network) {
  const previous = global.window, native = network
  global.window = Object.assign(new EventTarget(), { location: { origin: 'https://portal.test' }, fetch: native })
  t.mock.method(globalThis, 'fetch', (...args) => window.fetch(...args))
  t.after(() => { if (previous === undefined) delete global.window; else global.window = previous })
  return native
}

test('course loading resumes after a development effect cleanup and reloads invalidated data', async () => {
  const { createSemesterCatalogue } = sourceModule('frontend/src/core/semester-catalogue.ts')
  const snapshots = []; let version = 1
  const loader = createSemesterCatalogue(async semester => [{ id: 'course', course_code: 'QA101', semester, version }], value => snapshots.push(value))
  const first = loader.start(1)
  loader.dispose()
  await loader.start(1); await first
  assert.equal(snapshots.at(-1).loading,false)
  assert.equal(snapshots.at(-1).rows[0].version,1)
  version = 2
  await loader.start(1)
  assert.equal(snapshots.at(-1).rows[0].version,2)
  loader.dispose()
})

test('concurrent profile and assignment 401s share one refresh and both populate the cache', async t => {
  const counts = new Map(); let renewed = false
  browser(t, async url => {
    counts.set(url,(counts.get(url)||0)+1)
    if (url === '/api/auth/refresh') { await new Promise(resolve => setImmediate(resolve)); renewed = true; return Response.json({ success: true }) }
    return renewed ? Response.json({ loaded: url }) : Response.json({ code: 'AUTH_SESSION_REJECTED' }, { status: 401 })
  })
  const security = sourceModule('frontend/src/core/security/refresh-coordinator.ts')
  const cache = sourceModule('frontend/src/core/data-cache.ts')
  security.registerDataTransport(cache.cachedDataFetch); security.installGlobalFetchInterceptor()
  const urls = ['/api/auth/profile','/api/assignments/courses']
  const responses = await Promise.all(urls.map(url => window.fetch(url)))
  assert.deepEqual(responses.map(response => response.status),[200,200])
  assert.equal(counts.get('/api/auth/refresh'),1)
  for (const url of urls) { await window.fetch(url); assert.equal(counts.get(url),2) }
  cache.clearDataCache()
})

test('hot module reinstall retains native fetch and registers the current data transport', async t => {
  let networkCalls = 0, firstCacheCalls = 0, secondCacheCalls = 0
  const native = browser(t, async () => { networkCalls++; return Response.json({ ok: true }) })
  const first = sourceModule('frontend/src/core/security/refresh-coordinator.ts')
  first.registerDataTransport((input,init,network) => { firstCacheCalls++; return network(input,init) })
  first.installGlobalFetchInterceptor(); await window.fetch('/api/auth/profile')
  const second = sourceModule('frontend/src/core/security/refresh-coordinator.ts')
  second.registerDataTransport((input,init,network) => { secondCacheCalls++; return network(input,init) })
  second.installGlobalFetchInterceptor()
  assert.equal(window.__originalFetch,native)
  await window.fetch('/api/assignments/courses')
  assert.equal(firstCacheCalls,1); assert.equal(secondCacheCalls,1); assert.equal(networkCalls,2)
})

test('a temporary session refresh outage is surfaced without cached data being cleared', async t => {
  let failed = false
  browser(t, async url => url === '/api/auth/refresh' ? Response.json({ message: 'temporary outage' }, { status: 503 })
    : failed ? Response.json({ code: 'AUTH_SESSION_REJECTED' }, { status: 401 }) : Response.json({ courses: ['saved'] }))
  const security = sourceModule('frontend/src/core/security/refresh-coordinator.ts')
  const cache = sourceModule('frontend/src/core/data-cache.ts')
  security.registerDataTransport(cache.cachedDataFetch); security.installGlobalFetchInterceptor()
  await window.fetch('/api/assignments/courses'); failed = true
  let status
  await cache.refreshDatasets(['/api/assignments/courses'], async () => { status = (await window.fetch('/api/assignments/courses')).status })
  assert.equal(status,503)
  assert.deepEqual(cache.cachedData('/api/assignments/courses'),{ courses: ['saved'] })
  cache.clearDataCache()
})
