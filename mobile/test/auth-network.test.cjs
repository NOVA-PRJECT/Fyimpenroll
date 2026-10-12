const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/auth-network.ts'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const compiled = {exports:{}};new Function('require','module','exports',source)(require,compiled,compiled.exports)
const { ProfileRequests, createAuthFetch, withAuthDeadline } = compiled.exports

test('concurrent profile consumers share one request but later refreshes load fresh data',async()=>{
  const profiles=new ProfileRequests();let release,calls=0
  const load=()=>{calls++;return new Promise(resolve=>{release=resolve})}
  const a=profiles.load('alice-token',load),b=profiles.load('alice-token',load)
  assert.equal(a,b);release({role:'student'});await a;assert.equal(calls,1)
  await profiles.load('alice-token',async()=>{calls++;return {role:'teacher'}});assert.equal(calls,2)
})

test('profile work is isolated by credential and clearing cannot remove a newer request',async()=>{
  const profiles=new ProfileRequests();let oldRelease,newRelease
  const old=profiles.load('token',()=>new Promise(resolve=>{oldRelease=resolve}))
  profiles.clear()
  const fresh=profiles.load('token',()=>new Promise(resolve=>{newRelease=resolve}))
  oldRelease(null);await old
  assert.equal(profiles.load('token',()=>assert.fail('must reuse new request')),fresh)
  newRelease('new');assert.equal(await fresh,'new')
})

for(const revoked of [true,false]) test(`SDK logout uses one backend revocation and removes persisted credentials (revoked=${revoked})`,async t=>{
  const NativeResponse=global.Response
  global.Response=require('whatwg-fetch').Response
  t.after(()=>{global.Response=NativeResponse})
  const values=new Map(),calls=[]
  const storage={getItem:async key=>values.get(key)||null,setItem:async(key,value)=>values.set(key,value),removeItem:async key=>values.delete(key)}
  const transport=createAuthFetch('https://project.supabase.co','https://api.test',async(url,init)=>{
    calls.push(String(url))
    if(String(url).endsWith('/auth/v1/user'))return NativeResponse.json({id:'account',email:'a@example.test',app_metadata:{role:'student'}})
    assert.equal(String(url),'https://api.test/api/auth/logout')
    assert.match(init.headers.Authorization,/^Bearer /)
    return NativeResponse.json({success:true,revoked})
  })
  const client=createClient('https://project.supabase.co','anon',{global:{fetch:transport},auth:{storage,storageKey:'test-session',persistSession:true,autoRefreshToken:false,detectSessionInUrl:false}})
  const encode=data=>Buffer.from(JSON.stringify(data)).toString('base64url')
  const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:'account',exp:Math.floor(Date.now()/1000)+3600})}.${encode('signature')}`
  const established=await client.auth.setSession({access_token:token,refresh_token:'refresh'})
  assert.equal(established.error,null)
  assert.ok(values.has('test-session'))
  const result=await client.auth.signOut()
  assert.equal(Boolean(result.error),!revoked)
  assert.equal(values.has('test-session'),false)
  assert.equal((await client.auth.getSession()).data.session,null)
  assert.equal(calls.filter(url=>url.endsWith('/api/auth/logout')).length,1)
  assert.equal(calls.some(url=>url.includes('/auth/v1/logout')),false)
})

test('auth deadline aborts a stalled operation and forwards caller cancellation',async()=>{
  const wait=signal=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))
  await assert.rejects(withAuthDeadline(wait,5),/aborted/)
  const controller=new AbortController();const pending=withAuthDeadline(wait,12000,controller.signal)
  controller.abort();await assert.rejects(pending,/aborted/)
})
