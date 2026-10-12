export interface DashboardEntry { path: string; endpoint: string; data: unknown }
const KEY = 'fyimp_dashboard_entry'

/** UI data only. Middleware and every protected API still verify permissions. */
export function saveDashboardEntry(entry?: DashboardEntry) {
  try {
    sessionStorage.removeItem(KEY)
    if (entry?.path && entry.endpoint && entry.data != null) {
      sessionStorage.setItem(KEY, JSON.stringify({ ...entry, createdAt: Date.now() }))
    }
  } catch { /* Storage disabled/full: keep the normal dashboard API path. */ }
}

export function takeDashboardEntry(path: string, endpoint: string): DashboardEntry | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    sessionStorage.removeItem(KEY)
    const entry = JSON.parse(raw)
    const age = Date.now() - entry.createdAt
    return entry.path === path && entry.endpoint === endpoint && entry.data != null && age >= 0 && age < 60000 ? entry : null
  } catch { return null }
}
