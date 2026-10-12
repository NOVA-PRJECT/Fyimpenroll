const ROLES = Object.freeze({ SUPER_ADMIN: 'superadmin', CAMPUS_DIRECTOR: 'campus_director', HOD: 'hod',
  TEACHING_STAFF: 'teaching_staff', TEACHER: 'teacher', STUDENT: 'student' })
module.exports = { ROLES, ROLE_VALUES: Object.freeze(Object.values(ROLES)), ENROLLMENT_SLOT_COUNT: 8 }
module.exports.campusSessionLabel = session => {
  if (!session) return 'Unavailable'
  if (session.state === 'completed') return ({ on_time: 'On time', late: 'Late', early_leave: 'Early leave' })[session.status] || 'Recorded'
  return session.state === 'absent' ? 'Absent' : 'Pending'
}
module.exports.formatCampusTime = time => {
  const [hour, minute, second = 0] = time.split(':').map(Number)
  const seconds = second ? `:${String(second).padStart(2, '0')}` : ''
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')}${seconds} ${hour >= 12 ? 'PM' : 'AM'}`
}
