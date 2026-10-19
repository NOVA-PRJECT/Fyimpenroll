const {test}=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
function load(name) {
  const module={exports:{}}
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/core',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  vm.runInNewContext(code,{module,exports:module.exports,Error,Set,Map});return module.exports
}
test('a fixed blueprint paper is not a confirmed allocation before registration or an allocation run',()=>{
  const {registrationSlotState:state}=load('registration-display')
  for(const windowOpen of [true,false])for(const submitted of [true,false])for(const persistedCourseId of [null,'fixed-on-submission']) {
    const result=state({fixed:true,windowOpen,submitted,persistedCourseId,allocationCompleted:false})
    assert.equal(result.confirmed,false);assert.equal(result.badge,'Fixed blueprint course')
    assert.doesNotMatch(result.pendingText,/automated rounds|could not be resolved/)
  }
})
test('closed registration distinguishes an absent submission from preferences awaiting allocation',()=>{
  const {registrationSlotState:state}=load('registration-display')
  const base={fixed:false,windowOpen:false,persistedCourseId:null,allocationCompleted:false}
  assert.equal(state({...base,submitted:false}).pendingTitle,'Registration not submitted')
  assert.match(state({...base,submitted:false}).pendingText,/closed before you submitted/)
  assert.equal(state({...base,submitted:true}).pendingTitle,'Awaiting allocation')
  assert.match(state({...base,submitted:true}).pendingText,/not completed yet/)
})
test('a completed cohort run without a persisted student slot cannot confirm a paper',()=>{
  const {registrationSlotState:state}=load('registration-display')
  const base={fixed:false,windowOpen:false,submitted:true,allocationCompleted:true}
  assert.equal(state({...base,persistedCourseId:null}).confirmed,false)
  assert.equal(state({...base,persistedCourseId:'persisted'}).confirmed,true)
})
const period=(n,extra={})=>({timetable_slot_id:`p${n}`,course_id:'course',period_number:n,is_marked:true,is_lab_block:true,course_semester:4,adjacent_practical_slot_id:`p${n+1}`,...extra})
test('destination copy supports every approved previous-period pair',()=>{
  const {attendanceCopySource:source}=load('attendance-copy')
  for(const [from,to] of [[1,2],[2,3],[4,5],[5,6]])assert.equal(source([period(from),period(to)],period(to)).timetable_slot_id,`p${from}`)
})
test('copy excludes unmarked, unrelated, non-practical, non-adjacent, and lunch-crossing sources',()=>{
  const {attendanceCopySource:source}=load('attendance-copy'),target=period(5)
  for(const change of [{is_marked:false},{course_id:'other'},{is_lab_block:false},{course_semester:2},{adjacent_practical_slot_id:'different'},{period_number:2}]) {
    assert.equal(source([period(4,change)],target),undefined)
  }
  assert.equal(source([period(3)],period(4)),undefined)
  assert.equal(source([period(4)],period(5,{is_lab_block:false})),undefined)
})
test('copy preserves exact attendance by student ID without mutating either roster',()=>{
  const {copiedAbsences}=load('attendance-copy')
  const target=[{id:'a'},{id:'b'}],source=[{id:'b',status:'absent'},{id:'a',status:'present'}]
  assert.deepEqual([...copiedAbsences(target,source)],['b'])
  assert.deepEqual(source,[{id:'b',status:'absent'},{id:'a',status:'present'}])
  assert.equal(copiedAbsences(target,source.map(s=>({...s,status:'present'}))).size,0)
  assert.equal(copiedAbsences(target,source.map(s=>({...s,status:'absent'}))).size,2)
})
test('copy refuses mismatched or incomplete rosters instead of defaulting students to present',()=>{
  const {copiedAbsences}=load('attendance-copy'),target=[{id:'a'},{id:'b'}]
  for(const source of [[{id:'a',status:'present'}],[{id:'a',status:'present'},{id:'b',status:'unmarked'}],[{id:'a',status:'absent'},{id:'a',status:'absent'}],[{id:'a',status:'present'},{id:'c',status:'absent'}]]) {
    assert.throws(()=>copiedAbsences(target,source),/rosters differ|incomplete/)
  }
})
