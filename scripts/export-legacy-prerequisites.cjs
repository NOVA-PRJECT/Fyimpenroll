// Run before the destructive migration, while course editing is paused.
// node --env-file=backend/.env scripts/export-legacy-prerequisites.cjs scratch/prerequisites-backup.json
const fs = require('node:fs')
const path = require('node:path')
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const output = process.argv[2]
  if (!output) throw new Error('Supply a new backup JSON filename.')
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Backend Supabase credentials are required.')
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  async function read(table, columns) {
    const rows = []
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from(table).select(columns).order('id').range(offset, offset + 499)
      if (error) throw new Error(`Cannot export ${table}: ${error.message}`)
      rows.push(...data)
      if (data.length < 500) return rows
    }
  }
  const courses = await read('courses', '*')
  const rules = await read('course_prerequisite_rules', '*')
  const backup = { exported_at: new Date().toISOString(), project: new URL(SUPABASE_URL).hostname, courses, rules }
  const filename = path.resolve(output)
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, JSON.stringify(backup, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  const verified = JSON.parse(fs.readFileSync(filename, 'utf8'))
  if (JSON.stringify(verified) !== JSON.stringify(backup)) throw new Error('Backup read-back verification failed.')
  console.log(`Verified backup: ${courses.length} courses, ${rules.length} rules. ${filename}`)
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
