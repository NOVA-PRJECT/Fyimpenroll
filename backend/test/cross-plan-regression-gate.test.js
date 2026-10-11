const {test}=require('node:test')
const assert=require('node:assert/strict')
const {AuthorizationPolicy}=require('../dist/core/auth/authorization-policy')
const {registrationCompletion}=require('../dist/modules/credit-ledger/enrollment-reporting')
const {sanitizeSpreadsheetValue}=require('../dist/modules/credit-ledger/export.service')
const {parseKuCourseCode}=require('../dist/modules/credit-ledger/credit-ledger.constants')
// Detailed service, SQL, real Python solver, and frontend tests are separate suites
// run by test:all. These assertions import shared production contracts.
test('resource policy rejects missing and foreign campus authority',()=>{
 assert.throws(()=>AuthorizationPolicy.assertCampusScope({userId:'d',role:'campus_director'},'other'))
 assert.throws(()=>AuthorizationPolicy.assertCampusScope({userId:'d',role:'campus_director',campus_id:'home'},'other'))
})
test('research completion and optional-slot boundaries share the reporting contract',()=>{
 const pathways=[{id:'research',slots:[{slot:1,rule:'FIXED'}]}]
 assert.equal(registrationCompletion({pathway_id:'research',slot_1_course_id:'r'},pathways).state,'Allocated')
 assert.equal(registrationCompletion({pathway_id:'research',slot_7_course_id:'a',slot_8_course_id:'b'},pathways).state,'Unresolved')
})
test('unknown academic levels and spreadsheet text stay explicit at release boundaries',()=>{
 assert.equal(parseKuCourseCode('KU03DSCCSE201').derivedLevelBand,'Unknown')
 assert.equal(sanitizeSpreadsheetValue('=1+1'),"'=1+1")
 assert.equal(sanitizeSpreadsheetValue(4),4)
})
