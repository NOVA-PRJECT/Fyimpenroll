const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'../../implementation-handoffs/production-audit/correct_semester_1_mdc_hours.sql'),'utf8');
async function database(){const db=new PGlite();await db.exec(`
  CREATE TABLE courses(id int PRIMARY KEY,course_code text UNIQUE,category text,semester int,theory_hours_per_week int,practical_hours_per_week int);
  CREATE TABLE system_logs(log_type text,status text);
  CREATE TABLE timetable_entries(course_id int,status text);
  INSERT INTO courses VALUES (1,'KU01MDCCSE101','MDC',1,2,2),(2,'KU01MDCPSY101','MDC',1,2,2),(3,'KU01MDCSTA101','MDC',1,2,2),(4,'OTHER','DSC',1,2,2);`);return db;}
async function hours(db){return (await db.query('SELECT theory_hours_per_week AS theory,practical_hours_per_week AS practical FROM courses ORDER BY id')).rows;}

test('MDC handoff corrects only the reviewed catalogue rows and is safe to reapply',async()=>{
  const db=await database();try{
    await db.exec(sql);await db.exec(sql);
    assert.deepEqual(await hours(db),[{theory:3,practical:0},{theory:3,practical:0},{theory:3,practical:0},{theory:2,practical:2}]);
  }finally{await db.close();}
});

test('unexpected catalogue hours roll back the entire MDC correction',async()=>{
  const db=await database();try{
    await db.exec('UPDATE courses SET theory_hours_per_week=4 WHERE id=2');
    await assert.rejects(()=>db.exec(sql),/hours differ/);await db.exec('ROLLBACK');
    assert.deepEqual(await hours(db),[{theory:2,practical:2},{theory:4,practical:2},{theory:2,practical:2},{theory:2,practical:2}]);
  }finally{await db.close();}
});

test('MDC correction stops for active jobs and published affected courses',async()=>{
  const db=await database();try{
    await db.exec("INSERT INTO system_logs VALUES('timetable_job','running')");
    await assert.rejects(()=>db.exec(sql),/jobs are active/);await db.exec('ROLLBACK');
    await db.exec("DELETE FROM system_logs; INSERT INTO timetable_entries VALUES(1,'published')");
    await assert.rejects(()=>db.exec(sql),/published timetable entries/);await db.exec('ROLLBACK');
    assert.ok((await hours(db)).every(row=>row.theory===2&&row.practical===2));
  }finally{await db.close();}
});
