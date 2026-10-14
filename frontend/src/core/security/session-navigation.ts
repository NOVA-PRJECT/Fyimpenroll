import { THEME_KEY, THEME_POSITION_KEY } from '../theme/preferences'

/** Clear session data while keeping browser-only appearance preferences and director rules. */
export function clearSessionStorage() {
  sessionStorage.clear()
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('fyimp:rules:') && key !== THEME_KEY && key !== THEME_POSITION_KEY) localStorage.removeItem(key)
  }
}

/** A full reload prevents the previous account's in-memory UI from being reused. */
export function navigateAfterSessionChange(destination: string) {
  const target = new URL(destination, window.location.origin)
  if (target.origin !== window.location.origin) throw new Error('Invalid portal destination')
  window.location.assign(target.href)
}
