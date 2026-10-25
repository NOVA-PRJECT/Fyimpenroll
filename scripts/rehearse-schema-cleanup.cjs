const fs = require('node:fs')
const assert = require('node:assert/strict')
const { PGlite } = require('@electric-sql/pglite')
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const read = file => fs.readFileSync(file, 'utf8')
async function main() {
  const backupFile = process.argv[2]
  if (!backupFile) throw new Error('Supply the verified cleanup backup filename.')
  const backup = JSON.parse(read(backupFile))
  const db = new PGlite({ extensions: { 'uuid-ossp': uuid_ossp, pgcrypto } })
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY)')
    await db.exec(read('supabase/baseline/schema.sql'))
    await db.exec(read('supabase/migrations/20261022141208_atomic_teacher_changes.sql'))
    await db.exec(read('supabase/migrations/20261025044031_plain_course_prerequisites.sql'))
    await db.exec("SET session_replication_role='replica'")
    const ids = new Set(JSON.stringify(backup.tables).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi))
    for (const id of ids) await db.query('INSERT INTO auth.users(id) VALUES ($1) ON CONFLICT DO NOTHING', [id])
    for (const [table, records] of Object.entries(backup.tables)) {
      if (!/^[a-z_]+$/.test(table)) throw new Error('Invalid backup table name')
      await db.exec(`DELETE FROM public.${table}`)
      for (const record of records) {
        const keys = Object.keys(record)
        if (keys.some(key => !/^[a-z_0-9]+$/.test(key))) throw new Error('Invalid backup column name')
        const columns = await db.query('SELECT column_name,udt_name FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=$1', [table])
        const types = new Map(columns.rows.map(c => [c.column_name, c.udt_name]))
        const values = keys.map(key => record[key] !== null && ['json','jsonb'].includes(types.get(key)) ? JSON.stringify(record[key]) : record[key])
        await db.query(`INSERT INTO public.${table} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')})`,values)
      }
    }
    await db.exec("SET session_replication_role='origin'")
    await db.exec(read('supabase/migrations/20261025044158_retire_legacy_course_prerequisites.sql'))
    await db.exec(read('supabase/migrations/20261025062135_consolidate_application_schema.sql'))
    assert.equal((await db.query('SELECT public.production_readiness() AS r')).rows[0].r.ready, true)
    const registrations = (await db.query('SELECT * FROM public.student_registrations')).rows
    assert.equal(registrations.length, backup.tables.student_registrations.length)
    for (const row of registrations) {
      const original = backup.tables.student_registrations.find(r => r.id === row.id)
      for (let slot=1;slot<=8;slot++) assert.equal(row[`slot_${slot}_course_id`],original[`slot_${slot}_course_id`])
      assert.equal(row.total_credits, original.total_credits)
      assert.deepEqual(row.selections, original.selections)
      assert.equal(Object.hasOwn(row, 'preferences'), false)
    }
    for (const row of (await db.query('SELECT id,prerequisites FROM public.courses')).rows) {
      assert.deepEqual(row.prerequisites,backup.tables.courses.find(c=>c.id===row.id).prerequisites)
    }
    console.log(`Live-export rehearsal passed: ${registrations.length} registrations retained, ${backup.tables.courses.length} course prerequisite lists preserved, readiness true.`)
  } finally { await db.close() }
}
main().catch(error => { console.error(`Rehearsal failed: ${error.message}`); process.exitCode=1 })
