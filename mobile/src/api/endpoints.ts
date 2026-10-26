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
  STUDENT_DASHBOARD: '/api/student/overview',
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
  FACULTY_SCHEDULED_PERIODS: '/api/attendance/period/teacher-schedule',

  // Period Marking (Part 2)
  PERIOD_ATTENDANCE_CURRENT: '/api/attendance/period/current',
  PERIOD_ATTENDANCE_SUBMIT: '/api/attendance/period/submit',
  PERIOD_ATTENDANCE_ROSTER: '/api/attendance/period/roster',

  // HOD
  HOD_ABSENCE_SUMMARY: '/api/attendance/campus/roster',

};
