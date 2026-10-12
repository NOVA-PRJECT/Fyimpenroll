const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
function sourceModule(file) {
  const output = ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'), { compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports:{} }; new Function('require','module','exports',output)(require,module,module.exports);return module.exports
}
const { OfflineActionQueue } = sourceModule('src/lib/offline-queue.ts')
const storage = () => { const values=new Map();return {getItem:async key=>values.get(key)||null,setItem:async(key,value)=>{values.set(key,value)}} }
const action = (id,ownerId='alice') => ({id,ownerId,type:'PERIOD_MARKING',endpoint:'/marks',payload:{attendance_date:'2026-10-05',expected_revision:3,absent_student_ids:[id]},clientTimestamp:'2026-10-05T10:00:00Z'})
test('multiple markings retain order, owner and original revision/date payloads',async()=>{
  const queue=new OfflineActionQueue(storage());await queue.enqueue(action('a'));await queue.enqueue(action('b'));await queue.enqueue(action('c','bob'))
  const sent=[];await queue.sync('alice',()=>true,async row=>sent.push(row))
  assert.deepEqual(sent.map(row=>row.id),['a','b']);assert.deepEqual(sent[0].payload,action('a').payload)
  assert.deepEqual((await queue.list('bob')).map(row=>row.id),['c'])
})
test('account changes pause remaining actions and never submit them for another account',async()=>{
  const queue=new OfflineActionQueue(storage());await queue.enqueue(action('a'));await queue.enqueue(action('b'));let active=true
  const sent=[];await queue.sync('alice',()=>active,async row=>{sent.push(row.id);active=false})
  assert.deepEqual(sent,['a']);assert.deepEqual((await queue.list('alice')).map(row=>row.id),['b'])
  assert.deepEqual(await queue.list('bob'),[])
})
test('enqueue during synchronization is serialized and cannot be overwritten by a stale queue snapshot',async()=>{
  const queue=new OfflineActionQueue(storage());await queue.enqueue(action('a'))
  let release;const gate=new Promise(resolve=>{release=resolve});let started;const ready=new Promise(resolve=>{started=resolve})
  const sync=queue.sync('alice',()=>true,async()=>{started();await gate});await ready
  const enqueue=queue.enqueue(action('b'));release();await sync;await enqueue
  assert.deepEqual((await queue.list('alice')).map(row=>row.id),['b'])
})
test('revision conflicts block replay; transient failures retain pending actions and failed saves are visible',async()=>{
  const queue=new OfflineActionQueue(storage());await queue.enqueue(action('a'))
  await queue.sync('alice',()=>true,async()=>{throw {statusCode:409,message:'Revision changed'}})
  let called=false;await queue.sync('alice',()=>true,async()=>{called=true});assert.equal(called,false)
  assert.equal((await queue.list('alice'))[0].blockedReason,'Revision changed')
  await queue.clear('alice','PERIOD_MARKING');await queue.enqueue(action('b'))
  await queue.sync('alice',()=>true,async()=>{throw {statusCode:503}});assert.equal((await queue.list('alice')).length,1)
  const broken=new OfflineActionQueue({getItem:async()=>null,setItem:async()=>{throw new Error('Storage unavailable')}})
  await assert.rejects(broken.enqueue(action('c')),/Storage unavailable/)
})
test('the mobile profile accepts every canonical role, including teacher',()=>{
  const { ProfileResponseSchema }=sourceModule('src/api/schemas/auth.schema.ts')
  for(const role of require('@fyimp/contracts').ROLE_VALUES) assert.equal(ProfileResponseSchema.safeParse({role,profile:{}}).success,true)
  assert.equal(ProfileResponseSchema.safeParse({role:'visitor',profile:{}}).success,false)
})
