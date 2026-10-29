const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
require('reflect-metadata')
const { CreditLedgerService } = require('../backend/dist/modules/credit-ledger/credit-ledger.service')
const { StudentService } = require('../backend/dist/modules/student/student.service')
const { AllocationService } = require('../backend/dist/modules/allocation/allocation.service')
let db, sequence=0
const uid=n=>'00000000-0000-4000-8000-'+String(900000+n).padStart(12,'0')
before(async()=>{
 db=new PGlite({extensions:{'uuid-ossp':uuid_ossp,pgcrypto}})
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);')
 for(const file of ['supabase/baseline/schema.sql','supabase/baseline/reference-data.sql',
  ...fs.readdirSync('supabase/migrations').sort().filter(name=>name>'20261020135038\uffff').map(name=>'supabase/migrations/'+name),
  'supabase/changes/semester_lifecycle.sql','supabase/changes/data_read_optimization.sql','supabase/changes/preferences_before_allocation.sql']) await db.exec(fs.readFileSync(file,'utf8'))
})
after(async()=>{await db?.close()})
async function fixture(){
 const n=++sequence,base=n*100
 const f={campus:uid(base),dept:uid(base+1),student:uid(base+2),director:uid(base+3),hod:uid(base+4),courses:Array.from({length:7},(_,i)=>uid(base+10+i)),base,n}
 await db.exec(`INSERT INTO public.campuses(id,name,code) VALUES('${f.campus}','Preference ${n}','PF${n}');
 UPDATE public.campus_settings SET academic_year='2026-27',deadline=now()+interval '1 day',min_credits=0,max_credits=40 WHERE campus_id='${f.campus}';
 INSERT INTO public.departments(id,campus_id,name,code) VALUES('${f.dept}','${f.campus}','Preference dept ${n}','PD${n}');
 INSERT INTO auth.users(id) VALUES('${f.student}'),('${f.director}'),('${f.hod}');
 INSERT INTO public.faculty(id,full_name,email,role,campus_id,department_id) VALUES
 ('${f.director}','Director','pf-director${n}@example.test','campus_director','${f.campus}',NULL),
 ('${f.hod}','HOD','pf-hod${n}@example.test','hod','${f.campus}','${f.dept}');
 INSERT INTO public.students(id,full_name,campus_id,department_id,current_semester,academic_year_joined,cap_application_number)
 VALUES('${f.student}','Student ${n}','${f.campus}','${f.dept}',4,'2026-27','PF${n}');`)
 for(let i=0;i<7;i++)await db.query('INSERT INTO public.courses(id,course_code,title,department_id,semester,credits,category,seat_limit) VALUES($1,$2,$3,$4,4,4,$5,60)',[f.courses[i],`KU04${i<4?'DSC':'SEC'}${n}${i}`,`Paper ${i+1}`,f.dept,i<4?'DSC':'SEC'])
 f.preferences=f.courses.slice(0,6).map((id,i)=>({slot:i+1,is_fixed:i<4,choices:[{course_id:id,rank:1}]}))
 const rows=(await db.query('SELECT id,course_code FROM public.courses WHERE department_id=$1 ORDER BY id',[f.dept])).rows
 const slots=rows.slice(0,6).map((c,i)=>i<4?{rule:'FIXED',target:c.course_code,name:'Fixed '+i}:{rule:'GLOBAL_BASKET',target:'SEC',name:'Elective '+i})
 await db.query('INSERT INTO public.semester_blueprints(department_id,semester,min_credits,max_credits,pathways) VALUES($1,4,0,40,$2)',[f.dept,JSON.stringify([{id:'path',name:'Path',slots}])])
 return f
}
async function submit(f,student=f.student,date='2026-10-01T00:00:00Z'){
 return db.query("SELECT public.run_current_term_operation($1,0,'submit_student_registration',$2::jsonb) value",[f.campus,JSON.stringify({p_student_id:student,p_campus_id:f.campus,p_semester:4,p_academic_year:'2026-27',p_pathway_id:'path',p_preferences:f.preferences,
 p_fixed_assignments:Object.fromEntries(f.courses.slice(0,4).map((id,i)=>['slot_'+(i+1),id])),p_allocation_metadata:{slot_1:{allocated_by:'fixed'},credit_breakdown:{total_credits:24}},p_total_credits:24,p_submitted_at:date})])
}
const registration=async student=>(await db.query('SELECT * FROM public.student_registrations WHERE student_id=$1 ORDER BY semester DESC',[student])).rows[0]
async function readAdmin(student){
 const data={students:(await db.query('SELECT * FROM public.students WHERE id=$1',[student])).rows,
  student_registrations:(await db.query('SELECT * FROM public.student_registrations WHERE student_id=$1',[student])).rows,
  courses:(await db.query('SELECT * FROM public.courses')).rows,
  campus_settings:(await db.query('SELECT * FROM public.campus_settings')).rows,
  registration_preferences:(await db.query('SELECT * FROM public.registration_preferences WHERE student_id=$1',[student])).rows,
  system_logs:(await db.query('SELECT * FROM public.current_system_logs')).rows}
 for(const row of data.students){row.departments={name:'Department',code:'PD'};row.campuses={name:'Campus'}}
 for(const row of data.courses)row.departments={name:'Department'}
 return {from(table){table=({current_system_logs:'system_logs',current_student_registrations:'student_registrations'})[table]||table;let rows=data[table]||[],single=false;const q={select(){return q},eq(k,v){rows=rows.filter(r=>r[k]===v);return q},in(k,v){rows=rows.filter(r=>v.includes(r[k]));return q},order(){return q},limit(n){rows=rows.slice(0,n);return q},range(a,b){rows=rows.slice(a,b+1);return q},single(){single=true;return q},maybeSingle(){single=true;return q},then(resolve){return Promise.resolve({data:single?rows[0]||null:rows,error:null}).then(resolve)}};return q}}
}
async function ledger(student){return new CreditLedgerService({admin:await readAdmin(student)}).getCreditLedger(student,{userId:student,role:'student'})}
async function claim(f){
 await db.query("UPDATE public.campus_settings SET deadline=now()-interval '1 minute' WHERE campus_id=$1",[f.campus])
 const token=uid(f.base+70),run=(await db.query("SELECT public.claim_allocation_run($1,'2026-27',4::smallint,$2,300,$3) value",[f.campus,f.director,token])).rows[0].value
 return {run,token}
}
async function commit(f,claim,students=[f.student]){
 const assignments=students.flatMap(student=>f.courses.slice(0,6).map((course,i)=>({student_id:student,slot_key:'slot_'+(i+1),course_id:course,metadata:{allocated_by:i<4?'fixed':'rank_1',round:i<4?undefined:1}})))
 return db.query("SELECT public.apply_course_allocation($1,$2,'2026-27',4::smallint,$3,'[]','{}',$4) value",[claim.run,f.campus,JSON.stringify(assignments),claim.token])
}

test('six submitted papers including four fixed papers have zero enrollments, ledger credits and seat usage',async()=>{
 const f=await fixture();await submit(f);const reg=await registration(f.student)
 assert.ok(reg);for(let i=1;i<=8;i++)assert.equal(reg['slot_'+i+'_course_id'],null)
 assert.equal(Number(reg.total_credits),0);assert.deepEqual(reg.selections,[])
 assert.equal((await ledger(f.student)).totalRegisteredCredits,0)
 const admin=await readAdmin(f.student),user={userId:f.student,campus_id:f.campus,department_id:f.dept,role:'student'}
 const summary=await new StudentService({admin}).getDashboardSummary(user)
 assert.equal(summary.hasSubmission,true);assert.equal(summary.hasRegistration,false);assert.equal(summary.allocationCompleted,false)
 assert.equal(summary.totalRegisteredCredits,0);assert.ok(summary.enrolledCourses.every(course=>!course.isConfirmed))
 const unresolved=await new AllocationService({admin},{}).getUnresolvedStudents(4,{...user,role:'hod'})
 assert.equal(unresolved.allocationCompleted,false);assert.deepEqual(unresolved.unresolvedStudents,[])
 const counts=(await db.query('SELECT public.display_enrollment_counts($1) value',[JSON.stringify(f.courses.slice(0,6).map((id,i)=>({key:String(i),course_id:id,campus_id:f.campus,academic_year:'2026-27',semester:4})))] )).rows[0].value
 assert.ok(Object.values(counts).every(value=>value===0))
 await submit(f,f.student,'2026-10-02T00:00:00Z')
 assert.equal((await db.query('SELECT submitted_at FROM public.registration_preferences WHERE student_id=$1',[f.student])).rows[0].submitted_at.toISOString(),'2026-10-01T00:00:00.000Z')
})

test('allocation commits fixed and elective papers together with correct snapshots and credits',async()=>{
 const f=await fixture();await submit(f);const c=await claim(f);await commit(f,c)
 const reg=await registration(f.student)
 for(let i=0;i<6;i++)assert.equal(reg['slot_'+(i+1)+'_course_id'],f.courses[i])
 assert.equal(Number(reg.total_credits),24);assert.equal(reg.selections.length,6)
 assert.equal(reg.allocation_metadata.slot_1.allocated_by,'fixed');assert.equal(reg.allocation_metadata.slot_5.allocated_by,'rank_1')
 assert.equal((await ledger(f.student)).totalRegisteredCredits,24)
 const summary=await new StudentService({admin:await readAdmin(f.student)}).getDashboardSummary({userId:f.student,campus_id:f.campus,role:'student'})
 assert.equal(summary.totalRegisteredCredits,24);assert.equal(summary.enrolledCourses.filter(course=>course.isConfirmed).length,6)
 await assert.rejects(submit(f),/closed|allocation/)
})

test('fixed-paper overcapacity rolls back the entire allocation and leaves both students pending',async()=>{
 const f=await fixture(),second=uid(f.base+60)
 await db.query('INSERT INTO auth.users(id) VALUES($1)',[second])
 await db.query("INSERT INTO public.students(id,full_name,campus_id,department_id,current_semester,academic_year_joined,cap_application_number) VALUES($1,'Second',$2,$3,4,'2026-27',$4)",[second,f.campus,f.dept,'PF-SECOND'+f.n])
 await submit(f);await submit(f,second);await db.query('UPDATE public.courses SET seat_limit=1 WHERE id=$1',[f.courses[0]])
 const c=await claim(f);await assert.rejects(commit(f,c,[f.student,second]),/global capacity/)
 for(const student of [f.student,second]){assert.equal((await registration(student)).slot_1_course_id,null);assert.equal((await ledger(student)).totalRegisteredCredits,0)}
 assert.equal((await db.query('SELECT status FROM public.system_logs WHERE id=$1',[c.run])).rows[0].status,'running')
})

test('an older worker cannot complete allocation while silently omitting fixed papers',async()=>{
 const f=await fixture();await submit(f);const c=await claim(f)
 const electives=f.courses.slice(4,6).map((id,i)=>({student_id:f.student,slot_key:'slot_'+(i+5),course_id:id}))
 await assert.rejects(db.query("SELECT public.apply_course_allocation($1,$2,'2026-27',4::smallint,$3,'[]','{}',$4)",[c.run,f.campus,JSON.stringify(electives),c.token]),/omits a submitted paper/)
 assert.equal((await registration(f.student)).slot_5_course_id,null)
 assert.equal((await ledger(f.student)).totalRegisteredCredits,0)
})

test('manual RPCs and direct enrollment writes cannot bypass allocation completion',async()=>{
 const f=await fixture();await submit(f)
 await assert.rejects(db.query('UPDATE public.student_registrations SET slot_1_course_id=$1 WHERE student_id=$2',[f.courses[0],f.student]),/completed allocation/)
 await assert.rejects(db.query("SELECT public.execute_manual_course_allocation($1,$2,4::smallint,'2026-27','slot_5',$3,$4,'hod')",[f.student,f.campus,f.courses[4],f.hod]),/completed allocation/)
 assert.equal((await registration(f.student)).slot_5_course_id,null)
})

test('scoped repair preserves preferences and audits a premature fixed record after the account moved back',async()=>{
 const f=await fixture();await submit(f)
 await db.exec('ALTER TABLE public.student_registrations DISABLE TRIGGER enrollment_after_allocation')
 try{await db.query("UPDATE public.student_registrations SET slot_1_course_id=$1,total_credits=4,allocation_metadata='{\"slot_1\":{\"allocated_by\":\"fixed\"}}' WHERE student_id=$2",[f.courses[0],f.student])}
 finally{await db.exec('ALTER TABLE public.student_registrations ENABLE TRIGGER enrollment_after_allocation')}
 const reg=await registration(f.student),preferences=(await db.query('SELECT * FROM public.registration_preferences WHERE student_id=$1',[f.student])).rows[0]
 await db.query('UPDATE public.students SET current_semester=3 WHERE id=$1',[f.student])
 const historicalCourse=uid(f.base+80)
 await db.query("INSERT INTO public.courses(id,course_code,title,department_id,semester,credits,category) VALUES($1,$2,'Valid semester 3 paper',$3,3,4,'DSC')",[historicalCourse,'KU03DSCPR'+f.n,f.dept])
 await db.query("INSERT INTO public.system_logs(log_type,status,campus_id,academic_year,semester) VALUES('allocation_run','completed',$1,'2026-27',3)",[f.campus])
 await db.query("INSERT INTO public.student_registrations(student_id,campus_id,semester,academic_year,slot_1_course_id,total_credits) VALUES($1,$2,3,'2026-27',$3,4)",[f.student,f.campus,historicalCourse])
 const historical=(await db.query('SELECT * FROM public.student_registrations WHERE student_id=$1 AND semester=3',[f.student])).rows[0]
 const repaired=(await db.query('SELECT public.repair_pending_fixed_registration($1,$2,0) value',[reg.id,f.student])).rows[0].value
 assert.equal(repaired.pending_anchor_retained,false);assert.equal((await db.query('SELECT id FROM public.student_registrations WHERE id=$1',[reg.id])).rowCount,0)
 assert.deepEqual((await db.query('SELECT * FROM public.student_registrations WHERE id=$1',[historical.id])).rows[0],historical)
 assert.deepEqual((await db.query('SELECT * FROM public.registration_preferences WHERE student_id=$1',[f.student])).rows[0],preferences)
 const audit=(await db.query('SELECT metadata FROM public.system_logs WHERE id=$1',[repaired.audit_id])).rows[0].metadata
 assert.equal(audit.before.slot_1_course_id,f.courses[0]);assert.equal((await ledger(f.student)).totalRegisteredCredits,4)
})

test('repair keeps a zero-credit pending anchor when the student is still in the submitted semester',async()=>{
 const f=await fixture();await submit(f)
 await db.exec('ALTER TABLE public.student_registrations DISABLE TRIGGER enrollment_after_allocation')
 try{await db.query("UPDATE public.student_registrations SET slot_1_course_id=$1,total_credits=4,allocation_metadata='{\"slot_1\":{\"allocated_by\":\"fixed\"}}' WHERE student_id=$2",[f.courses[0],f.student])}
 finally{await db.exec('ALTER TABLE public.student_registrations ENABLE TRIGGER enrollment_after_allocation')}
 const reg=await registration(f.student)
 const result=(await db.query('SELECT public.repair_pending_fixed_registration($1,$2,0) value',[reg.id,f.student])).rows[0].value
 assert.equal(result.pending_anchor_retained,true);assert.equal((await registration(f.student)).id,reg.id)
 assert.equal((await registration(f.student)).slot_1_course_id,null);assert.equal((await ledger(f.student)).totalRegisteredCredits,0)
 await assert.rejects(db.query('SELECT public.repair_pending_fixed_registration($1,$2,0)',[reg.id,f.student]),/No premature/)
 const c=await claim(f);await commit(f,c);assert.equal((await ledger(f.student)).totalRegisteredCredits,24)
})

test('manual resolution remains available after completion and fixed papers remain protected',async()=>{
 const f=await fixture();await submit(f);const c=await claim(f);await commit(f,c)
 await db.query("SELECT public.execute_manual_course_allocation($1,$2,4::smallint,'2026-27','slot_5',$3,$4,'hod')",[f.student,f.campus,f.courses[6],f.hod])
 assert.equal((await registration(f.student)).slot_5_course_id,f.courses[6]);assert.equal((await ledger(f.student)).totalRegisteredCredits,24)
 await assert.rejects(db.query("SELECT public.execute_manual_course_allocation($1,$2,4::smallint,'2026-27','slot_1',$3,$4,'hod')",[f.student,f.campus,f.courses[4],f.hod]),/fixed core/)
})

test('pending submission keeps semester, term and deadline checks authoritative',async()=>{
 const f=await fixture()
 await db.query('UPDATE public.students SET current_semester=3 WHERE id=$1',[f.student])
 await assert.rejects(submit(f),/active semester/)
 await db.query('UPDATE public.students SET current_semester=4 WHERE id=$1',[f.student])
 await assert.rejects(db.query("SELECT public.run_current_term_operation($1,1,'submit_student_registration','{}')",[f.campus]),/term changed/)
 await db.query("UPDATE public.campus_settings SET deadline=now()-interval '1 minute' WHERE campus_id=$1",[f.campus])
 await assert.rejects(submit(f),/window is closed/)
 assert.equal(await registration(f.student),undefined)
})

test('repair refuses completed allocations and historical terms without changing ledger history',async()=>{
 const f=await fixture();await submit(f);const c=await claim(f);await commit(f,c)
 const reg=await registration(f.student)
 await assert.rejects(db.query('SELECT public.repair_pending_fixed_registration($1,$2,0)',[reg.id,f.student]),/completed allocation/)
 await db.query('SELECT public.promote_campus_students_atomic($1,$2,0)',[f.campus,f.director])
 await assert.rejects(db.query('SELECT public.repair_pending_fixed_registration($1,$2,0)',[reg.id,f.student]),/Historical|changed-term/)
 assert.equal((await ledger(f.student)).totalRegisteredCredits,24)
})

test('preference, allocation and repair routines remain service-role only',async()=>{
 const access=(await db.query("SELECT has_function_privilege('authenticated','public.repair_pending_fixed_registration(uuid,uuid,integer)','EXECUTE') client,has_function_privilege('anon','public.submit_student_registration(uuid,uuid,smallint,text,text,jsonb,jsonb,jsonb,numeric,timestamptz)','EXECUTE') anon,has_function_privilege('service_role','public.apply_course_allocation(uuid,uuid,text,smallint,jsonb,jsonb,jsonb,uuid)','EXECUTE') service")).rows[0]
 assert.deepEqual(access,{client:false,anon:false,service:true})
})
