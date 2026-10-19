const generic = /^(bad request|conflict|internal server error|error|unauthorized|forbidden|not found)$/i

/** Nest errors carry a useful message alongside a generic HTTP error label. */
export function apiErrorMessage(body: unknown, fallback: string, status?: number): string {
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const details = data.details as { fieldErrors?: Record<string, unknown>; formErrors?: unknown } | undefined
  const messages = (value: unknown): string[] => (Array.isArray(value) ? value : [value])
    .filter((v): v is string => typeof v === 'string' && !!v.trim() && !generic.test(v.trim()))
  const fields = details?.fieldErrors ? Object.entries(details.fieldErrors).flatMap(([field, value]) =>
    messages(value).map(message => `${field.replaceAll('_', ' ')}: ${message}`)) : []
  const text = [...fields, ...messages(details?.formErrors), ...messages(data.message), ...messages(data.error)][0]
  if (status === 401) return 'Your session has expired. Sign in again and retry.'
  if (status && status >= 500) return fallback
  return fields.length ? fields.join('; ') : text || (status === 403 ? 'You do not have permission to perform this action.' : fallback)
}

export async function adminRequest(url: string, fallback: string, init?: RequestInit) {
  let response: Response
  try { response = await fetch(url, init) }
  catch { throw new Error(`${fallback} Check your connection and retry.`) }
  const data = await response.json().catch(() => null)
  if (!response.ok || data === null) throw new Error(apiErrorMessage(data, fallback, response.status))
  return data
}
