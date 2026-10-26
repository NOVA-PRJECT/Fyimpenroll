import type { Role } from '@fyimp/contracts'
export type { Role } from '@fyimp/contracts'

export interface AuthUser {
  userId: string
  email: string
  role: Role
  department_id?: string | null
  campus_id?: string | null
  must_change_password?: boolean
  current_semester?: number
  term_version?: number
  full_name?: string
  token?: string
  consent?: { accepted: boolean; currentVersion: string }
}

export interface RequestWithUser extends Request {
  user: AuthUser
}
