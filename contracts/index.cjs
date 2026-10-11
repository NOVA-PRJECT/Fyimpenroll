const ROLES = Object.freeze({ SUPER_ADMIN: 'superadmin', CAMPUS_DIRECTOR: 'campus_director', HOD: 'hod',
  TEACHING_STAFF: 'teaching_staff', TEACHER: 'teacher', STUDENT: 'student' })
module.exports = { ROLES, ROLE_VALUES: Object.freeze(Object.values(ROLES)), ENROLLMENT_SLOT_COUNT: 8 }
