const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AuthGuard } = require('../dist/core/auth/guards/auth.guard')
const { AuthService } = require('../dist/modules/auth/auth.service')
const { RateLimiterService } = require('../dist/core/security/rate-limiter.service')
const audit={log:async()=>{}}, logger={warn:()=>{},error:()=>{}}
const user={userId:'student',role:'student',email:'student@example.test',token:'access'}
const rotated={data:{user:{id:'student',app_metadata:{role:'student'}},session:{access_token:'access',refresh_token:'rotated',expires_in:3600}},error:null}
function service(refresh) {
  const auth=new AuthService({createAuthClient:()=>({auth:{refreshSession:refresh}}),admin:{auth:{admin:{updateUserById:async()=>({error:null}),signOut:async()=>({error:null})}}}}, {},audit,logger)
  auth.determineUserRoute=async()=>({role:'student',must_change_password:false})
  return auth
}
test('authentication outages and throttling return 503 while invalid credentials return 401',async()=>{
  for(const status of [503,429,401]) {
    const guard=new AuthGuard({admin:{auth:{getUser:async()=>({error:{status}})}}})
    const context={switchToHttp:()=>({getRequest:()=>({headers:{authorization:'Bearer access'},method:'GET'})})}
    await assert.rejects(guard.canActivate(context),error=>error.getStatus()===(status===401?401:503))
  }
  const auth=service(async()=>{throw new TypeError('fetch failed')})
  await assert.rejects(auth.refreshSession('old'),error=>error.getStatus()===503)
})
test('logout invalidates rotated-token caches instead of replaying a cached session',async()=>{
  let revoked=false,calls=0
  const auth=service(async()=>{calls++;return revoked?{error:{status:401}}:rotated})
  assert.equal((await auth.refreshSession('old')).token,'access')
  assert.equal((await auth.refreshSession('rotated')).token,'access')
  assert.equal(calls,1)
  await auth.logout(user,'127.0.0.1');revoked=true
  assert.equal(auth.recentRefreshes.size,0)
  await assert.rejects(auth.refreshSession('old'),error=>error.getStatus()===401)
  assert.equal(calls,2)
})
test('logout fences a slow refresh even after the tombstone retention period',async()=>{
  let release
  const auth=service(()=>new Promise(resolve=>{release=resolve}))
  const refresh=auth.refreshSession('old')
  await auth.logout(user,'127.0.0.1')
  auth.pruneRefreshes(Date.now()+120000)
  assert.ok(auth.logoutGenerations.has('student'))
  release(rotated)
  await assert.rejects(refresh,error=>error.getStatus()===401)
  assert.equal(auth.recentRefreshes.size,0)
  auth.pruneRefreshes(Date.now()+120000)
  assert.equal(auth.logoutGenerations.size,0)
})
test('local fallback enforces sensitive limits while Redis is absent or unavailable',async()=>{
  const limiter=new RateLimiterService({get:()=>undefined})
  limiter.isConfigured=false
  for(let i=0;i<5;i++)assert.equal((await limiter.checkLimit(limiter.passwordChangeLimiter,'actor')).success,true)
  assert.equal((await limiter.checkLimit(limiter.passwordChangeLimiter,'actor')).success,false)
  limiter.isConfigured=true;limiter.redis={}
  limiter.passwordChangeLimiter.limit=async()=>{throw Error('network unavailable')}
  assert.equal((await limiter.checkLimit(limiter.passwordChangeLimiter,'actor')).success,false)
})
test('password metadata failure returns a recoverable synchronization response',async()=>{
  let updates=0
  const auth=new AuthService({createAuthClient:()=>({auth:{signInWithPassword:async()=>({error:null})}}),admin:{auth:{admin:{updateUserById:async()=>({error:++updates===2?{status:503}:null})}},from:()=>{const q={update:()=>q,eq:async()=>({error:null})};return q}}},{},audit,logger)
  const result=await auth.changePassword('old-password','NewPassword123!',user)
  assert.equal(result.code,'SYNC_FAILED');assert.equal(result.canRetrySync,true);assert.equal(result.success,false)
})
