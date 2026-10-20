# FYIMP Portal PWA

The website installs as FYIMP Portal with university icons and a standalone app window. `/install` leads with an Install app button that opens the browser's native installer when available. Manual steps appear only after clicking when the browser cannot offer a direct prompt. The shared public footer opens the native installer directly when available and otherwise links to this page.

## Run and install

From the repository root:

```sh
npm run build --workspace=frontend
npm run start --workspace=frontend
```

Open `http://localhost:3000/install` on the development computer. For installation from a phone, deploy to HTTPS and open that URL on the phone. A plain HTTP LAN address is not a secure context, so home-screen installation and the service worker may not be available there.

- Android/desktop Chrome or Edge: select Install app when offered, or use the browser menu's install action.
- iPhone/iPad: open in Safari, tap Share, then Add to Home Screen. Enable Open as Web App if shown.

Service worker registration runs only in production on secure origins (including localhost). `npm run dev` intentionally does not register a worker.

## Offline behavior and updates

`public/sw.js` caches an explicit list of public offline assets. Navigations use the network and show `offline.html` only when the network request fails. API requests, account pages, RSC responses, authentication, submissions and downloaded records are never cached by this worker. The PWA requires a connection for portal operations; it does not queue offline writes.

When an updated worker is waiting, an update notice lets the user finish their work before refreshing. There is no automatic reload of an open form. Bump the worker's `CACHE_NAME` version when changing the cached fallback assets; activation removes only older `fyimp-pwa-` caches. Other browser storage is left alone.

The manifest, worker, install page and public fallback assets remain reachable after logout. The worker is served with no-store headers so new deployments can be detected.

## Validate a production build

Run the service worker regression tests with `node --test frontend/tests/pwa-service-worker.test.cjs` from the repository root.

1. Inspect `/manifest.webmanifest`: standalone display, root scope/start URL and 192/512px icons.
2. Open `/install`, wait for service worker activation, and check browser DevTools → Application → Service Workers.
3. Enable offline mode, then reload a page. The branded reconnect page should appear, including its logo and retry control. Disable offline mode and use Try again.
4. Confirm Cache Storage contains only the allowlisted public fallback assets. Open protected pages and make API requests; no account responses should enter that cache.
5. Test requests for `/sw.js`, `/manifest.webmanifest`, `/offline.html` and `/pwa/icon-192.png` with a `session_ended` cookie. They must return their original content instead of a login redirect.
6. Install on Android and iOS and verify the launcher icon, standalone window and normal role/session routing. Check desktop and narrow phone layouts.
7. Test an updated worker with an open form. The page must wait for Refresh app before reloading.

Regenerate icons from the existing university logo with `node frontend/scripts/generate-pwa-icons.cjs`. This uses the Sharp installation bundled with Next.js. No external image service is involved.
