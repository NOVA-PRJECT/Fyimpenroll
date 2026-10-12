const { test } = require('node:test')
const assert = require('node:assert/strict')
const { CampusAttendanceService } = require('../dist/modules/campus-attendance/campus-attendance.service')
const { CampusSignInSchema } = require('../dist/modules/campus-attendance/dto/campus-attendance.dto')
const { DirectorService } = require('../dist/modules/director/director.service')
const { campusSessionLabel } = require('@fyimp/contracts')

const campus = { id: 'campus-a', name: 'Campus A', center_latitude: 12, center_longitude: 75, radius_meters: 500,
  morning_cutoff_time: '09:30:00', midday_split_time: '13:30:00', evening_cutoff_time: '15:30:00', day_end_time: '17:00:00' }
const user = { userId: 'student-a', role: 'student', campus_id: campus.id, department_id: 'dept-a' }
const now = '2026-10-12T03:30:00.000Z'
function fixture(options = {}) {
  const home = { ...campus, ...options.campus }
  const tables = { students: [{ id: user.userId, full_name: 'Student', department_id: 'dept-a', campus_id: home.id, campuses: home }],
    campuses: [home, { ...home, id: 'campus-b' }], campus_sign_ins: [], ...options.tables }
  const inserts = [], audit = []
  const admin = { from(table) {
    const predicates = []; let insert, update, range
    const result = () => {
      if (options.readError && !insert && table === 'campus_sign_ins') return { data: null, error: { message: 'private db error' } }
      if (insert) {
        if (options.insertError) return { data: null, error: options.insertError }
        const date = new Date(Date.parse(insert.signed_in_at) + 19800000).toISOString().slice(0, 10)
        if (tables[table].some(row => row.student_id === insert.student_id && row.campus_id === insert.campus_id && row.session_type === insert.session_type && row.signed_in_date === date)) return { data: null, error: { code: '23505' } }
        const row = { id: 'record-' + tables[table].length, ...insert, signed_in_date: date }
        tables[table].push(row); inserts.push(insert)
        return { data: [row], error: null }
      }
      let rows = (tables[table] || []).filter(row => predicates.every(fn => fn(row)))
      if (update) rows.forEach(row => Object.assign(row, update))
      if (range) rows = rows.slice(range[0], range[1] + 1)
      return { data: rows, error: null }
    }
    const query = { select() { return this }, order() { return this },
      eq(key, value) { predicates.push(row => row[key] === value); return this },
      in(key, values) { predicates.push(row => values.includes(row[key])); return this },
      range(from, to) { range = [from, to]; return this },
      insert(value) { insert = value; return this }, update(value) { update = value; return this },
      async maybeSingle() { const res = result(); return { ...res, data: res.data?.[0] || null } },
      single() { return this.maybeSingle() }, then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) } }
    return query
  } }
  const logger = { log: async event => audit.push(event) }
  return { service: new CampusAttendanceService({ admin }, logger), director: new DirectorService({ admin }, logger, {}), tables, inserts, audit }
}
function freeze(t, date = now) { t.mock.timers.enable({ apis: ['Date'], now: Date.parse(date) }) }
function sign(service, timestamp = new Date().toISOString(), lat = 12, lon = 75, accuracy = 10) {
  return service.recordCampusSignIn(user, lat, lon, accuracy, '127.0.0.1', timestamp)
}

test('records current presence, shares accurate status and retains no raw location', async t => {
  freeze(t); const f = fixture()
  const saved = await sign(f.service)
  assert.equal(saved.status, 'on_time')
  assert.equal(f.inserts[0].signed_in_date, undefined, 'database derives the IST date')
  assert.equal(f.inserts[0].latitude, undefined)
  assert.equal(f.audit[0].metadata.latitude, undefined)
  const status = await f.service.getStudentCampusStatus(user, user.userId)
  assert.equal(status.morning.state, 'completed')
  assert.equal(campusSessionLabel(status.morning), 'On time')
  assert.equal(status.can_sign_in, false)
  await assert.rejects(sign(f.service), error => error.getStatus() === 409)
})

for (const [time, session, label] of [
  ['09:30:00', 'morning', 'on_time'], ['09:30:01', 'morning', 'late'],
  ['13:29:59', 'morning', 'late'], ['13:30:00', 'evening', 'early_leave'],
  ['15:29:59', 'evening', 'early_leave'], ['15:30:00', 'evening', 'on_time'], ['17:00:00', 'evening', 'on_time'],
]) test(`IST boundary ${time} records ${session}/${label}`, async t => {
  freeze(t, `2026-10-12T${time}+05:30`); const f = fixture()
  const before = await f.service.getStudentCampusStatus(user, user.userId)
  assert.equal(before.can_sign_in, true)
  assert.equal(before[session].state, 'pending')
  const saved = await sign(f.service)
  assert.equal(saved.session_type, session); assert.equal(saved.status, label)
})

test('custom close times control both submission and displayed status', async t => {
  freeze(t, '2026-10-12T16:00:01+05:30')
  const f = fixture({ campus: { day_end_time: '16:00:00' } })
  const status = await f.service.getStudentCampusStatus(user, user.userId)
  assert.equal(status.active_session, 'closed'); assert.equal(status.evening.state, 'absent')
  assert.match(status.unavailable_reason, /4:00 PM/)
  await assert.rejects(sign(f.service), /4:00 PM IST/)
})

test('rejects stale, future and cross-session captures instead of replaying offline attendance', async t => {
  freeze(t, '2026-10-12T13:30:10+05:30'); const { service, inserts } = fixture()
  await assert.rejects(sign(service, '2026-10-12T13:28:00+05:30'), /expired/)
  await assert.rejects(sign(service, '2026-10-12T13:31:00+05:30'), /clock/)
  await assert.rejects(sign(service, '2026-10-12T13:29:59+05:30'), /session changed/)
  assert.equal(inserts.length, 0)
})

test('validates location accuracy, mocked flags and required timestamps', async t => {
  freeze(t); const f = fixture()
  const valid = { latitude: 12, longitude: 75, accuracy: 10, client_timestamp: now }
  for (const bad of [{ accuracy: -1 }, { accuracy: 51 }, { accuracy: Infinity }, { latitude: NaN }, { longitude: 181 }, { client_timestamp: undefined }, { mocked: true }]) {
    assert.equal(CampusSignInSchema.safeParse({ ...valid, ...bad }).success, false)
  }
  await assert.rejects(sign(f.service, now, 13, 75), /Outside campus/)
  await assert.rejects(sign(f.service, now, 12, 75, -1))
  assert.equal(f.inserts.length, 0)
})

for (const invalid of [{ center_latitude: undefined }, { center_latitude: null }, { center_longitude: 181 }, { radius_meters: -1 }, { midday_split_time: 'bad' }, { evening_cutoff_time: '08:00:00' }]) {
  test(`invalid campus setup fails closed: ${JSON.stringify(invalid)}`, async t => {
    freeze(t); const f = fixture({ campus: invalid })
    await assert.rejects(sign(f.service), /not configured/)
    const status = await f.service.getStudentCampusStatus(user, user.userId)
    assert.equal(status.can_sign_in, false); assert.match(status.unavailable_reason, /not configured/)
  })
}

test('duplicate races return conflict; failed lookups never lead to writes', async t => {
  freeze(t)
  const race = fixture({ insertError: { code: '23505', message: 'private database detail' } })
  await assert.rejects(sign(race.service), error => error.getStatus() === 409)
  const failed = fixture({ readError: true })
  await assert.rejects(sign(failed.service), /Unable to check/)
  assert.equal(failed.inserts.length, 0)
})

test('two simultaneous check-ins produce exactly one record and one conflict', async t => {
  freeze(t); const f = fixture()
  const results = await Promise.allSettled([sign(f.service), sign(f.service)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.getStatus(), 409)
  assert.equal(f.inserts.length, 1)
})

test('one millisecond past day end is closed and missing campus is actionable', async t => {
  freeze(t, '2026-10-12T17:00:00.001+05:30'); const f = fixture()
  assert.equal((await f.service.getStudentCampusStatus(user, user.userId)).can_sign_in, false)
  await assert.rejects(sign(f.service), /closed/)
  f.tables.students[0].campuses = null; f.tables.students[0].campus_id = null
  assert.match((await f.service.getStudentCampusStatus(user, user.userId)).unavailable_reason, /No campus/)
})

test('status ignores previous-campus records and enforces actor scope', async t => {
  freeze(t); const f = fixture({ tables: { campus_sign_ins: [{ student_id: user.userId, campus_id: 'old-campus', signed_in_date: '2026-10-12', session_type: 'morning', status: 'on_time' }] } })
  assert.equal((await f.service.getStudentCampusStatus(user, user.userId)).morning.state, 'pending')
  await assert.rejects(f.service.getStudentCampusStatus({ ...user, userId: 'other' }, user.userId), error => error.getStatus() === 403)
  await assert.rejects(f.service.getStudentCampusStatus({ role: 'campus_director', campus_id: 'other' }, user.userId), error => error.getStatus() === 403)
})

test('all-campus roster uses each campus schedule and rejects invalid or future dates', async t => {
  freeze(t, '2026-10-12T14:00:00+05:30')
  const f = fixture({ tables: { students: [
    { id: 'a', campus_id: 'campus-a', campuses: campus },
    { id: 'b', campus_id: 'campus-b', campuses: { ...campus, midday_split_time: '14:30:00' } },
  ] } })
  const roster = await f.service.getDepartmentCampusRoster({ role: 'superadmin' })
  assert.equal(roster.roster.find(row => row.id === 'a').morning.status, 'absent')
  assert.equal(roster.roster.find(row => row.id === 'b').morning.status, 'pending')
  for (const date of ['invalid', '2026-02-30', '2026-10-13']) await assert.rejects(f.service.getDepartmentCampusRoster({ role: 'superadmin' }, date))
})

test('director can configure only their campus, with validated coordinates and ordered timings', async () => {
  const f = fixture(); const actor = { role: 'campus_director', userId: 'director', campus_id: campus.id }
  const { id, name, ...settings } = campus
  await f.director.updateAttendanceSettings({ ...settings, radius_meters: 650 }, actor)
  assert.equal(f.tables.campuses[0].radius_meters, 650); assert.equal(f.tables.campuses[1].radius_meters, 500)
  assert.equal((await f.director.getAttendanceSettings(actor)).settings.radius_meters, 650)
  await assert.rejects(f.director.updateAttendanceSettings({ ...settings, campus_id: 'campus-b' }, actor))
  await assert.rejects(f.director.updateAttendanceSettings({ ...settings, morning_cutoff_time: '19:00' }, actor))
  await assert.rejects(f.director.updateAttendanceSettings(settings, { ...actor, role: 'student' }))
})
