const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runOrtoolsSolver}=require('../dist/modules/timetable/solver/ortools-runner');
function course(id,hours,students){return {courseId:id,courseCode:id,category:'DSC',theoryHours:hours,practicalHours:0,studentIds:students}}
function input(courses,rules=[]){return {academic_year:'2026-27',semester:1,courses,parallel_groups:[],teacher_reservations:[],rules,constraints:{},config:{max_time_in_seconds:10,num_workers:2}}}

test('rejects a pairwise-conflicting group requiring 33 periods even though each student needs only 22',async()=>{
  const result=await runOrtoolsSolver(input([
    course('A',11,['ab','ac']),course('B',11,['ab','bc']),course('C',11,['ac','bc'])
  ]));
  assert.equal(result.status,'INFEASIBLE');
  assert.equal(result.assignments.length,0);
  assert.equal(result.stats.wall_time_seconds,0);
  assert.equal(result.stats.capacity_required_periods,33);
  assert.equal(result.stats.capacity_available_periods,30);
  assert.match(result.diagnostics.join(' '),/Every pair shares at least one student/);
});

test('permits more than 30 course periods when independent courses can overlap',async()=>{
  const courses=Array.from({length:7},(_,i)=>course('course-'+i,5,['student-'+i]));
  const result=await runOrtoolsSolver(input(courses));
  assert.ok(['OPTIMAL','FEASIBLE'].includes(result.status),JSON.stringify(result.diagnostics));
  assert.equal(result.assignments.length,35);
  assert.equal(result.stats.capacity_required_periods,undefined);
});

test('uses the allowed campus periods and accepts a group exactly at capacity',async()=>{
  const rules=[{id:'morning',kind:'CAMPUS_TIME_LIMIT',scope:'campus',isHard:true,parameters:{days:[1],periods:[1,2,3]}}];
  const atCapacity=await runOrtoolsSolver(input([course('A',2,['s']),course('B',1,['s'])],rules));
  assert.ok(['OPTIMAL','FEASIBLE'].includes(atCapacity.status),JSON.stringify(atCapacity.diagnostics));
  assert.equal(atCapacity.assignments.length,3);
  const overCapacity=await runOrtoolsSolver(input([course('A',2,['s']),course('B',2,['s'])],rules));
  assert.equal(overCapacity.status,'INFEASIBLE');
  assert.equal(overCapacity.stats.capacity_required_periods,4);
  assert.equal(overCapacity.stats.capacity_available_periods,3);
});
