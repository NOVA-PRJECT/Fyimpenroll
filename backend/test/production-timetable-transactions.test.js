const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { PGlite } = require('@electric-sql/pglite')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const campus = id(1), course = id(2), department = id(3), slot = id(4), actor = id(5), token = id(6)
let db
before(async () => {
  if(process.env.PRODUCTION_SQL_TEST_URL) {
    const { Client }=require('pg');const client=new Client({connectionString:process.env.PRODUCTION_SQL_TEST_URL});await client.connect()
    db={exec:sql=>client.query(sql),query:(sql,params)=>client.query(sql,params),close:()=>client.end()}
  } else db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE schema_migrations(version text PRIMARY KEY,name text);
    CREATE TABLE campus_settings(campus_id uuid PRIMARY KEY,deadline timestamptz);
    CREATE TABLE departments(id uuid PRIMARY KEY,campus_id uuid);
    CREATE TABLE courses(id uuid PRIMARY KEY,department_id uuid);
    CREATE TABLE time_slots(id uuid PRIMARY KEY);
    CREATE TABLE system_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),log_type text,status text,campus_id uuid,
      academic_year text,semester int,user_id uuid,metadata jsonb DEFAULT '{}',progress int,error_message text,
      started_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),completed_at timestamptz);
    CREATE TABLE timetable_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campus_id uuid,academic_year text,semester int,
      course_id uuid REFERENCES courses(id),department_id uuid,time_slot_id uuid REFERENCES time_slots(id),session_type text,is_lab_block boolean,teacher_id uuid,status text,published_at timestamptz);
    CREATE TABLE timetable_conflicts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course_id uuid,academic_year text,semester int,resolved boolean);
    CREATE TABLE period_attendance_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),timetable_slot_id uuid,attendance_date date,
      CONSTRAINT uq_period_attendance_sessions UNIQUE(timetable_slot_id,attendance_date));
    CREATE INDEX idx_period_attendance_sessions_slot_date ON period_attendance_sessions(timetable_slot_id,attendance_date);
    CREATE TABLE retired_cohorts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campus_id uuid,academic_year text,semester int,
      CONSTRAINT uq_retired_cohorts UNIQUE(campus_id,academic_year,semester));
    CREATE INDEX idx_retired_cohorts_lookup ON retired_cohorts(campus_id,academic_year,semester);
    GRANT SELECT ON period_attendance_sessions,retired_cohorts TO authenticated;
    CREATE TABLE period_attendance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),timetable_slot_id uuid,attendance_date date,student_id uuid,course_id uuid,status text);
    INSERT INTO campus_settings VALUES('${campus}',now()-interval '1 day');
    INSERT INTO departments VALUES('${department}','${campus}'); INSERT INTO courses VALUES('${course}','${department}'); INSERT INTO time_slots VALUES('${slot}');
    INSERT INTO system_logs(log_type,status,campus_id,academic_year,semester) VALUES('allocation_run','completed','${campus}','2026-27',1);`)
  for (const file of ['20261010080000_production_timetable_transactions.sql','20261010090000_production_attendance_summary.sql']) {
    await db.exec(readFileSync(path.join(__dirname,'../../supabase/migrations',file),'utf8'))
  }
})
after(async () => { await db?.close() })
async function reset() { await db.exec("DELETE FROM timetable_conflicts; DELETE FROM timetable_entries; DELETE FROM system_logs WHERE log_type='timetable_job';") }
async function call(name, args) {
  const { rows } = await db.query(`SELECT public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) AS result`,args)
  return rows[0].result
}
async function claim() { return call('claim_timetable_generation_job',[campus,'2026-27',1,actor,600,token]) }
const entries = (patch = {}) => JSON.stringify([{ academic_year:'2026-27',semester:1,campus_id:campus,course_id:course,
  department_id:department,time_slot_id:slot,session_type:'theory',...patch }])
async function running(job) { await call('update_timetable_worker',[job,token,'running',25,null]) }
async function commit(job, fencing = token, rows = entries()) { return call('atomic_replace_timetable_draft',[campus,'2026-27',1,rows,job,fencing]) }
test('actual SQL rejects nonexistent, completed, expired and wrong-token worker commits', async () => {
  await reset(); const job = (await claim()).job_id; await running(job)
  await assert.rejects(commit(id(99)),/worker claim/)
  await assert.rejects(commit(job,id(88)),/worker claim/)
  await db.query("UPDATE system_logs SET updated_at=now()-interval '20 minutes' WHERE id=$1",[job])
  await assert.rejects(commit(job),/worker claim/)
  assert.equal(await call('recover_expired_timetable_workers',[]),1)
  await assert.rejects(running(job),/worker claim/)
  const replacement = (await claim()).job_id; await running(replacement); await commit(replacement)
  await assert.rejects(commit(replacement),/worker claim/)
})
test('draft insertion failure rolls back deletion and completion; cross-cohort entries are rejected', async () => {
  await reset(); const first=(await claim()).job_id;await running(first);await commit(first)
  const original=(await db.query('SELECT id FROM timetable_entries')).rows[0].id
  const second=(await claim()).job_id;await running(second)
  await assert.rejects(commit(second,token,entries({campus_id:id(90)})),/claimed cohort/)
  await assert.rejects(commit(second,token,entries({course_id:id(91)})),/foreign key/)
  assert.equal((await db.query('SELECT id FROM timetable_entries')).rows[0].id,original)
  assert.equal((await db.query('SELECT status FROM system_logs WHERE id=$1',[second])).rows[0].status,'running')
})
test('publication rejects active generation, conflicts and edits to validated drafts, then publishes atomically', async () => {
  await reset();const job=(await claim()).job_id;await running(job)
  await assert.rejects(call('publish_timetable_cohort',[campus,'2026-27',1]),/generation is active/)
  await commit(job)
  await db.query('INSERT INTO timetable_conflicts(course_id,academic_year,semester,resolved) VALUES($1,$2,1,false)',[course,'2026-27'])
  await assert.rejects(call('publish_timetable_cohort',[campus,'2026-27',1]),/unresolved conflicts/)
  await db.exec('DELETE FROM timetable_conflicts')
  await db.query('UPDATE timetable_entries SET teacher_id=$1',[id(80)])
  await assert.rejects(call('publish_timetable_cohort',[campus,'2026-27',1]),/verified current draft/)
  await db.exec('UPDATE timetable_entries SET teacher_id=NULL')
  const published=await call('publish_timetable_cohort',[campus,'2026-27',1]);assert.equal(published.published_count,1)
  await assert.rejects(claim(),/published/)
})
test('publication rejects a visiting teacher already published in another cohort', async () => {
  await reset(); const job=(await claim()).job_id;await running(job);await commit(job,token,entries({teacher_id:id(80)}))
  await db.query("INSERT INTO timetable_entries(campus_id,academic_year,semester,course_id,department_id,time_slot_id,session_type,teacher_id,status) VALUES($1,$2,3,$3,$4,$5,'theory',$6,'published')",[id(90),'2026-27',course,department,slot,id(80)])
  await assert.rejects(call('publish_timetable_cohort',[campus,'2026-27',1]),/teacher is already occupied/)
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM timetable_entries WHERE campus_id=$1 AND status='draft'",[campus])).rows[0].n),1)
  await db.query('DELETE FROM timetable_entries WHERE campus_id=$1',[id(90)])
  assert.equal((await call('publish_timetable_cohort',[campus,'2026-27',1])).published_count,1)
})
test('a completed review preview without a fingerprint blocks publication of an older verified draft',async()=>{
  await reset();const first=(await claim()).job_id;await running(first);await commit(first);
  const review=(await claim()).job_id;await running(review);
  await db.query("UPDATE system_logs SET status='completed',completed_at=now()+interval '1 second',metadata=metadata || $2::jsonb WHERE id=$1",
    [review,JSON.stringify({reviewDraft:{kind:'review_draft',unscheduledPeriods:2}})]);
  await assert.rejects(call('publish_timetable_cohort',[campus,'2026-27',1]),/No verified current draft/);
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM timetable_entries WHERE status='published'")).rows[0].n),0);
});
test('direct attendance metadata reads and browser RPC calls are denied; duplicate indexes are removed safely', async () => {
  for(const name of ['period_attendance_sessions','retired_cohorts']) {
    assert.equal((await db.query("SELECT has_table_privilege('authenticated',$1,'SELECT') AS allowed",[name])).rows[0].allowed,false)
  }
  assert.equal((await call('production_readiness',[])).ready,true)
  for(const name of ['idx_period_attendance_sessions_slot_date','idx_retired_cohorts_lookup']) {
    assert.equal((await db.query('SELECT to_regclass($1) AS value',[name])).rows[0].value,null)
  }
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM pg_constraint WHERE conname IN ('uq_period_attendance_sessions','uq_retired_cohorts')")).rows[0].n),2)
  for (const role of ['anon','authenticated']) {
    for (const signature of ['claim_timetable_generation_job(uuid,text,smallint,uuid,int,uuid)',
      'atomic_replace_timetable_draft(uuid,text,int,jsonb,uuid,uuid)', 'update_timetable_worker(uuid,uuid,text,int,text)',
      'publish_timetable_cohort(uuid,text,int)', 'recover_expired_timetable_workers()', 'attendance_student_course_counts(uuid[],uuid,text,int)']) {
      assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,signature])).rows[0].allowed,false,role+' '+signature)
      assert.equal((await db.query("SELECT has_function_privilege('service_role',$1,'EXECUTE') AS allowed",[signature])).rows[0].allowed,true,signature)
    }
  }
})
test('actual SQL aggregates over 100,000 attendance rows without application traversal limits', async () => {
  await reset();const job=(await claim()).job_id;await running(job);await commit(job);await call('publish_timetable_cohort',[campus,'2026-27',1])
  const entry=(await db.query('SELECT id FROM timetable_entries')).rows[0].id
  await db.query(`INSERT INTO period_attendance(timetable_slot_id,attendance_date,student_id,course_id,status)
    SELECT $1,date '2020-01-01'+n,$2,$3,CASE WHEN n%2=0 THEN 'present' ELSE 'absent' END FROM generate_series(1,100005) n`,[entry,id(50),course])
  const { rows }=await db.query('SELECT * FROM attendance_student_course_counts($1,$2,$3,$4)',[[id(50)],campus,'2026-27',1])
  assert.equal(Number(rows[0].conducted),100005);assert.equal(Number(rows[0].present),50002)
})

test('real PostgreSQL serializes a concurrent claim and publisher', { skip: !process.env.PRODUCTION_SQL_TEST_URL }, async () => {
  await reset(); const old=(await claim()).job_id; await running(old); await commit(old)
  const { Client }=require('pg')
  const claimant=new Client({connectionString:process.env.PRODUCTION_SQL_TEST_URL})
  const publisher=new Client({connectionString:process.env.PRODUCTION_SQL_TEST_URL,application_name:'fyimp-race-publisher'})
  await claimant.connect(); await publisher.connect()
  try {
    await claimant.query('BEGIN')
    await claimant.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`timetable:${campus}:2026-27:1`])
    const publication=publisher.query('SELECT publish_timetable_cohort($1,$2,$3)',[campus,'2026-27',1]).then(()=>({}),error=>({error}))
    let waiting=false
    for(let i=0;i<100;i++) {
      const result=await claimant.query("SELECT wait_event FROM pg_stat_activity WHERE application_name='fyimp-race-publisher'")
      if(result.rows.some(r=>r.wait_event==='advisory')) { waiting=true; break }
      await new Promise(resolve=>setTimeout(resolve,20))
    }
    assert.ok(waiting,'Publisher must wait for the cohort transaction')
    await claimant.query('SELECT claim_timetable_generation_job($1,$2,$3,$4,$5,$6)',[campus,'2026-27',1,actor,600,id(77)])
    await claimant.query('COMMIT')
    assert.match((await publication).error?.message||'',/generation is active/)
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM timetable_entries WHERE status='published'")).rows[0].n),0)
  } finally { await claimant.query('ROLLBACK'); await claimant.end(); await publisher.end() }
})
