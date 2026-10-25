interface RecoverySessionSource {
  auth: { getSession(): Promise<{ data: { session: { access_token: string } | null } }> }
}

/** Recovery credentials must never be replaced by ambient portal cookies. */
export async function requestPasswordRecovery(
  provider: RecoverySessionSource,
  endpoint: '/api/auth/complete-password-reset' | '/api/auth/sync-password-status',
  body?: { newPassword: string },
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const { data } = await provider.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Your recovery session has expired. Request a new password reset link.')
  return fetcher(endpoint, {
    method: 'POST', credentials: 'omit', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  })
}
