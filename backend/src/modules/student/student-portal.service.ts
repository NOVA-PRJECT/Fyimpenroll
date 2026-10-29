import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { SupabaseService } from '../../core/database/supabase.service'
import { fetchAllPaginated, fetchByIdChunks } from '../../core/database/pagination.util'
import { AuthUser } from '../../core/auth/types'
import { CampusAttendanceService } from '../campus-attendance/campus-attendance.service'

const slotColumns = Array.from({ length: 8 }, (_, index) => `slot_${index + 1}_course_id`)
const percentage = (present: number, total: number) => total ? Math.round(present / total * 1000) / 10 : null

@Injectable()
export class StudentPortalService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly campusAttendance: CampusAttendanceService,
  ) {}

  private async context(user: AuthUser, requestedSemester?: string) {
    const { data: student, error } = user.role === 'student' && user.campus_id && user.department_id && user.current_semester
      ? { data: { id: user.userId, campus_id: user.campus_id, department_id: user.department_id, current_semester: user.current_semester }, error: null }
      : await this.supabase.admin.from('students')
      .select('id, campus_id, department_id, current_semester').eq('id', user.userId).maybeSingle()
    if (error) throw new InternalServerErrorException('Unable to load student profile.')
    if (!student) throw new NotFoundException('Student profile not found.')
    const semester = requestedSemester === undefined ? Math.min(student.current_semester, 10) : Number(requestedSemester)
    if (!Number.isInteger(semester) || semester < 1 || semester > 10) {
      throw new BadRequestException('Semester must be an integer between 1 and 10.')
    }
    const { data: settings, error: settingsError } = user.verifiedCampusSettings
      ? { data: user.verifiedCampusSettings, error: null } : await this.supabase.admin.from('campus_settings')
      .select('academic_year, term_version').eq('campus_id', student.campus_id).maybeSingle()
    if (settingsError || !settings?.academic_year) throw new InternalServerErrorException('Campus academic year is not configured.')
    let query = this.supabase.admin.from('student_registrations')
      .select('id, campus_id, academic_year, term_version, slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id')
      .eq('student_id', user.userId).eq('semester', semester)
    if (semester === student.current_semester) query = query.eq('academic_year', settings.academic_year)
    const { data: registration, error: registrationError } = await query
      .order('academic_year', { ascending: false }).order('term_version', { ascending: false }).limit(1).maybeSingle()
    if (registrationError) throw new InternalServerErrorException('Unable to load course registration.')
    const courseIds = [...new Set<string>(slotColumns.map(key => registration?.[key]).filter(Boolean))]
    return {
      student, semester, courseIds,
      campusId: registration?.campus_id || student.campus_id,
      academicYear: registration?.academic_year || settings.academic_year,
      termVersion: registration?.term_version ?? settings.term_version,
      isCurrent: semester === student.current_semester && (!registration || (registration.academic_year === settings.academic_year && registration.term_version === settings.term_version)),
    }
  }

  private async coursesFor(context: Awaited<ReturnType<StudentPortalService['context']>>, selectedCourse?: string) {
    const courseIds = selectedCourse ? context.courseIds.filter(id => id === selectedCourse) : context.courseIds
    if (!courseIds.length) return []
    const [courseResult, assignments] = await Promise.all([
      this.supabase.admin.from('courses').select('id, course_code, title, credits, category, prerequisites')
        .in('id', courseIds).order('course_code'),
      fetchAllPaginated<any>(this.supabase.admin.from('teacher_course_assignments')
        .select('id, course_id, teacher_id')
        .in('course_id', courseIds).eq('campus_id', context.campusId)
        .eq('academic_year', context.academicYear).eq('term_version', context.termVersion).eq('semester', context.semester).order('id')),
    ])
    if (courseResult.error) throw new InternalServerErrorException('Unable to load enrolled courses.')
    const faculty = await fetchByIdChunks<{ id: string; full_name: string }>(assignments.map(a => a.teacher_id), ids =>
      this.supabase.admin.from('faculty').select('id, full_name').in('id', ids).order('id'), true)
    const facultyNames = new Map(faculty.map(teacher => [teacher.id, teacher.full_name]))
    return (courseResult.data || []).map(course => ({
      id: course.id, code: course.course_code, title: course.title, credits: Number(course.credits), category: course.category,
      faculty_name: [...new Set(assignments.filter(a => a.course_id === course.id).map(a => facultyNames.get(a.teacher_id)).filter(Boolean))].join(', ') || null,
      prerequisite_points: course.prerequisites || [],
    }))
  }

  async courses(user: AuthUser, semester?: string) {
    return this.coursesFor(await this.context(user, semester))
  }

  async course(user: AuthUser, courseId: string, semester?: string) {
    const course = (await this.coursesFor(await this.context(user, semester), courseId)).find(item => item.id === courseId)
    if (!course) throw new NotFoundException('Course is not in your selected semester registration.')
    return { ...course, prerequisites: course.prerequisite_points.join('; ') || null }
  }

  private async attendanceFor(user: AuthUser, context: Awaited<ReturnType<StudentPortalService['context']>>): Promise<{
    overall_percentage: number | null; courses: { course_id: string; course_code: string; course_title: string; attended_classes: number; total_classes: number; percentage: number | null }[];
    cleared?: boolean; message?: string;
  }> {
    const courses = await this.coursesFor(context)
    if (!context.isCurrent) return { overall_percentage: null, courses: [], cleared: true, message: 'Attendance for this concluded term has been cleared.' }
    if (!courses.length) return { overall_percentage: null, courses: [] }
    const { data, error } = await this.supabase.admin.rpc('attendance_student_course_counts', {
      p_student_ids: [user.userId], p_campus_id: context.campusId,
      p_academic_year: context.academicYear, p_semester: context.semester,
    })
    if (error || !data) throw new InternalServerErrorException('Unable to load attendance totals.')
    const counts = new Map<string, any>(data.map(row => [row.course_id, row]))
    const result = courses.map(course => {
      const row = counts.get(course.id)
      const present = Number(row?.present || 0), total = Number(row?.conducted || 0)
      return { course_id: course.id, course_code: course.code, course_title: course.title,
        attended_classes: present, total_classes: total, percentage: percentage(present, total) }
    })
    return { overall_percentage: percentage(result.reduce((sum, row) => sum + row.attended_classes, 0),
      result.reduce((sum, row) => sum + row.total_classes, 0)), courses: result }
  }

  async attendance(user: AuthUser, semester?: string) {
    return this.attendanceFor(user, await this.context(user, semester))
  }

  private async timetableFor(context: Awaited<ReturnType<StudentPortalService['context']>>) {
    if (!context.courseIds.length) return []
    const rows = await fetchAllPaginated<any>(this.supabase.admin.from('timetable_entries')
      .select('id, course_id, teacher_id, time_slots(day_of_week, period_number, start_time, end_time), courses(course_code, title)')
      .in('course_id', context.courseIds).eq('campus_id', context.campusId)
      .eq('academic_year', context.academicYear).eq('term_version', context.termVersion).eq('semester', context.semester).eq('status', 'published').order('id'))
    const teacherIds = [...new Set<string>(rows.map(row => row.teacher_id).filter(Boolean))]
    const faculty = teacherIds.length ? await this.supabase.admin.from('faculty').select('id, full_name').in('id', teacherIds) : { data: [], error: null }
    if (faculty.error) throw new InternalServerErrorException('Unable to load timetable faculty.')
    const names = new Map((faculty.data || []).map(teacher => [teacher.id, teacher.full_name]))
    return rows.map(row => ({
      id: row.id, day_of_week: row.time_slots.day_of_week, period_index: row.time_slots.period_number,
      start_time: row.time_slots.start_time, end_time: row.time_slots.end_time,
      course_code: row.courses.course_code, course_title: row.courses.title,
      faculty_name: names.get(row.teacher_id) || null,
    })).sort((a, b) => a.day_of_week - b.day_of_week || a.period_index - b.period_index)
  }

  async timetable(user: AuthUser, semester?: string) {
    return this.timetableFor(await this.context(user, semester))
  }

  async overview(user: AuthUser, semester?: string) {
    const context = await this.context(user, semester)
    const [attendance, timetable, status] = await Promise.all([
      this.attendanceFor(user, context), context.isCurrent ? this.timetableFor(context) : Promise.resolve([]),
      this.campusAttendance.getStudentCampusStatus(user, user.userId),
    ])
    const day = new Date(`${status.date}T00:00:00Z`).getUTCDay() || 7
    return {
      todaySlots: timetable.filter(slot => slot.day_of_week === day),
      attendanceSummary: {
        overallPercentage: attendance.overall_percentage,
        totalPresent: attendance.courses.reduce((sum, row) => sum + row.attended_classes, 0),
        totalClasses: attendance.courses.reduce((sum, row) => sum + row.total_classes, 0),
        campusSignInStatus: { morning: status.morning.state, evening: status.evening.state },
      },
    }
  }
}
