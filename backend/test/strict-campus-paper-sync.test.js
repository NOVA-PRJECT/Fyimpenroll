const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildCampusPaperGroups,resolveCampusPapers}=require('../dist/modules/timetable/solver/campus-paper-groups');
const {detectParallelGroups}=require('../dist/modules/timetable/solver/loader');
const {validateTimetable}=require('../dist/modules/timetable/solver/validator');
const {runOrtoolsSolver}=require('../dist/modules/timetable/solver/ortools-runner');
function course(id,category,hours=3,student=id,paper=1){return {
  courseId:id,courseCode:id,courseTitle:id,category,theoryHours:hours,practicalHours:0,
  departmentId:'dept-'+id,departmentName:id,isCrossDept:false,studentIds:new Set([student]),
  campusPaper:paper,conflictSummary:''};}
function payload(courses,rules=[],groups=[]){return {semester:1,courses:courses.map(c=>({...c,studentIds:[...c.studentIds]})),
  parallel_groups:groups,teacher_reservations:[],constraints:{},rules,config:{max_time_in_seconds:10,num_workers:2}};}
function response(assignments){return {assignments:Object.values(Object.groupBy(assignments,a=>a.courseId)).map(slots=>({courseId:slots[0].courseId,slots}))};}
function keys(assignments,id){return assignments.filter(a=>a.courseId===id).map(a=>`${a.day}-${a.period}`).sort();}
function window(id,days,periods=[1,2,3]){return {id:'window-'+id,kind:'CATEGORY_WINDOW',scope:'course',targetCourseId:id,isHard:true,parameters:{days,periods}};}

test('campus paper identities survive different department slot layouts and separate AEC papers',()=>{
  const catalogue=new Map([['a',{category:'MDC',courseCode:'A'}],['b',{category:'MDC',courseCode:'B'}],
    ['first',{category:'AEC',courseCode:'KU01AECENG101'}],['second',{category:'AEC',courseCode:'KU01AECENG102'}]]);
  const papers=resolveCampusPapers([{slot_4_course_id:'a',slot_5_course_id:'first',slot_6_course_id:'second'},
    {slot_2_course_id:'b',slot_7_course_id:'first',slot_8_course_id:'second'}],catalogue);
  assert.deepEqual([...papers],[['a',1],['first',1],['second',2],['b',1]]);
  assert.throws(()=>resolveCampusPapers([{slot_2_course_id:'a',slot_4_course_id:'b'},{slot_2_course_id:'b'}],catalogue),/inconsistent MDC paper positions/);
  assert.throws(()=>resolveCampusPapers([{slot_1_course_id:'second'}],catalogue),/inconsistent AEC paper positions/);
});

test('campus papers cannot be split to hide unequal hours or student overlap',async()=>{
  const unequal=[course('a','SEC',2),course('b','SEC',3)];
  assert.throws(()=>detectParallelGroups(unequal),/identical total contact hours/);
  assert.equal((await runOrtoolsSolver(payload(unequal))).status,'MODEL_INVALID');
  const overlapping=[course('a','MDC',3,'shared'),course('b','MDC',3,'shared')];
  assert.throws(()=>detectParallelGroups(overlapping),/overlapping student enrollments/);
  assert.equal((await runOrtoolsSolver(payload(overlapping))).status,'MODEL_INVALID');
});

for(const category of ['MDC','SEC','VAC']) test(`${category} options synchronize across departments even if caller groups are missing or split`,async()=>{
  const courses=[course('a',category),course('b',category),course('c',category)];
  assert.equal(buildCampusPaperGroups(courses).length,1);
  const result=await runOrtoolsSolver(payload(courses,[],[{groupId:'partial',category,courseIds:['a','b']}]));
  assert.ok(['OPTIMAL','FEASIBLE'].includes(result.status),JSON.stringify(result.diagnostics));
  assert.deepEqual(keys(result.assignments,'a'),keys(result.assignments,'b'));
  assert.deepEqual(keys(result.assignments,'a'),keys(result.assignments,'c'));
  assert.deepEqual(validateTimetable(response(result.assignments),courses,new Map(),[],[],{semester:1}),[]);
});

test('independent validation checks the whole campus paper even with unrelated department groups',()=>{
  const courses=[course('a','SEC',1),course('b','SEC',1),course('dsc','DSC',1)];
  const candidates=courses.map((c,i)=>({courseId:c.courseId,slots:[{day:i+1,period:1,sessionType:'theory',isLabBlock:false}]}));
  for(const groups of [[],[{groupId:'department',courseIds:['dsc'],courseCodes:['dsc'],departmentId:'dept-dsc'}],
    [{groupId:'split-a',courseIds:['a']},{groupId:'split-b',courseIds:['b']}]] ) {
    assert.ok(validateTimetable({assignments:candidates},courses,new Map(),groups).some(v=>v.type==='category_slot_mismatch'));
  }
});

test('disjoint course windows prove a common paper infeasible; partial windows use their full intersection',async()=>{
  const courses=[course('a','SEC'),course('b','SEC')];
  const disjoint=await runOrtoolsSolver(payload(courses,[window('a',[1]),window('b',[2])]));
  assert.equal(disjoint.status,'INFEASIBLE');assert.equal(disjoint.assignments.length,0);
  const shared=await runOrtoolsSolver(payload(courses,[window('a',[1,2]),window('b',[2,3])]));
  assert.ok(['OPTIMAL','FEASIBLE'].includes(shared.status));
  assert.deepEqual(keys(shared.assignments,'a'),['2-1','2-2','2-3']);
  assert.deepEqual(keys(shared.assignments,'b'),keys(shared.assignments,'a'));
});

test('equal-duration SEC options with different theory/lab structures occupy identical full periods',async()=>{
  const courses=[course('a','SEC',4),{...course('b','SEC',2),practicalHours:2}];
  assert.equal(buildCampusPaperGroups(courses).length,1);
  const result=await runOrtoolsSolver(payload(courses));
  assert.ok(['OPTIMAL','FEASIBLE'].includes(result.status),JSON.stringify(result.diagnostics));
  assert.deepEqual(keys(result.assignments,'a'),keys(result.assignments,'b'));
  assert.deepEqual(validateTimetable(response(result.assignments),courses,new Map()),[]);
});

test('AEC second-paper options share Wednesday while the common first paper remains Tuesday',async()=>{
  const courses=[{...course('KU01AECENG101','AEC'),studentIds:new Set(['s1','s2'])},
    course('second-a','AEC',3,'s1',2),course('second-b','AEC',3,'s2',2)];
  assert.deepEqual(buildCampusPaperGroups(courses)[0].courseIds,['second-a','second-b']);
  const result=await runOrtoolsSolver(payload(courses));
  assert.ok(['OPTIMAL','FEASIBLE'].includes(result.status));
  assert.deepEqual(keys(result.assignments,'KU01AECENG101'),['2-4','2-5','2-6']);
  assert.deepEqual(keys(result.assignments,'second-a'),['3-4','3-5','3-6']);
  assert.deepEqual(keys(result.assignments,'second-b'),keys(result.assignments,'second-a'));
  assert.deepEqual(validateTimetable(response(result.assignments),courses,new Map(),[],[],{semester:1}),[]);
});
