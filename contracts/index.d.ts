export const ROLES: Readonly<{ SUPER_ADMIN: 'superadmin'; CAMPUS_DIRECTOR: 'campus_director'; HOD: 'hod';
  TEACHING_STAFF: 'teaching_staff'; TEACHER: 'teacher'; STUDENT: 'student' }>
export const ROLE_VALUES: readonly ['superadmin', 'campus_director', 'hod', 'teaching_staff', 'teacher', 'student']
export type Role = typeof ROLE_VALUES[number]
export const ENROLLMENT_SLOT_COUNT: 8
export interface TeachingDelivery { delivery_id: string; id: string; campus_id: string; academic_year: string; semester: number }
