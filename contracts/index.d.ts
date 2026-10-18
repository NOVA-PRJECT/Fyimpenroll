export const ROLES: Readonly<{ SUPER_ADMIN: 'superadmin'; CAMPUS_DIRECTOR: 'campus_director'; HOD: 'hod';
  TEACHING_STAFF: 'teaching_staff'; TEACHER: 'teacher'; STUDENT: 'student' }>
export const ROLE_VALUES: readonly ['superadmin', 'campus_director', 'hod', 'teaching_staff', 'teacher', 'student']
export type Role = typeof ROLE_VALUES[number]
export const ENROLLMENT_SLOT_COUNT: 8
export interface TeachingDelivery { delivery_id: string; id: string; campus_id: string; academic_year: string; semester: number }
export interface CampusAttendanceStatus {
  date: string
  current_time_ist: string
  active_session: 'morning' | 'evening' | 'closed'
  can_sign_in: boolean
  unavailable_reason: string | null
  campus: {
    id: string | null; name: string | null; radius_meters: number
    morning_cutoff: string; midday_split: string; evening_cutoff: string; day_end: string
  }
  morning: CampusAttendanceSession
  evening: CampusAttendanceSession
}
export interface CampusAttendanceSession {
  state: 'completed' | 'pending' | 'absent'
  status: 'on_time' | 'late' | 'early_leave' | null
  signed_in_at: string | null
}
export function campusSessionLabel(session?: CampusAttendanceSession): string
export function formatCampusTime(time: string): string
export const HOD_COURSE_CATEGORIES: readonly ['DSS', 'DSC', 'DSE', 'VAC', 'SEC', 'MDC', 'MOOC', 'AEC', 'INT', 'FWD', 'RPH', 'CIP'];
