// Export while application writes are paused. Never commit the output.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { createClient } = require('@supabase/supabase-js')

const tables = {
  admins: ['id'], campus_settings: ['id'], campus_sign_ins: ['id'], campuses: ['id'],
  consent_records: ['id'], course_prerequisite_rules: ['id'], courses: ['id'],
  department_notices: ['id'], departments: ['id'], faculty: ['id'],
  graduation_candidates: ['operation_id', 'student_id'], graduation_operations: ['id'],
  period_attendance: ['id'], period_attendance_sessions: ['id'], period_unlock_requests: ['id'],
  promotion_receipts: ['campus_id', 'request_key'], registration_preferences: ['id'],
  retired_cohorts: ['id'], schema_migrations: ['version'], semester_blueprints: ['id'],
  student_registrations: ['id'], students: ['id'], system_logs: ['id'],
  teacher_course_assignments: ['id'], time_slots: ['id'], timetable_conflicts: ['id'], timetable_entries: ['id'],
}
const fingerprint = rows => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')

async function main() {
  const output = process.argv[2]
  if (!output) throw new Error('Supply a new backup filename outside version control.')
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Backend Supabase credentials are required.')
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  async function read(table, keys) {
    const rows = []
    for (let offset = 0; ; offset += 500) {
      let query = db.from(table).select('*')
      for (const key of keys) query = query.order(key)
      const { data, error } = await query.range(offset, offset + 499)
      if (error) throw new Error(`Cannot export ${table}: ${error.message}`)
      rows.push(...data)
      if (data.length < 500) return rows
    }
  }
  const backup = { exported_at: new Date().toISOString(), project: new URL(SUPABASE_URL).hostname, tables: {}, fingerprints: {} }
  for (const [table, keys] of Object.entries(tables)) {
    backup.tables[table] = await read(table, keys)
    backup.fingerprints[table] = fingerprint(backup.tables[table])
  }
  // A second complete read catches intervening writes and pagination inconsistencies.
  for (const [table, keys] of Object.entries(tables)) {
    if (fingerprint(await read(table, keys)) !== backup.fingerprints[table]) throw new Error(`Writes detected in ${table}; pause writes and export again.`)
  }
  const filename = path.resolve(output)
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, JSON.stringify(backup, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  const verified = JSON.parse(fs.readFileSync(filename, 'utf8'))
  if (JSON.stringify(verified) !== JSON.stringify(backup)) throw new Error('Backup read-back verification failed.')
  console.log(`Verified ${Object.keys(tables).length} tables; ${backup.tables.student_registrations.length} registrations, ${backup.tables.courses.length} courses. ${filename}`)
}
module.exports = { tables, fingerprint }
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
