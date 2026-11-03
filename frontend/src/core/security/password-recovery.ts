interface RecoverySessionSource {
  auth: { getSession(): Promise<{ data: { session: { access_token: string } | null } }> }
}

/** Recovery credentials must never be replaced by ambient portal cookies. */
export async function requestPasswordRecovery(
  provider: RecoverySessionSource,
  endpoint: '/api/auth/complete-password-reset' | '/api/auth/sync-password-status',
  body?: { newPassword: string; token_hash: string },
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let token: string | undefined
  if (endpoint.endsWith('/complete-password-reset')) {
    if (!body?.token_hash) throw new Error('Your recovery link has expired. Request a new password reset link.')
  } else {
    const { data } = await provider.auth.getSession()
    token = data.session?.access_token
    if (!token) throw new Error('Your recovery session has expired. Request a new password reset link.')
  }
  return fetcher(endpoint, {
    method: 'POST', credentials: 'omit', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
}
