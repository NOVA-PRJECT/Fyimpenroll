const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const {openFinalDatabase,fixture}=require('./helpers/final-database.cjs')
const read=name=>fs.readFileSync(path.join(__dirname,'../supabase/changes',name),'utf8')
const open=()=>openFinalDatabase({beforeReview:true,omitFeatures:['manual_timetable.sql','preferences_before_allocation.sql']})
const mutationSignature='public.mutate_teacher_assignments(uuid,text,jsonb,uuid,uuid,uuid)'
const definition=async db=>(await db.query('SELECT pg_get_functiondef($1::regprocedure) definition',[mutationSignature])).rows[0].definition
const originalPolicy="actor_role NOT IN ('superadmin','hod','campus_director')"
const bridge=()=>read('review_missing_prerequisites.sql')
const snapshot=async db=>(await db.query(`SELECT jsonb_build_object(
  'students',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.students s),
  'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.student_registrations r),
  'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.teacher_course_assignments a)) value`)).rows[0].value

for(const restricted of [false,true]) test(`missing-feature bridge installs over ${restricted?'already HOD-restricted':'original'} lifecycle and preserves existing records`,async()=>{
  const db=await open()
  try {
    const f=await fixture(db,70,{pending:true})
    // Existing premature enrollment is retained; installing the repair function must not execute it.
    await db.query("INSERT INTO public.student_registrations(student_id,campus_id,academic_year,semester,pathway_id,slot_1_course_id,total_credits,allocation_metadata) VALUES($1,$2,'2026-27',1,'path',$3,4,$4)",
      [f.students[0],f.campus,f.course,JSON.stringify({slot_1:{allocated_by:'fixed'}})])
    const before=await snapshot(db)
    if(restricted) await db.exec((await definition(db)).replace(originalPolicy,"actor_role <> 'hod'"))
    const initial=(await db.query(read('review_prerequisites.sql'))).rows
    assert.equal(initial.filter(row=>row.installed).length,2)
    const results=await db.exec(bridge())
    assert.ok(results.at(-1).rows.every(row=>row.installed))
    assert.deepEqual(await snapshot(db),before)
    assert.ok((await definition(db)).includes("actor_role IS NULL OR actor_role <> 'hod'"))
    await assert.rejects(db.exec(bridge()),/Manual timetable is installed or partially installed/)
    await db.exec('ROLLBACK')
    await db.exec(read('review_release.sql'))
    assert.equal((await db.query('SELECT public.production_readiness() value')).rows[0].value.ready,true)
    assert.deepEqual(await snapshot(db),before)
  } finally {await db.close()}
})

test('missing-feature bridge rejects partial and unknown policy states atomically',async()=>{
  const db=await open()
  try {
    await db.exec("CREATE FUNCTION public.commit_manual_timetable(uuid,text,integer,uuid,integer,text,jsonb,boolean) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$")
    await assert.rejects(db.exec(bridge()),/Manual timetable is installed or partially installed/)
    await db.exec('ROLLBACK; DROP FUNCTION public.commit_manual_timetable(uuid,text,integer,uuid,integer,text,jsonb,boolean)')
    await db.exec((await definition(db)).replace(originalPolicy,"actor_role <> 'superadmin'"))
    await assert.rejects(db.exec(bridge()),/Unexpected teacher mutation definition/)
    await db.exec('ROLLBACK')
    assert.ok((await definition(db)).includes("actor_role <> 'superadmin'"))
    const result=(await db.query(read('review_prerequisites.sql'))).rows
    assert.equal(result.filter(row=>row.installed).length,2)
  } finally {await db.close()}
})
