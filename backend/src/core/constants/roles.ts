export const ROLES = {
  SUPER_ADMIN: 'superadmin',
  CAMPUS_DIRECTOR: 'campus_director',
  HOD: 'hod',
  TEACHING_STAFF: 'teaching_staff',
  TEACHER: 'teacher',
  STUDENT: 'student',
} as const

export type Role = typeof ROLES[keyof typeof ROLES]