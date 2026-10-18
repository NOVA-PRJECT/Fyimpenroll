const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
require('ts-node').register({ project: path.join(__dirname, '../tsconfig.json'), transpileOnly: true })
const { AdminService } = require('../src/modules/admin/admin.service')
const { AuthService } = require('../src/modules/auth/auth.service')
const { AuthController } = require('../src/modules/auth/auth.controller')
const { HodService } = require('../src/modules/hod/hod.service')
const logger = { log: async () => {}, warn() {}, error() {} }
const user = { userId: 'admin', role: 'superadmin' }

function facultyDB({ rows = [], insertError = null, rollbackError = null, beforeCreate = async () => {} } = {}) {
  const calls = { created: [], deleted: [], updated: [] }
  const tables = { campuses: [{ id: 'campus' }], departments: [{ id: 'dept', campus_id: 'campus' }, { id: 'foreign', campus_id: 'elsewhere' }], faculty: rows }
  const db = {
    from(table) {
      const filters = []; let value, operation
      const q = {
        select() { return q }, eq(k,v) { filters.push(r => r[k] === v); return q }, neq(k,v) { filters.push(r => r[k] !== v); return q }, limit() { return q },
        insert(v) { value = v; operation = 'insert'; return q }, update(v) { value = v; operation = 'update'; return q }, delete() { operation = 'delete'; return q },
        async execute() {
          if (operation === 'insert') {
            const error = typeof insertError === 'function' ? await insertError(value) : insertError
            if (!error) tables[table].push(value)
            return { error }
          }
          const data = tables[table].filter(r => filters.every(f => f(r)))
          if (operation === 'update') { calls.updated.push(value); data.forEach(r => Object.assign(r,value)) }
          return { data, error: null }
        },
        then(a,b) { return q.execute().then(a,b) }, async maybeSingle() { const r = await q.execute(); return { ...r, data: r.data?.[0] || null } }, single() { return q.maybeSingle() },
      }; return q
    },
    auth: { admin: {
      async createUser(v) { calls.created.push(v); const id = calls.created.length === 1 ? 'brand-new-auth' : `brand-new-auth-${calls.created.length}`; await beforeCreate(); return { data: { user: { id } }, error: null } },
      async deleteUser(id) { calls.deleted.push(id); return { error: rollbackError } },
      async updateUserById() { return { error: null } },
    } },
  }
  return { db, calls, service: new AdminService({ admin: db }, logger, logger) }
}
const faculty = { full_name: 'Test', email: 'test@example.invalid', password: 'Password123!', campus_id: 'campus', department_id: 'dept', role: 'hod' }
for (const role of ['hod', 'campus_director', 'teaching_staff']) {
  test(`${role}: create and edit return 409 when occupied, self-edit is allowed`, async () => {
    const record = { id: 'existing', ...faculty, role, department_id: role === 'hod' ? 'dept' : null }
    const { service, calls } = facultyDB({ rows: [record] })
    await assert.rejects(service.createFaculty(record, user), e => e.getStatus() === 409)
    await assert.rejects(service.updateFaculty('other', record, user), e => e.getStatus() === 404)
    await service.updateFaculty('existing', record, user)
    assert.equal(calls.updated.length, 1)
    assert.equal(calls.created.length, 0)
  })
}
test('cross-campus HOD and department-assigned director/staff are rejected before Auth creation', async () => {
  const { service, calls } = facultyDB()
  for (const body of [{...faculty, department_id:'foreign'}, {...faculty, role:'campus_director'}, {...faculty, role:'teaching_staff'}]) {
    await assert.rejects(service.createFaculty(body, user), e => e.getStatus() === 400)
  }
  assert.equal(calls.created.length, 0)
})
test('all administrative mutations reject teachers and conversions to teacher', async () => {
  const { service, calls } = facultyDB({ rows: [{ ...faculty, id: 'teacher', role:'teacher' }, { ...faculty, id:'hod' }] })
  await assert.rejects(service.createFaculty({ ...faculty, role:'teacher' },user), e => e.getStatus() === 403)
  await assert.rejects(service.updateFaculty('teacher',faculty,user), e => e.getStatus() === 403)
  await assert.rejects(service.updateFaculty('hod',{ ...faculty, role:'teacher' },user), e => e.getStatus() === 403)
  await assert.rejects(service.deleteFaculty('teacher',user), e => e.getStatus() === 403)
  assert.deepEqual(calls.created, []); assert.deepEqual(calls.deleted, []); assert.deepEqual(calls.updated, [])
})
test('direct administrative HTTP requests reject teacher creation, edits, deletion and role conversion', async () => {
  const {Module}=require('@nestjs/common'), {NestFactory}=require('@nestjs/core')
  const {AdminController}=require('../src/modules/admin/admin.controller')
  const {AuthGuard}=require('../src/core/auth/guards/auth.guard'),{RolesGuard}=require('../src/core/auth/guards/roles.guard')
  const tid='00000000-0000-4000-8000-000000000010',hid='00000000-0000-4000-8000-000000000011'
  const {service,calls}=facultyDB({rows:[{...faculty,id:tid,role:'teacher'},{...faculty,id:hid,role:'hod'}]})
  const {SupabaseService}=require('../src/core/database/supabase.service')
  const {CURRENT_POLICY_VERSION}=require('../src/modules/consent/consent.constants')
  const guardDB={admin:{auth:{getUser:async()=>({data:{user:{id:'admin',app_metadata:{role:'superadmin',accepted_policy_version:CURRENT_POLICY_VERSION}}}})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{id:'admin'}})})}}
  class Fixture {}
  Module({controllers:[AdminController],providers:[{provide:AdminService,useValue:service},
    {provide:SupabaseService,useValue:guardDB},AuthGuard,RolesGuard]})(Fixture)
  const app=await NestFactory.create(Fixture,{logger:false,abortOnError:false})
  await app.listen(0,'127.0.0.1')
  const url=await app.getUrl()
  const body={...faculty,campus_id:'00000000-0000-4000-8000-000000000001',department_id:'00000000-0000-4000-8000-000000000002'}
  try {
    for(const [method,payload] of [['POST',{...body,role:'teacher'}],['PUT',{...body,id:tid}],['PUT',{...body,id:hid,role:'teacher'}],['DELETE',{faculty_id:tid}]]) {
      const res=await fetch(url+'/api/admin/faculty-list',{method,headers:{'Content-Type':'application/json',Authorization:'Bearer isolated-test-token'},body:JSON.stringify(payload)})
      const response=await res.text()
      assert.equal(res.status,403,response)
      assert.match(response,/Teachers are managed by their HOD/)
    }
    assert.deepEqual(calls.created,[]);assert.deepEqual(calls.deleted,[]);assert.deepEqual(calls.updated,[])
  } finally {await app.close()}
})
test('a raced insert conflict deletes only its newly created Auth user; failed rollback is reported', async () => {
  for (const rollbackError of [null, { message: 'unavailable' }]) {
    const { service, calls } = facultyDB({ insertError: { code:'23505' }, rollbackError })
    await assert.rejects(service.createFaculty(faculty,user), e => e.getStatus() === 409 && (rollbackError ? /Cleanup failed.*brand-new-auth/.test(e.message) : !/Cleanup failed/.test(e.message)))
    assert.deepEqual(calls.deleted, ['brand-new-auth'])
  }
})
test('simultaneous account creations produce one winner and roll back only the losing Auth account', async () => {
  let release, arrivals=0, occupied=false
  const barrier=new Promise(r=>release=r)
  const {service,calls}=facultyDB({beforeCreate:async()=>{if(++arrivals===2)release();await barrier},insertError:()=>{if(occupied)return {code:'23505'};occupied=true;return null}})
  const results=await Promise.allSettled([service.createFaculty({...faculty,email:'one@example.invalid'},user),service.createFaculty({...faculty,email:'two@example.invalid'},user)])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  const winner=results.find(r=>r.status==='fulfilled').value.id
  assert.equal(results.find(r=>r.status==='rejected').reason.getStatus(),409)
  assert.equal(calls.deleted.length,1);assert.notEqual(calls.deleted[0],winner)
})
test('role transfers check destination occupancy and exclude the account being edited', async () => {
  const {service}=facultyDB({rows:[{...faculty,id:'one'},{...faculty,id:'director',role:'campus_director',department_id:null}]})
  await assert.rejects(service.updateFaculty('one',{...faculty,role:'campus_director',department_id:null},user),e=>e.getStatus()===409)
  await service.updateFaculty('director',{...faculty,role:'campus_director',department_id:null},user)
})
test('course updates use guarded RPC and preserve an omitted semester; database blockers become 409', async () => {
  const calls=[]
  const db={ from: () => ({ select() {return this}, eq() {return this}, maybeSingle:async()=>({data:{id:'course',department_id:'dept'}}) }),
    rpc:async(name,args)=>{calls.push({name,args});return {error:{code:'P4090',message:'Course semester cannot change: registrations',details:'["registrations"]'}}} }
  const service=new HodService({admin:db},logger,logger)
  await assert.rejects(service.updateCourse('course',{course_code:'C',title:'Title',credits:2,category:'AEC'}, {department_id:'dept'}), e=>e.getStatus()===409 && e.getResponse().blocking_references[0]==='registrations')
  assert.equal(calls[0].name,'update_hod_course_guarded')
  assert.equal('semester' in calls[0].args.p_patch,false)
})

function logoutService({ expired = false, hang = false, auditHang = false } = {}) {
  const calls = { revoked: [], signals: [] }
  const provider = signal => {
    if (signal) calls.signals.push(signal)
    return { auth: {
      getUser: async () => hang ? new Promise(()=>{}) : expired ? { data: {user:null}, error:{message:'expired'} } : { data: {user:{id:'user',app_metadata:{role:'hod'}}} },
      refreshSession: async () => ({data:{user:{id:'user',app_metadata:{role:'hod'}},session:{access_token:'renewed'}}}),
      admin:{ updateUserById: async()=>({error:null}), signOut: async (token,scope) => { calls.revoked.push({token,scope}); return {error:null} } },
    } }
  }
  const service = new AuthService({createLogoutClient:provider,createAuthClient:provider,admin:provider()}, {}, {log: async () => auditHang ? new Promise(()=>{}) : undefined}, logger)
  return { service, calls }
}
test('expired access token uses refresh fallback, globally revokes, and fences concurrent refresh', async () => {
  const { service, calls } = logoutService({expired:true})
  const result=await service.logout('expired','ip',{startedAt:performance.now(),refreshToken:'refresh'})
  assert.equal(result.revoked,true)
  assert.deepEqual(calls.revoked,[{token:'renewed',scope:'global'}])
  assert.throws(()=>service.assertRefreshAllowed('refresh'), /signed out/)
})
test('logout prevents an already-running backend refresh from returning credentials or populating its cache', async () => {
  const {service}=logoutService()
  let ready,release
  const started=new Promise(r=>ready=r), blocked=new Promise(r=>release=r)
  service.determineUserRoute=async()=>{ready();await blocked;return {role:'hod'}}
  const refresh=service.refreshSession('rotating-token')
  await started
  await service.logout('access-token','ip',{startedAt:performance.now(),refreshToken:'rotating-token'})
  release()
  await assert.rejects(refresh,/signed out|Session changed/)
  assert.equal(service.recentRefreshes.size,0)
})
test('provider and audit stalls respect the five-second handler budget and clear cookies', async () => {
  for (const options of [{hang:true}, {auditHang:true}]) {
    const {service,calls}=logoutService(options)
    const controller=new AuthController(service)
    const cookies=[],headers={}
    const res={clearCookie:n=>cookies.push(n),cookie:()=>{},setHeader:(k,v)=>headers[k]=v}
    const started=performance.now()
    const keepAlive=setInterval(()=>{},100)
    try {
      const result=await controller.logout({headers:{},cookies:{auth_token:'token'},socket:{}},res)
      assert.ok(performance.now()-started<5300)
      assert.deepEqual(Object.keys(result).sort(),['revoked','success'])
      assert.equal(result.success,true)
      assert.equal(result.revoked,!options.hang)
      assert.deepEqual(cookies,['auth_token','refresh_token','user_role'])
      assert.match(headers['Server-Timing'], /authentication.*revocation.*audit.*logout/)
      if(options.hang) assert.equal(calls.signals[0].aborted,true)
    } finally { clearInterval(keepAlive) }
  }
})

test('migration enforces role uniqueness, course references and stale-reference rejection in PostgreSQL', async () => {
  const {PGlite}=require('@electric-sql/pglite')
  const db=new PGlite()
  const campus='00000000-0000-4000-8000-000000000001', dept='00000000-0000-4000-8000-000000000002', c='00000000-0000-4000-8000-000000000003', prior='00000000-0000-4000-8000-000000000004'
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE departments(id uuid PRIMARY KEY,campus_id uuid);
      CREATE TABLE faculty(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),role text,department_id uuid,campus_id uuid);
      CREATE TABLE courses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course_code text UNIQUE,title text,department_id uuid,semester int,credits int,category text,theory_hours_per_week smallint,practical_hours_per_week smallint,seat_limit int,prerequisite_course_ids uuid[]);
      CREATE TABLE semester_blueprints(id uuid DEFAULT gen_random_uuid(),semester int,pathways jsonb,slot_1_rule text,slot_1_target text);
      CREATE TABLE student_registrations(id uuid DEFAULT gen_random_uuid(),semester int,slot_1_course_id uuid,slot_8_course_id uuid,preferences jsonb,selections jsonb,selected_courses jsonb);
      CREATE TABLE registration_preferences(id uuid DEFAULT gen_random_uuid(),semester int,preferences jsonb);
      CREATE TABLE teacher_course_assignments(id uuid DEFAULT gen_random_uuid(),course_id uuid,semester int);
      CREATE TABLE timetable_entries(id uuid DEFAULT gen_random_uuid(),course_id uuid,semester int);
      CREATE TABLE timetable_conflicts(id uuid DEFAULT gen_random_uuid(),course_id uuid,blocking_course_id uuid,semester int);
      CREATE TABLE period_attendance(id uuid DEFAULT gen_random_uuid(),course_id uuid);
      CREATE TABLE course_prerequisite_rules(id uuid DEFAULT gen_random_uuid(),course_id uuid,rule text,target text);
      INSERT INTO departments VALUES('${dept}','${campus}');
      INSERT INTO courses(id,course_code,department_id,semester,prerequisite_course_ids) VALUES('${c}','C','${dept}',2,'{}'),('${prior}','PRIOR','${dept}',1,'{}');`)
    await db.exec(fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261018164035_testing_fixes_integrity.sql'),'utf8'))
    for(const role of ['hod','campus_director','teaching_staff']) {
      const department=role==='hod'?`'${dept}'`:'null'
      const insert=`INSERT INTO faculty(role,department_id,campus_id) VALUES('${role}',${department},'${campus}')`
      await db.exec(insert); await assert.rejects(db.exec(insert), e=>e.code==='23505')
      await db.exec(`DELETE FROM faculty WHERE role='${role}'`)
      const parallel=await Promise.allSettled([db.exec(insert),db.exec(insert)])
      assert.equal(parallel.filter(r=>r.status==='fulfilled').length,1)
      assert.equal(parallel.find(r=>r.status==='rejected').reason.code,'23505')
      await db.exec(`DELETE FROM faculty WHERE role='${role}'`)
    }
    await assert.rejects(db.exec(`INSERT INTO faculty(role,department_id,campus_id) VALUES('hod','${dept}',gen_random_uuid())`),/Department must belong/)
    const move=sem=>db.query('SELECT update_hod_course_guarded($1,$2,$3)',[c,dept,JSON.stringify({semester:sem})])
    // Category-only baskets do not retain a course explicitly.
    await db.exec(`INSERT INTO semester_blueprints(semester,pathways) VALUES(2,'[{"slots":[{"rule":"GLOBAL_BASKET","target":"AEC"}]}]')`)
    await move(4)
    assert.equal((await db.query(`SELECT semester FROM courses WHERE id='${c}'`)).rows[0].semester,4)
    await assert.rejects(db.exec(`INSERT INTO teacher_course_assignments(course_id,semester) VALUES('${c}',2)`),/changed semester/)
    const scenarios=[
      ['student_registrations',`(semester,slot_8_course_id) VALUES(4,'${c}')`,'registrations'],
      ['registration_preferences',`(semester,preferences) VALUES(4,'[{"choices":[{"course_id":"${c}","rank":1}]}]')`,'ranked preferences'],
      ['semester_blueprints',`(semester,pathways) VALUES(4,'[{"slots":[{"rule":"AEC_ELECT","target":"C"}]}]')`,'explicit blueprint references'],
      ['teacher_course_assignments',`(course_id,semester) VALUES('${c}',4)`,'teacher assignments'],
      ['timetable_entries',`(course_id,semester) VALUES('${c}',4)`,'timetable records'],
      ['timetable_conflicts',`(blocking_course_id,semester) VALUES('${c}',4)`,'timetable conflicts'],
      ['period_attendance',`(course_id) VALUES('${c}')`,'attendance records'],
      ['course_prerequisite_rules',`(course_id,rule,target) VALUES('${prior}','COMPLETED_COURSE','C')`,'invalid'],
    ]
    for(const [table,insert,label] of scenarios) {
      if(label==='invalid') {await assert.rejects(db.exec(`INSERT INTO ${table}${insert}`),/earlier semester/);continue}
      await db.exec(`INSERT INTO ${table}${insert}`)
      await assert.rejects(move(6),e=>e.code==='P4090' && e.message.includes(label))
      await db.exec(`DELETE FROM ${table}`)
    }
    await db.exec(`UPDATE courses SET semester=6 WHERE id='${prior}'; INSERT INTO course_prerequisite_rules(course_id,rule,target) VALUES('${prior}','COMPLETED_COURSE','C')`)
    await assert.rejects(move(3),/prerequisite dependencies/)
    await db.exec('DELETE FROM course_prerequisite_rules')
    await db.exec(`UPDATE courses SET prerequisite_course_ids=ARRAY['${c}']::uuid[] WHERE id='${prior}'`)
    await assert.rejects(move(3),/prerequisite dependencies/)
    await db.exec(`UPDATE courses SET prerequisite_course_ids='{}' WHERE id='${prior}'`)
    await db.query('SELECT update_hod_course_guarded($1,$2,$3)',[c,dept,JSON.stringify({prerequisite_course_ids:[prior]})]).then(()=>assert.fail('future prerequisite accepted'),e=>assert.match(e.message,/earlier semester/))
    await move(2)
    const writerFirst=await Promise.allSettled([
      db.exec(`INSERT INTO teacher_course_assignments(course_id,semester) VALUES('${c}',2)`),move(4),
    ])
    assert.deepEqual(writerFirst.map(r=>r.status),['fulfilled','rejected'])
    await db.exec('DELETE FROM teacher_course_assignments')
    const moveFirst=await Promise.allSettled([move(4),db.exec(`INSERT INTO teacher_course_assignments(course_id,semester) VALUES('${c}',2)`)] )
    assert.deepEqual(moveFirst.map(r=>r.status),['fulfilled','rejected'])
    await move(2)
    // The correction aborts on newly discovered usage, then preserves every row.
    const hid='e814d190-e1c2-4731-b2ec-d97d5dc897e0', dest='5b5289d5-17eb-43ba-832e-19883e9eaada', hod='d16aa6e6-bbdb-4156-81f1-31df5815a7db'
    const courses=['e8140001-e1c2-4731-b2ec-d97d5dc89701','e8140002-e1c2-4731-b2ec-d97d5dc89702','e8140003-e1c2-4731-b2ec-d97d5dc89703','e8140004-e1c2-4731-b2ec-d97d5dc89704']
    await db.exec(`ALTER TABLE departments ADD COLUMN code text; ALTER TABLE departments ADD COLUMN name text;
      ALTER TABLE semester_blueprints ADD COLUMN department_id uuid; ALTER TABLE timetable_entries ADD COLUMN department_id uuid;
      CREATE TABLE students(department_id uuid); CREATE TABLE department_notices(department_id uuid);
      CREATE TABLE campuses(id uuid,code text); INSERT INTO campuses VALUES('${dest}','MANGAT');
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid,raw_app_meta_data jsonb);
      INSERT INTO auth.users VALUES('${hod}','{"role":"hod","campus_id":"${dest}","department_id":"${hid}"}');
      INSERT INTO departments VALUES('${hid}','${dest}','HIS','History');
      INSERT INTO faculty(id,role,department_id,campus_id) VALUES('${hod}','hod','${hid}','${dest}');
      UPDATE departments SET campus_id='feed55c6-deea-46b7-9fa1-a97cfabf0838' WHERE id='${hid}';`)
    for(let i=0;i<courses.length;i++) await db.query('INSERT INTO courses(id,course_code,department_id,semester) VALUES($1,$2,$3,$4)',[courses[i],'HISTORY'+i,hid,i===0?1:3])
    for(const [id,sem] of [['ba0cd4e4-c95f-4056-bd2f-1b49e86d481f',1],['d90d5cf3-fd22-47bb-9401-894f0565feb1',3]]) {
      await db.query('INSERT INTO semester_blueprints(id,department_id,semester) VALUES($1,$2,$3)',[id,hid,sem])
    }
    const correction=fs.readFileSync(path.join(__dirname,'../../supabase/migrations/20261018164802_correct_history_campus.sql'),'utf8')
    const before=await db.query(`SELECT to_jsonb(c) row FROM courses c WHERE department_id='${hid}' ORDER BY id`)
    await db.exec(`INSERT INTO students VALUES('${hid}')`)
    await assert.rejects(db.exec(correction),/new department usage/)
    await db.exec('ROLLBACK')
    await db.exec('DELETE FROM students')
    await db.exec(correction)
    assert.equal((await db.query(`SELECT campus_id FROM departments WHERE id='${hid}'`)).rows[0].campus_id,dest)
    assert.deepEqual((await db.query(`SELECT to_jsonb(c) row FROM courses c WHERE department_id='${hid}' ORDER BY id`)).rows,before.rows)
    assert.equal((await db.query(`SELECT count(*) n FROM semester_blueprints WHERE department_id='${hid}'`)).rows[0].n,2)
    await assert.rejects(db.exec(`UPDATE departments SET campus_id=gen_random_uuid() WHERE id='${hid}'`),e=>e.code==='23503')
  } finally {await db.close()}
})
