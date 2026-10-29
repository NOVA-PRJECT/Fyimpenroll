const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
let db
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
before(async()=>{
  db=new PGlite()
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.current_student_registrations(id uuid,student_id uuid,campus_id uuid,academic_year text,semester integer,term_version integer,
      ${Array.from({length:8},(_,i)=>`slot_${i+1}_course_id uuid`).join(',')});
    CREATE TABLE public.students(id uuid,campus_id uuid);
    CREATE TABLE public.period_attendance(timetable_slot_id uuid,student_id uuid,status text,marked_at timestamptz,attendance_date date);
    CREATE TABLE public.period_attendance_sessions(timetable_slot_id uuid,attendance_date date,revision integer,revision_token text);
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;`)
  await db.exec(fs.readFileSync('supabase/changes/data_read_optimization.sql','utf8'))
  await db.exec(`INSERT INTO public.current_student_registrations(id,student_id,campus_id,academic_year,semester,term_version,slot_1_course_id,slot_2_course_id) VALUES
    ('${uid(1)}','${uid(11)}','${uid(21)}','2026-27',1,0,'${uid(31)}','${uid(31)}'),
    ('${uid(2)}','${uid(12)}','${uid(22)}','2026-27',1,0,'${uid(31)}',null),
    ('${uid(3)}','${uid(13)}','${uid(21)}','2025-26',1,0,'${uid(31)}',null);
    INSERT INTO public.students VALUES('${uid(11)}','${uid(21)}'),('${uid(12)}','${uid(22)}');`)
})
after(async()=>await db?.close())
test('batched delivery totals distinguish local/global capacity and count repeated slots once',async()=>{
  const delivery={course_id:uid(31),academic_year:'2026-27',semester:1}
  const {rows}=await db.query('SELECT public.display_enrollment_counts($1) AS totals',[JSON.stringify([
    {...delivery,key:'global'},{...delivery,key:'campus',campus_id:uid(21)},{...delivery,key:'term',campus_id:uid(21),term_version:1},
  ])]);assert.deepEqual(rows[0].totals,{global:2,campus:1,term:0})
})
test('period totals retain date, session revision, enrollment and empty-mark semantics',async()=>{
  await db.exec(`INSERT INTO public.period_attendance VALUES('${uid(41)}','${uid(11)}','present',now(),'2026-10-28');
    INSERT INTO public.period_attendance_sessions VALUES('${uid(41)}','2026-10-28',3,'revision-three');`)
  const slot={course_id:uid(31),campus_id:uid(21),academic_year:'2026-27',semester:1}
  const value=(await db.query('SELECT public.display_period_status($1,$2) AS status',[JSON.stringify([{...slot,id:uid(41)},{...slot,id:uid(42)}]),'2026-10-28'])).rows[0].status
  assert.equal(value[uid(41)].total_enrolled,1);assert.equal(value[uid(41)].present,1);assert.equal(value[uid(41)].revision_token,'revision-three')
  assert.equal(value[uid(42)].is_marked,false);assert.equal(value[uid(42)].revision,0)
})
test('aggregation functions reject public execution and oversized batches',async()=>{
  const privileges=(await db.query("SELECT has_function_privilege('anon','public.display_enrollment_counts(jsonb)','EXECUTE') AS anon,has_function_privilege('authenticated','public.display_period_status(jsonb,date)','EXECUTE') AS authenticated,has_function_privilege('service_role','public.display_enrollment_counts(jsonb)','EXECUTE') AS service")).rows[0]
  assert.deepEqual(privileges,{anon:false,authenticated:false,service:true})
  await assert.rejects(db.query('SELECT public.display_enrollment_counts($1)',[JSON.stringify(Array.from({length:201},()=>({})))]),/200/)
})
