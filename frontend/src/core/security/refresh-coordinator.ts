/**
 * Cookie-Compatible API Session Refresh Coordinator (R30)
 *
 * Coordinates token refresh across all in-browser API activity.
 * - Deduplicates concurrent 401 refresh requests into a single in-flight call to /api/auth/refresh
 * - Retries safe reads (GET, HEAD, OPTIONS) once with updated cookies
 * - Retries mutations only with idempotency or an explicit pre-handler authentication rejection
 * - Distinguishes transient provider/backend outages (503/network) from genuine session revocation (401/400)
 */

interface RefreshResult {
  success: boolean
  outage?: boolean
  error?: string
}

let activeRefreshPromise: Promise<RefreshResult> | null = null
let isInterceptionInstalled = false
let sessionGeneration = 0
let refreshRevision = 0
let sessionEnding = false
let refreshController: AbortController | null = null

export function beginSessionLogout(): void {
  sessionEnding = true
  refreshController?.abort()
  invalidateRefreshSession()
}

export function resumeSessionAfterLogoutFailure(): void { sessionEnding = false }

export function invalidateRefreshSession(): void {
  sessionGeneration += 1
  activeRefreshPromise = null
}

export async function coordinateRefresh(): Promise<RefreshResult> {
  if (sessionEnding) return { success: false, error: 'Session ending' }
  if (activeRefreshPromise) {
    return activeRefreshPromise
  }

  const generation = sessionGeneration
  const controller = new AbortController()
  refreshController = controller
  const timeout = setTimeout(() => controller.abort(), 10000)
  activeRefreshPromise = (async (): Promise<RefreshResult> => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal,
      })

      if (generation !== sessionGeneration) return { success: false, error: 'Session ended' }
      if (response.ok) {
        refreshRevision += 1
        return { success: true }
      }

      if (response.status >= 500 || response.status === 429) {
        // Transient server or rate-limit outage: do NOT eject user
        return { success: false, outage: true, error: `Auth service temporarily unavailable (${response.status})` }
      }

      // Explicit revocation or invalid token (400, 401, 403)
      return { success: false, outage: false, error: 'Session expired or revoked' }
    } catch (err: unknown) {
      // Network disconnect or DNS failure: transient outage
      return { success: false, outage: true, error: (err instanceof Error ? err.message : '') || 'Network error during session refresh' }
    } finally {
      clearTimeout(timeout)
      if (refreshController === controller) refreshController = null
      if (generation === sessionGeneration) activeRefreshPromise = null
    }
  })()

  return activeRefreshPromise
}

export interface ApiFetchOptions {
  idempotent?: boolean
  skipRefreshRetry?: boolean
}

function isSafeMethod(method?: string): boolean {
  if (!method) return true
  const upper = method.toUpperCase()
  return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS'
}

function hasIdempotencyHeader(headers?: HeadersInit): boolean {
  if (!headers) return false
  if (headers instanceof Headers) {
    return headers.has('idempotency-key') || headers.has('x-safe-retry')
  }
  if (Array.isArray(headers)) {
    return headers.some(([k]) => {
      const l = k.toLowerCase()
      return l === 'idempotency-key' || l === 'x-safe-retry'
    })
  }
  return Object.keys(headers).some((k) => {
    const l = k.toLowerCase()
    return l === 'idempotency-key' || l === 'x-safe-retry'
  })
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: ApiFetchOptions,
): Promise<Response> {
  const originalFetch = (typeof window !== 'undefined' && window.__originalFetch) || fetch
  const generation = sessionGeneration
  const revision = refreshRevision
  // Preserve a Request body before fetch consumes it, for a permitted single retry.
  const retryInput = input instanceof Request ? input.clone() : input
  const response = await originalFetch(input, init)

  // Only intercept 401 Unauthorized responses for /api/ endpoints (excluding auth refresh/login/logout itself)
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
  const isAuthEndpoint =
    urlStr.includes('/api/auth/refresh') ||
    urlStr.includes('/api/auth/login') ||
    urlStr.includes('/api/auth/logout')

  if (response.status !== 401 || isAuthEndpoint || options?.skipRefreshRetry) {
    return response
  }

  // Determine if this request is eligible for safe retry
  const method = init?.method || (input instanceof Request ? input.method : 'GET')
  const isSafe = isSafeMethod(method)
  const isIdempotentMutation = !isSafe && (options?.idempotent || hasIdempotencyHeader(init?.headers || (input instanceof Request ? input.headers : undefined)))

  const rejectedBeforeHandler = !isSafe &&
    (await response.clone().json().catch(() => null))?.code === 'AUTH_SESSION_REJECTED'

  if (!isSafe && !isIdempotentMutation && !rejectedBeforeHandler) {
    // Non-idempotent mutation without proof of commit safety: do not blindly replay
    return response
  }

  // Attempt coordinated refresh
  // A late 401 from an older concurrent request must not renew an already
  // refreshed session, or bring back an account that has since logged out.
  if (generation !== sessionGeneration) return response
  const refreshResult: RefreshResult = revision !== refreshRevision ? { success: true } : await coordinateRefresh()
  if (generation !== sessionGeneration) return response
  if (!refreshResult.success) {
    if (refreshResult.outage) {
      return Response.json({ message: 'Authentication service is temporarily unavailable. Please retry.' }, { status: 503 })
    }
    return Response.json({ message: 'Your session has expired. Please sign in again.' }, { status: 401 })
  }
  if (init?.signal?.aborted || (input instanceof Request && input.signal.aborted)) {
    return response
  }

  // Retry the request once with fresh session cookies
  return originalFetch(retryInput, init)
}

/**
 * Installs global fetch interception on the browser window so that all
 * dashboard fetch('/api/...') calls automatically benefit from deduplicated
 * session refresh and controlled safe retry without refactoring every component.
 */
export function installGlobalFetchInterceptor(): void {
  if (typeof window === 'undefined' || isInterceptionInstalled) return

  const nativeFetch = window.fetch
  ;window.__originalFetch = nativeFetch

  window.fetch = async function interceptedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
    if (urlStr.includes('/api/auth/logout')) invalidateRefreshSession()
    const isApiCall = urlStr.startsWith('/api/') || urlStr.includes('/api/')

    if (!isApiCall) {
      return nativeFetch.apply(window, [input, init])
    }

    return apiFetch(input, init)
  }

  isInterceptionInstalled = true
}
