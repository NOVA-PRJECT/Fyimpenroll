'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { QueryClientProvider } from '@tanstack/react-query'
import { bindDataScope, cachedDataFetch, clearDataCache, currentDataScope, dataClient, revalidateVisibleData } from '@/core/data-cache'
import { installGlobalFetchInterceptor, invalidateRefreshSession, registerDataTransport } from '@/core/security/refresh-coordinator'
import { installSessionBroadcast } from '@/core/security/session-identity'
let installed = false

export default function DataProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [readyPath, setReadyPath] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState(false)
  // Install before children mount; their first effects must use the same transport.
  if (typeof window !== 'undefined' && !installed) {
    registerDataTransport(cachedDataFetch)
    window.addEventListener('fyimp:session-cleared', clearDataCache)
    installGlobalFetchInterceptor()
    installed = true
  }
  useEffect(() => {
    let active = true, pending: Promise<void> | undefined
    const protectedPage = () => /^\/(dashboard|change-password)(\/|$)/.test(window.location.pathname)
    const changed = () => {
      invalidateRefreshSession()
      clearDataCache()
      // A reload also discards component-local data belonging to the old account.
      if (protectedPage()) { document.documentElement.style.visibility = 'hidden'; window.location.reload() }
    }
    const verify = () => pending ??= (async () => {
      if (!protectedPage()) { if (active) setReadyPath(pathname); return }
      setChecking(true)
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' })
        if (response.status === 401) { invalidateRefreshSession(); clearDataCache(); window.location.replace('/login'); return }
        if (!response.ok) throw new Error('Session verification unavailable')
        const identity = await response.json()
        if (typeof identity.dataScope !== 'string' || !identity.dataScope) throw new Error('Session scope missing')
        if (!active) return
        const previous = currentDataScope()
        if (previous !== 'session' && previous !== identity.dataScope) { changed(); return }
        bindDataScope(identity.dataScope)
        setReadyPath(pathname); setError(false); setChecking(false)
        await revalidateVisibleData()
      } catch { if (active) { setError(true); setChecking(true) } }
    })().finally(() => { pending = undefined })
    const visible = () => { if (document.visibilityState !== 'hidden') void verify() }
    const uninstall = installSessionBroadcast(changed)
    window.addEventListener('fyimp:identity-changed', changed)
    window.addEventListener('focus', visible)
    window.addEventListener('online', visible)
    document.addEventListener('visibilitychange', visible)
    const timer = setInterval(visible, 60000)
    void verify()
    return () => {
      active = false; clearInterval(timer); uninstall()
      window.removeEventListener('fyimp:identity-changed', changed)
      window.removeEventListener('focus', visible); window.removeEventListener('online', visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [pathname])
  return <QueryClientProvider client={dataClient}>
    {error && <p role="alert">Could not verify your session. Reconnect or reload to continue.</p>}
    {readyPath === pathname && <div style={checking ? { visibility: 'hidden' } : undefined} inert={checking || undefined} aria-hidden={checking || undefined}>{children}</div>}
  </QueryClientProvider>
}
