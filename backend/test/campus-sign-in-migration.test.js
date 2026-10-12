const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261012010000_campus_sign_in_date.sql'), 'utf8')

for (const generated of [false, true]) test(`campus date migration preserves data and derives IST dates (generated=${generated})`, async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE campus_sign_ins (id integer PRIMARY KEY, signed_in_at timestamptz NOT NULL,
        signed_in_date date ${generated ? "GENERATED ALWAYS AS ((signed_in_at AT TIME ZONE 'Asia/Kolkata')::date) STORED" : 'NOT NULL DEFAULT CURRENT_DATE'});
      INSERT INTO campus_sign_ins (id, signed_in_at) VALUES (1, '2026-10-10T19:00:00Z');`)
    const before = (await db.query('SELECT * FROM campus_sign_ins')).rows
    await db.exec(sql); await db.exec(sql)
    assert.deepEqual((await db.query('SELECT * FROM campus_sign_ins')).rows, before)
    await db.exec("INSERT INTO campus_sign_ins (id, signed_in_at) VALUES (2, '2026-10-12T18:29:59Z'), (3, '2026-10-12T18:30:00Z')")
    assert.deepEqual((await db.query('SELECT signed_in_date::text AS date FROM campus_sign_ins WHERE id > 1 ORDER BY id')).rows, [{ date: '2026-10-12' }, { date: '2026-10-13' }])
    await db.exec("UPDATE campus_sign_ins SET signed_in_at = '2026-10-14T18:30:00Z' WHERE id = 2")
    assert.equal((await db.query('SELECT signed_in_date::text AS date FROM campus_sign_ins WHERE id = 2')).rows[0].date, '2026-10-15')
  } finally { await db.close() }
})
