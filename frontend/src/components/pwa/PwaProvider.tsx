'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable'

const PwaContext = createContext({
  canInstall: false,
  isInstalled: false,
  isIOS: false,
  install: async (): Promise<InstallOutcome> => 'unavailable',
})

export const usePwa = () => useContext(PwaContext)

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const installPrompt = useRef<InstallPromptEvent | null>(null)
  const [canInstall, setCanInstall] = useState(false)
  const [isInstalled, setInstalled] = useState(false)
  const [isIOS, setIOS] = useState(false)
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  const [updating, setUpdating] = useState(false)
  const updateRequested = useRef(false)

  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)')
    const updateDisplayMode = () => setInstalled(displayMode.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
    updateDisplayMode()
    setIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
    const onPrompt = (event: Event) => {
      event.preventDefault()
      installPrompt.current = event as InstallPromptEvent
      setCanInstall(true)
    }
    const onInstalled = () => {
      installPrompt.current = null
      setCanInstall(false)
      setInstalled(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    displayMode.addEventListener('change', updateDisplayMode)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      displayMode.removeEventListener('change', updateDisplayMode)
    }
  }, [])

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !window.isSecureContext || !('serviceWorker' in navigator)) return
    let active = true
    let registration: ServiceWorkerRegistration | undefined
    let installing: ServiceWorker | null = null
    const onStateChange = () => {
      if (active && installing?.state === 'installed' && navigator.serviceWorker.controller) {
        setWaitingWorker(registration?.waiting ?? installing)
      }
    }
    const onUpdateFound = () => {
      installing?.removeEventListener('statechange', onStateChange)
      installing = registration?.installing ?? null
      installing?.addEventListener('statechange', onStateChange)
    }
    const onControllerChange = () => {
      if (updateRequested.current) window.location.reload()
    }
    const checkUpdate = () => {
      if (document.visibilityState === 'visible') void registration?.update().catch(() => {})
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    document.addEventListener('visibilitychange', checkUpdate)
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then((result) => {
      if (!active) return
      registration = result
      if (result.waiting) setWaitingWorker(result.waiting)
      result.addEventListener('updatefound', onUpdateFound)
      if (result.installing) onUpdateFound()
    }).catch((error: unknown) => console.warn('Unable to enable offline fallback:', error))
    return () => {
      active = false
      registration?.removeEventListener('updatefound', onUpdateFound)
      installing?.removeEventListener('statechange', onStateChange)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      document.removeEventListener('visibilitychange', checkUpdate)
    }
  }, [])

  const install = useCallback(async (): Promise<InstallOutcome> => {
    const prompt = installPrompt.current
    if (!prompt) return 'unavailable'
    installPrompt.current = null
    setCanInstall(false)
    await prompt.prompt()
    const choice = await prompt.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    return choice.outcome
  }, [])

  return (
    <PwaContext.Provider value={{ canInstall, isInstalled, isIOS, install }}>
      {children}
      {waitingWorker && (
        <aside aria-label="App update" className="fixed bottom-4 left-4 z-[100] max-w-[calc(100vw-5rem)] rounded-xl border border-[color:var(--portal-strong-border,#cbd5e1)] bg-[color:var(--portal-surface,#fff)] p-4 shadow-lg sm:max-w-sm">
          <p role="status" className="text-sm font-semibold">A new version is ready</p>
          <p className="mt-1 text-xs text-[color:var(--portal-muted,#64748b)]">Finish your work, then refresh to update.</p>
          <button type="button" disabled={updating} onClick={() => {
            updateRequested.current = true
            setUpdating(true)
            waitingWorker.postMessage({ type: 'SKIP_WAITING' })
          }} className="mt-3 min-h-11 rounded-lg bg-[#082042] px-4 text-sm font-semibold text-white disabled:opacity-60">
            {updating ? 'Updating…' : 'Refresh app'}
          </button>
        </aside>
      )}
    </PwaContext.Provider>
  )
}
