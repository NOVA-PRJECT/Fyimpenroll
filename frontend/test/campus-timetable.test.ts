import {test} from 'vitest';
import assert from 'node:assert/strict';
import {entriesForDepartment} from '../src/core/utils/campusTimetable';

test('cohort grids and exports show both minors taught elsewhere and exclude unrelated owned courses',()=>{
  const entries=[{id:'major',departmentId:'it',category:'DSC',enrolledDepartmentIds:['it']},
    {id:'minor-one',departmentId:'math',category:'DSC',enrolledDepartmentIds:['it','math']},
    {id:'minor-two',departmentId:'stats',category:'DSC',enrolledDepartmentIds:['it']},
    {id:'owned-but-not-selected',departmentId:'it',category:'DSC',enrolledDepartmentIds:['math']},
    {id:'campus',departmentId:'stats',category:'MDC',enrolledDepartmentIds:['math']}];
  assert.deepEqual(entriesForDepartment(entries,'it').map(e=>e.id),['major','minor-one','minor-two']);
  assert.equal(entriesForDepartment(entries,'stats').some(e=>e.id==='minor-two'),false);
});

test('unscheduled minor sessions follow the same cohort filter as placed entries',()=>{
  const conflicts=[{id:'minor',departmentId:'stats',enrolledDepartmentIds:['it']},
    {id:'unrelated',departmentId:'it',enrolledDepartmentIds:['math']}];
  assert.deepEqual(entriesForDepartment(conflicts,'it').map(e=>e.id),['minor']);
});

test('legacy entries without enrollment metadata retain common paper and ownership fallback',()=>{
  const entries=[{id:'major',departmentId:'cs',category:'DSC'},
    {id:'other-major',departmentId:'eco',category:'DSC'},
    ...['MDC','SEC','VAC','AEC'].map(category=>({id:category,departmentId:'eco',category})),
    {id:'owned-aec',departmentId:'cs',category:'AEC'}];
  assert.deepEqual(entriesForDepartment(entries,'cs').map(e=>e.id),['major','MDC','SEC','VAC','AEC','owned-aec']);
  assert.equal(entriesForDepartment(entries,'eco').filter(e=>e.id==='MDC').length,1);
});

test.each(['MDC', 'SEC', 'VAC', 'AEC'])('%s slots show only papers selected by the department students', category => {
  const entries = [
    {id:'selected',category,departmentId:'stats',enrolledDepartmentIds:['it']},
    {id:'other-department-option',category,departmentId:'it',enrolledDepartmentIds:['math']},
    {id:'unselected',category,departmentId:'it',enrolledDepartmentIds:[]},
    {id:'selected-by-both',category,departmentId:'stats',enrolledDepartmentIds:['it','math']},
  ];
  assert.deepEqual(entriesForDepartment(entries,'it').map(e=>e.id),['selected','selected-by-both']);
  assert.deepEqual(entriesForDepartment(entries,'math').map(e=>e.id),['other-department-option','selected-by-both']);
});

test('department code aliases remain supported and uncategorized entries stay scoped',()=>{
  const entries=[{id:'alias',departmentId:'legacy',departmentCode:'CS'},
    {id:'other',departmentId:'other'}, {id:'common',departmentId:'other',category:' aec '}];
  assert.deepEqual(entriesForDepartment(entries,'cs','cs').map(e=>e.id),['alias','common']);
});
