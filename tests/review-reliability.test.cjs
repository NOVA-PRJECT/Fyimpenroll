const {test}=require('node:test')
const assert=require('node:assert/strict')
require('reflect-metadata')
const {Subject,lastValueFrom,of}=require('rxjs')
const {ExportBudgetInterceptor}=require('../backend/dist/core/security/export-budget.interceptor')
const {AttendanceExportController}=require('../backend/dist/modules/period-attendance/attendance-export.controller')
const {PeriodAttendanceController}=require('../backend/dist/modules/period-attendance/period-attendance.controller')
const {ReviewWorker}=require('../backend/dist/core/jobs/review-worker')
const {AppModule}=require('../backend/dist/app.module')
const {SupabaseService}=require('../backend/dist/core/database/supabase.service')
const {AllocationService}=require('../backend/dist/modules/allocation/allocation.service')
const {assertDeliveryAuthority}=require('../backend/dist/core/auth/delivery-authority')
test('API can own one polling worker and leaves an in-flight claim recoverable on shutdown', async () => {
  const calls = []
  let resolveClaim
  const claim = new Promise(resolve => { resolveClaim = resolve })
  const supabase = { admin: { rpc: async name => {
    calls.push(name)
    return name === 'claim_review_job' ? claim : { data: [] }
  } } }
  assert.ok(Reflect.getMetadata('providers', AppModule).includes(ReviewWorker))
  assert.deepEqual(Reflect.getMetadata('design:paramtypes', ReviewWorker), [SupabaseService, AllocationService])
  const worker = new ReviewWorker(supabase, {})
  const run = worker.run()
  assert.equal(worker.run(), run)
  const stopped = worker.onModuleDestroy()
  resolveClaim({ data: { id: 'claim-during-shutdown' } })
  await stopped
  assert.deepEqual(calls.sort(), ['claim_auth_cleanup', 'claim_review_job'])
})
test('both attendance export URLs share the same process and per-user budget',async()=>{
  for(const controller of [AttendanceExportController,PeriodAttendanceController]) {
    assert.ok(Reflect.getMetadata('__interceptors__',controller.prototype.exportStatement).includes(ExportBudgetInterceptor))
  }
  const budget=new ExportBudgetInterceptor(),a=new Subject(),b=new Subject()
  const context=userId=>({switchToHttp:()=>({getRequest:()=>({user:{userId}})})})
  const first=lastValueFrom(budget.intercept(context('a'),{handle:()=>a}))
  await assert.rejects(lastValueFrom(budget.intercept(context('a'),{handle:()=>of('duplicate')})),e=>e.getStatus()===503)
  const second=lastValueFrom(budget.intercept(context('b'),{handle:()=>b}))
  await assert.rejects(lastValueFrom(budget.intercept(context('c'),{handle:()=>of('third')})),e=>e.getStatus()===503)
  a.next('done');a.complete();await first
  assert.equal(await lastValueFrom(budget.intercept(context('a'),{handle:()=>of('released')})),'released')
  b.next('done');b.complete();await second
})
test('cleanup worker records resolved provider errors, thrown errors and successful already-missing accounts',async()=>{
  let active=0,maximum=0;const acknowledgements=[]
  const tasks=Array.from({length:5},(_,i)=>({id:'task'+i,user_id:i,fence:'fence'}))
  const supabase={admin:{rpc:async(name,args)=>{
    if(name==='claim_auth_cleanup')return {data:tasks,error:null}
    acknowledgements.push(args);return {error:null}
  },auth:{admin:{deleteUser:async id=>{
    maximum=Math.max(maximum,++active)
    try{await new Promise(resolve=>setTimeout(resolve,5));if(id===0)return {error:{message:'throttled',status:429}};if(id===1)throw new Error('network failure');if(id===2)return {error:{message:'missing',status:404}};return {error:null}}
    finally{active--}
  }}}}}
  await new ReviewWorker(supabase,{}).cleanupAccounts()
  assert.equal(maximum,5);assert.equal(acknowledgements.length,5)
  assert.equal(acknowledgements.find(a=>a.p_id==='task0').p_error,'throttled')
  assert.equal(acknowledgements.find(a=>a.p_id==='task1').p_error,'network failure')
  assert.equal(acknowledgements.find(a=>a.p_id==='task2').p_error,null)
})
test('delivery policy covers every role, visiting assignments, foreign scopes and missing identity',async()=>{
  const delivery={course_id:'course',campus_id:'host',department_id:'department',academic_year:'2026-27',semester:1,term_version:2}
  const query={select(){return query},eq(key,value){if(key==='campus_id')assert.equal(value,'host');return query},limit:async()=>({data:[{id:'assignment'}],error:null})}
  const db={from:()=>query}
  await assertDeliveryAuthority(db,{role:'superadmin'},delivery)
  await assertDeliveryAuthority(db,{role:'hod',campus_id:'host',department_id:'department'},delivery)
  await assertDeliveryAuthority(db,{role:'teacher',userId:'visiting',campus_id:'other-home-campus'},delivery)
  for(const role of ['student','teaching_staff','campus_director']) await assert.rejects(assertDeliveryAuthority(db,{role},delivery),e=>e.getStatus()===403)
  await assert.rejects(assertDeliveryAuthority(db,{role:'hod',campus_id:'foreign',department_id:'department'},delivery),e=>e.getStatus()===403)
  await assert.rejects(assertDeliveryAuthority(db,{role:'teacher'}, {...delivery,campus_id:null}),e=>e.getStatus()===403)
  query.limit=async()=>({data:[],error:null})
  await assert.rejects(assertDeliveryAuthority(db,{role:'teacher',userId:'unassigned'},delivery),e=>e.getStatus()===403)
})
