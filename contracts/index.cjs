const ROLES = Object.freeze({ SUPER_ADMIN: 'superadmin', CAMPUS_DIRECTOR: 'campus_director', HOD: 'hod',
  TEACHING_STAFF: 'teaching_staff', TEACHER: 'teacher', STUDENT: 'student' })
module.exports = { ROLES, ROLE_VALUES: Object.freeze(Object.values(ROLES)), ENROLLMENT_SLOT_COUNT: 8 }
module.exports.HOD_COURSE_CATEGORIES = Object.freeze([
  'DSS', 'DSC', 'DSE', 'VAC', 'SEC', 'MDC', 'MOOC', 'AEC', 'INT', 'FWD', 'RPH', 'CIP',
])
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

// Dependencies describe display data, never authorization.
const DATA_DOMAINS = ['catalogue', 'people', 'settings', 'enrollment', 'assignments', 'timetable', 'attendance', 'signin', 'jobs', 'logs']
module.exports.DATA_DOMAINS = Object.freeze(DATA_DOMAINS)
module.exports.dataReadDomains = input => {
  const path = String(input).split('?')[0].replace(/\/+$/, '')
  if (/\/export(?:\/|-)|\/health|\/auth\/(?!profile$)|\/consent\//.test(path) || /\/progress$/.test(path)) return []
  if (/\/auth\/profile$/.test(path)) return ['people']
  if (/\/admin\/logs$/.test(path)) return ['logs']
  if (/\/admin\/(campuses|departments)$/.test(path)) return ['catalogue', 'settings']
  if (/\/admin\/faculty-list$|\/hod\/(students|teachers)$|graduation-candidates$/.test(path)) return ['people', 'enrollment']
  if (/\/director\//.test(path)) return ['settings', 'people']
  if (/\/hod\/(courses|blueprint|departments|catalog-readiness)$|\/registrations\/pathway-slots$/.test(path)) return ['catalogue', 'settings']
  if (/\/assignments\//.test(path)) return ['catalogue', 'people', 'assignments', 'settings']
  if (/\/faculty\/defaulters$/.test(path)) return ['people', 'enrollment', 'settings']
  if (/\/faculty\//.test(path)) return ['people', 'catalogue', 'enrollment', 'assignments', 'settings']
  if (/\/attendance\/campus\//.test(path)) return ['people', 'settings', 'signin']
  if (/\/attendance\/period\//.test(path)) return ['people', 'enrollment', 'assignments', 'timetable', 'attendance', 'settings']
  if (/\/(timetable\/job-status|allocation\/status)$/.test(path)) return ['jobs', 'settings']
  if (/\/timetable\//.test(path)) return ['catalogue', 'people', 'enrollment', 'assignments', 'timetable', 'jobs', 'settings']
  if (/\/(registrations|allocation)\//.test(path) || /\/student\/dashboard-summary$/.test(path)) return ['catalogue', 'people', 'enrollment', 'settings', 'jobs']
  if (/\/credit-ledger\/|\/student\/courses/.test(path)) return ['catalogue', 'people', 'enrollment', 'assignments', 'settings']
  if (/\/student\/timetable$/.test(path)) return ['people', 'enrollment', 'assignments', 'timetable', 'settings']
  if (/\/student\/attendance$/.test(path)) return ['catalogue', 'people', 'enrollment', 'attendance', 'settings']
  if (/\/student\/overview$/.test(path)) return ['people', 'catalogue', 'enrollment', 'assignments', 'timetable', 'attendance', 'signin', 'settings']
  return []
}
module.exports.dataChangeDomains = input => {
  const path = String(input).split('?')[0]
  if (/\/auth\/|\/consent\//.test(path)) return []
  if (/promote-students|graduate-students|\/admin\/(campuses|departments)/.test(path)) return DATA_DOMAINS.slice()
  if (/\/hod\/courses|\/hod\/blueprint/.test(path)) return ['catalogue']
  if (/\/hod\/(students|bulk-students)|\/admin\/faculty|\/hod\/teachers/.test(path)) return ['people', 'enrollment', 'assignments', 'timetable']
  if (/\/director\//.test(path)) return ['settings']
  if (/\/attendance\/campus\//.test(path)) return ['signin']
  if (/\/attendance\/period\//.test(path)) return ['attendance']
  if (/\/assignments\//.test(path) || /\/timetable\/entries\/.+\/teacher/.test(path)) return ['assignments', 'timetable']
  if (/\/timetable\//.test(path)) return ['timetable', 'jobs']
  if (/\/allocation\//.test(path)) return ['enrollment', 'jobs', 'timetable']
  if (/\/registrations\//.test(path)) return ['enrollment']
  return []
}
module.exports.databaseChangeDomains = name => {
  if (/^current_/.test(name)) name = name.slice(8)
  if (/promote_campus|delete_graduating|delete_campus|delete_department/.test(name)) return DATA_DOMAINS.slice()
  if (/^(courses|semester_blueprints|departments|time_slots)$|update_hod_course/.test(name)) return ['catalogue']
  if (/^(students|faculty|admins|insert_student|update_student)$/.test(name)) return ['people', 'enrollment', 'assignments', 'timetable']
  if (/^(campuses|campus_settings)$|update_campus_settings/.test(name)) return ['settings', 'catalogue']
  if (/teacher_course_assignments|mutate_teacher_assignments/.test(name)) return ['assignments', 'timetable']
  if (/student_registrations|registration_preferences|apply_course_allocation|student_course_change|manual_course_allocation|submit_student_registration/.test(name)) return ['enrollment', 'jobs', 'timetable']
  if (/period_attendance|submit_period_attendance|copy_practical_attendance/.test(name)) return ['attendance']
  if (/campus_sign_ins|record_campus_sign_in/.test(name)) return ['signin']
  if (/timetable_entries|commit_manual_timetable|replace_timetable_draft|publish_timetable/.test(name)) return ['timetable', 'jobs']
  if (/system_logs|worker|claim_.*(job|run)/.test(name)) return ['jobs', 'logs']
  return []
}
module.exports.canonicalDataUrl = input => {
  const url = new URL(input, 'https://portal.invalid')
  url.searchParams.delete('_t')
  if (/\/attendance\/campus\/status\/|\/student\/overview$|\/attendance\/period\/(current|teacher-schedule)$/.test(url.pathname) && !url.searchParams.has('date')) {
    url.searchParams.set('_day', new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10))
  }
  url.searchParams.sort()
  return url.pathname + (url.searchParams.size ? '?' + url.searchParams.toString() : '')
}
// Clock-derived presentation is recalculated without refetching stored records.
module.exports.projectReadData = (input, value, now = Date.now()) => {
  if (!value || typeof value !== 'object') return value
  const path = String(input).split('?')[0], date = new Date(now + 330 * 60000).toISOString()
  const minutes = Number(date.slice(11,13))*60+Number(date.slice(14,16))
  const time = text => { const p=String(text).split(':').map(Number);return p[0]*60+p[1] }
  if (value.registrationWindow?.deadline) {
    const remaining = Date.parse(value.registrationWindow.deadline)-now
    return { ...value, registrationWindow: { ...value.registrationWindow,
      isOpen: value.registrationWindow.isOpen && remaining>0,
      hoursRemaining: remaining>0?Math.floor(remaining/3600000):null,
      isClosingSoon: value.registrationWindow.isOpen&&remaining>0&&remaining<=86400000 } }
  }
  if (/\/registrations\/(blueprint|my)$/.test(path) && value.deadline) return { ...value, windowOpen: value.windowOpen && now<Date.parse(value.deadline) }
  if (/\/attendance\/campus\/status\//.test(path) && value.campus) {
    if (value.date!==date.slice(0,10)) return { ...value, can_sign_in:false, unavailable_reason:'Refresh campus status for today.' }
    const active=minutes<time(value.campus.midday_split)?'morning':minutes<=time(value.campus.day_end)?'evening':'closed'
    const morning={...value.morning,state:value.morning.signed_in_at?'completed':minutes<time(value.campus.midday_split)?'pending':'absent'}
    const evening={...value.evening,state:value.evening.signed_in_at?'completed':minutes<=time(value.campus.day_end)?'pending':'absent'}
    const blocked=value.static_unavailable_reason || (value.unavailable_reason && !/^This session is already|^Campus checkpoints (?:are )?closed/.test(value.unavailable_reason)?value.unavailable_reason:null)
    const completed=active==='morning'?morning.state==='completed':active==='evening'&&evening.state==='completed'
    return {...value,morning,evening,active_session:active,current_time_ist:date.slice(11,19),can_sign_in:!blocked&&active!=='closed'&&!completed,
      unavailable_reason:blocked||(active==='closed'?'Campus checkpoints are closed.':completed?'This session is already recorded.':null)}
  }
  if (/\/attendance\/campus\/roster$/.test(path) && Array.isArray(value.roster)) {
    const roster=value.roster.map(row=>{
      const morning={...row.morning},evening={...row.evening}
      if (!morning.signed_in_at&&row.midday_split) morning.status=value.date===date.slice(0,10)&&minutes<time(row.midday_split)?'pending':'absent'
      if (!evening.signed_in_at&&row.day_end) evening.status=value.date===date.slice(0,10)&&minutes<=time(row.day_end)?'pending':'absent'
      const states=[morning.status,evening.status]
      return {...row,morning,evening,urgency_score:(states.includes('absent')?4:0)+(states.includes('late')||states.includes('early_leave')?3:0)+(states.includes('pending')?2:0)+(states.every(s=>s==='on_time')?1:0)}
    }).sort((a,b)=>b.urgency_score-a.urgency_score)
    const count=(session,status)=>roster.filter(row=>row[session].status===status).length
    return {...value,roster,summary:{total_students:roster.length,morning:{on_time:count('morning','on_time'),late:count('morning','late'),absent:count('morning','absent'),pending:count('morning','pending')},evening:{on_time:count('evening','on_time'),early_leave:count('evening','early_leave'),absent:count('evening','absent'),pending:count('evening','pending')}}}
  }
  return value
}
