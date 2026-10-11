const {test}=require('node:test');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const {Logger}=require('@nestjs/common');
const {HealthController}=require('../dist/modules/health/health.controller');
const {FileConstraintStoreService}=require('../dist/modules/timetable/solver/file-constraint-store.service');
function database(ready=true){return {admin:{rpc:async()=>({data:{ready},error:null})}}}

test('readiness retries a failed Python startup check and caches the successful retry',async t=>{
  t.mock.timers.enable({apis:['Date'],now:100000});
  const warnings=[];t.mock.method(Logger.prototype,'warn',message=>warnings.push(message));
  t.mock.method(Logger.prototype,'log',()=>{});
  t.mock.method(FileConstraintStoreService.prototype,'getBaseConstraints',()=>({rules:[]}));
  let attempts=0;
  t.mock.method(cp,'execFile',(_binary,_args,options,callback)=>{
    assert.equal(options.timeout,30000);
    attempts++;queueMicrotask(()=>callback(attempts===1?new Error('cold-start timeout'):null,'',''));return {};
  });
  const controller=new HealthController(database());
  await assert.rejects(()=>controller.ready(),e=>e.getResponse().solverAndRules===false);
  assert.match(warnings[0],/cold-start timeout/);
  await assert.rejects(()=>controller.ready());assert.equal(attempts,1);
  t.mock.timers.tick(15001);
  assert.equal((await controller.ready()).solverAndRules,true);assert.equal(attempts,2);
  t.mock.timers.tick(15001);
  assert.equal((await controller.ready()).solverAndRules,true);assert.equal(attempts,2);
});

test('concurrent readiness callers share one probe and missing dependencies stay unavailable',async t=>{
  t.mock.method(Logger.prototype,'warn',()=>{});let attempts=0,dbCalls=0;
  t.mock.method(cp,'execFile',(_binary,_args,_options,callback)=>{
    attempts++;queueMicrotask(()=>callback(new Error('import failed'),'','ModuleNotFoundError: ortools'));return {};
  });
  const controller=new HealthController({admin:{rpc:async()=>{dbCalls++;return {data:{ready:true},error:null}}}});
  const results=await Promise.allSettled([controller.ready(),controller.ready(),controller.ready()]);
  assert.equal(attempts,1);assert.equal(dbCalls,1);
  for(const r of results){assert.equal(r.status,'rejected');assert.equal(r.reason.getResponse().solverAndRules,false)}
});

test('invalid scheduling rules and database failures never report ready',async t=>{
  t.mock.method(Logger.prototype,'warn',()=>{});
  t.mock.method(cp,'execFile',(_binary,_args,_options,callback)=>{queueMicrotask(()=>callback(null,'',''));return {}});
  t.mock.method(FileConstraintStoreService.prototype,'getBaseConstraints',()=>{throw new Error('Invalid rules')});
  await assert.rejects(()=>new HealthController(database()).ready(),e=>e.getResponse().solverAndRules===false);
  t.mock.method(FileConstraintStoreService.prototype,'getBaseConstraints',()=>({rules:[]}));
  await assert.rejects(()=>new HealthController(database(false)).ready(),e=>e.getResponse().database===false&&e.getResponse().solverAndRules===true);
});
