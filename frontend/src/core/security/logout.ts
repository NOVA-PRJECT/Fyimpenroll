import { clearSessionStorage, navigateAfterSessionChange } from './session-navigation'
import { beginSessionLogout } from './refresh-coordinator'

let pending: Promise<boolean> | null = null
let confirmLogout: (() => Promise<boolean>) | undefined

export function registerLogoutDialog(handler: () => Promise<boolean>): () => void {
  confirmLogout = handler
  return () => { if (confirmLogout === handler) confirmLogout = undefined }
}

/** All callers share revocation, cookie cleanup, timeout and retry feedback. */
export function logoutPortal(): Promise<boolean> {
  if (pending) return pending
  pending = (confirmLogout?.() ?? Promise.resolve(false)).finally(() => { pending = null })
  return pending
}

export async function performLogout(): Promise<boolean> {
  beginSessionLogout()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST', signal: controller.signal, cache: 'no-store' })
    const result = await response.json()
    if (!response.ok || result.success !== true) throw new Error('Logout could not be confirmed.')
    try { clearSessionStorage() } catch { /* Blocked storage must not prevent cookie logout. */ }
    const destination = result.revoked === false
      ? '/login?message=' + encodeURIComponent('Signed out on this browser. Server session revocation could not be confirmed.')
      : '/login'
    navigateAfterSessionChange(destination)
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}
