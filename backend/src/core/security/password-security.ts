import { createHash } from 'node:crypto'
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common'

/** Pwned Passwords k-anonymity: only five SHA-1 hex characters leave the server. */
export async function assertPasswordNotCompromised(password: string): Promise<void> {
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
  let compromised = false
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'FYIMP-Portal-Password-Security' },
      signal: AbortSignal.timeout(5000), redirect: 'error',
    })
    if (!response.ok) throw new Error('Password screening unavailable')
    const body = await response.text()
    const lines = body.trim().split(/\r?\n/)
    if (!lines.length || lines.some(line => !/^[A-F0-9]{35}:\d+$/.test(line))) {
      throw new Error('Invalid password screening response')
    }
    compromised = lines.some(line => {
      const [suffix, count] = line.split(':')
      return suffix === digest.slice(5) && Number(count) > 0
    })
  } catch {
    // A failed check must never be treated as evidence that the password is safe.
    throw new ServiceUnavailableException('Password security checking is temporarily unavailable. Please retry shortly.')
  }
  if (compromised) throw new BadRequestException({ code: 'PASSWORD_COMPROMISED', field: 'new_password',
    message: 'This password has appeared in a known data breach. Choose a different password.' })
}
