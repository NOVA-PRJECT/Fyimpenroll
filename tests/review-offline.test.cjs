const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
function load(filename, replacements={}) {
  filename=path.resolve(filename)
  const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename))
  const original=m.require.bind(m);m.require=name=>replacements[name]||original(name)
  m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename)
  return m.exports
}
const {OfflineActionQueue}=load('mobile/src/lib/offline-queue.ts')
const action=owner=>({id:'one',ownerId:owner,type:'PERIOD_MARKING',endpoint:'/attendance/period/submit',payload:{expected_revision:0},clientTimestamp:new Date().toISOString()})
test('storage read failure never overwrites queued attendance even when a later write would succeed',async()=>{
  let writes=0
  const secure=load('mobile/src/lib/secure-store.ts',{'expo-secure-store':{getItemAsync:async()=>{throw new Error('device temporarily locked')},setItemAsync:async()=>{writes++}}}).secureStorage
  const queue=new OfflineActionQueue(secure)
  await assert.rejects(queue.enqueue(action('owner-a')),/read encrypted/)
  await assert.rejects(queue.clear('owner-a','PERIOD_MARKING'),/read encrypted/)
  await assert.rejects(queue.sync('owner-a',()=>true,async()=>assert.fail('cannot sync unreadable storage')),/read encrypted/)
  assert.equal(writes,0)
})
test('offline sync cannot replay another owner or silently lose a conflict',async()=>{
  const values=new Map(),store={getItem:async k=>values.get(k)||null,setItem:async(k,v)=>values.set(k,v)}
  const queue=new OfflineActionQueue(store)
  await queue.enqueue(action('owner-a'));let calls=0
  await queue.sync('owner-a',()=>false,async()=>{calls++});assert.equal(calls,0)
  await queue.sync('owner-a',()=>true,async()=>{calls++;throw {statusCode:409,message:'Reload the roster'}})
  assert.equal((await queue.list('owner-a'))[0].blockedReason,'Reload the roster')
  assert.deepEqual(await queue.list('owner-b'),[])
})
