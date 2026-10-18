const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')

function harness(fetchImpl=async()=>Response.json({success:true,revoked:true})) {
  const calls=[], navigations=[], cache=new Map(), timers=[]
  const document={cookie:''},window={}
  function load(name) {
    if(cache.has(name)) return cache.get(name).exports
    const module={exports:{}};cache.set(name,module)
    if(name==='session-navigation') {module.exports={clearSessionStorage(){calls.push('clear')},navigateAfterSessionChange(url){navigations.push(url)}};return module.exports}
    const filename=path.join(__dirname,'../src/core/security',name+'.ts')
    const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
    vm.runInNewContext(source,{module,exports:module.exports,require:n=>load(n.replace('./','')),document,window,
      fetch:async(...args)=>{calls.push(args);return fetchImpl(...args)},Request,Response,Headers,URL,DOMException,AbortController,
      setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},console})
    return module.exports
  }
  return {logout:load('logout'),coordinator:load('refresh-coordinator'),calls,navigations,document,timers}
}
test('cancelled shared confirmation performs no request or session change; repeated clicks share one confirmation', async()=>{
  const h=harness(); let resolve,opened=0
  h.logout.registerLogoutDialog(()=>{opened++;return new Promise(r=>resolve=r)})
  const a=h.logout.logoutPortal(),b=h.logout.logoutPortal()
  assert.equal(a,b);assert.equal(opened,1)
  resolve(false);assert.equal(await a,false)
  assert.equal(h.calls.length,0);assert.equal(h.document.cookie,'');assert.equal(h.navigations.length,0)
})
test('confirmed logout keeps 12-second timeout, stops refresh/polling and preserves the unconfirmed-revocation warning',async()=>{
  const h=harness(async()=>Response.json({success:true,revoked:false}))
  assert.equal(await h.logout.performLogout(),true)
  assert.equal(h.timers[0].ms,12000)
  assert.match(h.document.cookie,/session_ended=1/)
  assert.equal((await h.coordinator.coordinateRefresh()).success,false)
  await assert.rejects(h.coordinator.apiFetch('/api/hod/students'),e=>e.name==='AbortError')
  assert.equal(h.calls.filter(Array.isArray).length,1)
  assert.match(decodeURIComponent(h.navigations[0]),/Server session revocation could not be confirmed/)
})
test('an unconfirmed network request reports failure without navigating or clearing storage; close permits retry', async()=>{
  const h=harness(async()=>{throw new Error('network offline')})
  assert.equal(await h.logout.performLogout(),false)
  assert.deepEqual(h.navigations,[])
  assert.equal(h.calls.includes('clear'),false)
  h.coordinator.resumeSessionAfterLogoutFailure()
  assert.match(h.document.cookie,/Max-Age=0/)
})
test('a refresh completing after logout cannot renew the coordinator or trigger a retried request',async()=>{
  let finish
  const h=harness(()=>new Promise(r=>finish=r))
  const refresh=h.coordinator.coordinateRefresh()
  h.coordinator.beginSessionLogout()
  finish(Response.json({token:'late-token'}))
  assert.equal((await refresh).success,false)
  assert.equal((await h.coordinator.coordinateRefresh()).success,false)
})
test('the client timeout fails an unconfirmed logout instead of reporting success',async()=>{
  const h=harness((url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('timeout')))))
  const pending=h.logout.performLogout()
  h.timers[0].fn()
  assert.equal(await pending,false)
  assert.deepEqual(h.navigations,[])
  assert.equal(h.calls.includes('clear'),false)
})

test('an old polling response is discarded when logout begins',async()=>{
  let finish
  const h=harness(()=>new Promise(r=>finish=r))
  const poll=h.coordinator.apiFetch('/api/auth/profile')
  h.coordinator.beginSessionLogout()
  finish(Response.json({role:'hod'}))
  await assert.rejects(poll,e=>e.name==='AbortError')
})
