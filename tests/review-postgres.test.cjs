const {test}=require('node:test')
const assert=require('node:assert/strict')
const {openPostgresDatabase,fixture,uid,stageVerifiedDraft}=require('./helpers/final-database.cjs')
const enabled=!!process.env.FYIMP_TEST_DATABASE_URL
test('real PostgreSQL concurrent authorization, revision and lifecycle invariants',{skip:!enabled},async t=>{
  const db=await openPostgresDatabase()
  try {
    await t.test('teacher revocation commits before a waiting attendance submission is authorized',async()=>{
      const f=await fixture(db,101);await f.publish()
      const revoke=await db.connect(),submit=await db.connect()
      try {
        await revoke.query('BEGIN');await revoke.query('DELETE FROM public.teacher_course_assignments WHERE teacher_id=$1',[f.teacher])
        let finished=false
        const work=submit.query('SELECT public.atomic_submit_period_attendance($1,$2::date,$3,$4::uuid[],$5::uuid[],$6,0)',[f.entry,f.date,f.teacher,[],f.students,f.course])
        work.then(()=>{finished=true},()=>{finished=true})
        await new Promise(resolve=>setTimeout(resolve,100));assert.equal(finished,false,'submission waits for authority writer')
        await revoke.query('COMMIT');await assert.rejects(work,/no longer authorized/)
      } finally {await revoke.query('ROLLBACK');revoke.release();submit.release()}
    })
    await t.test('competing first submissions commit exactly one revision',async()=>{
      const f=await fixture(db,102);await f.publish()
      const results=await Promise.allSettled([f.submit(),f.submit([f.students[0]])])
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
      assert.match(results.find(r=>r.status==='rejected').reason.message,/ATTENDANCE_CONFLICT/)
      assert.equal((await db.query('SELECT revision FROM public.period_attendance_sessions WHERE timetable_slot_id=$1',[f.entry])).rows[0].revision,1)
    })
    await t.test('promotion prevents a waiting old-term attendance write',async()=>{
      const f=await fixture(db,103);await f.publish()
      const promote=await db.connect(),submit=await db.connect()
      try {
        await promote.query('BEGIN');await promote.query('SELECT public.promote_campus_students_atomic($1,$2,0)',[f.campus,f.director])
        const work=submit.query('SELECT public.atomic_submit_period_attendance($1,$2::date,$3,$4::uuid[],$5::uuid[],$6,0)',[f.entry,f.date,f.teacher,[],f.students,f.course])
        work.catch(()=>{})
        await promote.query('COMMIT');await assert.rejects(work,/not found|no longer authorized|Delivery/)
      } finally {await promote.query('ROLLBACK');promote.release();submit.release()}
    })
    await t.test('cross-campus course capacity survives competing allocation commits',async()=>{
      const a=await fixture(db,104,{pending:true}),b=await fixture(db,105,{pending:true})
      await db.query('UPDATE public.courses SET seat_limit=1 WHERE id=$1',[a.course])
      for(const f of [a,b]) await db.query("INSERT INTO public.student_registrations(student_id,campus_id,academic_year,semester,pathway_id,total_credits) VALUES($1,$2,'2026-27',1,'path',0)",[f.students[0],f.campus])
      const tokens=[uid(880001),uid(880002)],claims=[]
      for(const [i,f] of [a,b].entries()) claims.push((await db.query("SELECT public.claim_allocation_run($1,'2026-27',1::smallint,$2,300,$3) value",[f.campus,f.director,tokens[i]])).rows[0].value)
      const results=await Promise.allSettled([a,b].map((f,i)=>db.query("SELECT public.apply_course_allocation($1,$2,'2026-27',1::smallint,$3::jsonb,'[]','{}',$4)",
        [claims[i],f.campus,JSON.stringify([{student_id:f.students[0],slot_key:'slot_1',course_id:a.course,metadata:{allocated_by:'fixed'}}]),tokens[i]])))
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
      assert.match(results.find(r=>r.status==='rejected').reason.message,/capacity|seat/i)
      assert.equal(Number((await db.query('SELECT count(*) n FROM public.current_student_registrations WHERE slot_1_course_id=$1',[a.course])).rows[0].n),1)
    })
    await t.test('visiting teacher publication cannot double book across campuses',async()=>{
      const a=await fixture(db,108),b=await fixture(db,109)
      await db.query('UPDATE public.teacher_course_assignments SET teacher_id=$1 WHERE teacher_id=$2',[a.teacher,b.teacher])
      // Normal generation rejects a conflicting draft before publication.
      await stageVerifiedDraft(db,a)
      await assert.rejects(stageVerifiedDraft(db,b,a.teacher),/Teacher already has a class/)
      // Existing manual override can stage clashes. Keep that flag local to each
      // transaction to exercise publication's independent occupancy guard.
      const withOverride=async work=>{
        const connection=await db.connect()
        try {
          await connection.query('BEGIN')
          await connection.query("SET LOCAL app.manual_timetable_override='on'")
          const result=await work(connection)
          await connection.query('COMMIT');return result
        } catch(error) {await connection.query('ROLLBACK');throw error}
        finally {connection.release()}
      }
      // The rejected generation claim remains active; finish it before retrying.
      await db.query("UPDATE public.system_logs SET status='failed',completed_at=clock_timestamp() WHERE campus_id=$1 AND log_type='timetable_job' AND status IN ('queued','running')",[b.campus])
      await withOverride(connection=>stageVerifiedDraft(connection,b,a.teacher))
      const results=await Promise.allSettled([a,b].map(f=>withOverride(connection=>connection.query("SELECT public.publish_timetable_cohort($1,'2026-27',1)",[f.campus]))))
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
      assert.match(results.find(r=>r.status==='rejected').reason.message,/teacher.*occupied|already occupied|teacher.*published/i)
    })
    await t.test('a cancellation waiting on a timetable commit preserves the committed outcome', async () => {
      const f = await fixture(db, 110, { hours: 0, semester: 10 })
      await db.query("SELECT public.enqueue_review_job('timetable',$1,$2,0,'2026-27',10,'{}')", [f.campus, f.director])
      const job = (await db.query('SELECT public.claim_review_job() AS job')).rows[0].job
      const worker = await db.connect()
      try {
        await worker.query('BEGIN')
        await worker.query("SELECT public.finalize_research_cohort($1,'2026-27',10,$2,0,$3,$4)", [f.campus, f.director, job.id, job.fence])
        const cancellation = assert.rejects(db.query('SELECT public.cancel_review_job($1,$2)', [job.id, f.director]), { code: 'P4090' })
        await worker.query('COMMIT')
        await cancellation
      } finally {
        await worker.query('ROLLBACK')
        worker.release()
      }
      await db.query('SELECT public.finish_review_job($1,$2,NULL)', [job.id, job.fence])
      const state = await db.query('SELECT q.status AS queue, l.status AS log FROM public.review_jobs q JOIN public.system_logs l USING(id) WHERE q.id=$1', [job.id])
      assert.deepEqual(state.rows[0], { queue: 'completed', log: 'completed' })
    })
    await t.test('competing workers claim one shared expensive-job slot',async()=>{
      const a=await fixture(db,106),b=await fixture(db,107)
      for(const f of [a,b]) await db.query("SELECT public.enqueue_review_job('timetable',$1,$2,0,'2026-27',1,'{}')",[f.campus,f.director])
      const claims=await Promise.all([db.query('SELECT public.claim_review_job() value'),db.query('SELECT public.claim_review_job() value')])
      assert.equal(claims.filter(r=>r.rows[0].value!==null).length,1)
    })
  } finally {await db.close()}
})
