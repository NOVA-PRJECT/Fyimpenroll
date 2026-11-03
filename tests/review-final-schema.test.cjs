const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { openFinalDatabase, fixture, uid, stageVerifiedDraft } = require('./helpers/final-database.cjs')
let db
before(async()=>{ db=await openFinalDatabase() })
after(async()=>{ await db?.close() })
test('exact final bootstrap passes compatibility and incomplete capabilities fail readiness',async()=>{
  const ready=async()=>(await db.query('SELECT public.production_readiness() r')).rows[0].r
  assert.equal((await ready()).ready,true)
  assert.equal((await ready()).schema.version,1)
  await db.exec('BEGIN; DROP FUNCTION public.display_period_status(jsonb,date);')
  try { assert.equal((await ready()).ready,false) } finally { await db.exec('ROLLBACK;') }
})
test('database attendance rejects duplicate absentees, omitted revisions, unknown students and stale corrections',async()=>{
  const f=await fixture(db,1); await f.publish()
  await assert.rejects(f.submit([f.students[0],f.students[0]]),/duplicate/)
  await assert.rejects(f.submit([],null),/revision/)
  await assert.rejects(f.submit([uid(999999)]),/roster/)
  assert.equal((await f.submit()).rows[0].value.present_count,1)
  await assert.rejects(f.submit([],0),/CONFLICT/)
  assert.equal((await f.submit([f.students[0]],1)).rows[0].value.absent_count,1)
  await assert.rejects(db.query('UPDATE public.period_attendance_sessions SET present_count=-1 WHERE timetable_slot_id=$1',[f.entry]),/review_attendance_totals/)
})
test('authoritative attendance roster cannot be truncated by a Data API cap',async()=>{
  const f=await fixture(db,2,{count:1001}); await f.publish()
  await assert.rejects(f.submit([],0,f.students.slice(0,1000)),/roster changed/)
  const result=(await f.submit([f.students[1000]])).rows[0].value
  assert.equal(result.total_students,1001); assert.equal(result.present_count,1000)
})
test('revoked assignment is rejected inside the attendance transaction',async()=>{
  const f=await fixture(db,3); await f.publish()
  await db.query('DELETE FROM public.teacher_course_assignments WHERE teacher_id=$1',[f.teacher])
  await assert.rejects(f.submit(),/no longer authorized/)
})
test('practical copy requires complete source marks and target revision',async()=>{
  const f=await fixture(db,4,{count:2}); await f.publish(true)
  const copy=rev=>db.query('SELECT public.atomic_copy_practical_attendance($1,$2,$3::date,$4,$5) value',[f.entry,f.entry2,f.date,f.teacher,rev])
  await assert.rejects(copy(0),/complete current roster/)
  await f.submit([f.students[0]])
  await assert.rejects(copy(null),/revision/)
  assert.equal((await copy(0)).rows[0].value.copied_count,2)
  await assert.rejects(copy(0),/CONFLICT/)
})
test('audit storage failure rolls attendance marks and revision back together',async()=>{
  const f=await fixture(db,5); await f.publish()
  await db.exec(`CREATE FUNCTION public.reject_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='period_attendance_marked' THEN RAISE EXCEPTION 'Audit storage failed'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER zz_review_audit BEFORE INSERT ON public.system_logs FOR EACH ROW EXECUTE FUNCTION public.reject_review_audit();`)
  try { await assert.rejects(f.submit(),/Audit storage failed/) } finally { await db.exec('DROP TRIGGER zz_review_audit ON public.system_logs; DROP FUNCTION public.reject_review_audit();') }
  assert.equal((await db.query('SELECT count(*)::int n FROM public.period_attendance WHERE timetable_slot_id=$1',[f.entry])).rows[0].n,0)
})
test('durable queue permits one expensive worker and fences expired delivery and cancellation',async()=>{
  const a=await fixture(db,6),b=await fixture(db,7)
  const enqueue=f=>db.query("SELECT public.enqueue_review_job('timetable',$1,$2,0,'2026-27',1,'{}') value",[f.campus,f.director])
  const first=(await enqueue(a)).rows[0].value; assert.equal((await enqueue(a)).rows[0].value.jobId,first.jobId)
  await enqueue(b)
  const claim=async()=>(await db.query('SELECT public.claim_review_job() value')).rows[0].value
  const old=await claim(); assert.equal(old.id,first.jobId); assert.equal(await claim(),null)
  await db.query("UPDATE public.review_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[old.id])
  const fresh=await claim(); assert.equal(fresh.id,old.id); assert.notEqual(fresh.fence,old.fence)
  assert.equal((await db.query('SELECT public.finish_review_job($1,$2,NULL) value',[old.id,old.fence])).rows[0].value,false)
  await db.query('SELECT public.cancel_review_job($1,$2)',[fresh.id,a.director])
  assert.equal((await db.query('SELECT public.renew_review_job($1,$2) value',[fresh.id,fresh.fence])).rows[0].value,false)
  const next=await claim(); assert.equal(next.campus_id,b.campus)
  await db.query('SELECT public.finish_review_job($1,$2,$3)',[next.id,next.fence,'synthetic test completion'])
})
test('research-only cohorts finalize without fake periods and block later preference edits',async()=>{
  const f=await fixture(db,8,{hours:0,semester:9})
  await db.query("SELECT public.enqueue_review_job('timetable',$1,$2,0,'2026-27',9,'{}')",[f.campus,f.director])
  const job=(await db.query('SELECT public.claim_review_job() value')).rows[0].value
  await db.query("SELECT public.finalize_research_cohort($1,'2026-27',9,$2,0,$3,$4)",[f.campus,f.director,job.id,job.fence])
  await assert.rejects(db.query('SELECT public.cancel_review_job($1,$2)',[job.id,f.director]),{ code: 'P4090' })
  const committed = (await db.query('SELECT l.status, q.fence FROM public.system_logs l JOIN public.review_jobs q USING(id) WHERE l.id=$1',[job.id])).rows[0]
  assert.equal(committed.status,'completed')
  assert.equal(committed.fence,job.fence)
  assert.equal((await db.query('SELECT count(*)::int n FROM public.timetable_entries WHERE campus_id=$1',[f.campus])).rows[0].n,0)
  await assert.rejects(db.query('UPDATE public.student_registrations SET total_credits=5 WHERE student_id=$1',[f.students[0]]),/finalized/)
  await db.query('SELECT public.finish_review_job($1,$2,$3)',[job.id,job.fence,'Worker stopped after commit'])
  assert.deepEqual((await db.query('SELECT status,error FROM public.review_jobs WHERE id=$1',[job.id])).rows[0],{status:'completed',error:null})
  const mixed=await fixture(db,9,{hours:1,semester:10})
  await db.query("SELECT public.enqueue_review_job('timetable',$1,$2,0,'2026-27',10,'{}')",[mixed.campus,mixed.director])
  const active=(await db.query('SELECT public.claim_review_job() value')).rows[0].value
  await assert.rejects(db.query("SELECT public.finalize_research_cohort($1,'2026-27',10,$2,0,$3,$4)",[mixed.campus,mixed.director,active.id,active.fence]),/classroom components/)
  await db.query('SELECT public.finish_review_job($1,$2,$3)',[active.id,active.fence,'mixed cohort requires classroom schedule'])
})
test('manual revisions ignore unrelated campus edits and detect shared teacher occupancy changes',async()=>{
  const a=await fixture(db,10),b=await fixture(db,11)
  const vector=async()=>(await db.query("SELECT public.manual_dependency_vector($1,'2026-27',1,0) value",[a.campus])).rows[0].value
  const original=await vector()
  await db.query("UPDATE public.faculty SET full_name='Renamed teacher' WHERE id=$1",[b.teacher])
  assert.deepEqual(await vector(),original)
  await db.query("UPDATE public.campus_settings SET deadline=now()-interval '2 days' WHERE campus_id=$1",[b.campus])
  assert.deepEqual(await vector(),original)
  await db.query("INSERT INTO public.teacher_course_assignments(teacher_id,course_id,campus_id,academic_year,semester) VALUES($1,$2,$3,'2026-27',1)",[a.teacher,b.course,b.campus])
  assert.notDeepEqual(await vector(),original)
})
test('domain deletion persists a complete manifest and bounded cleanup claims track provider errors',async()=>{
  const f=await fixture(db,12,{count:7})
  const result=(await db.query("SELECT public.review_delete_accounts('campus',$1,$2) value",[f.campus,f.admin])).rows[0].value
  assert.equal(result.pendingAuthAccounts,10)
  const tasks=(await db.query('SELECT * FROM public.claim_auth_cleanup()')).rows
  assert.equal(tasks.length,5)
  for(const [i,task] of tasks.entries()) await db.query('SELECT public.finish_auth_cleanup($1,$2,$3)',[task.id,task.fence,i===0?'provider throttled':null])
  const failed=(await db.query('SELECT status,error FROM public.auth_cleanup_tasks WHERE id=$1',[tasks[0].id])).rows[0]
  assert.equal(failed.status,'pending'); assert.equal(failed.error,'provider throttled')
  assert.equal((await db.query('SELECT count(*)::int n FROM public.auth_cleanup_tasks WHERE request_id=$1',[result.cleanupRequestId])).rows[0].n,10)
})

test('deleting a department preserves same-campus teaching assignments owned by another department', async () => {
  const f = await fixture(db, 33), otherDepartment = uid(900), otherCourse = uid(901)
  await db.query("INSERT INTO public.departments(id,campus_id,name,code) VALUES($1,$2,'Other department','O33')",[otherDepartment,f.campus])
  await db.query("INSERT INTO public.courses(id,course_code,title,department_id,semester,credits,category,theory_hours_per_week,practical_hours_per_week) VALUES($1,'KU01DSC901','Other course',$2,1,4,'DSC',1,0)",[otherCourse,otherDepartment])
  await db.query("INSERT INTO public.teacher_course_assignments(teacher_id,course_id,campus_id,academic_year,semester) VALUES($1,$2,$3,'2026-27',1)",[f.teacher,otherCourse,f.campus])
  const removeDepartment = () => db.query("SELECT public.review_delete_accounts('department',$1,$2)",[f.dept,f.admin])
  await assert.rejects(removeDepartment(), /outside the deletion scope/)
  assert.equal((await db.query('SELECT teacher_id FROM public.teacher_course_assignments WHERE course_id=$1',[otherCourse])).rows[0].teacher_id, f.teacher)
  assert.equal((await db.query('SELECT id FROM public.auth_cleanup_tasks WHERE resource_id=$1',[f.dept])).rows.length, 0)
  await db.query('DELETE FROM public.teacher_course_assignments WHERE course_id=$1',[otherCourse])
  await removeDepartment()
  assert.equal((await db.query('SELECT id FROM public.courses WHERE id=$1',[otherCourse])).rows.length, 1)
  assert.equal((await db.query('SELECT id FROM public.departments WHERE id=$1',[f.dept])).rows.length, 0)
})
test('final bootstrap supports preferences, allocation, verified publication, attendance and promotion together',async()=>{
  const f=await fixture(db,13,{pending:true}),student=f.students[0]
  await db.query("UPDATE public.campus_settings SET deadline=now()+interval '1 day' WHERE campus_id=$1",[f.campus])
  await db.query("SELECT public.submit_student_registration($1,$2,1::smallint,'2026-27','path',$3::jsonb,'{}','{}',4,now())",[student,f.campus,JSON.stringify([{slot:1,is_fixed:true,choices:[{course_id:f.course,rank:1}]}])])
  assert.equal((await db.query('SELECT slot_1_course_id FROM public.current_student_registrations WHERE student_id=$1',[student])).rows[0].slot_1_course_id,null)
  await db.query("UPDATE public.campus_settings SET deadline=now()-interval '1 minute' WHERE campus_id=$1",[f.campus])
  await db.query("SELECT public.enqueue_review_job('allocation',$1,$2,0,'2026-27',1,'{}')",[f.campus,f.director])
  const job=(await db.query('SELECT public.claim_review_job() value')).rows[0].value
  await db.query("SELECT public.apply_course_allocation($1,$2,'2026-27',1::smallint,$3::jsonb,'[]','{}',$4)",[job.id,f.campus,JSON.stringify([{student_id:student,slot_key:'slot_1',course_id:f.course,metadata:{allocated_by:'fixed'}}]),job.fence])
  await db.query('SELECT public.finish_review_job($1,$2,NULL)',[job.id,job.fence])
  await stageVerifiedDraft(db,f)
  await db.query("SELECT public.publish_timetable_cohort($1,'2026-27',1)",[f.campus])
  assert.equal((await f.submit()).rows[0].value.total_students,1)
  await db.query('SELECT public.promote_campus_students_atomic($1,$2,0)',[f.campus,f.director])
  assert.equal((await db.query('SELECT current_semester FROM public.students WHERE id=$1',[student])).rows[0].current_semester,2)
  assert.equal((await db.query('SELECT slot_1_course_id FROM public.student_registrations WHERE student_id=$1',[student])).rows[0].slot_1_course_id,f.course)
  await assert.rejects(f.submit([],1),/Delivery not found|concluded|not found/)
})

test('single-transaction owner bundle restores the same ready schema and refuses replay',async()=>{
  const isolated=await openFinalDatabase({bundle:true})
  try {
    assert.equal((await isolated.query('SELECT public.production_readiness() r')).rows[0].r.ready,true)
    const fs=require('node:fs'),path=require('node:path')
    await assert.rejects(isolated.exec(fs.readFileSync(path.resolve(__dirname,'../supabase/changes/review_release.sql'),'utf8')),/already installed/)
    await isolated.exec('ROLLBACK')
  }finally{await isolated.close()}
})

test('zero-contact final semester can promote to graduation without classroom periods',async()=>{
  const f=await fixture(db,14,{hours:0,semester:10})
  await db.query("SELECT public.enqueue_review_job('timetable',$1,$2,0,'2026-27',10,'{}')",[f.campus,f.director])
  const job=(await db.query('SELECT public.claim_review_job() value')).rows[0].value
  await db.query("SELECT public.finalize_research_cohort($1,'2026-27',10,$2,0,$3,$4)",[f.campus,f.director,job.id,job.fence])
  await db.query('SELECT public.finish_review_job($1,$2,NULL)',[job.id,job.fence])
  await assert.rejects(db.query('UPDATE public.courses SET theory_hours_per_week=1 WHERE id=$1',[f.course]),/finalized research-only/)
  await db.query('SELECT public.promote_campus_students_atomic($1,$2,0)',[f.campus,f.director])
  assert.equal((await db.query('SELECT current_semester FROM public.students WHERE id=$1',[f.students[0]])).rows[0].current_semester,11)
  await db.query('SELECT public.delete_graduating_students($1,$2::uuid[],$3)',[f.campus,f.students,f.director])
  assert.equal((await db.query('SELECT count(*)::int n FROM auth.users WHERE id=$1',[f.students[0]])).rows[0].n,0)
})
test('dependency-based manual context returns fresh save revisions and preserves immutable publication',async()=>{
  const f=await fixture(db,15)
  await db.query("INSERT INTO public.system_logs(log_type,campus_id,academic_year,semester,status,user_id,metadata) VALUES('timetable_job',$1,'2026-27',1,'failed',$2,'{}')",[f.campus,f.director])
  const context=async()=>(await db.query("SELECT public.timetable_manual_context($1,'2026-27',1,$2,0) value",[f.campus,f.director])).rows[0].value
  const initial=await context()
  const draft={mode:'follow_rules',reason:'',rules:[],entries:[{courseId:f.course,day:1,period:1,sessionType:'theory',isLabBlock:false}],report:{blockingViolations:[],violations:[],remaining:[],unscheduledPeriods:0}}
  const commit=(revision,publish)=>db.query("SELECT public.commit_manual_timetable($1,'2026-27',1,$2,0,$3,$4::jsonb,$5) value",[f.campus,f.director,revision,JSON.stringify(draft),publish])
  const saved=(await commit(initial.revision,false)).rows[0].value
  const refreshed=await context()
  assert.equal(saved.revision,refreshed.revision)
  assert.notEqual(refreshed.revision,initial.revision)
  await assert.rejects(commit(initial.revision,false),/changed/)
  await commit(refreshed.revision,true)
  assert.equal((await context()).published,true)
  await assert.rejects(commit((await context()).revision,false),/Published timetables/)
})
