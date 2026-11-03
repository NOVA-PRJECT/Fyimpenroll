const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')
const root = path.resolve(__dirname, '../..')
function bootstrapSources(filename = path.join(root, 'supabase/baseline/bootstrap.psql')) {
  return fs.readFileSync(filename, 'utf8').split(/\r?\n/).flatMap(line => {
    if (line.startsWith('\\ir ')) {
      const target = path.resolve(path.dirname(filename), line.slice(4).trim())
      return target.endsWith('.psql') ? bootstrapSources(target) : [target]
    }
    return []
  })
}
async function openFinalDatabase({ bundle = false, beforeReview = false, omitFeatures = [] } = {}) {
  const db = new PGlite({ extensions: { 'uuid-ossp': uuid_ossp, pgcrypto } })
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);')
  const original = bootstrapSources().filter(file => !omitFeatures.includes(path.basename(file)))
  const prerequisites = original.filter(file => !path.basename(file).startsWith('review_'))
  const sources = beforeReview ? prerequisites : bundle ? [...prerequisites, path.join(root,'supabase/changes/review_release.sql')] : original
  for (const file of sources) {
    try { await db.exec(fs.readFileSync(file, 'utf8')) }
    catch (error) { await db.close(); throw new Error(`${path.relative(root,file)}: ${error.message}`, { cause: error }) }
  }
  return db
}
const uid = n => '00000000-0000-4000-8000-' + String(9000000 + n).padStart(12, '0')
async function fixture(db, n, { count = 1, hours = 1, semester = 1, pending = false } = {}) {
  const f = Object.fromEntries(['campus','dept','director','hod','teacher','course','entry','entry2','run','job','admin'].map((key,i) => [key,uid(n*20000+i)]))
  f.students = Array.from({ length: count }, (_,i) => uid(n*20000+100+i)); f.semester=semester
  f.date = (await db.query("SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date-((extract(dow FROM now() AT TIME ZONE 'Asia/Kolkata')::int+6)%7))::text d")).rows[0].d
  await db.exec(`BEGIN;
    INSERT INTO public.campuses(id,name,code) VALUES('${f.campus}','Review ${n}','RV${n}');
    UPDATE public.campus_settings SET academic_year='2026-27',min_credits=0,max_credits=40,deadline=now()-interval '1 day',term_started_at=now()-interval '30 days' WHERE campus_id='${f.campus}';
    INSERT INTO public.departments(id,name,code,campus_id) VALUES('${f.dept}','Review dept ${n}','RD${n}','${f.campus}');
    INSERT INTO auth.users(id) VALUES('${f.director}'),('${f.hod}'),('${f.teacher}'),('${f.admin}'),${f.students.map(id=>`('${id}')`).join(',')};
    INSERT INTO public.admins(id,full_name,email) VALUES('${f.admin}','Administrator','admin${n}@test.invalid');
    INSERT INTO public.faculty(id,full_name,email,role,campus_id,department_id) VALUES
      ('${f.director}','Director','dir${n}@test.invalid','campus_director','${f.campus}',NULL),
      ('${f.hod}','HOD','hod${n}@test.invalid','hod','${f.campus}','${f.dept}'),
      ('${f.teacher}','Teacher','teacher${n}@test.invalid','teacher','${f.campus}','${f.dept}');
    INSERT INTO public.students(id,full_name,cap_application_number,current_semester,academic_year_joined,department_id,campus_id)
      VALUES ${f.students.map((id,i)=>`('${id}','Student ${i}','REVIEW${n}_${i}',${semester},'2026-27','${f.dept}','${f.campus}')`).join(',')};
    INSERT INTO public.courses(id,course_code,title,department_id,semester,credits,category,theory_hours_per_week,practical_hours_per_week)
      VALUES('${f.course}','KU${String(semester).padStart(2,'0')}DSC${n}','Review course','${f.dept}',${semester},4,'DSC',${hours},0);
    INSERT INTO public.teacher_course_assignments(teacher_id,course_id,campus_id,academic_year,semester)
      VALUES('${f.teacher}','${f.course}','${f.campus}','2026-27',${semester});
    ${pending ? '' : `INSERT INTO public.system_logs(id,log_type,campus_id,academic_year,semester,status,user_id,metadata) VALUES('${f.run}','allocation_run','${f.campus}','2026-27',${semester},'completed','${f.director}','{}');
    INSERT INTO public.student_registrations(student_id,campus_id,academic_year,semester,pathway_id,slot_1_course_id,total_credits)
      VALUES ${f.students.map(id=>`('${id}','${f.campus}','2026-27',${semester},'path','${f.course}',4)`).join(',')};`}
    COMMIT;`)
  f.publish = async (practical = false) => {
    await db.query(`INSERT INTO public.timetable_entries(id,campus_id,academic_year,semester,course_id,department_id,time_slot_id,teacher_id,status,session_type,is_lab_block)
      SELECT $1,$2,'2026-27',$3,$4,$5,id,$6,'draft',$7,$8 FROM public.time_slots WHERE day_of_week=1 AND period_number=1`,
      [f.entry,f.campus,semester,f.course,f.dept,f.teacher,practical?'practical':'theory',practical])
    if (practical) await db.query(`INSERT INTO public.timetable_entries(id,campus_id,academic_year,semester,course_id,department_id,time_slot_id,teacher_id,status,session_type,is_lab_block)
      SELECT $1,$2,'2026-27',$3,$4,$5,id,$6,'draft','practical',true FROM public.time_slots WHERE day_of_week=1 AND period_number=2`,[f.entry2,f.campus,semester,f.course,f.dept,f.teacher])
    await db.query("UPDATE public.timetable_entries SET status='published' WHERE campus_id=$1",[f.campus])
  }
  f.submit = (absent=[],revision=0,roster=f.students) => db.query('SELECT public.atomic_submit_period_attendance($1,$2::date,$3,$4::uuid[],$5::uuid[],$6,$7) value',[f.entry,f.date,f.teacher,absent,roster,f.course,revision])
  return f
}
async function openPostgresDatabase() {
  const url=process.env.FYIMP_TEST_DATABASE_URL
  if(process.env.FYIMP_TEST_DATABASE_ISOLATED!=='1' || !url || new URL(url).pathname!=='/fyimp_review_test') {
    throw new Error('Real PostgreSQL tests require an explicitly isolated database named fyimp_review_test')
  }
  const {Pool}=require('pg'),pool=new Pool({connectionString:url,max:8})
  // This reset is permitted only in the dedicated test database checked above.
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA public; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);')
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
  END $$;`)
  for(const file of bootstrapSources()) await pool.query(fs.readFileSync(file,'utf8'))
  return {query:(sql,args)=>pool.query(sql,args),exec:sql=>pool.query(sql),connect:()=>pool.connect(),close:()=>pool.end()}
}
async function stageVerifiedDraft(db,f,teacher=f.teacher) {
  const token=require('node:crypto').randomUUID()
  const claim=(await db.query('SELECT public.claim_timetable_generation_job($1,$2,$3::smallint,$4,600,$5) value',[f.campus,'2026-27',f.semester,f.director,token])).rows[0].value
  await db.query("SELECT public.update_timetable_worker($1,$2,'running',10,NULL)",[claim.job_id,token])
  const slot=(await db.query('SELECT id FROM public.time_slots WHERE day_of_week=1 AND period_number=1')).rows[0].id
  await db.query('SELECT public.atomic_replace_timetable_draft($1,$2,$3,$4::jsonb,$5,$6)',[f.campus,'2026-27',f.semester,
    JSON.stringify([{campus_id:f.campus,academic_year:'2026-27',semester:f.semester,course_id:f.course,department_id:f.dept,time_slot_id:slot,teacher_id:teacher,session_type:'theory',is_lab_block:false}]),claim.job_id,token])
  f.entry=(await db.query('SELECT id FROM public.current_timetable_entries WHERE campus_id=$1 AND course_id=$2',[f.campus,f.course])).rows[0].id
  return claim
}
module.exports = { openFinalDatabase, openPostgresDatabase, fixture, uid, bootstrapSources, stageVerifiedDraft }
