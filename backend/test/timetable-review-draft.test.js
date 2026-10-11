const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runOrtoolsSolver}=require('../dist/modules/timetable/solver/ortools-runner');
const {validateTimetable}=require('../dist/modules/timetable/solver/validator');
const {createReviewDraft,saveReviewDraft,readReviewDraft}=require('../dist/modules/timetable/solver/review-draft');
const {TimetableService}=require('../dist/modules/timetable/timetable.service');
const {validatePreflightRules}=require('../dist/modules/timetable/solver/loader');
function course(id,hours,category='DSC',student=id,practical=0){return {courseId:id,courseCode:id,courseTitle:id,
  departmentId:'dept-'+id,departmentName:id,category,theoryHours:hours,practicalHours:practical,
  studentIds:new Set([student]),campusPaper:1};}
function payload(courses,rules=[],semester=1){return {semester,courses:courses.map(c=>({...c,studentIds:[...c.studentIds]})),
  parallel_groups:[],teacher_reservations:[],rules,constraints:{},config:{allow_partial:true,max_time_in_seconds:4,num_workers:2}};}
function response(result){return {assignments:Object.values(Object.groupBy(result.assignments,a=>a.courseId))
  .map(slots=>({courseId:slots[0].courseId,slots}))};}
const window={id:'one-morning',kind:'CAMPUS_TIME_LIMIT',scope:'campus',isHard:true,parameters:{days:[1],periods:[1,2,3]}};

test('catalogue hours may vary but cannot be missing, negative or fractional',()=>{
  for(const hours of [undefined,null,-1,2.5]) assert.throws(()=>validatePreflightRules([course('a',hours)],1),/invalid contact hours/);
  assert.doesNotThrow(()=>validatePreflightRules([course('a',0),course('b',2,'MDC')],1));
});

test('over-capacity input produces a conflict-free draft and accounts for every missing period',async()=>{
  const courses=[course('a',2,'DSC','shared'),course('b',2,'DSC','shared')];
  const result=await runOrtoolsSolver(payload(courses,[window]));
  assert.equal(result.status,'PARTIAL');assert.equal(result.assignments.length,3);
  assert.equal(result.unscheduled.reduce((sum,s)=>sum+s.periods,0),1);
  assert.deepEqual(validateTimetable(response(result),courses,new Map(),[],[],{allowPartial:true,semester:1,effectiveRules:[window]}),[]);
  assert.ok(validateTimetable(response(result),courses,new Map()).some(v=>['hours_mismatch','unplaced_course'].includes(v.type)));
  const draft=createReviewDraft(result,courses);assert.equal(draft.unscheduledPeriods,1);
  assert.ok(!JSON.stringify(draft).includes('shared'),'preview contains no student membership identifiers');
  assert.throws(()=>createReviewDraft({...result,unscheduled:[]},courses),/Incomplete draft accounting/);
});

test('MDC uses configured two theory hours, while uneven options keep a single synchronized block',async()=>{
  const courses=[course('a',2,'MDC'),course('b',3,'MDC')];
  const result=await runOrtoolsSolver(payload(courses));
  assert.equal(result.status,'PARTIAL');assert.equal(result.assignments.length,4);
  const keys=id=>result.assignments.filter(a=>a.courseId===id).map(a=>`${a.day}-${a.period}`).sort();
  assert.deepEqual(keys('a'),keys('b'));assert.equal(createReviewDraft(result,courses).unscheduledPeriods,1);
  assert.deepEqual(validateTimetable(response(result),courses,new Map(),[],[],{allowPartial:true,semester:1}),[]);
});

test('reserved teachers, empty domains and odd practical hours remain unscheduled without illegal placements',async()=>{
  const courses=[{...course('teacher',1),teacherId:'t'},course('lab',0,'DSC','labstudent',3)];
  const input=payload(courses,[window]);input.teacher_reservations=[1,2,3].map(period=>({teacherId:'t',day:1,period}));
  const result=await runOrtoolsSolver(input);assert.equal(result.status,'PARTIAL');
  assert.equal(result.assignments.filter(a=>a.courseId==='teacher').length,0);
  assert.equal(result.assignments.filter(a=>a.courseId==='lab').length,2);
  assert.equal(createReviewDraft(result,courses).unscheduledPeriods,2);
  assert.deepEqual(validateTimetable(response(result),courses,new Map(),[],input.teacher_reservations,
    {allowPartial:true,semester:1,effectiveRules:[window]}),[]);
});

test('partial validation still rejects overlap, excess hours and omitted campus options',()=>{
  const courses=[course('a',2,'SEC'),course('b',2,'SEC')];
  const candidates={assignments:[{courseId:'a',slots:[{day:1,period:1,sessionType:'theory',isLabBlock:false}]}]};
  assert.ok(validateTimetable(candidates,courses,new Map(),[],[],{allowPartial:true}).some(v=>v.type==='category_slot_mismatch'));
  const extra={assignments:[{courseId:'a',slots:[1,2,3].map(period=>({day:1,period,sessionType:'theory',isLabBlock:false}))}]};
  assert.ok(validateTimetable(extra,[courses[0]],new Map(),[],[],{allowPartial:true}).some(v=>v.type==='hours_mismatch'));
});

function database(job,save=true){const seen=[];let mutation;const db={from(table){seen.push(table);const q={
  select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,gt:()=>q,
  update:value=>{mutation=value;return q},maybeSingle:async()=>({data:mutation?(save?{id:'job'}:null):job})};return q}};
  return {db,seen,get mutation(){return mutation}};}
test('durable review storage preserves fencing and removes publishable fingerprints; expired claims fail',async()=>{
  const draft={kind:'review_draft',entries:[],conflicts:[],unscheduledPeriods:1};
  const job={metadata:{fencing_token:'token',lease_seconds:600,draft_hash:'old'},updated_at:new Date().toISOString()};
  const mock=database(job);await saveReviewDraft(mock.db,'job','token','campus',draft);
  assert.equal(mock.mutation.status,'completed');assert.equal(mock.mutation.metadata.fencing_token,'token');
  assert.equal(mock.mutation.metadata.draft_hash,undefined);assert.ok(mock.seen.every(t=>t==='system_logs'));
  await assert.rejects(saveReviewDraft(database(job,false).db,'job','token','campus',draft),/expired worker claim/);
  assert.deepEqual(await readReviewDraft(database({status:'completed',metadata:{reviewDraft:draft}}).db,'campus','2026-27',1),draft);
});
test('publication rejects incomplete review drafts even when force is requested',async()=>{
  const mock=database({status:'completed',metadata:{reviewDraft:{kind:'review_draft'}}});
  mock.db.rpc=()=>{throw Error('Publication RPC must not run')};
  const service=new TimetableService({admin:mock.db},{log:async()=>{}},{warn:()=>{},error:()=>{}});
  await assert.rejects(service.publish('2026-27',1,{role:'campus_director',campus_id:'campus'},true),/unscheduled sessions/);
});
test('generation falls back to a durable review preview without replacing timetable entries',async()=>{
  const runner=require('../dist/modules/timetable/solver/ortools-runner');
  const loader=require('../dist/modules/timetable/solver/loader');
  const originalRun=runner.runOrtoolsSolver,originalLoad=loader.loadGenerationInput;
  const courses=[course('a',2,'DSC','shared'),course('b',2,'DSC','shared')];
  const assignments=[{courseId:'a',departmentId:'dept-a',day:1,period:1,sessionType:'theory',isLabBlock:false},
    {courseId:'a',departmentId:'dept-a',day:2,period:1,sessionType:'theory',isLabBlock:false},
    {courseId:'b',departmentId:'dept-b',day:3,period:1,sessionType:'theory',isLabBlock:false}];
  const unscheduled=[{courseId:'b',sessionId:'th_2',sessionType:'theory',periods:1,reason:'Not placed'}];
  let calls=0,saved,lastRedis;
  runner.runOrtoolsSolver=async input=>{calls++;assert.equal(input.config.allow_partial===true,calls===2);
    return {status:calls===1?'INFEASIBLE':'PARTIAL',assignments:calls===1?[]:assignments,
      unscheduled,diagnostics:[],stats:{wall_time_seconds:0}}};
  loader.loadGenerationInput=async()=>({courses,slotMap:new Map(),slotLookup:new Map(),studentDeptMap:new Map(),
    parallelGroups:[],teacherReservations:[],preflightDiagnostics:[],stats:{courseCount:2}});
  const db={rpc:async name=>{assert.equal(name,'update_timetable_worker');return {}},from(table){
    const q={select:()=>q,eq:()=>q,or:()=>q,limit:()=>q,gt:()=>q,
      update:value=>{assert.equal(table,'system_logs');saved=value;return q},
      maybeSingle:async()=>({data:saved?{id:'job'}:{metadata:{fencing_token:'token',lease_seconds:600}}}),
      then:resolve=>resolve({data:table==='departments'?[{id:'dept-a'},{id:'dept-b'}]:[]})};return q}};
  try {
    const {runGenerationJob}=require('../dist/modules/timetable/solver/job');
    await runGenerationJob('job','2026-27',1,'director',db,{set:async(_key,value)=>{lastRedis=JSON.parse(value)}},'campus',[],undefined,'token');
    assert.equal(calls,2);assert.equal(saved.metadata.reviewDraft.unscheduledPeriods,1);
    assert.equal(lastRedis.status,'completed');assert.match(lastRedis.stepMessage,/Review draft ready/);
  } finally {runner.runOrtoolsSolver=originalRun;loader.loadGenerationInput=originalLoad;}
});
