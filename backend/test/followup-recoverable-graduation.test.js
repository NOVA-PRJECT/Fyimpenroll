const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { PGlite } = require('@electric-sql/pglite')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { AdminService } = require('../dist/modules/admin/admin.service')
let db
const campus='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002'
const actor='00000000-0000-4000-8000-000000000003'
const user={userId:actor,role:'campus_director',campus_id:campus}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let failAuth=false,failDatabase=false,failCheckpoint=false
before(async()=>{
 db=new PGlite()
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, banned boolean DEFAULT false);
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
 CREATE TABLE campuses(id uuid PRIMARY KEY);
 CREATE TABLE campus_settings(id uuid DEFAULT gen_random_uuid(),campus_id uuid UNIQUE REFERENCES campuses(id),academic_year text,min_credits int,max_credits int,last_promoted_at timestamptz);
 CREATE TABLE students(id uuid PRIMARY KEY REFERENCES auth.users(id),campus_id uuid REFERENCES campuses(id),current_semester int CHECK(current_semester BETWEEN 1 AND 10));
 CREATE TABLE courses(id uuid PRIMARY KEY,credits int,category text,academic_level text);
 CREATE TABLE student_registrations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),student_id uuid REFERENCES students(id) ON DELETE CASCADE,
 slot_1_course_id uuid,slot_2_course_id uuid,slot_3_course_id uuid,slot_4_course_id uuid,slot_5_course_id uuid,slot_6_course_id uuid,slot_7_course_id uuid,slot_8_course_id uuid,selections jsonb);
 CREATE TABLE period_attendance(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),student_id uuid REFERENCES students(id) ON DELETE CASCADE,timetable_slot_id uuid);
 CREATE TABLE departments(id uuid PRIMARY KEY,campus_id uuid);
 CREATE TABLE timetable_entries(id uuid PRIMARY KEY,department_id uuid,academic_year text,semester int);
 CREATE TABLE system_logs(log_type text,status text,campus_id uuid,user_id uuid,event_type text,action text,resource_type text,resource_id uuid,metadata jsonb);
 CREATE TABLE schema_migrations(version text PRIMARY KEY,name text);
 INSERT INTO campuses VALUES ('${campus}'),('${other}'); INSERT INTO auth.users(id) VALUES ('${actor}');`)
 for(const file of ['20261007050000_plan08_campus_onboarding_and_atomic_promotion.sql','20261010040000_followup_plan08_recoverable_graduation_and_retention.sql','20261010050000_followup_plan08_durable_graduation_recovery.sql','20261010060000_followup_plan09_registration_snapshots.sql']) {
  await db.exec(readFileSync(path.join(__dirname,'../../supabase/migrations',file),'utf8'))
 }
 // Install the actual attendance function bodies. Their resource tables are not
 // exercised by this ACL test; attendance service behavior has a separate suite.
 const attendance=readFileSync(path.join(__dirname,'../../supabase/migrations/20261010030000_followup_plan07_attendance_concurrency_and_pairing.sql'),'utf8')
 for(const name of ['atomic_submit_period_attendance','atomic_copy_practical_attendance']) {
   const start=attendance.indexOf('CREATE OR REPLACE FUNCTION '+name+'(')
   const end=attendance.indexOf('$$;',attendance.indexOf('AS $$',start))+3
   await db.exec(attendance.slice(start,end))
 }
 const timetable=readFileSync(path.join(__dirname,'../../supabase/migrations/20261010020000_followup_plan06_file_constraints_and_cohort_guards.sql'),'utf8')
 const draftStart=timetable.indexOf('CREATE OR REPLACE FUNCTION atomic_replace_timetable_draft(')
 const draftEnd=timetable.indexOf('$$ LANGUAGE plpgsql;',draftStart)+'$$ LANGUAGE plpgsql;'.length
 await db.exec(timetable.slice(draftStart,draftEnd))
 await db.exec(readFileSync(path.join(__dirname,'../../supabase/migrations/20261010070000_followup_plan10_attendance_rpc_privileges.sql'),'utf8'))
})
after(async()=>{await db?.close()})
async function student(n,sem=10,host=campus){const sid=id(n);await db.query('INSERT INTO auth.users(id) VALUES ($1)',[sid]);await db.query('INSERT INTO students VALUES ($1,$2,$3)',[sid,host,sem]);return sid}
function service(){
 const admin={
  rpc:async(name,args)=>{
   if(name==='graduate_candidate_database'&&failDatabase)return {error:{message:'injected SQL failure'}}
   if(name==='finish_graduation_candidate'&&failCheckpoint&&args.p_error_stage===null)return {error:{message:'injected checkpoint failure'}}
   try {const keys=Object.keys(args), values=Object.values(args); const result=await db.query(`SELECT public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) AS result`,values);return {data:result.rows[0].result,error:null}}
   catch(error){return {data:null,error}}
  },
  auth:{admin:{
   updateUserById:async(sid)=>{await db.query('UPDATE auth.users SET banned=true WHERE id=$1',[sid]);return {error:null}},
   deleteUser:async(sid)=>{if(failAuth)return {error:{message:'injected provider outage'}};await db.query('DELETE FROM auth.users WHERE id=$1',[sid]);return {error:null}}
  }}
 }
 return new AdminService({admin},{log:async()=>{}},{error:()=>{},warn:()=>{}})
}
test('real migration rejects authenticated calls to destructive graduation RPCs',async()=>{
 for(const signature of ['prepare_graduation(uuid,uuid[],uuid)','graduate_candidate_database(uuid,uuid)','atomic_graduate_candidates_db(uuid,uuid[])',
   'atomic_submit_period_attendance(uuid,date,uuid,uuid[],uuid[],uuid,integer)','atomic_copy_practical_attendance(uuid,uuid,date,uuid,integer)',
   'atomic_replace_timetable_draft(uuid,text,integer,jsonb,uuid)']){
  const {rows}=await db.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') AS allowed",[signature]);assert.equal(rows[0].allowed,false)
 }
})
test('real FK graph graduates dependent registration and marks, with durable replay',async()=>{
 const sid=await student(10);await db.query('INSERT INTO student_registrations(student_id) VALUES($1)',[sid]);await db.query('INSERT INTO period_attendance(student_id) VALUES($1)',[sid])
 assert.equal((await service().graduateStudents(campus,[sid,sid],user)).graduated_count,1)
 assert.equal((await db.query('SELECT * FROM auth.users WHERE id=$1',[sid])).rows.length,0)
 assert.equal((await db.query('SELECT * FROM student_registrations WHERE student_id=$1',[sid])).rows.length,0)
 assert.equal((await service().graduateStudents(campus,[sid],user)).success,true)
})
test('provider failure leaves banned account and database stage; fresh service retries recorded candidate',async()=>{
 const sid=await student(11);failAuth=true
 const first=await service().graduateStudents(campus,[sid],user);assert.equal(first.success,false);assert.equal(first.errors[0].stage,'auth')
 assert.equal((await db.query('SELECT banned FROM auth.users WHERE id=$1',[sid])).rows[0].banned,true)
 failAuth=false;assert.equal((await service().graduateStudents(campus,[sid],user)).success,true)
})
test('database failure remains visible and retains student, then retries safely',async()=>{
 const sid=await student(12);failDatabase=true
 const result=await service().graduateStudents(campus,[sid],user);assert.equal(result.errors[0].stage,'database')
 assert.equal((await db.query('SELECT * FROM students WHERE id=$1',[sid])).rows.length,1)
 failDatabase=false;assert.equal((await service().graduateStudents(campus,[sid],user)).success,true)
})
test('interruption after Auth deletion is recovered from durable database stage',async()=>{
 const sid=await student(13);failCheckpoint=true
 assert.equal((await service().graduateStudents(campus,[sid],user)).errors[0].stage,'checkpoint')
 failCheckpoint=false;assert.equal((await service().graduateStudents(campus,[sid],user)).success,true)
})
test('unknown, foreign, and non-final candidates reject the entire list before cleanup',async()=>{
 const foreign=await student(14,10,other), early=await student(15,6),valid=await student(16)
 for(const invalid of [foreign,early,id(999)]) await assert.rejects(service().graduateStudents(campus,[valid,invalid],user),/Invalid graduation/)
 assert.equal((await db.query('SELECT * FROM students WHERE id=$1',[valid])).rows.length,1)
})
test('real promotion receipt replay does not promote twice or reselect new semester-10 students',async()=>{
 const ninth=await student(17,9)
 const args=[campus,actor,'fixed-request']
 const first=(await db.query('SELECT promote_campus_students_atomic($1,$2,$3) result',args)).rows[0].result
 const second=(await db.query('SELECT promote_campus_students_atomic($1,$2,$3) result',args)).rows[0].result
 assert.deepEqual(second,first);assert.ok(!second.graduating_student_ids.includes(ninth))
 assert.equal((await db.query('SELECT current_semester FROM students WHERE id=$1',[ninth])).rows[0].current_semester,10)
})
test('real snapshot trigger preserves credits and removes replaced course snapshots',async()=>{
 const sid=await student(18,3),a=id(101),b=id(102)
 await db.query("INSERT INTO courses VALUES($1,4,'DSC',NULL),($2,3,'AEC',NULL)",[a,b])
 const reg=(await db.query('INSERT INTO student_registrations(student_id,slot_1_course_id) VALUES($1,$2) RETURNING id',[sid,a])).rows[0].id
 await db.query('UPDATE courses SET credits=99 WHERE id=$1',[a]);await db.query('UPDATE student_registrations SET selections=selections WHERE id=$1',[reg])
 assert.equal((await db.query('SELECT selections FROM student_registrations WHERE id=$1',[reg])).rows[0].selections[0].credits,4)
 await db.query('UPDATE student_registrations SET slot_1_course_id=$1 WHERE id=$2',[b,reg])
 const selections=(await db.query('SELECT selections FROM student_registrations WHERE id=$1',[reg])).rows[0].selections
 assert.equal(selections.length,1);assert.equal(selections[0].course_id,b);assert.equal(selections[0].credits,3)
})
