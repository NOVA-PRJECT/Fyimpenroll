const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const {openFinalDatabase}=require('./helpers/final-database.cjs')
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase/changes',name),'utf8')

test('owner prerequisite diagnostic names each missing feature and failed bundle leaves no review changes',async()=>{
  const db=await openFinalDatabase({beforeReview:true})
  try {
    const complete=(await db.query(read('review_prerequisites.sql'))).rows
    assert.equal(complete.length,4)
    assert.ok(complete.every(row=>row.installed && row.lifecycle_installed && !row.review_release_installed))
    for(const prerequisite of complete) {
      const name=prerequisite.signature.slice(7).split('(')[0],held=name+'_test_held'
      await db.exec(`ALTER FUNCTION ${prerequisite.signature} RENAME TO ${held}`)
      const missing=(await db.query(read('review_prerequisites.sql'))).rows.filter(row=>!row.installed)
      assert.equal(missing.length,1)
      assert.equal(missing[0].owner_sql,prerequisite.owner_sql)
      await assert.rejects(db.exec(read('review_release.sql')),error=>{
        assert.ok(error.message.includes(prerequisite.signature))
        assert.ok(error.message.includes(prerequisite.owner_sql))
        assert.match(error.hint,/do not replay semester_lifecycle/)
        return true
      })
      await db.exec('ROLLBACK')
      assert.equal((await db.query("SELECT to_regclass('public.review_jobs') result")).rows[0].result,null)
      assert.equal((await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname='review_authority_lock'")).rows[0].n,0)
      await db.exec(`ALTER FUNCTION ${prerequisite.signature.replace('public.'+name+'(','public.'+held+'(')} RENAME TO ${name}`)
    }
    const results=await db.exec(read('review_preflight.sql'))
    assert.ok(results.at(-1).rows.every(row=>row.installed))
  } finally {await db.close()}
})
