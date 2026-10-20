/* Only public fallback assets belong in this cache. Account data stays online. */
const CACHE_PREFIX = 'fyimp-pwa-'
const CACHE_NAME = `${CACHE_PREFIX}v2`
const OFFLINE_URL = '/offline.html'
const PUBLIC_ASSETS = [
  OFFLINE_URL,
  '/pwa/offline.css',
  '/pwa/offline.js',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
  '/pwa/icon-maskable-512.png',
  '/pwa/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(
    PUBLIC_ASSETS.map((url) => new Request(url, { cache: 'reload', credentials: 'omit' })),
  )))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  // Updating is an explicit user action so an open form is never reloaded for them.
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request)
      } catch {
        const cache = await caches.open(CACHE_NAME)
        return (await cache.match(OFFLINE_URL)) || Response.error()
      }
    })())
    return
  }

  if (!url.search && PUBLIC_ASSETS.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      return (await cache.match(url.pathname)) || fetch(request)
    })())
  }
})
