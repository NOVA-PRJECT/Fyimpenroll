import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'
import * as Papa from 'papaparse'
import { SupabaseService } from '../../core/database/supabase.service'
import { AuthUser } from '../../core/auth/types'
import { fetchAllPaginated, fetchByIdChunks } from '../../core/database/pagination.util'
import { CreditLedgerService } from './credit-ledger.service'
import { registrationCompletion, registrationSlots } from './enrollment-reporting'

export function sanitizeSpreadsheetValue(value: any): any {
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return value
  const text = String(value)
  return /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text
}
type Query = { semester?: number; academic_year?: string; campus_id?: string; department_id?: string;
  course_id?: string; date?: string; start_date?: string; end_date?: string; format?: 'csv'|'xlsx'|'json' }

@Injectable()
export class ExportService {
  constructor(private readonly supabase: SupabaseService, private readonly creditLedgerService: CreditLedgerService) {}
  private all(query: any): Promise<any[]> { return fetchAllPaginated<any>(query.order('id'), 1000, 20000) }
  private assertRole(user: AuthUser, roles: string[]) {
    if (!roles.includes(user.role)) throw new ForbiddenException('Role not authorized for this export')
    if (['hod','campus_director','teaching_staff','student'].includes(user.role) && !user.campus_id) throw new ForbiddenException('Campus affiliation required')
    if (user.role === 'hod' && !user.department_id) throw new ForbiddenException('Department affiliation required')
  }
  private async names(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))]
    const rows = await fetchByIdChunks<any>(unique, ids => this.supabase.admin.from('faculty').select('id,full_name').in('id',ids).order('id'))
    return new Map(rows.map(r => [r.id,r.full_name]))
  }
  private async deliveries(user: AuthUser, courseId?: string) {
    let q = this.supabase.admin.from('teacher_course_assignments').select('id,teacher_id,course_id,campus_id,academic_year,semester')
    if (user.role === 'teacher') q = q.eq('teacher_id',user.userId)
    if (courseId) q = q.eq('course_id',courseId)
    return this.all(q)
  }
  private deliveryMatches(delivery: any, reg: any, courseId: string) {
    return delivery.course_id === courseId && delivery.campus_id === reg.students?.campus_id && delivery.academic_year === reg.academic_year && delivery.semester === reg.semester
  }
  private async registrations(query: Query, user: AuthUser, roster = false) {
    this.assertRole(user, roster ? ['teacher','teaching_staff','hod','campus_director','superadmin'] : ['student','teacher','hod','campus_director','superadmin'])
    if (!query.academic_year && user.role === 'hod') {
      const { data, error } = await this.supabase.admin.from('campus_settings').select('academic_year').eq('campus_id', user.campus_id).single()
      if (error || !data?.academic_year) throw new NotFoundException('Current academic year unavailable')
      query = { ...query, academic_year: data.academic_year }
    }
    const buildQuery = () => {
      let q = this.supabase.admin.from('student_registrations')
        .select('*,students!student_registrations_student_id_fkey!inner(id,full_name,cap_application_number,campus_id,department_id,departments(id,name,code),campuses(id,name))')
      if (user.role === 'student') q = q.eq('student_id',user.userId)
      if (['hod','campus_director','teaching_staff'].includes(user.role)) q = q.eq('students.campus_id',user.campus_id)
      if (user.role === 'hod') q = q.eq('students.department_id',user.department_id)
      if (query.semester) q = q.eq('semester',query.semester)
      if (query.academic_year) q = q.eq('academic_year',query.academic_year)
      if (query.campus_id) q = q.eq('students.campus_id',query.campus_id)
      if (query.department_id) q = q.eq('students.department_id',query.department_id)
      if (query.course_id && user.role !== 'teacher') q = q.or(Array.from({length:8},(_,i)=>'slot_'+(i+1)+'_course_id.eq.'+query.course_id).join(','))
      return q
    }
    if (user.role !== 'teacher') return this.all(buildQuery())
    const deliveries = (await this.deliveries(user,query.course_id)).filter(d => d.campus_id && d.academic_year && d.semester &&
      (!query.campus_id || query.campus_id === d.campus_id) && (!query.academic_year || query.academic_year === d.academic_year) &&
      (!query.semester || query.semester === d.semester))
    const cohorts = new Map<string,any[]>()
    for (const d of deliveries) {
      const key = [d.campus_id,d.academic_year,d.semester].join('|')
      if (!cohorts.has(key)) cohorts.set(key,[])
      cohorts.get(key)!.push(d)
    }
    const rows = new Map<string,any>()
    for (const assignments of cohorts.values()) {
      const d = assignments[0], courseIds: string[] = [...new Set<string>(assignments.map(a=>a.course_id))]
      // Eight courses produce at most 64 UUID predicates, keeping API URLs bounded.
      for (let offset=0;offset<courseIds.length;offset+=8) {
        const predicates = courseIds.slice(offset,offset+8).flatMap(id=>Array.from({length:8},(_,i)=>'slot_'+(i+1)+'_course_id.eq.'+id))
        const page = await this.all(buildQuery().eq('students.campus_id',d.campus_id).eq('academic_year',d.academic_year)
          .eq('semester',d.semester).or(predicates.join(',')))
        for (const row of page) rows.set(row.id || [row.student_id,row.academic_year,row.semester].join('|'),row)
        if (rows.size>20000) throw new BadRequestException('Export exceeds the row limit. Select a narrower term or class.')
      }
    }
    const keys = new Set(deliveries.map(d=>[d.course_id,d.campus_id,d.academic_year,d.semester].join('|')))
    return [...rows.values()].map(r => {
      const scoped = {...r}
      for (let i=1;i<=8;i++) if (!keys.has([r['slot_'+i+'_course_id'],r.students?.campus_id,r.academic_year,r.semester].join('|'))) scoped['slot_'+i+'_course_id'] = null
      scoped.selections = (Array.isArray(r.selections) ? r.selections : r.selections?.courses || []).filter((s:any) => registrationSlots(scoped).some(slot => slot.courseId === (s.course_id || s.id)))
      return scoped
    }).filter(r => registrationSlots(r).length > 0)
  }
  private async completionData() {
    return this.all(this.supabase.admin.from('semester_blueprints').select('id,department_id,semester,pathways'))
  }
  private completion(reg: any, blueprints: any[]) {
    return registrationCompletion(reg,blueprints.find(b=>b.department_id===reg.students?.department_id && b.semester===reg.semester)?.pathways || [])
  }
  async exportFinalRegistrations(query: Query, user: AuthUser) {
    const regs = await this.registrations(query,user)
    const blueprints = await this.completionData()
    const ids = [...new Set(regs.flatMap(r=>registrationSlots(r).map(s=>s.courseId)))]
    const courses = await fetchByIdChunks<any>(ids, chunk => this.supabase.admin.from('courses').select('id,title,course_code,credits').in('id',chunk).order('id'))
    const map = new Map(courses.map(c=>[c.id,c]))
    const rows = regs.map(r=>{
      const row: Record<string,any> = {'Academic Year':r.academic_year,'Semester':r.semester,'Campus':r.students?.campuses?.name,
        'Department':r.students?.departments?.name,'Student Name':r.students?.full_name,'CAP App No':r.students?.cap_application_number}
      let core=0, additional=0, missingSnapshot=false
      const snapshots = Array.isArray(r.selections) ? r.selections : r.selections?.courses || []
      for(let i=1;i<=8;i++) {
        const c=map.get(r[`slot_${i}_course_id`])
        row[`Paper ${i}`]=c ? `${c.title} (${c.course_code})` : ''
        if(c) {
          const snapshot=snapshots.find((s:any)=>(s.course_id||s.id)===c.id && (s.slot==null || Number(s.slot)===i))
          missingSnapshot ||= snapshot?.credits == null
          const credits=Number(snapshot?.credits ?? c.credits)||0
          if(i<=6) core+=credits; else additional+=credits
        }
      }
      return {...row,'Core Credits':core,'Additional Credits':additional,'Total Credits':core+additional,
        'Credit Source':missingSnapshot?'Current catalogue fallback; historical snapshot missing':'Registration snapshots',
        'Allocation State':user.role==='teacher'?'Assigned class courses only':this.completion(r,blueprints).state}
    })
    return this.renderOutput(rows,'Final_Registrations',query.format)
  }
  async exportUnresolvedAllocations(query: Query,user: AuthUser) {
    this.assertRole(user,['hod','campus_director','superadmin'])
    const regs=await this.registrations(query,user), blueprints=await this.completionData()
    const rows=regs.flatMap(r=>{
      const c=this.completion(r,blueprints)
      return c.state==='Allocated'?[]:[{'Academic Year':r.academic_year,'Semester':r.semester,'Campus':r.students?.campuses?.name,
        'Department':r.students?.departments?.name,'Student Name':r.students?.full_name,'CAP App No':r.students?.cap_application_number,
        'Missing Required Slots':c.missingRequired.join(', '),'Missing Additional Slots':c.missingAdditional.join(', ')||'None',
        'First Submitted At':r.submitted_at,'Operational Status':c.state}]
    })
    return this.renderOutput(rows,'Unresolved_Allocations',query.format)
  }
  async exportCampusClassRoster(query: Query,user: AuthUser) {
    if(!query.course_id) throw new NotFoundException('Course ID required')
    const regs=await this.registrations(query,user,true)
    const {data:course,error}=await this.supabase.admin.from('courses').select('id,course_code,title').eq('id',query.course_id).single()
    if(error||!course) throw new NotFoundException('Course not found')
    const deliveries=await this.deliveries(user,query.course_id), names=await this.names(deliveries.map(d=>d.teacher_id))
    if(user.role==='teacher'&&!deliveries.length) throw new ForbiddenException('Teacher is not assigned to teach this course/class')
    const rows=regs.map(r=>({'Course Code':course.course_code,'Course Title':course.title,'Academic Year':r.academic_year,
      'Semester':r.semester,'Campus':r.students?.campuses?.name,'CAP App No':r.students?.cap_application_number,'Student Name':r.students?.full_name,
      'Home Department':r.students?.departments?.name,'Enrollment Type':registrationSlots(r).some(s=>s.courseId===course.id&&s.slot>=7)?'Additional / Elective':'Core',
      'Assigned Teacher':deliveries.filter(d=>this.deliveryMatches(d,r,course.id)).map(d=>names.get(d.teacher_id)||'Name unavailable').join(', ')||'Unassigned'}))
    return this.renderOutput(rows,`Class_Roster_${String(course.course_code).replace(/[^a-zA-Z0-9_-]/g,'_')}`,query.format)
  }
  async exportTimetable(query: Query,user: AuthUser) {
    this.assertRole(user,['student','teacher','teaching_staff','hod','campus_director','superadmin'])
    let q=this.supabase.admin.from('timetable_entries').select('id,campus_id,course_id,teacher_id,semester,academic_year,status,time_slots(day_of_week,period_number),courses(id,course_code,title),departments(id,name),campuses(id,name)')
    if(user.role==='teacher') q=q.eq('teacher_id',user.userId)
    if(['student','teaching_staff','hod','campus_director'].includes(user.role)) q=q.eq('campus_id',user.campus_id)
    if(user.role==='hod') q=q.eq('department_id',user.department_id)
    if(['student','teaching_staff'].includes(user.role)) q=q.eq('status','published')
    if(query.campus_id) q=q.eq('campus_id',query.campus_id)
    if(query.department_id) q=q.eq('department_id',query.department_id)
    if(query.semester) q=q.eq('semester',query.semester)
    if(query.academic_year) q=q.eq('academic_year',query.academic_year)
    let entries=await this.all(q)
    if(user.role==='student') {
      const regs=await this.registrations({...query,semester:query.semester||user.current_semester},user)
      entries=entries.filter(e=>regs.some(r=>r.semester===e.semester && r.academic_year===e.academic_year && registrationSlots(r).some(s=>s.courseId===e.course_id)))
    }
    const names=await this.names(entries.map(e=>e.teacher_id)), days=['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    const rows=entries.map(e=>({'Campus':e.campuses?.name,'Department':e.departments?.name,'Academic Year':e.academic_year,'Semester':e.semester,
      'Day':days[e.time_slots?.day_of_week]||'Unknown','Period':`Period ${e.time_slots?.period_number}`,'Course Code':e.courses?.course_code,'Course Title':e.courses?.title,
      'Assigned Teacher':e.teacher_id?names.get(e.teacher_id)||'Name unavailable':'Unassigned','Status':e.status==='published'?'Published':'[DRAFT]'}))
    return this.renderOutput(rows,'Timetable_Schedule',query.format)
  }
  async exportPeriodAttendance(query: Query,user: AuthUser) {
    this.assertRole(user,['teacher','hod','campus_director','superadmin'])
    if(user.role==='teacher' && query.course_id && !(await this.deliveries(user,query.course_id)).some(d=>d.course_id===query.course_id)) throw new ForbiddenException('Teacher is not assigned to teach this course')
    let q=this.supabase.admin.from('period_attendance').select('id,attendance_date,status,marked_at,students!inner(id,department_id,campus_id),timetable_entries!inner(id,campus_id,teacher_id,semester,academic_year,course_id,time_slots(day_of_week,period_number),courses(id,course_code,title))')
    if(user.role==='teacher') q=q.eq('timetable_entries.teacher_id',user.userId)
    if(['hod','campus_director'].includes(user.role)) q=q.eq('timetable_entries.campus_id',user.campus_id)
    if(user.role==='hod') q=q.eq('students.department_id',user.department_id)
    if(query.semester) q=q.eq('timetable_entries.semester',query.semester)
    if(query.academic_year) q=q.eq('timetable_entries.academic_year',query.academic_year)
    if(query.course_id) q=q.eq('timetable_entries.course_id',query.course_id)
    if(query.start_date) q=q.gte('attendance_date',query.start_date)
    if(query.end_date) q=q.lte('attendance_date',query.end_date)
    const marks=await this.all(q), sessions=new Map<string,any>()
    for(const m of marks) {
      const e=m.timetable_entries,key=`${e.id}_${m.attendance_date}`
      if(!sessions.has(key)) sessions.set(key,{'Date':m.attendance_date,'Campus ID':e.campus_id,'Academic Year':e.academic_year,'Semester':e.semester,
        'Course Code':e.courses?.course_code,'Course Title':e.courses?.title,'Period':`P${e.time_slots?.period_number}`,'Total Marked':0,'Present Count':0,'Absent Count':0,'As of Date':m.marked_at})
      const row=sessions.get(key)
      row['Total Marked']++; if(m.status==='present')row['Present Count']++; if(m.status==='absent')row['Absent Count']++
      if(m.marked_at>row['As of Date']) row['As of Date']=m.marked_at
    }
    const rows=[...sessions.values()].map(s=>({...s,'Session Percentage':`${Math.round(s['Present Count']/s['Total Marked']*100)}%`,'Denominator (Hours)':1}))
    return this.renderOutput(rows,'Period_Attendance_Summary',query.format)
  }
  async exportGpsSignIns(query: Query,user: AuthUser) {
    this.assertRole(user,['campus_director','superadmin'])
    if(user.role==='campus_director'&&query.campus_id&&query.campus_id!==user.campus_id) throw new ForbiddenException('Campus outside scope')
    let q=this.supabase.admin.from('campus_sign_ins').select('id,signed_in_date,signed_in_at,session_type,status,source,campuses(id,name),students(id,full_name,cap_application_number,departments(id,name))')
    const campus=user.role==='campus_director'?user.campus_id:query.campus_id
    if(campus) q=q.eq('campus_id',campus)
    if(query.date) q=q.eq('signed_in_date',query.date)
    if(query.start_date) q=q.gte('signed_in_date',query.start_date)
    if(query.end_date) q=q.lte('signed_in_date',query.end_date)
    const rows=(await this.all(q)).map(r=>({'Campus':r.campuses?.name,'Sign-in Date':r.signed_in_date,'Student Name':r.students?.full_name,
      'CAP App No':r.students?.cap_application_number,'Department':r.students?.departments?.name,'Session':r.session_type,'Status':r.status,'Verification Source':r.source,'Recorded At':r.signed_in_at}))
    return this.renderOutput(rows,'GPS_Campus_Sign_Ins',query.format)
  }
  async exportCreditLedger(id:string,user:AuthUser,format?:'csv'|'xlsx'|'json') {
    const ledger=await this.creditLedgerService.getCreditLedger(id,user)
    const rows=ledger.registeredCourses.map(c=>({'Student Name':ledger.student.fullName,'CAP App No':ledger.student.capApplicationNumber,
      'Department':ledger.student.departmentName,'Academic Year':c.academicYear,'Semester':c.semester,'Course Code':c.courseCode,'Course Title':c.title,'Category':c.normalizedCategory,
      'Registered Credits':c.credits,'Credit Source':c.creditSource}))
    return this.renderOutput(rows,'Credit_Ledger',format,{totalRegisteredCredits:ledger.totalRegisteredCredits,
      advisoryMatrixVersion:ledger.advisoryMatrixVersion,disclaimer:ledger.disclaimer})
  }
  private async renderOutput(rows:Record<string,any>[],prefix:string,format?:'csv'|'xlsx'|'json',metadata?:Record<string,any>) {
    if(!format||format==='json') return {data:rows,count:rows.length,metadata}
    const safe=rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,sanitizeSpreadsheetValue(value)])))
    if(format==='csv') return {buffer:Buffer.from(Papa.unparse(safe),'utf8'),filename:`${prefix}.csv`,contentType:'text/csv; charset=utf-8'}
    const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet(prefix.slice(0,31))
    if(rows.length){sheet.addRow(Object.keys(rows[0]));for(const row of safe)sheet.addRow(Object.values(row))}
    sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];sheet.columns?.forEach(c=>{c.width=24})
    return {buffer:Buffer.from(await workbook.xlsx.writeBuffer()),filename:`${prefix}.xlsx`,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
  }
}
