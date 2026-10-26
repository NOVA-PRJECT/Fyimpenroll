const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
let db
const uid = n => '00000000-0000-4000-8000-' + String(700000 + n).padStart(12, '0')
before(async () => {
 db = new PGlite({ extensions: { 'uuid-ossp': uuid_ossp, pgcrypto } })
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);')
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/baseline/schema.sql'),'utf8'))
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/baseline/reference-data.sql'),'utf8'))
 for(const n of fs.readdirSync(path.join(__dirname,'../supabase/migrations')).sort().filter(n=>n>'20261020135038\uffff')) await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',n),'utf8'))
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/changes/semester_lifecycle.sql'),'utf8'))
})
after(async()=>{await db?.close()})
async function fixture(n) {
 const ids=Object.fromEntries(['campus','dept','director','hod','teacher','student','senior','final','pending','course','entry','assignment','registration'].map((k,i)=>[k,uid(n*100+i)]))
 await db.exec(`INSERT INTO public.campuses(id,name,code) VALUES('${ids.campus}','Lifecycle ${n}','LC${n}');
 UPDATE public.campus_settings SET academic_year='2026-27',min_credits=0,max_credits=40,deadline=now()-interval '1 day' WHERE campus_id='${ids.campus}';
 INSERT INTO public.departments(id,name,code,campus_id) VALUES('${ids.dept}','Lifecycle dept ${n}','LD${n}','${ids.campus}');
 INSERT INTO auth.users(id) VALUES('${ids.director}'),('${ids.hod}'),('${ids.teacher}'),('${ids.student}'),('${ids.senior}'),('${ids.final}'),('${ids.pending}');
 INSERT INTO public.faculty(id,full_name,email,role,department_id,campus_id) VALUES
 ('${ids.director}','Director','ld${n}@example.test','campus_director',null,'${ids.campus}'),
 ('${ids.hod}','HOD','lh${n}@example.test','hod','${ids.dept}','${ids.campus}'),
 ('${ids.teacher}','Teacher','lt${n}@example.test','teacher','${ids.dept}','${ids.campus}');
 INSERT INTO public.students(id,full_name,cap_application_number,academic_year_joined,department_id,campus_id,current_semester) VALUES
 ('${ids.student}','Student','LS${n}','2026-27','${ids.dept}','${ids.campus}',1),
 ('${ids.senior}','Senior','L9${n}','2022-23','${ids.dept}','${ids.campus}',9),
 ('${ids.final}','Final','L10${n}','2022-23','${ids.dept}','${ids.campus}',10),
 ('${ids.pending}','Pending','L11${n}','2021-22','${ids.dept}','${ids.campus}',11);
 INSERT INTO public.courses(id,course_code,title,department_id,semester,credits,category) VALUES('${ids.course}','LC${n}101','Lifecycle course','${ids.dept}',1,4,'DSC');
 INSERT INTO public.student_registrations(id,student_id,campus_id,semester,academic_year,slot_1_course_id,total_credits)
 VALUES('${ids.registration}','${ids.student}','${ids.campus}',1,'2026-27','${ids.course}',4);
 INSERT INTO public.teacher_course_assignments(id,teacher_id,course_id,campus_id,academic_year,semester) VALUES('${ids.assignment}','${ids.teacher}','${ids.course}','${ids.campus}','2026-27',1);
 INSERT INTO public.timetable_entries(id,academic_year,semester,course_id,department_id,campus_id,time_slot_id,teacher_id,status)
 SELECT '${ids.entry}','2026-27',1,'${ids.course}','${ids.dept}','${ids.campus}',id,'${ids.teacher}','draft' FROM public.time_slots WHERE day_of_week=1 AND period_number=1;
 UPDATE public.timetable_entries SET status='published',published_at=now() WHERE id='${ids.entry}';
 INSERT INTO public.registration_preferences(student_id,campus_id,semester,academic_year,preferences) VALUES('${ids.student}','${ids.campus}',1,'2026-27','[]');
 INSERT INTO public.period_attendance(timetable_slot_id,student_id,course_id,status,attendance_date) VALUES('${ids.entry}','${ids.student}','${ids.course}','present',(now() AT TIME ZONE 'Asia/Kolkata')::date);
 INSERT INTO public.period_attendance_sessions(timetable_slot_id,attendance_date,revision_token,total_students,present_count) VALUES('${ids.entry}',(now() AT TIME ZONE 'Asia/Kolkata')::date,'one',1,1);
 INSERT INTO public.campus_sign_ins(student_id,campus_id,session_type,location_accuracy_meters,status) VALUES('${ids.student}','${ids.campus}','morning',10,'on_time');`)
 return ids
}
const promote = ids => db.query('SELECT public.promote_campus_students_atomic($1,$2,0) AS result',[ids.campus,ids.director])
const graduate = (ids,students) => db.query('SELECT public.delete_graduating_students($1,$2::uuid[],$3) AS result',[ids.campus,students,ids.director])
const record = async (table,id) => (await db.query(`SELECT to_jsonb(t) AS row FROM public.${table} t WHERE id=$1`,[id])).rows[0]?.row

test('restores 20 backend-only tables and replaces all retired lifecycle routines',async()=>{
 assert.equal((await db.query('SELECT public.production_readiness() AS value')).rows[0].value.ready,true)
 assert.equal((await db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,20)
})
test('promotion preserves the academic ledger and teaching history while clearing temporary data',async()=>{
 const ids=await fixture(1)
 const before=await Promise.all([record('student_registrations',ids.registration),record('timetable_entries',ids.entry),record('teacher_course_assignments',ids.assignment)])
 const {rows}=await promote(ids)
 assert.equal(rows[0].result.promoted_count,3)
 assert.deepEqual(await Promise.all([record('student_registrations',ids.registration),record('timetable_entries',ids.entry),record('teacher_course_assignments',ids.assignment)]),before)
 for(const [key,sem] of [['student',2],['senior',10],['final',11],['pending',11]]) assert.equal((await record('students',ids[key])).current_semester,sem)
 assert.ok((await db.query('SELECT id FROM auth.users WHERE id=$1',[ids.final])).rowCount)
 for(const table of ['registration_preferences','campus_sign_ins']) assert.equal((await db.query(`SELECT id FROM public.${table} WHERE campus_id=$1`,[ids.campus])).rowCount,0)
 assert.equal((await db.query('SELECT id FROM public.period_attendance WHERE timetable_slot_id=$1',[ids.entry])).rowCount,0)
 const settings=(await db.query('SELECT * FROM public.campus_settings WHERE campus_id=$1',[ids.campus])).rows[0]
 assert.equal(settings.term_version,1);assert.equal(settings.deadline,null)
 await assert.rejects(promote(ids),/term changed|locked/i)
 await assert.rejects(db.query('SELECT public.atomic_submit_period_attendance($1,CURRENT_DATE,$2,ARRAY[]::uuid[],$3::uuid[],$4,NULL)',[ids.entry,ids.teacher,[ids.student],ids.course]),/not found|concluded/i)
})
test('a failed cleanup rolls back temporary deletions, promotion, and the campus timestamp',async()=>{
 const ids=await fixture(2)
 await db.exec(`CREATE FUNCTION public.reject_lifecycle_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected promotion failure'; END $$;
 CREATE TRIGGER zz_lifecycle_test BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.reject_lifecycle_test();`)
 try {await assert.rejects(promote(ids),/Injected promotion failure/)} finally {await db.exec('DROP TRIGGER zz_lifecycle_test ON public.students; DROP FUNCTION public.reject_lifecycle_test();')}
 assert.equal((await record('students',ids.final)).current_semester,10)
 assert.equal((await db.query('SELECT term_version,last_promoted_at FROM public.campus_settings WHERE campus_id=$1',[ids.campus])).rows[0].term_version,0)
 assert.equal((await db.query('SELECT count(*)::int n FROM public.registration_preferences WHERE campus_id=$1',[ids.campus])).rows[0].n,1)
})
test('graduation rejects mixed selections and independently deletes only semester-11 accounts',async()=>{
 const ids=await fixture(3); await promote(ids)
 await assert.rejects(graduate(ids,[ids.final,ids.senior]),/semester-11/)
 assert.ok(await record('students',ids.final))
 const settings=(await db.query('SELECT last_promoted_at FROM public.campus_settings WHERE campus_id=$1',[ids.campus])).rows[0]
 assert.equal((await graduate(ids,[ids.final])).rows[0].result.deleted_count,1)
 assert.equal(await record('students',ids.final),undefined)
 assert.equal((await db.query('SELECT id FROM auth.users WHERE id=$1',[ids.final])).rowCount,0)
 assert.ok(await record('timetable_entries',ids.entry));assert.ok(await record('teacher_course_assignments',ids.assignment));assert.ok(await record('student_registrations',ids.registration))
 assert.deepEqual((await db.query('SELECT last_promoted_at FROM public.campus_settings WHERE campus_id=$1',[ids.campus])).rows[0],settings)
})
test('stale term requests are rejected and retained schedules no longer block new-term teaching',async()=>{
 const ids=await fixture(4);await promote(ids)
 await assert.rejects(db.query("SELECT public.run_current_term_operation($1,0,'publish_timetable_cohort',$2::jsonb)",[ids.campus,JSON.stringify({p_academic_year:'2026-27',p_semester:1})]),/term changed/)
 const {rows}=await db.query("SELECT public.mutate_teacher_assignments($1,'assign',$2::jsonb) AS result",[ids.hod,JSON.stringify([{teacher_id:ids.teacher,course_id:ids.course,campus_id:ids.campus,academic_year:'2026-27',semester:1}])])
 assert.equal(rows[0].result.success,true)
 assert.equal((await db.query('SELECT count(*)::int n FROM public.teacher_course_assignments WHERE course_id=$1',[ids.course])).rows[0].n,2)
 assert.equal((await db.query('SELECT count(*)::int n FROM public.current_teacher_course_assignments WHERE course_id=$1',[ids.course])).rows[0].n,1)
 await db.query(`INSERT INTO public.timetable_entries(academic_year,semester,course_id,department_id,campus_id,time_slot_id,teacher_id,status)
 SELECT '2026-27',1,$1,$2,$3,time_slot_id,$4,'draft' FROM public.timetable_entries WHERE id=$5`,[ids.course,ids.dept,ids.campus,ids.teacher,ids.entry])
 assert.equal((await db.query('SELECT count(*)::int n FROM public.timetable_entries WHERE course_id=$1',[ids.course])).rows[0].n,2)
 await assert.rejects(db.query("UPDATE public.timetable_entries SET teacher_id=NULL WHERE id=$1",[ids.entry]),/Concluded-term/)
})
test('running jobs block promotion and a previous-term worker cannot commit after cancellation',async()=>{
 const ids=await fixture(5)
 const job=uid(599)
 await db.query("INSERT INTO public.system_logs(id,log_type,status,campus_id,academic_year,semester) VALUES($1,'timetable_job','running',$2,'2026-27',1)",[job,ids.campus])
 await assert.rejects(promote(ids),/workers/)
 await db.query("UPDATE public.system_logs SET status='failed' WHERE id=$1",[job])
 await promote(ids)
 await assert.rejects(db.query("UPDATE public.system_logs SET status='completed' WHERE id=$1",[job]),/Concluded-term/)
})
test('a graduation failure rolls back the complete selected batch, including Auth and ledger cascades',async()=>{
 const ids=await fixture(6);await promote(ids)
 await db.exec(`CREATE FUNCTION public.reject_graduation_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id='${ids.pending}' THEN RAISE EXCEPTION 'Injected Auth deletion failure'; END IF; RETURN OLD; END $$;
 CREATE TRIGGER zz_graduation_failure BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.reject_graduation_test();`)
 try {await assert.rejects(graduate(ids,[ids.final,ids.pending]),/Injected Auth deletion failure/)}finally{await db.exec('DROP TRIGGER zz_graduation_failure ON auth.users; DROP FUNCTION public.reject_graduation_test()')}
 for(const key of ['final','pending'])assert.ok(await record('students',ids[key]))
 assert.equal((await db.query('SELECT count(*)::int n FROM auth.users WHERE id=ANY($1::uuid[])',[[ids.final,ids.pending]])).rows[0].n,2)
})
test('graduation refuses Storage owners and ignores the promotion cooldown for eligible accounts',async()=>{
 const ids=await fixture(7);await promote(ids)
 await db.exec('CREATE SCHEMA storage; CREATE TABLE storage.objects(owner uuid,owner_id text)')
 await db.query('INSERT INTO storage.objects(owner,owner_id) VALUES($1,NULL)',[ids.final])
 await assert.rejects(graduate(ids,[ids.final]),/Storage/)
 assert.ok(await record('students',ids.final))
 await db.exec('DROP TABLE storage.objects; DROP SCHEMA storage')
 assert.equal((await graduate(ids,[ids.final])).rows[0].result.deleted_count,1)
})
test('service-role teacher mutations can read active views while clients cannot execute lifecycle functions',async()=>{
 const ids=await fixture(8)
 await db.exec('SET ROLE service_role')
 try{
  assert.equal((await db.query("SELECT public.mutate_teacher_assignments($1,'remove','[]'::jsonb,$2) r",[ids.hod,ids.assignment])).rows[0].r.success,true)
 }finally{await db.exec('RESET ROLE')}
 await db.exec('SET ROLE authenticated')
 try{await assert.rejects(promote(ids),/permission denied/)}finally{await db.exec('RESET ROLE')}
})
const operation = (ids,version,name,payload) => db.query('SELECT public.run_current_term_operation($1,$2,$3,$4::jsonb) r',[ids.campus,version,name,JSON.stringify(payload)])
test('new-term submissions and edits preserve prior registration snapshots and preference timestamps',async()=>{
 const ids=await fixture(9);await promote(ids)
 const course=uid(990),alternate=uid(991)
 await db.query("UPDATE public.campus_settings SET deadline=now()+interval '1 day' WHERE campus_id=$1",[ids.campus])
 await db.query("INSERT INTO public.courses(id,course_code,title,department_id,semester,credits,category) VALUES($1,'NEXT201','Next course',$2,2,4,'DSC'),($3,'NEXT202','Alternate',$2,2,4,'DSC')",[course,ids.dept,alternate])
 await db.query("INSERT INTO public.semester_blueprints(department_id,semester,min_credits,max_credits,pathways) VALUES($1,2,0,40,$2::jsonb)",[ids.dept,JSON.stringify([{id:'path',name:'Path',slots:[{rule:'FIXED',target:course,name:'Paper'}]}])])
 const original=await record('student_registrations',ids.registration)
 const payload={p_student_id:ids.student,p_campus_id:ids.campus,p_semester:2,p_academic_year:'2026-27',p_pathway_id:'path',
  p_preferences:{slot_1:[{course_id:course,rank:1}]},p_allocation_metadata:{slot_1:{allocated_by:'fixed'}},p_fixed_assignments:{slot_1:course},p_total_credits:4,p_submitted_at:'2026-10-01T00:00:00Z'}
 assert.equal((await operation(ids,1,'submit_student_registration',payload)).rows[0].r.success,true)
 assert.equal((await operation(ids,1,'submit_student_registration',{...payload,p_submitted_at:'2026-10-02T00:00:00Z'})).rows[0].r.success,true)
 assert.deepEqual(await record('student_registrations',ids.registration),original)
 assert.equal((await db.query('SELECT count(*)::int n FROM public.student_registrations WHERE student_id=$1',[ids.student])).rows[0].n,2)
 assert.equal((await db.query('SELECT submitted_at FROM public.registration_preferences WHERE student_id=$1',[ids.student])).rows[0].submitted_at.toISOString(),'2026-10-01T00:00:00.000Z')
 const manual={p_student_id:ids.student,p_campus_id:ids.campus,p_semester:2,p_academic_year:'2026-27',p_slot_key:'slot_2',p_course_id:alternate,p_actor_id:ids.hod,p_actor_role:'hod'}
 assert.equal((await operation(ids,1,'execute_manual_course_allocation',manual)).rows[0].r.success,true)
})
test('settings writes and student imports/edits reject requests from a term that has ended',async()=>{
 const ids=await fixture(10)
 assert.ok((await operation(ids,0,'update_campus_settings',{p_actor_id:ids.director,deadline:null})).rows[0].r[0].id)
 const student=uid(1090)
 await db.query('INSERT INTO auth.users(id) VALUES($1)',[student])
 assert.equal((await operation(ids,0,'insert_student',{id:student,p_actor_id:ids.hod,full_name:'New student',cap_application_number:'NEW1090',current_semester:1,academic_year_joined:'2026-27',department_id:ids.dept})).rows[0].r.id,student)
 await promote(ids)
 await assert.rejects(operation(ids,0,'update_campus_settings',{p_actor_id:ids.director,deadline:'2100-01-01'}),/term changed/)
 await assert.rejects(operation(ids,1,'update_student',{id:student,p_actor_id:ids.hod,department_id:ids.dept,full_name:'Stale edit',current_semester:1,expected_semester:1}),/Student changed/)
 assert.equal((await record('students',student)).current_semester,2)
})
test('a later term can allocate, generate and publish the same course without changing its historical delivery',async()=>{
 const ids=await fixture(11);const historic=await record('timetable_entries',ids.entry);await promote(ids)
 const incoming=uid(1190),allocationToken=uid(1191),jobToken=uid(1192)
 await db.query('INSERT INTO auth.users(id) VALUES($1)',[incoming])
 await operation(ids,1,'insert_student',{id:incoming,p_actor_id:ids.hod,full_name:'Incoming',cap_application_number:'INCOMING1190',current_semester:1,academic_year_joined:'2026-27',department_id:ids.dept})
 await operation(ids,1,'execute_manual_course_allocation',{p_student_id:incoming,p_campus_id:ids.campus,p_semester:1,p_academic_year:'2026-27',p_slot_key:'slot_1',p_course_id:ids.course,p_actor_id:ids.hod,p_actor_role:'hod'})
 await operation(ids,1,'mutate_teacher_assignments',{p_actor_id:ids.hod,p_operation:'assign',p_items:[{teacher_id:ids.teacher,course_id:ids.course,campus_id:ids.campus,academic_year:'2026-27',semester:1}]})
 await operation(ids,1,'update_campus_settings',{p_actor_id:ids.director,deadline:'2026-01-01T00:00:00Z'})
 const cohort={p_campus_id:ids.campus,p_semester:1,p_academic_year:'2026-27',p_user_id:ids.director}
 const run=(await operation(ids,1,'claim_allocation_run',{...cohort,p_fencing_token:allocationToken})).rows[0].r
 await db.query('SELECT public.apply_course_allocation($1,$2,$3,1::smallint,$4::jsonb,\'[]\'::jsonb,\'{}\'::jsonb,$5)',[run,ids.campus,'2026-27',JSON.stringify([{student_id:incoming,slot_key:'slot_1',course_id:ids.course}]),allocationToken])
 const job=(await operation(ids,1,'claim_timetable_generation_job',{...cohort,p_fencing_token:jobToken})).rows[0].r
 await db.query("SELECT public.update_timetable_worker($1,$2,'running',50,NULL)",[job.job_id,jobToken])
 await db.query('SELECT public.atomic_replace_timetable_draft($1,$2,1,$3::jsonb,$4,$5)',[ids.campus,'2026-27',JSON.stringify([{academic_year:'2026-27',semester:1,course_id:ids.course,department_id:ids.dept,campus_id:ids.campus,time_slot_id:historic.time_slot_id,teacher_id:ids.teacher,session_type:'theory'}]),job.job_id,jobToken])
 const published=(await operation(ids,1,'publish_timetable_cohort',cohort)).rows[0].r
 assert.equal(published.published_count,1)
 assert.deepEqual(await record('timetable_entries',ids.entry),historic)
 assert.equal((await db.query('SELECT count(*)::int n FROM public.current_timetable_entries WHERE campus_id=$1 AND status=\'published\'',[ids.campus])).rows[0].n,1)
 assert.equal((await db.query('SELECT count(*)::int n FROM public.timetable_entries WHERE campus_id=$1 AND status=\'published\'',[ids.campus])).rows[0].n,2)
})
