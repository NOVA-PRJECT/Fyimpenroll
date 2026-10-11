import {test} from 'vitest';
import assert from 'node:assert/strict';
import {entriesForDepartment} from '../src/core/utils/campusTimetable';

test('department views include every common campus paper without duplicating owned entries',()=>{
  const entries=[{id:'major',departmentId:'cs',category:'DSC'},
    {id:'other-major',departmentId:'eco',category:'DSC'},
    ...['MDC','SEC','VAC','AEC'].map(category=>({id:category,departmentId:'eco',category})),
    {id:'owned-aec',departmentId:'cs',category:'AEC'}];
  assert.deepEqual(entriesForDepartment(entries,'cs').map(e=>e.id),['major','MDC','SEC','VAC','AEC','owned-aec']);
  assert.equal(entriesForDepartment(entries,'eco').filter(e=>e.id==='MDC').length,1);
});

test('department code aliases remain supported and uncategorized entries stay scoped',()=>{
  const entries=[{id:'alias',departmentId:'legacy',departmentCode:'CS'},
    {id:'other',departmentId:'other'}, {id:'common',departmentId:'other',category:' aec '}];
  assert.deepEqual(entriesForDepartment(entries,'cs','cs').map(e=>e.id),['alias','common']);
});
