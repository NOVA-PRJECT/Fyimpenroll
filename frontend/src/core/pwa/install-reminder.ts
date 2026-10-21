export const INSTALL_REMINDER_LAST_SHOWN_KEY = 'fyimp:pwa-install-reminder:last-shown:v1'
export const INSTALL_REMINDER_DISMISSED_KEY = 'fyimp:pwa-install-reminder:handled:v1'
export const INSTALL_REMINDER_CHANGED_EVENT = 'fyimp:install-reminder-changed'
export const INSTALL_REMINDER_COOLDOWN = 72 * 60 * 60 * 1000
export const INSTALL_REMINDER_DELAY = 3000

type ReminderStorage = Pick<Storage, 'getItem' | 'setItem'>
type ReminderState = { lastShownAt: number | null; permanentlyDismissed: boolean }

export function canShowInstallReminder({ pathname, ready, installed, blocked }: {
  pathname: string
  ready: boolean
  installed: boolean
  blocked: boolean
}) {
  return ready && !installed && !blocked && pathname !== '/install' && !pathname.startsWith('/install/')
}

export function createInstallReminderStore(
  getStorage: () => ReminderStorage | undefined,
  notifyDismissal: () => void = () => {},
) {
  let fallback: ReminderState = { lastShownAt: null, permanentlyDismissed: false }
  let memoryOnly = false

  function read(): ReminderState {
    if (memoryOnly) return fallback
    try {
      const storage = getStorage()
      if (!storage) throw new Error('Storage unavailable')
      const value = storage.getItem(INSTALL_REMINDER_LAST_SHOWN_KEY)
      const timestamp = value?.trim() ? Number(value) : NaN
      fallback = {
        lastShownAt: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null,
        permanentlyDismissed: storage.getItem(INSTALL_REMINDER_DISMISSED_KEY) === 'true',
      }
    } catch {
      // Keep this page load usable even when storage is blocked or full.
      memoryOnly = true
    }
    return fallback
  }

  function write(key: string, value: string, next: ReminderState) {
    fallback = next
    if (memoryOnly) return
    try {
      const storage = getStorage()
      if (!storage) throw new Error('Storage unavailable')
      storage.setItem(key, value)
    } catch {
      memoryOnly = true
    }
  }

  return {
    isEligible(now = Date.now()) {
      const state = read()
      if (state.permanentlyDismissed) return false
      if (memoryOnly && state.lastShownAt !== null) return false
      return state.lastShownAt === null || state.lastShownAt > now || now - state.lastShownAt >= INSTALL_REMINDER_COOLDOWN
    },
    markShown(now = Date.now()) {
      const state = read()
      write(INSTALL_REMINDER_LAST_SHOWN_KEY, String(now), { ...state, lastShownAt: now })
    },
    dismissPermanently() {
      const state = read()
      write(INSTALL_REMINDER_DISMISSED_KEY, 'true', { ...state, permanentlyDismissed: true })
      notifyDismissal()
    },
  }
}

export const installReminderStore = createInstallReminderStore(
  () => typeof window === 'undefined' ? undefined : window.localStorage,
  () => window.dispatchEvent(new Event(INSTALL_REMINDER_CHANGED_EVENT)),
)
