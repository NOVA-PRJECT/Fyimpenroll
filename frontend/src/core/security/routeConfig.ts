import { Role } from '../constants/roles'

export const ROLE_DASHBOARD_MAP: Record<Role, string> = {
  superadmin: '/dashboard/superadmin',
  campus_director: '/dashboard/director',
  hod: '/dashboard/hod',
  teaching_staff: '/dashboard/teaching_staff',
  teacher: '/dashboard/teacher',
  student: '/dashboard/student',
}

export const DASHBOARD_ROLE_MAP: Record<string, Role> = {
  '/dashboard/superadmin': 'superadmin',
  '/dashboard/director': 'campus_director',
  '/dashboard/hod': 'hod',
  '/dashboard/teaching_staff': 'teaching_staff',
  '/dashboard/teacher': 'teacher',
  '/dashboard/student': 'student',
}
