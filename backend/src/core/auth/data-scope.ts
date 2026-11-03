import { createHash } from 'node:crypto'
import { AuthUser } from './types'

/** Called only after the guard verifies the access token with Auth. */
export function dataScope(user: AuthUser): string {
  let session = user.token || ''
  try { session = JSON.parse(Buffer.from(session.split('.')[1], 'base64url').toString()).session_id || session } catch {}
  return createHash('sha256').update(JSON.stringify([user.userId, session, user.role, user.campus_id,
    user.department_id, user.current_semester, user.term_version])).digest('hex')
}
