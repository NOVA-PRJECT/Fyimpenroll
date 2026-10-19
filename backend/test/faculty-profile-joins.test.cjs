const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
require('ts-node').register({project:path.join(__dirname,'../tsconfig.json'),transpileOnly:true})
const {AuthService}=require('../src/modules/auth/auth.service')
const {AdminService}=require('../src/modules/admin/admin.service')
const {PeriodAttendanceService}=require('../src/modules/period-attendance/period-attendance.service')
const {DashboardEntryService}=require('../src/modules/auth/dashboard-entry.service')
const logger={log:async()=>{},warn(){},error(){}}
function harness({department=true}={}) {
  const faculty={id:'faculty',full_name:'Fixture HOD',department_id:department?'dept':null,campus_id:'campus',departments:department?{name:'Example Department'}:null,campuses:{name:'Example Campus'}}
  const admin={from(table){
    let selection=''
    const q={select(value){selection=value;return q},eq(){return q},order(){return q},or(){return q},in(){return q},
      async execute(){
        const ambiguous=table==='faculty'&&/departments\s*\(/.test(selection)
        return ambiguous?{data:null,error:{code:'PGRST201',message:'Multiple department relationships'}}:{data:table==='faculty'?[faculty]:table==='students'?[{full_name:'Fixture Student',departments:{name:'Example Department'}}]:[],error:null}
      },then(a,b){return q.execute().then(a,b)},async single(){const result=await q.execute();return {...result,data:result.data?.[0]??null}},maybeSingle(){return q.single()},
    };return q
  }}
  return {admin,faculty,auth:new AuthService({admin},{},logger,logger)}
}
for(const role of ['hod','teacher','campus_director','teaching_staff'])test(`${role}: profile join remains unambiguous with both department foreign keys`,async()=>{
  const h=harness(),profile=await h.auth.getProfile({userId:'faculty',role,must_change_password:false})
  assert.equal(profile.role,role);assert.equal(profile.profile.full_name,'Fixture HOD')
  assert.equal(profile.profile.departments.name,'Example Department');assert.equal(profile.profile.campuses.name,'Example Campus')
})
test('campus staff with no department retain a valid profile and a null department relation',async()=>{
  const result=await harness({department:false}).auth.getProfile({userId:'faculty',role:'campus_director'})
  assert.equal(result.profile.departments,null);assert.equal(result.profile.campuses.name,'Example Campus')
})
test('student profiles keep their existing department relationship and response shape',async()=>{
  const result=await harness().auth.getProfile({userId:'student',role:'student'})
  assert.equal(result.role,'student');assert.equal(result.profile.full_name,'Fixture Student')
})
test('superadmin faculty lists resolve department names under the same schema',async()=>{
  const h=harness(),list=await new AdminService({admin:h.admin},logger,logger).getFacultyList()
  assert.equal(list.length,1);assert.equal(list[0].departments.name,'Example Department')
})
test('teacher schedules retain their profile names even with no assigned timetable entries',async()=>{
  const h=harness(),result=await new PeriodAttendanceService({admin:h.admin},logger,logger).getTeacherSchedule({userId:'faculty',role:'teacher'},'2026-10-19')
  assert.equal(result.teacherName,'Fixture HOD');assert.equal(result.departmentName,'Example Department');assert.equal(result.campusName,'Example Campus')
  assert.deepEqual(result.periods,[])
})
test('HOD login preload uses the repaired profile query and preserves the nested profile contract',async()=>{
  const h=harness(),entry=await new DashboardEntryService(h.auth,{}, {}, {}).load({userId:'faculty',role:'hod',consent:{accepted:true}},'/dashboard/hod')
  assert.equal(entry.endpoint,'/api/auth/profile');assert.equal(entry.data.profile.departments.name,'Example Department')
})
