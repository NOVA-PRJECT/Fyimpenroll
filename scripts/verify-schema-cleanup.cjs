// Read-only post-release comparison. Keep writes paused until this passes.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { createClient } = require('@supabase/supabase-js')
const { tables } = require('./export-schema-cleanup.cjs')

function retainedRecord(table, record) {
  const result = { ...record }
  const omitted = {
    courses: ['tag', 'prerequisite_course_ids'],
    student_registrations: ['preferences', 'selected_courses'],
    time_slots: ['is_lab_block', 'lab_pair_with'],
    graduation_operations: ['candidate_student_ids', 'completed_student_ids', 'failed_student_ids', 'stage_details'],
    semester_blueprints: Array.from({ length: 6 }, (_, i) => ['rule', 'target', 'name'].map(field => `slot_${i + 1}_${field}`)).flat(),
  }
  if (table === 'registration_preferences') {
    result.legacy_allocation_metadata_snapshot = result.allocation_metadata
    delete result.allocation_metadata
  }
  if (table === 'semester_blueprints' && (!result.pathways || result.pathways.length === 0)) {
    let last = 0
    for (let i = 1; i <= 6; i++) if (result[`slot_${i}_rule`]) last = i
    result.pathways = last ? [{ id: 'legacy-default', name: 'Default', slots: Array.from({ length: last }, (_, i) => ({
      rule: result[`slot_${i + 1}_rule`] ?? '', target: result[`slot_${i + 1}_target`] ?? '', name: result[`slot_${i + 1}_name`] ?? `Paper ${i + 1}`,
    })) }] : []
  }
  for (const key of omitted[table] ?? []) delete result[key]
  return result
}

async function main() {
  const backupFile = process.argv[2]
  if (!backupFile) throw new Error('Supply the verified pre-release backup filename.')
  const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'))
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Backend Supabase credentials are required.')
  if (backup.project !== new URL(SUPABASE_URL).hostname) throw new Error('Backup belongs to a different project.')
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: readiness, error: readinessError } = await db.rpc('production_readiness')
  if (readinessError || !readiness?.ready) throw new Error('Database readiness failed.')
  for (const [table, keys] of Object.entries(tables)) {
    if (table === 'course_prerequisite_rules') continue
    const saved = []
    for (let offset = 0; ; offset += 500) {
      let query = db.from(table).select('*')
      for (const key of keys) query = query.order(key)
      const { data, error } = await query.range(offset, offset + 499)
      if (error) throw new Error(`Cannot verify ${table}: ${error.message}`)
      saved.push(...data)
      if (data.length < 500) break
    }
    try { assert.deepEqual(saved, backup.tables[table].map(row => retainedRecord(table, row))) }
    catch { throw new Error(`Retained-data mismatch in ${table}; keep writes paused and investigate.`) }
  }
  console.log('Verified all 26 retained application tables against the release backup.')
}
module.exports = { retainedRecord }
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
