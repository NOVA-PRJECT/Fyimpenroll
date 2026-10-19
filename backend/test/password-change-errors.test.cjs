const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
require('ts-node').register({project:path.join(__dirname,'../tsconfig.json'),transpileOnly:true})
const {AuthService}=require('../src/modules/auth/auth.service')
const user={userId:'fixture',email:'fixture@example.invalid',role:'student',department_id:'dept',campus_id:'campus'}
function harness({verifyError=null,pwError=null,flagError=null,metadataError=null,throwUpdate=false}={}) {
  const calls=[]
  const supabase={createAuthClient:()=>({auth:{signInWithPassword:async()=>({error:verifyError,data:{session:{access_token:'fixture-token'}}})}}),admin:{
    auth:{admin:{updateUserById:async(id,value)=>{
      calls.push(value)
      if(throwUpdate)throw {name:'AuthRetryableFetchError'}
      return {error:value.password?pwError:metadataError}
    }}},from:()=>({update:()=>({eq:async()=>({error:flagError})})})
  }}
  const logger={log:async()=>{}}
  return {calls,service:new AuthService(supabase,{},logger,logger)}
}
test('incorrect current password is a field-specific 400 and never updates Auth',async()=>{
  const h=harness({verifyError:{status:400,code:'invalid_credentials'}})
  await assert.rejects(h.service.changePassword('wrong-current','Different123!',user),e=>e.getStatus()===400&&e.getResponse().code==='CURRENT_PASSWORD_INCORRECT'&&e.getResponse().field==='current_password')
  assert.equal(h.calls.length,0)
})
test('reusing the current password is rejected before any provider mutation',async()=>{
  const h=harness()
  await assert.rejects(h.service.changePassword('Unchanged123!','Unchanged123!',user),e=>e.getResponse().code==='PASSWORD_UNCHANGED')
  assert.equal(h.calls.length,0)
})
test('provider password rejection codes become readable new-password errors without synchronizing the profile',async()=>{
  for(const [code,expected] of [['same_password','PASSWORD_UNCHANGED'],['weak_password','PASSWORD_TOO_WEAK'],['validation_failed','NEW_PASSWORD_REJECTED']]) {
    const h=harness({pwError:{status:422,code}})
    await assert.rejects(h.service.changePassword('Current123!','Different123!',user),e=>e.getStatus()===400&&e.getResponse().code===expected&&e.getResponse().field==='new_password')
    assert.equal(h.calls.length,1)
  }
})
test('provider outages and retryable fetch failures remain service failures, not incorrect-password errors',async()=>{
  for(const options of [{verifyError:{status:503}},{pwError:{status:503}},{pwError:{status:429}},{throwUpdate:true}]) {
    await assert.rejects(harness(options).service.changePassword('Current123!','Different123!',user),e=>e.getStatus()===503)
  }
})
test('successful changes and partial profile synchronization keep the existing response contract',async()=>{
  const ok=await harness().service.changePassword('Current123!','Different123!',user)
  assert.equal(ok.success,true);assert.equal(ok.token,'fixture-token')
  for(const options of [{flagError:{message:'fixture failure'}},{metadataError:{message:'fixture failure'}}]) {
    const result=await harness(options).service.changePassword('Current123!','Different123!',user)
    assert.equal(result.success,false);assert.equal(result.code,'SYNC_FAILED');assert.equal(result.canRetrySync,true)
  }
})
