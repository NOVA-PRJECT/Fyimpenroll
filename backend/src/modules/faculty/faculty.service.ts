import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { enrollmentCounts } from '../../core/database/enrollment-counts'
import { SupabaseService } from '../../core/database/supabase.service'
import { fetchAllPaginated, fetchByIdChunks } from '../../core/database/pagination.util'
import { AuthUser } from '../../core/auth/types'

@Injectable()
export class FacultyService {
  constructor(
    private readonly supabase: SupabaseService,
  ) {}

  async getCourses(user: AuthUser) {
    const { data: faculty } = await this.supabase.admin
      .from('faculty')
      .select('full_name, role, department_id')
      .eq('id', user.userId)
      .single()

    let courseList: any[] = []
    let deptIds: string[] = []

    if (user.role === 'teacher') {
      const assignments = await fetchAllPaginated<any>(this.supabase.admin
        .from('current_teacher_course_assignments')
        .select('id, course_id, campus_id, academic_year, semester, courses(id, course_code, title, semester, department_id, credits, category)')
        .eq('teacher_id', user.userId).order('id'))
      const settings = await fetchByIdChunks<any>(assignments.map(a => a.campus_id).filter(Boolean), ids =>
        this.supabase.admin.from('campus_settings').select('campus_id, academic_year').in('campus_id', ids).order('campus_id'))
      const years = new Map(settings.map(s => [s.campus_id, s.academic_year]))
      courseList = assignments.filter(a => a.campus_id && a.academic_year === years.get(a.campus_id) && a.courses)
        .map(a => ({ ...a.courses, delivery_id: a.id, campus_id: a.campus_id, academic_year: a.academic_year, semester: a.semester }))
      deptIds = [...new Set(courseList.map(c => c.department_id))]
    } else {
      // General teaching staff / department view
      const depts = await fetchAllPaginated<any>(this.supabase.admin
        .from('departments').select('id, name, code')
        .eq('campus_id', user.campus_id).order('id'))

      deptIds = (depts ?? []).map((d) => d.id)

      if (deptIds.length > 0) {
        const courses = await fetchByIdChunks<any>(deptIds, ids => this.supabase.admin
          .from('courses').select('id, course_code, title, semester, department_id, credits, category')
          .in('department_id', ids).order('id'))

        courseList = courses || []
      }
    }

    const depts = await fetchByIdChunks<any>(deptIds, ids => this.supabase.admin
      .from('departments').select('id, name, code').in('id', ids).order('id'), true)

    const { data: campusSettings } = await this.supabase.admin
      .from('campus_settings')
      .select('academic_year')
      .eq('campus_id', user.campus_id)
      .single()

    const academicYear = campusSettings?.academic_year ?? ''
    const enrolledCounts = await enrollmentCounts(this.supabase.admin, courseList.filter(course => (course.campus_id || user.campus_id) && (course.academic_year || academicYear)).map(course => ({
      key: course.delivery_id || course.id, course_id: course.id, campus_id: course.campus_id || user.campus_id,
      academic_year: course.academic_year || academicYear, semester: course.semester,
    })))

    const coursesWithCounts = (courseList ?? []).map((course) => ({
      ...course,
      enrolled_count: enrolledCounts[course.delivery_id || course.id] || 0,
    }))

    return {
      teacherName: faculty?.full_name ?? '',
      role: user.role,
      departments: depts ?? [],
      courses: coursesWithCounts,
      isIndividualTeacher: user.role === 'teacher',
    }
  }

  async getClassRoster(courseId: string, user: AuthUser, deliveryId?: string) {
    let deliveryCampusId = user.campus_id;
    let delivery: any;
    if (user.role === 'teacher') {
      if (!deliveryId) throw new BadRequestException('Select an assigned course delivery');
      const { data, error } = await this.supabase.admin.from('current_teacher_course_assignments')
        .select('id, campus_id, academic_year, semester').eq('id', deliveryId)
        .eq('teacher_id', user.userId).eq('course_id', courseId).maybeSingle();
      if (error) throw new InternalServerErrorException('Could not verify teaching assignment');
      if (!data?.campus_id) throw new ForbiddenException('You are not assigned to this delivery');
      delivery = data;
      deliveryCampusId = data.campus_id;
    }
    if (!deliveryCampusId) throw new BadRequestException('Campus ID missing');
    const { data: campusSettings, error: settingsError } = await this.supabase.admin.from('campus_settings')
      .select('academic_year').eq('campus_id', deliveryCampusId).maybeSingle();
    if (settingsError || !campusSettings?.academic_year) throw new InternalServerErrorException('Current academic year unavailable');
    const academicYear = campusSettings.academic_year;
    if (delivery && delivery.academic_year !== academicYear) throw new ForbiddenException('This assignment is not for the current academic year');

    const { data: course, error: courseError } = await this.supabase.admin
      .from('courses')
      .select('id, title, course_code, department_id, semester')
      .eq('id', courseId)
      .single();

    if (courseError || !course) {
      throw new NotFoundException('Course not found');
    }

    // R06: Do NOT reject visiting faculty or cross-campus catalogue courses where courseDept.campus_id !== user.campus_id!
    // For HOD, verify authority over their own department
    if (user.role === 'hod' && user.department_id && course.department_id !== user.department_id) {
      throw new ForbiddenException('Course does not belong to your department');
    }

    const slotFields = [
      'slot_1_course_id',
      'slot_2_course_id',
      'slot_3_course_id',
      'slot_4_course_id',
      'slot_5_course_id',
      'slot_6_course_id',
      'slot_7_course_id',
      'slot_8_course_id',
    ];
    const orClause = slotFields.map((field) => `${field}.eq.${courseId}`).join(',');

    let regQuery = this.supabase.admin
      .from('current_student_registrations')
      .select(`
        student_id,
        pathway_id,
        slot_1_course_id,
        slot_2_course_id,
        slot_3_course_id,
        slot_4_course_id,
        slot_5_course_id,
        slot_6_course_id,
        slot_7_course_id,
        slot_8_course_id
      `)
      .eq('academic_year', academicYear)
      .eq('semester', delivery?.semester ?? course.semester)
      .order('id')
      .or(orClause);

    if (deliveryCampusId) {
      regQuery = regQuery.eq('campus_id', deliveryCampusId);
    }

    const registrations = await fetchAllPaginated<any>(regQuery);
    const regError = null;

    if (regError) {
      throw new InternalServerErrorException('Failed to fetch registrations');
    }

    if (!registrations || registrations.length === 0) {
      return {
        course,
        total_students: 0,
        department_breakdown: {},
        students: [],
      };
    }

    const studentIds = registrations.map((r: any) => r.student_id);
    const studentPathwayMap = new Map(
      registrations.map((r: any) => [r.student_id, r.pathway_id ?? null]),
    );

    const students = await fetchByIdChunks<any>(studentIds, ids => this.supabase.admin.from('students')
      .select('id, full_name, campus_id, departments (name, code)').in('id', ids)
      .eq('campus_id', deliveryCampusId).order('id'), true);

    const departmentBreakdown: Record<string, number> = {}
    students.forEach((student: any) => {
      const deptName = student.departments?.name ?? 'Unknown'
      departmentBreakdown[deptName] = (departmentBreakdown[deptName] ?? 0) + 1
    })

    const roster = students.map((student: any) => ({
      id: student.id,
      full_name: student.full_name,
      department: student.departments?.name ?? 'Unknown',
      department_code: student.departments?.code ?? '',
      pathway: studentPathwayMap.get(student.id) ?? 'Default',
    }))

    roster.sort((a, b) => {
      const deptA = (a.department_code || a.department).toUpperCase()
      const deptB = (b.department_code || b.department).toUpperCase()
      if (deptA !== deptB) return deptA.localeCompare(deptB)
      return a.full_name.localeCompare(b.full_name)
    })

    return {
      course,
      total_students: roster.length,
      department_breakdown: departmentBreakdown,
      students: roster,
    }
  }

  async getDefaulters(semester: number | undefined, user: AuthUser) {
    const campusId = user.campus_id
    const departmentId = user.department_id

    if (!campusId || !departmentId) {
      throw new BadRequestException('Campus or department assignment missing')
    }

    let studentsQuery = this.supabase.admin
      .from('students')
      .select('id, full_name, current_semester')
      .lt('current_semester', 11)
      .eq('department_id', departmentId)
      .eq('campus_id', campusId)
      .order('current_semester', { ascending: true })
      .order('full_name', { ascending: true })

    if (semester !== undefined) {
      studentsQuery = studentsQuery.eq('current_semester', semester)
    }

    const [settingsRes, studentsRes] = await Promise.all([
      this.supabase.admin
        .from('campus_settings')
        .select('academic_year')
        .eq('campus_id', campusId)
        .maybeSingle(),
      fetchAllPaginated<any>(studentsQuery.order('id')),
    ])

    if (settingsRes.error || !settingsRes.data?.academic_year) throw new InternalServerErrorException('Current academic year unavailable')
    const academicYear = settingsRes.data.academic_year
    const students = studentsRes

    if (students.length === 0) {
      return {
        academic_year: academicYear,
        total_students: 0,
        submitted_count: 0,
        students: [],
      }
    }

    const registrations = await fetchByIdChunks<any>(students.map(s => s.id), ids => this.supabase.admin
      .from('current_student_registrations').select('id, student_id, semester, academic_year, submitted_at, slot_1_course_id')
      .in('student_id', ids).eq('academic_year', academicYear).eq('campus_id', campusId).order('id'))

    // A registration is valid if submitted_at is set or slot_1 is filled
    const validRegistrations = (registrations ?? []).filter((r: any) => {
      return r.submitted_at != null || r.slot_1_course_id != null
    })

    const submittedSet = new Set(validRegistrations.map((r: any) => `${r.student_id}:${r.semester}`))

    const enriched = students.map((s: any) => {
      const targetSem = semester !== undefined ? semester : s.current_semester
      const isSubmitted = submittedSet.has(`${s.id}:${targetSem}`) || submittedSet.has(`${s.id}:${s.current_semester}`)
      return {
        id: s.id,
        full_name: s.full_name,
        current_semester: s.current_semester,
        submitted: isSubmitted,
      }
    })

    const submittedCount = enriched.filter((s: any) => s.submitted).length

    return {
      academic_year: academicYear,
      total_students: enriched.length,
      submitted_count: submittedCount,
      students: enriched,
    }
  }
}
