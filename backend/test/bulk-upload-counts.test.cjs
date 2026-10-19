const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
require('ts-node').register({project:path.join(__dirname,'../tsconfig.json'),transpileOnly:true})
const {HodService}=require('../src/modules/hod/hod.service')
const user={userId:'hod',role:'hod',department_id:'dept',campus_id:'campus'}
const row=n=>({full_name:`Fixture ${n}`,email:`fixture${n}@example.invalid`,current_semester:2,academic_year_joined:'2026-27',cap_application_number:`FIXTURE${n}`})
function harness({authFailure=()=>false,dbFailure=()=>false}={}) {
  const calls={created:[],deleted:[],inserted:[],audits:[]}
  const admin={auth:{admin:{
    async createUser(body){calls.created.push(body.email);return authFailure(body.email)?{data:null,error:{message:'Email already registered'}}:{data:{user:{id:body.email}},error:null}},
    async deleteUser(id){calls.deleted.push(id);return {error:null}},
    async updateUserById(){return {error:null}},
  }},from(){return {async insert(body){calls.inserted.push(body);return {error:dbFailure(body.id)?{message:'Student record rejected'}:null}}}}}
  return {calls,service:new HodService({admin},{log:async body=>calls.audits.push(body)},{error(){}})}
}
for(const [name,fail,created,errors] of [
  ['all-success',()=>false,2,0],['mixed',email=>email.startsWith('fixture1'),1,1],['all-failed',()=>true,0,2],
])test(`bulk API ${name}: additive totals match row outcomes`,async()=>{
  const h=harness({authFailure:fail})
  const result=await h.service.bulkCreateStudents([row(1),row(2)],'FixturePassword123!',user)
  assert.equal(result.success,true);assert.equal(result.inserted_count,created);assert.equal(result.error_count,errors)
  assert.equal(result.results.length,created+errors)
  assert.equal(h.calls.audits[0].metadata.count,created)
  assert.equal(h.calls.audits[0].metadata.error_count,errors)
})
test('a failed student insert is counted as an error and cleans up only the newly created Auth user',async()=>{
  const h=harness({dbFailure:email=>email.startsWith('fixture2')})
  const result=await h.service.bulkCreateStudents([row(1),row(2)],'FixturePassword123!',user)
  assert.equal(result.inserted_count,1);assert.equal(result.error_count,1)
  assert.deepEqual(h.calls.deleted,['fixture2@example.invalid'])
  assert.match(result.results[1].issues[0],/rejected/)
})
test('row validation failures count as errors without creating an Auth account',async()=>{
  const h=harness()
  const result=await h.service.bulkCreateStudents([{email:'fixture@example.invalid'}],'FixturePassword123!',user)
  assert.equal(result.inserted_count,0);assert.equal(result.error_count,1);assert.equal(h.calls.created.length,0)
})
