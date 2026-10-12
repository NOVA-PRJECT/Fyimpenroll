const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
function compile(file, requireModule) {
  const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText
  const module={exports:{}};new Function('require','module','exports',source)(requireModule,module,module.exports);return module.exports
}
const network=compile('src/lib/auth-network.ts',require)
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function harness(initialSession) {
  const states=[],effects=[];let listener
  const session={access_token:'access',refresh_token:'refresh',user:{id:'account'}}
  const react={createContext:()=>({Provider:'provider'}),createElement:(_type,props)=>props,
    useState:value=>{const i=states.push(value)-1;return [value,next=>{states[i]=next}]},
    useRef:current=>({current}),useCallback:fn=>fn,useEffect:fn=>effects.push(fn)}
  const auth={getSession:()=>initialSession||Promise.resolve({data:{session:null}}),
    setSession:async()=>{await listener('SIGNED_IN',session);return {data:{session,user:session.user},error:null}},
    signOut:async()=>{listener('SIGNED_OUT',null);return {error:null}},
    onAuthStateChange:callback=>{listener=callback;return {data:{subscription:{unsubscribe(){}}}}}}
  const deps={react,'../lib/supabase':{supabase:{auth}},'../lib/query-client':{queryClient:{clear(){}}},
    '../api/client':{apiClient:{post:async()=>({token:'access',refreshToken:'refresh'})},setOnUnauthorizedCallback(){}},
    '../api/schemas/auth.schema':{ProfileResponseSchema:{safeParse:data=>({success:true,data})}},
    '../api/endpoints':{API_ENDPOINTS:{AUTH_PROFILE:'/api/auth/profile',AUTH_LOGIN:'/api/auth/login'}},
    '../config/env':{ENV:{API_BASE_URL:'https://api.test'}},'react-native':{Alert:{alert(){}}},'../lib/auth-network':network}
  const {AuthProvider}=compile('src/context/AuthContext.tsx',name=>name in deps?deps[name]:require(name))
  const value=AuthProvider({children:null}).value
  effects.forEach(fn=>fn())
  return {value,states,session,emit:(...args)=>listener(...args)}
}
test('login performs exactly one profile request despite the SDK SIGNED_IN notification',async t=>{
  const original=global.fetch;t.after(()=>{global.fetch=original})
  let calls=0;global.fetch=async()=>{calls++;return Response.json({role:'student',profile:{full_name:'Alice'}})}
  const app=harness();await tick()
  assert.equal((await app.value.login('a@example.test','password')).role,'student')
  assert.equal(calls,1);assert.equal(app.states[2],'student');assert.equal(app.states[4],false)
})
test('a profile response completing after logout cannot restore the old account',async t=>{
  const original=global.fetch;t.after(()=>{global.fetch=original})
  let release;global.fetch=()=>new Promise(resolve=>{release=resolve})
  const app=harness();await tick()
  const login=app.value.login('a@example.test','password');await tick()
  const rejected=assert.rejects(login,/Session changed/)
  await app.value.logout()
  release(Response.json({role:'student',profile:{full_name:'Alice'}}));await rejected
  assert.deepEqual(app.states.slice(0,4),[null,null,null,null])
})
test('late startup restoration cannot override SIGNED_OUT',async()=>{
  let restore
  const app=harness(new Promise(resolve=>{restore=resolve}))
  app.emit('SIGNED_OUT',null)
  restore({data:{session:app.session}});await tick()
  assert.deepEqual(app.states.slice(0,4),[null,null,null,null])
})
