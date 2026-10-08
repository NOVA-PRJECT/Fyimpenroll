import { Role } from '../constants/roles'

export type Faculty = {
  id: string
  full_name: string
  email: string
  role: Role
  department_id: string | null
  campus_id: string
}

export type Campus = {
  id: string
  name: string
  code: string
}

export type CampusSettings = {
  id: string
  campus_id: string
  registration_is_open: boolean
  deadline: string
  academic_year: string
  min_credits: number
  max_credits: number
}

export type Department = {
  id: string
  name: string
  code: string
  campus_id: string
}

export type Admin = {
  id: string
  full_name: string
  email: string
  role: 'superadmin'
}