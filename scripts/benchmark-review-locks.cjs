const fs=require('node:fs')
const assert=require('node:assert/strict')
const {performance}=require('node:perf_hooks')
const {openPostgresDatabase,fixture,uid,stageVerifiedDraft}=require('../tests/helpers/final-database.cjs')
async function main(){
  const db=await openPostgresDatabase()
  try{
    const a=await fixture(db,201),b=await fixture(db,202);await a.publish();await b.publish()
    await db.exec('DELETE FROM public.review_lock_samples')
    const stream=async f=>{
      const durations=[]
      for(let revision=0;revision<20;revision++){const started=performance.now();await f.submit([],revision);durations.push(performance.now()-started)}
      return durations
    }
    const started=performance.now(),[first,second]=await Promise.all([stream(a),stream(b)])
    const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)]||0
    const attendanceElapsedMs=performance.now()-started
    const workloads={}
    const measure=async(name,work)=>{
      const durations=[]
      for(let iteration=0;iteration<5;iteration++){
        const operation=await work(iteration),begin=performance.now()
        await operation();durations.push(performance.now()-begin)
      }
      workloads[name]={iterations:durations.length,p50:percentile(durations,.5),p95:percentile(durations,.95),max:Math.max(...durations)}
    }
    await measure('sharedCourseSeatCompetitionMs',async iteration=>{
      const a=await fixture(db,300+iteration*2,{pending:true}),b=await fixture(db,301+iteration*2,{pending:true})
      await db.query('UPDATE public.courses SET seat_limit=1 WHERE id=$1',[a.course])
      const tokens=[uid(890000+iteration*2),uid(890001+iteration*2)],claims=[]
      for(const [i,f] of [a,b].entries()){
        await db.query("INSERT INTO public.student_registrations(student_id,campus_id,academic_year,semester,pathway_id,total_credits) VALUES($1,$2,'2026-27',1,'path',0)",[f.students[0],f.campus])
        claims.push((await db.query("SELECT public.claim_allocation_run($1,'2026-27',1::smallint,$2,300,$3) value",[f.campus,f.director,tokens[i]])).rows[0].value)
      }
      return async()=>{
        const results=await Promise.allSettled([a,b].map((f,i)=>db.query("SELECT public.apply_course_allocation($1,$2,'2026-27',1::smallint,$3::jsonb,'[]','{}',$4)",
          [claims[i],f.campus,JSON.stringify([{student_id:f.students[0],slot_key:'slot_1',course_id:a.course,metadata:{allocated_by:'fixed'}}]),tokens[i]])))
        assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
      }
    })
    const withOverride=async work=>{
      const connection=await db.connect()
      try {
        await connection.query('BEGIN');await connection.query("SET LOCAL app.manual_timetable_override='on'")
        const value=await work(connection);await connection.query('COMMIT');return value
      }catch(error){await connection.query('ROLLBACK');throw error}finally{connection.release()}
    }
    await measure('visitingTeacherPublicationMs',async iteration=>{
      const a=await fixture(db,400+iteration*2),b=await fixture(db,401+iteration*2)
      await db.query('UPDATE public.teacher_course_assignments SET teacher_id=$1 WHERE teacher_id=$2',[a.teacher,b.teacher])
      for(const f of [a,b]) await withOverride(connection=>stageVerifiedDraft(connection,f,a.teacher))
      return async()=>{
        const results=await Promise.allSettled([a,b].map(f=>withOverride(connection=>connection.query("SELECT public.publish_timetable_cohort($1,'2026-27',1)",[f.campus]))))
        assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
      }
    })
    await measure('promotionVersusAttendanceMs',async iteration=>{
      const f=await fixture(db,500+iteration);await f.publish()
      return async()=>{
        const promote=await db.connect(),submit=await db.connect()
        try {
          await promote.query('BEGIN');await promote.query('SELECT public.promote_campus_students_atomic($1,$2,0)',[f.campus,f.director])
          const waiting=submit.query('SELECT public.atomic_submit_period_attendance($1,$2::date,$3,$4::uuid[],$5::uuid[],$6,0)',[f.entry,f.date,f.teacher,[],f.students,f.course])
          waiting.catch(()=>{});await promote.query('COMMIT');await assert.rejects(waiting)
        }finally{await promote.query('ROLLBACK');promote.release();submit.release()}
      }
    })
    const samples=(await db.query('SELECT operation,wait_ms,transaction_elapsed_ms FROM public.review_lock_samples ORDER BY sampled_at')).rows
    const report={environment:'isolated synthetic PostgreSQL; not production throughput',postgresVersion:(await db.query('SHOW server_version')).rows[0].server_version,
      attendanceTransactions:40,attendanceElapsedMs,
      attendanceMs:{p50:percentile([...first,...second],.5),p95:percentile([...first,...second],.95),p99:percentile([...first,...second],.99)},
      workloads,
      sampledLockWaitMs:{p95:percentile(samples.map(s=>s.wait_ms),.95),p99:percentile(samples.map(s=>s.wait_ms),.99)},samples}
    fs.mkdirSync('scratch',{recursive:true});fs.writeFileSync('scratch/review-lock-benchmark.json',JSON.stringify(report,null,2)+'\n')
    console.log(JSON.stringify({...report,samples:samples.length}))
  }finally{await db.close()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
