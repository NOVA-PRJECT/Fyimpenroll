import { useSyncExternalStore } from 'react'
export function usePathname() {
  return useSyncExternalStore(callback => {
    window.addEventListener('popstate', callback)
    return () => window.removeEventListener('popstate', callback)
  }, () => window.location.pathname)
}
export function navigate(path: string) {
  history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
