const {test}=require('node:test')
const assert=require('node:assert/strict')
const ExcelJS=require('exceljs'),Papa=require('papaparse')
const {ExportService}=require('../dist/modules/credit-ledger/export.service')
const {CreditLedgerService}=require('../dist/modules/credit-ledger/credit-ledger.service')
const {AttendanceExportService}=require('../dist/modules/period-attendance/attendance-export.service')
const {fetchAllPaginated}=require('../dist/core/database/pagination.util')
// Fake PostgREST transport only: production services perform all authorization,
// enrollment selection, arithmetic, pagination and serialization.
function transport(tables,cap=2){return {admin:{from(table){let checks=[],start=0,end=999
 const value=(row,key)=>key.split('.').reduce((v,k)=>v?.[k],row)
 const q={select(projection){
   if(table==='student_registrations')assert.ok(!projection.includes('created_at'))
   if(table==='campus_sign_ins')assert.ok(!/(^|,)sign_in_date/.test(projection))
   if(table==='timetable_entries')assert.ok(!projection.includes('faculty('))
   return q
 },eq(k,v){checks.push(r=>value(r,k)===v);return q},in(k,vs){checks.push(r=>vs.includes(value(r,k)));return q},
 gte(k,v){checks.push(r=>value(r,k)>=v);return q},lte(k,v){checks.push(r=>value(r,k)<=v);return q},
 or(expression){const terms=expression.split(',').map(t=>t.split('.eq.'));checks.push(r=>terms.some(([k,v])=>r[k]===v));return q},
 order(){return q},range(a,b){start=a;end=b;return q},
 single:async()=>({data:rows()[0]||null,error:null}),maybeSingle:async()=>({data:rows()[0]||null,error:null}),
 then(resolve,reject){return Promise.resolve({data:rows().slice(start,Math.min(end+1,start+cap)),error:null}).then(resolve,reject)}}
 function rows(){return [...(tables[table]||[])].filter(r=>checks.every(c=>c(r))).sort((a,b)=>String(a.id).localeCompare(String(b.id)))}return q
 }}}}
function fixture(){
 const student={id:'s',full_name:'=HYPERLINK("bad")',cap_application_number:'CAP1',campus_id:'host',department_id:'dept',current_semester:9,departments:{id:'dept',name:'Home'},campuses:{id:'host',name:'Host'}}
 const course={id:'a',course_code:'KU09DSCCSE201',title:'Foreign-owned',credits:99,category:'DSC',department_id:'foreign',academic_level:null}
 const registration={id:'reg',student_id:'s',students:student,semester:9,academic_year:'2026-27',pathway_id:'research',submitted_at:'2026-07-01',slot_1_course_id:'a',slot_7_course_id:'b',selections:[{course_id:'a',slot:1,credits:4},{course_id:'removed',credits:100}]}
 const slot={id:'tt1',campus_id:'host',teacher_id:'visiting',course_id:'a',semester:9,academic_year:'2026-27',status:'published',time_slots:{day_of_week:1,period_number:1},courses:course,campuses:student.campuses,departments:student.departments}
 const tables={students:[student],courses:[course,{...course,id:'b',course_code:'KU09AECCSE201',title:'Additional',credits:3}],
 student_registrations:[registration],semester_blueprints:[{id:'bp',department_id:'dept',semester:9,pathways:[{id:'research',slots:[{slot:1,rule:'FIXED'}]}]}],
 teacher_course_assignments:[{id:'ta',teacher_id:'visiting',course_id:'a',campus_id:'host',semester:9,academic_year:'2026-27'}],
 faculty:[{id:'visiting',full_name:'Visiting Teacher'}],departments:[{id:'dept',name:'Home',code:'H',campus_id:'host'}],campus_settings:[{id:'cs',campus_id:'host',academic_year:'2026-27'}],
 timetable_entries:[slot,{...slot,id:'other-slot',campus_id:'other',teacher_id:'other-teacher'}],
 period_attendance:[{id:'mark1',student_id:'s',course_id:'a',timetable_slot_id:'tt1',attendance_date:'2026-09-07',status:'present',marked_at:'2026-09-07T10:00:00Z',students:student,timetable_entries:slot}],
 campus_sign_ins:[{id:'gps',campus_id:'host',signed_in_date:'2026-09-07',signed_in_at:'2026-09-07T03:30:00Z',session_type:'morning',status:'on_time',source:'gps',students:student,campuses:student.campuses}]}
 const db=transport(tables),ledger=new CreditLedgerService(db)
 return {tables,db,ledger,exports:new ExportService(db,ledger),student,slot,registration}
}
const admin={userId:'admin',role:'superadmin'},teacher={userId:'visiting',role:'teacher',campus_id:'other',department_id:'foreign'}
test('every operational export serializes JSON, CSV and parsed XLSX with schema-correct data',async()=>{
 const f=fixture()
 const jobs=[['exportFinalRegistrations',{}],['exportUnresolvedAllocations',{}],['exportCampusClassRoster',{course_id:'a'}],['exportTimetable',{}],['exportPeriodAttendance',{}],['exportGpsSignIns',{}]]
 for(const [method,query] of jobs){
  const json=await f.exports[method]({...query,format:'json'},admin)
  for(const format of ['csv','xlsx']){
   const result=await f.exports[method]({...query,format},admin)
   if(format==='csv'){const parsed=Papa.parse(result.buffer.toString(),{header:true,skipEmptyLines:true});assert.equal(parsed.data.length,json.count)}
   else{const book=new ExcelJS.Workbook();await book.xlsx.load(result.buffer);assert.equal(book.worksheets[0].actualRowCount,json.count?json.count+1:0)}
  }
 }
 const roster=await f.exports.exportCampusClassRoster({course_id:'a'},teacher)
 assert.equal(roster.data[0]['Assigned Teacher'],'Visiting Teacher')
 const csv=await f.exports.exportFinalRegistrations({format:'csv'},admin)
 assert.ok(Papa.parse(csv.buffer.toString(),{header:true}).data[0]['Student Name'].startsWith("'="))
 const ledger=await f.exports.exportCreditLedger('s',admin,'xlsx');const book=new ExcelJS.Workbook();await book.xlsx.load(ledger.buffer);assert.equal(book.worksheets[0].actualRowCount,3)
})
test('pathway completion uses required slots; optional papers cannot cover a missing required slot',async()=>{
 const f=fixture();assert.equal((await f.exports.exportFinalRegistrations({},admin)).data[0]['Allocation State'],'Allocated')
 assert.equal((await f.exports.exportUnresolvedAllocations({},admin)).count,0)
 f.tables.semester_blueprints[0].pathways[0].slots.push({slot:2,rule:'FIXED'})
 const missing=await f.exports.exportUnresolvedAllocations({},admin)
 assert.equal(missing.data[0]['Missing Required Slots'],'Slot 2')
})
test('ledger excludes removed selections, preserves snapshots and withholds unapproved degree judgments',async()=>{
 const f=fixture(),ledger=await f.ledger.getCreditLedger('s',admin)
 assert.deepEqual(ledger.registeredCourses.map(c=>c.id),['a','b'])
 assert.equal(ledger.totalRegisteredCredits,7);assert.equal(ledger.registeredCourses[0].levelBand,'Unknown')
 assert.equal(ledger.exitEligibility.threeYear.eligible,null);assert.equal(ledger.historicalSnapshotsComplete,false)
 const scoped=await f.ledger.getCreditLedger('s',teacher);assert.deepEqual(scoped.registeredCourses.map(c=>c.id),['a'])
 await assert.rejects(f.ledger.getCreditLedger('s',{...teacher,userId:'unassigned'}),/No assigned/)
})
test('teacher and student timetables exclude another campus delivery of the same catalogue course',async()=>{
 const f=fixture()
 assert.equal((await f.exports.exportTimetable({},teacher)).count,1)
 assert.equal((await f.exports.exportTimetable({},{userId:'s',role:'student',campus_id:'host',current_semester:9})).count,1)
 assert.equal((await f.exports.exportFinalRegistrations({},teacher)).data[0]['Paper 7'],'')
 await assert.rejects(f.exports.exportGpsSignIns({},teacher),/not authorized/)
})
test('statement includes cross-department/additional courses and uses 1/10 weighted marked periods, with NA for no data',async()=>{
 const f=fixture();f.registration.slot_8_course_id='c';f.tables.courses.push({id:'c',course_code:'NO_DATA',title:'No marks',credits:2})
 for(let i=0;i<9;i++)f.tables.period_attendance.push({id:'b'+i,student_id:'s',course_id:'b',timetable_slot_id:'ttb',attendance_date:`2026-09-${String(i+1).padStart(2,'0')}`,status:'absent',timetable_entries:{...f.slot,id:'ttb',course_id:'b'}})
 f.tables.period_attendance.push({id:'foreign',student_id:'s',course_id:'a',timetable_slot_id:'foreign',attendance_date:'2026-09-01',status:'absent',timetable_entries:{...f.slot,campus_id:'other'}})
 f.db.admin.rpc=(name,args)=>{assert.equal(name,'attendance_student_course_counts');assert.equal(args.p_campus_id,'host');assert.equal(args.p_academic_year,'2026-27');return transport({counts:[{id:'a',student_id:'s',course_id:'a',conducted:1,present:1},{id:'b',student_id:'s',course_id:'b',conducted:9,present:0}]}).admin.from('counts')}
 const result=await new AttendanceExportService(f.db).generateAttendanceStatement({userId:'hod',role:'hod',department_id:'dept',campus_id:'host'},9)
 const book=new ExcelJS.Workbook();await book.xlsx.load(result.buffer);const sheet=book.worksheets[0]
 assert.deepEqual(sheet.getRow(5).values.slice(4),[100,0,'NA',10])
})
test('complete-data traversal follows actual capped response size and fails explicitly at safety limit',async()=>{
 const rows=Array.from({length:1205},(_,i)=>({id:String(i).padStart(5,'0')}))
 const result=await fetchAllPaginated(transport({records:rows},137).admin.from('records').select('*').order('id'))
 assert.equal(result.length,1205);assert.equal(new Set(result.map(r=>r.id)).size,1205)
 await assert.rejects(fetchAllPaginated(transport({records:rows},100).admin.from('records'),100,100),/safety limit/)
})
