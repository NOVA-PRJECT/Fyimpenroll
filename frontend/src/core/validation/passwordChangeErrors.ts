import { apiErrorMessage } from '../api-error'

export function passwordChangeError(body: unknown, status: number) {
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const code = typeof data.code === 'string' ? data.code : ''
  let message: string
  if (status === 429) message = 'Too many password-change attempts. Wait a few minutes and try again.'
  else if (status === 503) message = 'The password service is temporarily unavailable. Please try again shortly.'
  else message = apiErrorMessage(data, 'Unable to update your password. Please try again.', status)
  const field = data.field === 'current_password' || data.field === 'new_password' ? data.field
    : code === 'CURRENT_PASSWORD_INCORRECT' ? 'current_password'
    : ['PASSWORD_UNCHANGED', 'PASSWORD_TOO_WEAK', 'NEW_PASSWORD_REJECTED'].includes(code) ? 'new_password'
    : message === 'Current password is incorrect' ? 'current_password' : undefined
  return { message, field }
}
