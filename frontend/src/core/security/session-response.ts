/** Only explicit authentication restrictions should navigate away from a failed request. */
export function sessionRedirect(status: number, payload: { must_change_password?: boolean; consent_required?: boolean }) {
  if (status === 401) return '/login'
  if (status === 403 && payload.must_change_password) return '/change-password'
  if (status === 403 && payload.consent_required) return '/consent'
  return null
}
