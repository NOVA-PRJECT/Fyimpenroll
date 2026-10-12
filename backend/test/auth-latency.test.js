const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AuditLoggerService } = require('../dist/core/logging/audit-logger.service')
const { AuditDeliveryService } = require('../dist/core/logging/audit-delivery.service')
const { AuthService } = require('../dist/modules/auth/auth.service')
const { AuthController } = require('../dist/modules/auth/auth.controller')
const { DashboardEntryService } = require('../dist/modules/auth/dashboard-entry.service')

const event = { eventType: 'user_login', userId: 'unknown', userRole: 'student', action: 'login', resourceType: 'user', status: 'success' }
test('session audits wait for queue acceptance, not database delivery', async () => {
  let release, queued
  const logger = new AuditLoggerService({admin:{from(){assert.fail('database must not block login')}}}, {
    enqueue: payload => { queued = payload; return new Promise(resolve => { release = resolve }) },
  })
  let done = false
  const pending = logger.log(event).then(() => { done = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(done, false)
  assert.ok(queued.id); assert.ok(queued.created_at)
  release(true); await pending; assert.equal(done, true)
})

test('queue failure persists the same UUID synchronously so ambiguous acceptance is safe', async () => {
  let queued, saved
  const logger = new AuditLoggerService({admin:{from:()=>({upsert:async(payload, options)=>{
    saved = payload; assert.deepEqual(options,{onConflict:'id',ignoreDuplicates:true}); return {error:null}
  }})}}, {enqueue:async payload=>{queued=payload;return false}})
  await logger.log(event)
  assert.equal(saved.id, queued.id)
})

test('audit delivery only acknowledges persisted batches and safely retries failed acknowledgements', async () => {
  const messages=[JSON.stringify({id:'event-1',log_type:'audit_event'})]
  let databaseFails=true, ackFails=false, writes=0, acknowledgements=0
  const worker = new AuditDeliveryService({admin:{from:()=>({upsert:async(payload, options)=>{
    writes++; assert.equal(payload[0].id,'event-1');assert.equal(options.ignoreDuplicates,true)
    return {error:databaseFails?{message:'offline'}:null}
  }})}}, {get:()=>undefined})
  worker.redis={eval:async(_script,_keys,[now,lease])=>{assert.equal(lease-now,60000);return messages},zrem:async()=>{if(ackFails)throw Error('offline');acknowledgements++}}
  await worker.flush();assert.equal(acknowledgements,0)
  databaseFails=false;ackFails=true;await worker.flush();assert.equal(acknowledgements,0)
  ackFails=false;await worker.flush();assert.equal(acknowledgements,1);assert.equal(writes,3)
})

test('concurrent audit flushes share one lease request', async () => {
  const worker=new AuditDeliveryService({}, {get:()=>undefined});let release,calls=0
  worker.redis={eval:()=>{calls++;return new Promise(resolve=>{release=resolve})}}
  const first=worker.flush(), second=worker.flush(); assert.equal(first,second)
  release([]);await first;assert.equal(calls,1)
})

test('logout renewal never resolves roles, writes metadata, or stores reusable credentials', async () => {
  const auth=new AuthService({createAuthClient:()=>({auth:{refreshSession:async()=>({data:{user:{id:'account',app_metadata:{role:'student'}},session:{access_token:'revocation-only'}},error:null})}})}, {},{}, {})
  auth.determineUserRoute=()=>assert.fail('no role lookup during logout')
  const user=await auth.refreshForLogout('refresh')
  assert.equal(user.token,'revocation-only');assert.equal(auth.recentRefreshes.size,0)
  assert.ok(auth.logoutGenerations.has('account'))
})

test('dashboard entry only loads the matching unrestricted role and shares its authenticated user', async () => {
  const calls=[]
  const load=label=>async user=>{calls.push([label,user]);return {name:label}}
  const entry=new DashboardEntryService({getProfile:load('profile')},{getDashboardSummary:load('student')},{getSettings:load('director')},{getCourses:load('faculty')})
  for(const [role,path,endpoint] of [['student','student','/api/student/dashboard-summary'],['campus_director','director','/api/director/settings'],['teacher','teacher','/api/faculty/courses'],['teaching_staff','teaching_staff','/api/faculty/courses'],['hod','hod','/api/auth/profile'],['superadmin','superadmin','/api/auth/profile']]) {
    const user={role,consent:{accepted:true}}
    const result=await entry.load(user,`/dashboard/${path}`)
    assert.equal(result.endpoint,endpoint);assert.equal(calls.at(-1)[1],user)
  }
  const before=calls.length
  for(const user of [{role:'student',consent:{accepted:false}},{role:'student',consent:{accepted:true},must_change_password:true},{role:'hod',consent:{accepted:true}}]) {
    assert.equal(await entry.load(user,'/dashboard/student'),undefined)
  }
  assert.equal(calls.length,before)
})

test('dashboard data outages preserve routing and allow the page to retry', async () => {
  const entry=new DashboardEntryService({}, {getDashboardSummary:async()=>{throw Error('offline')}},{},{})
  assert.equal(await entry.load({role:'student',consent:{accepted:true}},'/dashboard/student'),undefined)
})

test('only web login requests preload data, using verified account scope rather than body fields', async () => {
  const verified={userId:'verified-user',role:'student',campus_id:'verified-campus',department_id:'dept',token:'access',refreshToken:'refresh',consent:{accepted:true},redirectTo:'/dashboard/student'}
  let loads=0
  const controller=new AuthController({login:async()=>verified},{load:async(user,path)=>{
    loads++;assert.equal(user.userId,'verified-user');assert.equal(user.campus_id,'verified-campus')
    return {path,endpoint:'/api/student/dashboard-summary',data:{studentInfo:{full_name:'Student'}}}
  }})
  const response={cookie:()=>{},setHeader:()=>{}}
  const request={headers:{},ip:'127.0.0.1'}
  const login={email:'student@example.test',password:'password'}
  assert.equal((await controller.login(login,request,response)).dashboardEntry,undefined)
  const result=await controller.login({...login,preloadDashboard:true,campus_id:'attacker-campus'},request,response)
  assert.equal(loads,1);assert.equal(result.dashboardEntry.data.studentInfo.full_name,'Student')
})

test('ordinary refresh skips unchanged metadata without skipping account verification', async () => {
  const metadata={role:'student',department_id:'dept',campus_id:'campus',must_change_password:false}
  let verified=0
  const auth=new AuthService({createAuthClient:()=>({auth:{refreshSession:async()=>({data:{user:{id:'account',app_metadata:metadata},session:{access_token:'access',refresh_token:'rotated'}},error:null})}}),admin:{auth:{admin:{updateUserById:()=>assert.fail('unchanged metadata')}}}}, {},{}, {})
  auth.determineUserRoute=async()=>{verified++;return metadata}
  await auth.refreshSession('refresh');assert.equal(verified,1)
})
