const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {runOrtoolsSolver}=require('../dist/modules/timetable/solver/ortools-runner');
const {validatePreflightRules,detectParallelGroups}=require('../dist/modules/timetable/solver/loader');
const {validateTimetable}=require('../dist/modules/timetable/solver/validator');
const {RuleDefinitionSchema}=require('../dist/modules/timetable/solver/schemas');
const rules=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../src/modules/timetable/solver/constraints.base.json'),'utf8')).rules;
function course(id,code,category='AEC',theoryHours=3,practicalHours=0){return {
  courseId:id,courseCode:code,courseTitle:code,departmentId:'english',departmentName:'English',
  category,theoryHours,practicalHours,isCrossDept:true,studentIds:new Set(['student-a','student-b']),conflictSummary:''};}
function input(courses,extraRules=[]){return {semester:1,academic_year:'2026-27',
  courses:courses.map(c=>({...c,studentIds:[...c.studentIds]})),parallel_groups:[],teacher_reservations:[],
  rules:[...rules,...extraRules],constraints:{},config:{max_time_in_seconds:10,num_workers:2}};}
function response(assignments){return {assignments:Object.values(Object.groupBy(assignments,a=>a.courseId)).map(slots=>({courseId:slots[0].courseId,slots}))};}
const slotMap=new Map([1,2,3,4,5].map(d=>[d,new Map([1,2,3,4,5,6].map(p=>[p,`${d}-${p}`]))]));

test('shared campus AEC papers occupy Tuesday and Wednesday P4-P6 exactly once',async()=>{
  const courses=[course('first','KU01AECENG101'),course('second','KU01AECENG102')];
  const groups=detectParallelGroups(courses,new Map([['student-a','dept-a'],['student-b','dept-b']]));
  assert.equal(groups.length,0,'compulsory papers must not be put in the same parallel basket');
  const result=await runOrtoolsSolver(input(courses));
  assert.ok(['OPTIMAL','FEASIBLE'].includes(result.status),JSON.stringify(result.diagnostics));
  assert.equal(result.assignments.length,6);
  for(const [id,day] of [['first',2],['second',3]]) {
    assert.deepEqual(result.assignments.filter(a=>a.courseId===id).map(a=>`${a.day}-${a.period}`).sort(),[4,5,6].map(p=>`${day}-${p}`));
  }
  assert.deepEqual(validateTimetable(response(result.assignments),courses,slotMap,[],[],{semester:1,effectiveRules:rules}),[]);
  const swapped=result.assignments.map(a=>({...a,day:a.day===2?3:2}));
  assert.ok(validateTimetable(response(swapped),courses,slotMap,[],[],{semester:1,effectiveRules:rules}).some(v=>v.type==='invalid_window'));
  assert.ok(validateTimetable(response(swapped),courses,slotMap,[],[],{semester:1,effectiveRules:[]}).some(v=>v.type==='invalid_window'),'older browser rule overrides must retain mandatory paper times');
});

test('older browser rules cannot move the mandatory AEC first paper',async()=>{
  const payload=input([course('first','KU01AECENG101')]);
  payload.rules=[{id:'wednesday-only',kind:'CAMPUS_TIME_LIMIT',scope:'campus',isHard:true,parameters:{days:[3],periods:[4,5,6]}}];
  assert.equal((await runOrtoolsSolver(payload)).status,'INFEASIBLE');
});

test('a campus time restriction cannot move the first AEC paper to Wednesday or omit it',async()=>{
  const result=await runOrtoolsSolver(input([course('first','KU01AECENG101')],[{
    id:'wednesday-only',kind:'CAMPUS_TIME_LIMIT',scope:'campus',isHard:true,parameters:{days:[3],periods:[4,5,6]}
  }]));
  assert.equal(result.status,'INFEASIBLE');assert.equal(result.assignments.length,0);
});

test('MDC contact hours follow the catalogue, including practicals when configured',async()=>{
  const configured=course('mdc','KU01MDCPSY101','MDC',2,2);
  assert.doesNotThrow(()=>validatePreflightRules([configured],1));
  const actual=await runOrtoolsSolver(input([configured]));
  assert.ok(['OPTIMAL','FEASIBLE'].includes(actual.status));
  assert.equal(actual.assignments.filter(a=>a.sessionType==='theory').length,2);
  assert.equal(actual.assignments.filter(a=>a.sessionType==='practical').length,2);
  assert.deepEqual(validateTimetable(response(actual.assignments),[configured],slotMap,[],[],{semester:1,effectiveRules:rules}),[]);
  const valid=course('mdc','KU01MDCPSY101','MDC');
  assert.doesNotThrow(()=>validatePreflightRules([valid],1));
  const result=await runOrtoolsSolver(input([valid]));
  assert.ok(['OPTIMAL','FEASIBLE'].includes(result.status));
  assert.equal(result.assignments.length,3);assert.ok(result.assignments.every(a=>a.sessionType==='theory'));
  assert.deepEqual(validateTimetable(response(result.assignments),[valid],slotMap,[],[],{semester:1,effectiveRules:rules}),[]);
});

test('course window filters are typed, scoped and do not constrain an unrelated course',async()=>{
  assert.equal(RuleDefinitionSchema.safeParse({...rules.find(r=>r.id==='sem1_aec_first_paper'),parameters:{courseCodes:[null]}}).success,false);
  const unrelated=course('dsc','KU01DSCECO101','DSC',1);
  const result=await runOrtoolsSolver(input([unrelated],[{id:'monday-only',kind:'CAMPUS_TIME_LIMIT',scope:'campus',isHard:true,parameters:{days:[1],periods:[1]}}]));
  assert.ok(['OPTIMAL','FEASIBLE'].includes(result.status));
  assert.equal(result.assignments[0].day,1);assert.equal(result.assignments[0].period,1);
});
