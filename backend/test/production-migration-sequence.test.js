const {test,before,after}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path')
const {PGlite}=require('@electric-sql/pglite')
const root=path.resolve(__dirname,'../..'),migrations=path.join(root,'supabase/migrations')
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
let db
before(async()=>{
 db=new PGlite()
 await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;")
 // Exercise the repository's actual table definitions. The remainder of the
 // historical consolidation script is deliberately not an upgrade recipe.
 const master=fs.readFileSync(path.join(root,'supabase/MASTER_SCHEMA_UPSERT.sql'),'utf8')
 const tables=master.slice(master.indexOf('-- 1. Campuses'),master.indexOf('-- PART 3:'))
 await db.exec(tables)
 const views=master.slice(master.indexOf('CREATE OR REPLACE VIEW allocation_runs'),master.indexOf('-- Triggers for Allocation Runs View'))
 await db.exec(views)
 const files=fs.readdirSync(migrations).filter(name=>/^202610(07|09|10)/.test(name)&&name.endsWith('.sql')).sort()
 for(const file of files.filter(name=>name<'20261010040000')){try{await db.exec(fs.readFileSync(path.join(migrations,file),'utf8'))}catch(error){throw Error(file+': '+error.message,{cause:error})}}
 const bundle=fs.readFileSync(path.join(root,'implementation-handoffs/production-audit/APPLY_PENDING_WEB_REPAIRS.sql'),'utf8')
 const interrupted=bundle.replace('NOTIFY pgrst,', "DO $abort$ BEGIN RAISE EXCEPTION 'synthetic rollout interruption'; END $abort$;\nNOTIFY pgrst,")
 await assert.rejects(db.exec(interrupted),/synthetic rollout interruption/)
 await db.exec('ROLLBACK')
 assert.equal((await db.query("SELECT to_regclass('public.graduation_candidates') AS name")).rows[0].name,null)
 assert.equal((await db.query("SELECT count(*) n FROM schema_migrations WHERE version LIKE '2026101004%'")).rows[0].n,0)
 await db.exec(bundle)
})
after(async()=>{await db?.close()})
test('full plan and follow-up sequence composes on the actual base table constraints',async()=>{
 for(const prefix of ['20261010040000','20261010050000','20261010060000','20261010070000','20261010080000','20261010090000','20261010100000'])assert.equal((await db.query('SELECT version FROM schema_migrations WHERE version LIKE $1',[prefix+'%'])).rows.length,1)
 assert.equal((await db.query('SELECT production_readiness() AS result')).rows[0].result.ready,true)
})
test('backend literal table references exist after the integrated migration sequence',async()=>{
 const known=new Set((await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map(row=>row.table_name))
 const missing=new Set()
 function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(file.endsWith('.ts'))for(const match of fs.readFileSync(file,'utf8').matchAll(/\.from\(['"]([a-z_]+)['"]\)/g))if(!known.has(match[1]))missing.add(match[1])}}
 walk(path.join(root,'backend/src'))
 assert.deepEqual([...missing],[])
})

test('allocation deadlines and claim timestamps use the same instant in a non-UTC database',async()=>{
 await db.exec("SET TIME ZONE 'Asia/Kolkata'")
 await db.query('INSERT INTO campuses(id,name,code) VALUES($1,$2,$3)',[id(1),'Synthetic Campus','TEST'])
 await db.query("UPDATE campus_settings SET academic_year='2026-27',deadline=now()-interval '30 minutes' WHERE campus_id=$1",[id(1)])
 const run=(await db.query('SELECT claim_allocation_run($1,$2,$3,$4,$5,$6) AS id',[id(1),'2026-27',1,id(2),300,id(3)])).rows[0].id
 assert.equal((await db.query("SELECT abs(extract(epoch FROM (started_at-now())))<2 AS correct FROM system_logs WHERE id=$1",[run])).rows[0].correct,true)
})

test('allocation fences commits, accounts for retained fixed seats and atomically completes credit totals',async()=>{
 await db.query('INSERT INTO departments(id,campus_id,name,code) VALUES($1,$2,$3,$4)',[id(10),id(1),'Synthetic Dept','SYN'])
 await db.query("INSERT INTO courses(id,department_id,course_code,title,semester,credits,category,seat_limit) VALUES($1,$2,'SYN1','Fixed',1,4,'DSC',1),($3,$2,'SYN2','Elective',1,3,'DSC',2),($4,$2,'SYN3','Replacement',1,5,'DSC',2)",[id(30),id(10),id(31),id(32)])
 await db.query('INSERT INTO auth.users(id) VALUES($1),($2)',[id(20),id(21)])
 for(const sid of [id(20),id(21)])await db.query("INSERT INTO students(id,full_name,department_id,campus_id,cap_application_number,academic_year_joined) VALUES($1,'Synthetic Student',$2,$3,$4,'2026-27')",[sid,id(10),id(1),sid])
 await db.query("INSERT INTO student_registrations(student_id,campus_id,semester,academic_year,slot_1_course_id) VALUES($1,$3,1,'2026-27',$4),($2,$3,1,'2026-27',NULL)",[id(20),id(21),id(1),id(30)])
 const run=(await db.query("SELECT id FROM system_logs WHERE log_type='allocation_run' AND status='running'")).rows[0].id
 const allocation=[{student_id:id(20),slot_key:'slot_2',course_id:id(31)},{student_id:id(21),slot_key:'slot_1',course_id:id(30)}]
 const commit=(claim,token,rows)=>db.query('SELECT apply_course_allocation($1,$2,$3,$4,$5,$6,$7,$8)',[claim,id(1),'2026-27',1,JSON.stringify(rows),'[]',JSON.stringify({total_students:2,fully_allocated:1,partially_allocated:0,unallocated:1}),token])
 await assert.rejects(commit(run,null,[]),/worker claim/)
 await assert.rejects(commit(run,id(99),[]),/worker claim/)
 await assert.rejects(commit(run,id(3),[{student_id:id(20),slot_key:'slot_1',course_id:null}]),/existing course/)
 await assert.rejects(commit(run,id(3),allocation),/global capacity/)
 assert.equal((await db.query('SELECT slot_2_course_id FROM student_registrations WHERE student_id=$1',[id(20)])).rows[0].slot_2_course_id,null)
 await db.query("UPDATE system_logs SET started_at=now()-interval '10 minutes' WHERE id=$1",[run])
 await assert.rejects(commit(run,id(3),[]),/worker claim/)
 const next=(await db.query('SELECT claim_allocation_run($1,$2,$3,$4,$5,$6) id',[id(1),'2026-27',1,id(2),300,id(4)])).rows[0].id
 await commit(next,id(4),allocation.slice(0,1))
 assert.equal((await db.query('SELECT total_credits FROM student_registrations WHERE student_id=$1',[id(20)])).rows[0].total_credits,7)
 const completed=(await db.query('SELECT status,metadata FROM system_logs WHERE id=$1',[next])).rows[0]
 assert.equal(completed.status,'completed');assert.equal(completed.metadata.total_students,2);assert.equal(completed.metadata.fencing_token,id(4))
 assert.equal((await db.query("SELECT fail_allocation_worker($1,$2,'late error') result",[next,id(4)])).rows[0].result,false)
 await db.query("UPDATE campus_settings SET deadline=now()+interval '30 minutes' WHERE campus_id=$1",[id(1)])
 const changed=(await db.query("SELECT execute_student_course_change($1,$2,$3,$4,$5,$6,$7) result",[id(20),id(1),1,'2026-27','slot_2',id(32),'request-key'])).rows[0].result
 assert.equal(changed.total_credits,9)
 const replay=(await db.query("SELECT execute_student_course_change($1,$2,$3,$4,$5,$6,$7) result",[id(20),id(1),1,'2026-27','slot_2',id(32),'request-key'])).rows[0].result
 assert.equal(replay.idempotent_replay,true)
 await assert.rejects(db.query("SELECT execute_student_course_change($1,$2,$3,$4,$5,$6,$7)",[id(20),id(1),1,'2026-27','slot_2',id(31),'request-key']),/different request payload/)
})

test('the exact SQL bundle is safely replayed using receipts without rewriting academic records',async()=>{
 const before=(await db.query('SELECT id,total_credits,selections FROM student_registrations ORDER BY id')).rows
 await db.exec(fs.readFileSync(path.join(root,'implementation-handoffs/production-audit/APPLY_PENDING_WEB_REPAIRS.sql'),'utf8'))
 assert.deepEqual((await db.query('SELECT id,total_credits,selections FROM student_registrations ORDER BY id')).rows,before)
 assert.equal((await db.query('SELECT production_readiness() result')).rows[0].result.ready,true)
})
