/**
 * Backend API Endpoints on NestJS
 */

export const API_ENDPOINTS = {
  // System Health
  HEALTH: '/api/health',

  // Auth
  AUTH_LOGIN: '/api/auth/login',
  AUTH_LOGOUT: '/api/auth/logout',
  AUTH_PROFILE: '/api/auth/profile',

  // Student
  STUDENT_DASHBOARD: '/api/student/dashboard-summary',
  STUDENT_TIMETABLE: '/api/student/timetable',
  STUDENT_COURSES: '/api/student/courses',
  STUDENT_ATTENDANCE: '/api/student/attendance',
  CREDIT_LEDGER_ME: '/api/credit-ledger/me',
  CREDIT_LEDGER: (studentId: string) => `/api/credit-ledger/${studentId}`,
  STUDENT_CAMPUS_SIGN_IN: '/api/attendance/campus/sign-in',
  CAMPUS_SIGN_IN: '/api/attendance/campus/sign-in',
  CAMPUS_STATUS: '/api/attendance/campus/status',
  CAMPUS_ROSTER: '/api/attendance/campus/roster',

  // Teacher / Faculty
  FACULTY_SCHEDULED_PERIODS: '/api/faculty/scheduled-periods',
  FACULTY_PERIOD_MARKING: '/api/faculty/mark-period',
  FACULTY_ROSTER: '/api/faculty/roster',

  // Period Marking (Part 2)
  PERIOD_ATTENDANCE_CURRENT: '/api/attendance/period/current',
  PERIOD_ATTENDANCE_SUBMIT: '/api/attendance/period/submit',
  PERIOD_ATTENDANCE_ROSTER: '/api/attendance/period/roster',
  PERIOD_ATTENDANCE_UNLOCK: '/api/attendance/period/unlock',

  // HOD
  HOD_ABSENCE_SUMMARY: '/api/hod/absence-summary',
  HOD_SIGN_IN_ROSTER: '/api/hod/campus-sign-in-roster',
  HOD_UNLOCK_MARKING: '/api/hod/unlock-period-marking',
  HOD_ANNOUNCEMENTS: '/api/hod/announcements',

  // Notices
  NOTICES: '/api/notices',
};
