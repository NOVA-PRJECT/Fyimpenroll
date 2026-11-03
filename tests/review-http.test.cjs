const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
require('reflect-metadata')
const { Module } = require('@nestjs/common')
const { NestFactory } = require('@nestjs/core')
const { AuthController } = require('../backend/dist/modules/auth/auth.controller')
const { AuthService } = require('../backend/dist/modules/auth/auth.service')
const { TimetableController } = require('../backend/dist/modules/timetable/timetable.controller')
const { TimetableService } = require('../backend/dist/modules/timetable/timetable.service')
const { ManualTimetableService } = require('../backend/dist/modules/timetable/manual-timetable.service')
const { SupabaseService } = require('../backend/dist/core/database/supabase.service')
const { AuthGuard } = require('../backend/dist/core/auth/guards/auth.guard')
const { RolesGuard } = require('../backend/dist/core/auth/guards/roles.guard')
const { RateLimiterService } = require('../backend/dist/core/security/rate-limiter.service')
const { RateLimitGuard } = require('../backend/dist/core/security/rate-limit.guard')
const { CURRENT_POLICY_VERSION } = require('../backend/dist/modules/consent/consent.constants')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const accounts = { staff:{id:id(1),role:'teaching_staff',campus_id:id(10)}, missing:{id:id(2),role:'teaching_staff',campus_id:null}, teacher:{id:id(3),role:'teacher',campus_id:id(10)} }
const tables = { faculty:Object.values(accounts),campus_settings:[{campus_id:id(10),term_version:0,academic_year:'2026-27'}],
  departments:[{id:id(11),campus_id:id(10)},{id:id(21),campus_id:id(20)}],
  current_teacher_course_assignments:[{id:id(40),teacher_id:id(3),course_id:id(30),campus_id:id(10),academic_year:'2026-27',semester:1}],
  current_timetable_entries:[{id:id(50),course_id:id(30),campus_id:id(10),department_id:id(11),academic_year:'2026-27',semester:1,status:'published'},
    {id:id(51),course_id:id(30),campus_id:id(20),department_id:id(21),academic_year:'2026-27',semester:1,status:'published'},
    {id:id(52),course_id:id(30),campus_id:id(10),department_id:id(11),academic_year:'2026-27',semester:1,status:'draft'}] }
function query(table) {
  let rows=[...(tables[table]||[])], single=false
  const q={select(){return q},eq(k,v){rows=rows.filter(r=>r[k]===v);return q},in(k,v){rows=rows.filter(r=>v.includes(r[k]));return q},
    order(){return q},limit(n){rows=rows.slice(0,n);return q},range(a,b){rows=rows.slice(a,b+1);return q},
    maybeSingle(){single=true;return q},single(){single=true;return q},then(resolve){return Promise.resolve({data:single?rows[0]||null:rows,error:null}).then(resolve)}}
  return q
}
let app,base,writes=0
const logger={log:async()=>{},warn(){},error(){}}
const supabase = { admin: {
  from: query, rpc: async () => ({ error: null }),
  auth: {
    getUser: async token => ({ data: { user: accounts[token] ? { ...accounts[token], app_metadata: {
      role: accounts[token].role, must_change_password: false, accepted_policy_version: CURRENT_POLICY_VERSION,
    } } : null }, error: null }),
    admin: { updateUserById: async () => { writes++; return { error: null } } },
  },
} }
before(async()=>{
  class TestModule {}
  Module({controllers:[AuthController,TimetableController],providers:[
    {provide:SupabaseService,useValue:supabase},AuthGuard,RolesGuard,
    {provide:RateLimitGuard,useValue:{canActivate:()=>true}},
    {provide:RateLimiterService,useValue:{checkLimit:async()=>({success:true})}},
    {provide:AuthService,useValue:new AuthService(supabase,{},logger,logger)},
    {provide:TimetableService,useValue:new TimetableService(supabase,logger,logger)},
    {provide:ManualTimetableService,useValue:{}},
  ]})(TestModule)
  app=await NestFactory.create(TestModule,{logger:['error'],abortOnError:false})
  app.use(require('cookie-parser')())
  await app.listen(0,'127.0.0.1');base=await app.getUrl()
})
after(async()=>{await app?.close()})
test('HTTP reset rejects an ordinary authenticated session without recovery proof',async()=>{
  const response=await fetch(base+'/api/auth/complete-password-reset',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer teacher'},body:JSON.stringify({newPassword:'Synthetic-Permanent-381'})})
  assert.equal(response.status,400);assert.equal(writes,0)
})
test('HTTP timetable staff scoping denies foreign filters, missing affiliations and drafts',async()=>{
  const request=(token,department)=>fetch(base+`/api/timetable/entries?academicYear=2026-27&semester=1${department?'&departmentId='+department:''}`,{headers:{Authorization:'Bearer '+token}})
  assert.equal((await request('staff',id(21))).status,403)
  assert.equal((await request('missing')).status,403)
  const own=await request('staff',id(11));assert.equal(own.status,200)
  assert.deepEqual((await own.json()).entries.map(e=>e.id),[id(50)])
  const teacher=await request('teacher');assert.equal(teacher.status,200)
  assert.ok((await teacher.json()).entries.some(e=>e.campusId===id(20)),'approved cross-campus teacher timetable viewing remains available')
})
test('HTTP session returns an uncached verified scope that differs between accounts',async()=>{
  const session=async token=>fetch(base+'/api/auth/session',{headers:{Authorization:'Bearer '+token}})
  const a=await session('staff'),b=await session('teacher')
  assert.equal(a.headers.get('cache-control'),'private, no-store')
  const first=await a.json(),second=await b.json()
  assert.match(first.dataScope,/^[a-f0-9]{64}$/);assert.notEqual(first.dataScope,second.dataScope)
})
