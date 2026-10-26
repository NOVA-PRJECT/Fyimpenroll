const crypto = require('node:crypto')
const removed = ['period_unlock_requests','department_notices','retired_cohorts','graduation_operations','graduation_candidates','promotion_receipts']
const keys = {
 admins:['id'],campus_settings:['id'],campus_sign_ins:['id'],campuses:['id'],consent_records:['id'],courses:['id'],departments:['id'],faculty:['id'],
 period_attendance:['id'],period_attendance_sessions:['id'],registration_preferences:['id'],schema_migrations:['version'],semester_blueprints:['id'],
 student_registrations:['id'],students:['id'],system_logs:['id'],teacher_course_assignments:['id'],time_slots:['id'],timetable_conflicts:['id'],timetable_entries:['id'],
 period_unlock_requests:['id'],department_notices:['id'],retired_cohorts:['id'],graduation_operations:['id'],graduation_candidates:['student_id'],promotion_receipts:['campus_id','request_key'],
}
const canonical = value => value instanceof Date ? value.toISOString() : typeof value==='string' && /^\d{4}-\d{2}-\d{2}[T ]\d\d:/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value
const fingerprint = rows => crypto.createHash('sha256').update(JSON.stringify(canonical(rows))).digest('hex')
async function snapshot(db, stage) {
 if (!['before','after'].includes(stage)) throw new Error('Stage must be before or after')
 const tables = {}, fingerprints = {}
 for (const [table, order] of Object.entries(keys)) {
  if (stage==='after' && removed.includes(table)) continue
  const rows=[]
  for(let offset=0;;offset+=500) {
   let q=db.from(table).select('*'); for(const key of order)q=q.order(key)
   const {data,error}=await q.range(offset,offset+499)
   if(error)throw new Error(`Unable to snapshot ${table}: ${error.message}`)
   rows.push(...data);if(data.length<500)break
  }
  tables[table]=rows;fingerprints[table]=fingerprint(rows)
 }
 return {stage,tables,fingerprints}
}
function compare(before,after) {
 for(const table of Object.keys(keys).filter(t=>!removed.includes(t))) {
  if(!before.tables[table] || !after.tables[table])throw new Error(`Missing retained table ${table}`)
  const clean=rows=>rows.map(row=>{const copy={...row};delete copy.term_version; if(table==='campus_settings')delete copy.term_started_at; return copy})
  if(fingerprint(clean(before.tables[table]))!==fingerprint(clean(after.tables[table])))throw new Error(`Retained data changed in ${table}`)
 }
}
module.exports={keys,removed,fingerprint,snapshot,compare}
