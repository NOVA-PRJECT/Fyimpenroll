const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const job='988fc349-e413-40b6-98ff-a607672d25bf';
const campus='5b5289d5-17eb-43ba-832e-19883e9eaada';
const sql=fs.readFileSync(path.join(__dirname,'../../implementation-handoffs/production-audit/RECOVER_ABANDONED_TIMETABLE_JOB.sql'),'utf8');
test('targeted recovery only changes the exact abandoned job and preserves refreshed or completed jobs',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`CREATE TABLE system_logs(id uuid PRIMARY KEY,log_type text,status text,campus_id uuid,academic_year text,semester smallint,started_at timestamptz,updated_at timestamptz,completed_at timestamptz,error_message text);`);
  const seed=(id,status,updated)=>db.query(`INSERT INTO system_logs(id,log_type,status,campus_id,academic_year,semester,updated_at) VALUES($1,'timetable_job',$2,$3,'2026-27',1,$4)`,[id,status,campus,updated]);
  await seed(job,'running','2026-09-03T08:43:57.264586+00:00');
  const other='00000000-0000-4000-8000-000000000001';
  await seed(other,'running','2026-09-03T08:43:57.264586+00:00');
  await db.exec(sql);
  const row=async id=>(await db.query('SELECT status,completed_at FROM system_logs WHERE id=$1',[id])).rows[0];
  assert.equal((await row(job)).status,'failed');assert.ok((await row(job)).completed_at);
  assert.equal((await row(other)).status,'running');
  await db.query('DELETE FROM system_logs WHERE id=$1',[job]);
  await seed(job,'running',new Date().toISOString());
  await db.exec(sql);assert.equal((await row(job)).status,'running');
  await db.query("UPDATE system_logs SET status='completed',updated_at='2026-09-03T08:43:57.264586+00:00' WHERE id=$1",[job]);
  await db.exec(sql);assert.equal((await row(job)).status,'completed');
 }finally{await db.close()}
});
