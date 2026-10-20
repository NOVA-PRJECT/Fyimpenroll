const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const origin = 'https://portal.example'
const source = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8')

function worker() {
  const handlers = new Map()
  const stores = new Map()
  const requests = []
  let claimed = false
  let skipped = false
  let network = async () => new Response('online account page')
  const context = {
    URL, Response,
    Request: class extends Request {
      constructor(url, options) { super(new URL(url, origin), options) }
    },
    fetch: (...args) => network(...args),
    caches: {
      keys: async () => [...stores.keys()],
      delete: async (key) => stores.delete(key),
      open: async (key) => {
        if (!stores.has(key)) stores.set(key, new Map())
        const store = stores.get(key)
        return {
          addAll: async (items) => {
            for (const request of items) {
              requests.push(request)
              store.set(new URL(request.url).pathname, new Response('public offline fallback'))
            }
          },
          match: async (url) => store.get(url)?.clone(),
        }
      },
    },
    self: {
      location: { origin },
      addEventListener: (name, handler) => handlers.set(name, handler),
      clients: { claim: async () => { claimed = true } },
      skipWaiting: async () => { skipped = true },
    },
  }
  vm.runInNewContext(source, context)
  return {
    requests, stores,
    get claimed() { return claimed },
    get skipped() { return skipped },
    setNetwork(fn) { network = fn },
    async event(name, data = {}) {
      let result
      handlers.get(name)({
        ...data,
        waitUntil: (promise) => { result = promise },
        respondWith: (promise) => { result = promise },
      })
      return result
    },
    fetch(url, mode = 'navigate', method = 'GET') {
      return this.event('fetch', { request: { url: new URL(url, origin).href, mode, method } })
    },
  }
}

test('install caches only self-contained public fallback assets without credentials', async () => {
  const sw = worker()
  await sw.event('install')
  assert.equal(sw.requests.length, 7)
  for (const request of sw.requests) {
    const url = new URL(request.url)
    assert.equal(url.origin, origin)
    assert.ok(url.pathname === '/offline.html' || url.pathname.startsWith('/pwa/'))
    assert.equal(request.credentials, 'omit')
  }
  assert.equal(sw.skipped, false)
})

test('online account pages stay on the network; failed navigation uses the public fallback', async () => {
  const sw = worker()
  await sw.event('install')
  const before = [...sw.stores.values()][0].size
  assert.equal(await (await sw.fetch('/dashboard/student')).text(), 'online account page')
  assert.equal([...sw.stores.values()][0].size, before)
  sw.setNetwork(async () => { throw new TypeError('offline') })
  assert.equal(await (await sw.fetch('/dashboard/teacher')).text(), 'public offline fallback')
  assert.equal([...sw.stores.values()][0].size, before)
})

test('API, submissions, Next.js data requests and foreign requests bypass the worker', async () => {
  const sw = worker()
  await sw.event('install')
  sw.setNetwork(async () => { throw new Error('should not be intercepted') })
  assert.equal(await sw.fetch('/api/auth/profile', 'cors'), undefined)
  assert.equal(await sw.fetch('/api/download', 'navigate'), undefined)
  assert.equal(await sw.fetch('/dashboard/student', 'navigate', 'POST'), undefined)
  assert.equal(await sw.fetch('/dashboard/student?_rsc=private', 'cors'), undefined)
  assert.equal(await sw.fetch('/_next/static/app.js', 'no-cors'), undefined)
  assert.equal(await sw.fetch('https://other.example/page'), undefined)
  assert.equal(await (await sw.fetch('/pwa/icon-192.png', 'no-cors')).text(), 'public offline fallback')
})

test('activation clears only older app-owned caches; updates wait for user action', async () => {
  const sw = worker()
  await sw.event('install')
  sw.stores.set('fyimp-pwa-v0', new Map())
  sw.stores.set('another-app-cache', new Map())
  await sw.event('activate')
  assert.equal(sw.stores.has('fyimp-pwa-v0'), false)
  assert.equal(sw.stores.has('another-app-cache'), true)
  assert.equal(sw.claimed, true)
  assert.equal(sw.skipped, false)
  await sw.event('message', { data: { type: 'UNKNOWN' } })
  assert.equal(sw.skipped, false)
  await sw.event('message', { data: { type: 'SKIP_WAITING' } })
  assert.equal(sw.skipped, true)
})
