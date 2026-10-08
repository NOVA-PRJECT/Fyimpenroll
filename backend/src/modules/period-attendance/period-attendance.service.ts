import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../../core/database/supabase.service';
import { AuditLoggerService } from '../../core/logging/audit-logger.service';
import { ServerLoggerService } from '../../core/logging/server-logger.service';
import { AuthUser } from '../../core/auth/types';
import { AuthorizationPolicy } from '../../core/auth/authorization-policy';
import { getISTDateTime } from '../../core/utils/date-time.util';
import { CopyPracticalDto } from './dto/copy-practical.dto';

@Injectable()
export class PeriodAttendanceService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService,
    private readonly serverLogger: ServerLoggerService,
  ) {}

  /**
   * Helper to convert time string (HH:MM:SS or HH:MM) to minutes from midnight.
   */
  private timeToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map((v) => parseInt(v, 10));
    return hours * 60 + (minutes || 0);
  }

  /**
   * Detects scheduled periods for the authenticated teacher today (IST),
   * showing running/upcoming periods and live marking status.
   * NOTE (Plan 07 / F43): Post-period 15-minute lockout is retired;
   * authorized teachers can mark or correct current-semester dates at any time.
   */
  async getCurrentPeriod(user: AuthUser) {
    // 1. Fetch teacher's assigned courses
    const { data: assignments, error: assignError } = await this.supabase.admin
      .from('teacher_course_assignments')
      .select('course_id')
      .eq('teacher_id', user.userId);

    if (assignError) {
      throw new InternalServerErrorException(`Failed to check assignments: ${assignError.message}`);
    }

    if (!assignments || assignments.length === 0) {
      return {
        active_slots: [],
        next_slot: null,
        message: 'No courses currently assigned to you. Contact your HOD.',
      };
    }

    const assignedCourseIds = assignments.map((a) => a.course_id);

    // 2. Determine today's day of week (1=Monday ... 7=Sunday) in IST
    const ist = getISTDateTime();
    const dayOfWeek = ist.dayOfWeek;
    const currentMinutes = ist.totalMinutes;

    // 3. Fetch published timetable entries for teacher's courses
    const { data: entries, error: entriesError } = await this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        academic_year,
        semester,
        session_type,
        is_lab_block,
        courses(id, course_code, title),
        time_slots(id, day_of_week, period_number, start_time, end_time),
        departments(campus_id)
      `)
      .in('course_id', assignedCourseIds)
      .eq('status', 'published');

    if (entriesError) {
      throw new InternalServerErrorException(`Failed to fetch timetable entries: ${entriesError.message}`);
    }

    const todayEntries = (entries || []).filter(
      (e: any) => e.time_slots?.day_of_week === dayOfWeek
    );

    // 4. Find slots that are currently active or scheduled today
    const candidateActiveEntries: { entry: any; slot: any }[] = [];
    let nextUpcomingSlot: any = null;
    let minUpcomingDiff = Infinity;

    for (const entry of todayEntries) {
      const slot = (entry as any).time_slots;
      if (!slot) continue;

      const startMin = this.timeToMinutes(slot.start_time);
      const endMin = this.timeToMinutes(slot.end_time);

      // Current running period or recently passed today
      if (currentMinutes >= startMin && currentMinutes <= endMin + 60) {
        candidateActiveEntries.push({ entry, slot });
      } else if (startMin > currentMinutes) {
        const diff = startMin - currentMinutes;
        if (diff < minUpcomingDiff) {
          minUpcomingDiff = diff;
          nextUpcomingSlot = {
            course_code: (entry as any).courses?.course_code,
            course_title: (entry as any).courses?.title,
            start_time: slot.start_time,
            end_time: slot.end_time,
            period_number: slot.period_number,
          };
        }
      }
    }

    // Fallback: If no slot is running in the current 60-min window, include all today's slots
    const targetSlots = candidateActiveEntries.length > 0
      ? candidateActiveEntries
      : todayEntries.map((entry: any) => ({ entry, slot: entry.time_slots }));

    // Batch fetch rosters and marking records concurrently for slots (F45 & F48)
    const activeSlots = await Promise.all(
      targetSlots.map(async ({ entry, slot }) => {
        const campusId = (entry as any).departments?.campus_id;
        const [roster, { data: existingMarks }] = await Promise.all([
          this.getEnrolledRoster(entry.course_id, entry.academic_year, campusId, entry.semester),
          this.supabase.admin
            .from('period_attendance')
            .select('student_id, status, marked_at')
            .eq('timetable_slot_id', entry.id)
            .eq('attendance_date', ist.dateString),
        ]);

        const markedMap = new Map((existingMarks || []).map((m: any) => [m.student_id, m.status]));
        const isMarked = (existingMarks || []).length > 0;

        return {
          timetable_slot_id: entry.id,
          course_id: entry.course_id,
          course_code: (entry as any).courses?.course_code,
          course_title: (entry as any).courses?.title,
          period_number: slot.period_number,
          start_time: slot.start_time,
          end_time: slot.end_time,
          is_marked: isMarked,
          roster: roster.map((s) => ({
            ...s,
            status: markedMap.get(s.id) || (isMarked ? 'present' : 'unmarked'),
          })),
        };
      })
    );

    return {
      active_slots: activeSlots,
      next_slot: nextUpcomingSlot,
      message:
        activeSlots.length === 0
          ? 'No active lecture period right now.'
          : `${activeSlots.length} lecture period(s) available for attendance.`,
    };
  }

  /**
   * Retrieves full scheduled periods for the teacher on a specific date (F48),
   * along with attendance marking status for that exact academic date.
   */
  async getTeacherSchedule(user: AuthUser, queryDate?: string) {
    // 1. Fetch teacher faculty profile
    const { data: faculty } = await this.supabase.admin
      .from('faculty')
      .select('id, full_name, department_id, campus_id, departments(name), campuses(name)')
      .eq('id', user.userId)
      .maybeSingle();

    // 2. Fetch assigned courses
    const { data: assignments, error: assignError } = await this.supabase.admin
      .from('teacher_course_assignments')
      .select('course_id, courses(id, course_code, title, category, semester, credits)')
      .eq('teacher_id', user.userId);

    if (assignError) {
      throw new InternalServerErrorException(`Failed to check assignments: ${assignError.message}`);
    }

    const assignedCourses = (assignments || []).map((a: any) => a.courses).filter(Boolean);
    const assignedCourseIds = assignedCourses.map((c: any) => c.id);

    // Determine target date and day of week in IST (F48)
    const ist = getISTDateTime();
    let dateStr = ist.dateString;
    let dayOfWeek = ist.dayOfWeek;

    if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
      dateStr = queryDate;
      const [y, m, d] = queryDate.split('-').map(Number);
      const parsedDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      const day = parsedDate.getUTCDay();
      dayOfWeek = day === 0 ? 7 : day;
    }

    if (assignedCourseIds.length === 0) {
      return {
        teacherName: faculty?.full_name || '',
        departmentName: (faculty as any)?.departments?.name || '',
        campusName: (faculty as any)?.campuses?.name || '',
        date: dateStr,
        dayOfWeek,
        assignedCourses: [],
        periods: [],
        weeklySchedule: [],
        message: 'No courses currently assigned to you. Contact your HOD.',
      };
    }

    // 3. Fetch published timetable entries for assigned courses
    const { data: entries, error: entriesError } = await this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        academic_year,
        semester,
        session_type,
        is_lab_block,
        courses(id, course_code, title, category, semester, credits),
        time_slots(id, day_of_week, period_number, start_time, end_time),
        departments(campus_id)
      `)
      .in('course_id', assignedCourseIds)
      .eq('status', 'published');

    if (entriesError) {
      throw new InternalServerErrorException(`Failed to fetch timetable entries: ${entriesError.message}`);
    }

    const weeklySchedule = (entries || []).map((entry: any) => ({
      timetable_slot_id: entry.id,
      course_id: entry.course_id,
      course_code: entry.courses?.course_code || '',
      course_title: entry.courses?.title || '',
      course_category: entry.courses?.category || '',
      course_semester: entry.courses?.semester || 1,
      credits: entry.courses?.credits,
      is_lab_block: entry.is_lab_block || false,
      session_type: entry.session_type || 'theory',
      day_of_week: entry.time_slots?.day_of_week,
      period_number: entry.time_slots?.period_number,
      start_time: entry.time_slots?.start_time || '',
      end_time: entry.time_slots?.end_time || '',
    }));

    const dayEntries = (entries || []).filter(
      (e: any) => e.time_slots?.day_of_week === dayOfWeek
    );

    // 4. Check marking status for each slot strictly on dateStr (F46, F48)
    const periodsWithStatus = await Promise.all(
      dayEntries.map(async (entry: any) => {
        const slot = entry.time_slots;
        const campusId = (entry as any).departments?.campus_id;

        const [roster, { data: marks }] = await Promise.all([
          this.getEnrolledRoster(entry.course_id, entry.academic_year, campusId, entry.semester),
          this.supabase.admin
            .from('period_attendance')
            .select('student_id, status, marked_at')
            .eq('timetable_slot_id', entry.id)
            .eq('attendance_date', dateStr),
        ]);

        const isMarked = (marks || []).length > 0;
        const presentCount = (marks || []).filter((m: any) => m.status === 'present').length;
        const absentCount = (marks || []).filter((m: any) => m.status === 'absent').length;

        // Check if adjacent practical slot exists for copy button (F49)
        const isPractical = entry.is_lab_block || entry.session_type === 'practical';
        let adjacentPracticalSlotId: string | null = null;
        if (isPractical) {
          const nextPeriodNum = (slot?.period_number || 0) + 1;
          const nextEntry = dayEntries.find(
            (other: any) =>
              other.course_id === entry.course_id &&
              other.time_slots?.period_number === nextPeriodNum &&
              (other.is_lab_block || other.session_type === 'practical')
          );
          if (nextEntry) {
            adjacentPracticalSlotId = nextEntry.id;
          }
        }

        return {
          timetable_slot_id: entry.id,
          course_id: entry.course_id,
          course_code: entry.courses?.course_code || '',
          course_title: entry.courses?.title || '',
          course_category: entry.courses?.category || '',
          course_semester: entry.courses?.semester || 1,
          is_lab_block: entry.is_lab_block || false,
          session_type: entry.session_type || 'theory',
          period_number: slot?.period_number || 1,
          start_time: slot?.start_time || '',
          end_time: slot?.end_time || '',
          is_marked: isMarked,
          total_enrolled: roster.length,
          present_count: isMarked ? presentCount : roster.length,
          absent_count: isMarked ? absentCount : 0,
          adjacent_practical_slot_id: adjacentPracticalSlotId,
        };
      })
    );

    periodsWithStatus.sort((a, b) => a.period_number - b.period_number);

    return {
      teacherName: faculty?.full_name || '',
      departmentName: (faculty as any)?.departments?.name || '',
      campusName: (faculty as any)?.campuses?.name || '',
      date: dateStr,
      dayOfWeek,
      assignedCourses,
      periods: periodsWithStatus,
      weeklySchedule,
    };
  }

  /**
   * Helper to retrieve all enrolled students for a specific course, strictly scoped
   * to current academic year, campus, and semester (F45).
   * Resolves across slots 1–8 and JSONB selections (covering papers 7–8).
   */
  async getEnrolledRoster(
    courseId: string,
    academicYear?: string,
    campusId?: string,
    semester?: number
  ) {
    let query = this.supabase.admin
      .from('student_registrations')
      .select('student_id, campus_id, academic_year, semester, slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id, slot_7_course_id, slot_8_course_id, selections')
      .or(
        `slot_1_course_id.eq.${courseId},slot_2_course_id.eq.${courseId},slot_3_course_id.eq.${courseId},slot_4_course_id.eq.${courseId},slot_5_course_id.eq.${courseId},slot_6_course_id.eq.${courseId},slot_7_course_id.eq.${courseId},slot_8_course_id.eq.${courseId}`
      );

    if (academicYear) {
      query = query.eq('academic_year', academicYear);
    }
    if (campusId) {
      query = query.eq('campus_id', campusId);
    }
    if (semester) {
      query = query.eq('semester', semester);
    }

    const { data: registrations, error: regError } = await query;

    if (regError) {
      throw new InternalServerErrorException(`Failed to fetch student registrations: ${regError.message}`);
    }

    // Also include students who selected this course in JSONB selections if not in flat slots
    const studentIdSet = new Set<string>();
    for (const reg of registrations || []) {
      studentIdSet.add(reg.student_id);
    }

    // Check JSONB selections for paper 7-8 or elective variants if flat slots missed any
    if (academicYear || campusId) {
      let jsonQuery = this.supabase.admin
        .from('student_registrations')
        .select('student_id, selections');

      if (academicYear) jsonQuery = jsonQuery.eq('academic_year', academicYear);
      if (campusId) jsonQuery = jsonQuery.eq('campus_id', campusId);
      if (semester) jsonQuery = jsonQuery.eq('semester', semester);

      const { data: jsonRegs } = await jsonQuery;
      for (const reg of jsonRegs || []) {
        const sel = reg.selections;
        const arr = Array.isArray(sel) ? sel : Array.isArray(sel?.courses) ? sel.courses : [];
        for (const item of arr) {
          const cid = typeof item === 'string' ? item : item?.id || item?.course_id;
          if (cid === courseId) {
            studentIdSet.add(reg.student_id);
          }
        }
      }
    }

    const studentIds = Array.from(studentIdSet);
    if (studentIds.length === 0) return [];

    let studentQuery = this.supabase.admin
      .from('students')
      .select('id, full_name, cap_application_number, current_semester, campus_id')
      .in('id', studentIds);

    if (campusId) {
      studentQuery = studentQuery.eq('campus_id', campusId);
    }

    const { data: students, error: studentError } = await studentQuery.order('full_name', { ascending: true });

    if (studentError) {
      throw new InternalServerErrorException(`Failed to fetch student profiles: ${studentError.message}`);
    }

    return students || [];
  }

  /**
   * Retrieves persistent dated marks for a timetable slot and date (F47, F48).
   * Distinguishes present, absent, and unmarked students, preventing accidental overwrites.
   */
  async getSlotMarks(user: AuthUser, slotId: string, attendanceDate: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {
      throw new BadRequestException('attendanceDate must be formatted as YYYY-MM-DD');
    }

    // 1. Fetch timetable entry and verify published status (F43)
    const { data: entry, error: entryError } = await this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        academic_year,
        semester,
        status,
        session_type,
        is_lab_block,
        courses(id, course_code, title),
        time_slots(id, day_of_week, period_number, start_time, end_time),
        departments(campus_id)
      `)
      .eq('id', slotId)
      .maybeSingle();

    if (entryError || !entry) {
      throw new NotFoundException('Timetable slot not found.');
    }

    if (entry.status !== 'published') {
      throw new BadRequestException('Cannot inspect attendance for an unpublished timetable draft (F43).');
    }

    // 2. Validate teacher assignment (or HOD/superadmin)
    if (user.role === 'teacher') {
      const { data: assignment } = await this.supabase.admin
        .from('teacher_course_assignments')
        .select('id')
        .eq('teacher_id', user.userId)
        .eq('course_id', entry.course_id)
        .maybeSingle();

      if (!assignment) {
        throw new ForbiddenException('You are not assigned to instruct this course.');
      }
    } else if (user.role === 'hod' && user.department_id !== entry.department_id) {
      throw new ForbiddenException('Cannot access attendance for another department.');
    }

    // 3. Resolve current cohort roster (F45)
    const campusId = (entry as any).departments?.campus_id;
    const roster = await this.getEnrolledRoster(
      entry.course_id,
      entry.academic_year,
      campusId,
      entry.semester
    );

    // 4. Fetch existing marks for this slot on attendanceDate (F48)
    const { data: marks, error: marksError } = await this.supabase.admin
      .from('period_attendance')
      .select('student_id, status, marked_at, marked_by')
      .eq('timetable_slot_id', slotId)
      .eq('attendance_date', attendanceDate);

    if (marksError) {
      throw new InternalServerErrorException(`Failed to fetch slot marks: ${marksError.message}`);
    }

    const marksMap = new Map((marks || []).map((m: any) => [m.student_id, m]));
    const isMarked = (marks || []).length > 0;
    let latestMarkedAt: string | null = null;
    let latestMarkedBy: string | null = null;

    for (const m of marks || []) {
      if (!latestMarkedAt || (m.marked_at && m.marked_at > latestMarkedAt)) {
        latestMarkedAt = m.marked_at;
        latestMarkedBy = m.marked_by;
      }
    }

    const students = roster.map((student) => {
      const mark = marksMap.get(student.id);
      return {
        id: student.id,
        full_name: student.full_name,
        cap_application_number: student.cap_application_number,
        status: mark ? mark.status : 'unmarked',
      };
    });

    const presentCount = students.filter((s) => s.status === 'present').length;
    const absentCount = students.filter((s) => s.status === 'absent').length;
    const unmarkedCount = students.filter((s) => s.status === 'unmarked').length;

    return {
      slot: {
        id: entry.id,
        course_id: entry.course_id,
        course_code: (entry as any).courses?.course_code,
        course_title: (entry as any).courses?.title,
        period_number: (entry as any).time_slots?.period_number,
        start_time: (entry as any).time_slots?.start_time,
        end_time: (entry as any).time_slots?.end_time,
        session_type: entry.session_type,
        is_lab_block: entry.is_lab_block,
      },
      attendance_date: attendanceDate,
      is_marked: isMarked,
      last_marked_at: latestMarkedAt,
      last_marked_by: latestMarkedBy,
      summary: {
        total_enrolled: roster.length,
        present_count: presentCount,
        absent_count: absentCount,
        unmarked_count: unmarkedCount,
      },
      students,
    };
  }

  /**
   * Submits or corrects period attendance marks for a published class on an explicit academic date (F43, F44, F48).
   * Removes 15-minute grace period lock; authorized teachers can correct retained current-semester dates at any time.
   */
  async submitAttendance(
    user: AuthUser,
    slotId: string,
    absentStudentIds: string[],
    ip: string,
    attendanceDateInput?: string,
    lastMarkedAtInput?: string
  ) {
    AuthorizationPolicy.assertNotRosterOnly(user, 'submit period attendance');

    // 1. Fetch timetable entry and verify published status (F43)
    const { data: entry, error: entryError } = await this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        academic_year,
        semester,
        status,
        courses(title, course_code),
        time_slots(day_of_week, start_time, end_time),
        departments(campus_id)
      `)
      .eq('id', slotId)
      .maybeSingle();

    if (entryError || !entry) {
      throw new NotFoundException('Timetable slot not found.');
    }

    if (entry.status !== 'published') {
      throw new BadRequestException(
        `Cannot mark attendance: timetable entry ${slotId} has status '${entry.status}'. Attendance requires a published schedule (F43).`
      );
    }

    const courseId = entry.course_id;

    // 2. Validate teacher is assigned to this course (or HOD for their department)
    if (user.role === 'teacher') {
      const { data: assignment, error: assignError } = await this.supabase.admin
        .from('teacher_course_assignments')
        .select('id')
        .eq('teacher_id', user.userId)
        .eq('course_id', courseId)
        .maybeSingle();

      if (assignError || !assignment) {
        throw new ForbiddenException('You are not assigned to instruct this course.');
      }
    } else if (user.role === 'hod' && user.department_id !== entry.department_id) {
      throw new ForbiddenException('Cannot submit attendance for another department.');
    }

    // 3. Resolve explicit academic date (F48) in IST
    const ist = getISTDateTime();
    let attendanceDate = ist.dateString;
    if (attendanceDateInput && /^\d{4}-\d{2}-\d{2}$/.test(attendanceDateInput)) {
      attendanceDate = attendanceDateInput;
    }

    if (attendanceDate > ist.dateString) {
      throw new BadRequestException('Cannot mark attendance for future dates (F43/F48).');
    }

    // 4. Concurrency conflict check (F47)
    if (lastMarkedAtInput) {
      const { data: newerMarks } = await this.supabase.admin
        .from('period_attendance')
        .select('marked_at')
        .eq('timetable_slot_id', slotId)
        .eq('attendance_date', attendanceDate)
        .gt('marked_at', lastMarkedAtInput)
        .limit(1);

      if (newerMarks && newerMarks.length > 0) {
        throw new ConflictException(
          'Attendance for this period was updated by another teacher while you were editing. Please refresh to inspect the latest marks.'
        );
      }
    }

    // 5. Scoped roster validation (F45): exclude historical or foreign students
    const campusId = (entry as any).departments?.campus_id;
    const roster = await this.getEnrolledRoster(
      courseId,
      entry.academic_year,
      campusId,
      entry.semester
    );

    if (roster.length === 0) {
      throw new NotFoundException('No enrolled students found for this course cohort.');
    }

    const validStudentIds = new Set(roster.map((s) => s.id));
    for (const absentId of absentStudentIds) {
      if (!validStudentIds.has(absentId)) {
        throw new BadRequestException(
          `Student ID ${absentId} is not enrolled in this campus course cohort (F45).`
        );
      }
    }

    const absentSet = new Set(absentStudentIds);
    const nowIso = new Date().toISOString();

    // 6. Construct rows: server-authoritative marked_at, explicit attendance_date (F48)
    const rows = roster.map((student) => ({
      timetable_slot_id: slotId,
      student_id: student.id,
      course_id: courseId,
      marked_by: user.userId,
      status: absentSet.has(student.id) ? 'absent' : 'present',
      marked_at: nowIso,
      attendance_date: attendanceDate,
      is_late_entry: false,
    }));

    // 7. Bulk upsert rows atomically
    const { error: upsertError } = await this.supabase.admin
      .from('period_attendance')
      .upsert(rows, { onConflict: 'timetable_slot_id,student_id,attendance_date' });

    if (upsertError) {
      throw new InternalServerErrorException(`Failed to record attendance: ${upsertError.message}`);
    }

    await this.auditLogger.log({
      eventType: 'period_attendance_marked',
      userId: user.userId,
      userRole: user.role,
      action: `marked period attendance for slot ${slotId} on ${attendanceDate} (${absentStudentIds.length} absent, ${rows.length - absentStudentIds.length} present)`,
      resourceType: 'period_attendance',
      resourceId: slotId,
      status: 'success',
      ipAddress: ip,
      metadata: {
        attendance_date: attendanceDate,
        marked_at: nowIso,
      },
    });

    return {
      success: true,
      attendance_date: attendanceDate,
      marked_at: nowIso,
      total_students: roster.length,
      present_count: rows.length - absentStudentIds.length,
      absent_count: absentStudentIds.length,
    };
  }

  /**
   * Copies attendance marks from an adjacent practical period to the next period (F49).
   * Creates two counted period records for a two-hour practical block.
   */
  async copyPracticalAttendance(user: AuthUser, dto: CopyPracticalDto, ip: string) {
    AuthorizationPolicy.assertNotRosterOnly(user, 'copy practical period attendance');

    // 1. Fetch both source and target timetable entries
    const [sourceRes, targetRes] = await Promise.all([
      this.supabase.admin
        .from('timetable_entries')
        .select(`
          id,
          course_id,
          department_id,
          academic_year,
          semester,
          status,
          session_type,
          is_lab_block,
          time_slots(day_of_week, period_number)
        `)
        .eq('id', dto.source_slot_id)
        .maybeSingle(),
      this.supabase.admin
        .from('timetable_entries')
        .select(`
          id,
          course_id,
          department_id,
          academic_year,
          semester,
          status,
          session_type,
          is_lab_block,
          time_slots(day_of_week, period_number)
        `)
        .eq('id', dto.target_slot_id)
        .maybeSingle(),
    ]);

    if (!sourceRes.data || !targetRes.data) {
      throw new NotFoundException('Source or target timetable entry not found.');
    }

    const source = sourceRes.data;
    const target = targetRes.data;

    if (source.status !== 'published' || target.status !== 'published') {
      throw new BadRequestException('Both practical periods must be published (F43).');
    }

    if (source.course_id !== target.course_id) {
      throw new BadRequestException('Cannot copy attendance between different courses (F49).');
    }

    const sourceSlot = (source as any).time_slots;
    const targetSlot = (target as any).time_slots;
    if (sourceSlot?.day_of_week !== targetSlot?.day_of_week) {
      throw new BadRequestException('Cannot copy attendance between different days of the week (F49).');
    }

    // 2. Fetch marks from source slot on the requested attendance_date
    const { data: sourceMarks, error: sourceMarksError } = await this.supabase.admin
      .from('period_attendance')
      .select('student_id, status, course_id')
      .eq('timetable_slot_id', dto.source_slot_id)
      .eq('attendance_date', dto.attendance_date);

    if (sourceMarksError || !sourceMarks || sourceMarks.length === 0) {
      throw new BadRequestException(
        `Source practical period has no attendance recorded for ${dto.attendance_date}. Mark the source period first.`
      );
    }

    // 3. Check if target already has marks on this date (overwrite safeguard)
    const { data: existingTargetMarks } = await this.supabase.admin
      .from('period_attendance')
      .select('student_id')
      .eq('timetable_slot_id', dto.target_slot_id)
      .eq('attendance_date', dto.attendance_date);

    if (existingTargetMarks && existingTargetMarks.length > 0 && !dto.overwrite) {
      throw new ConflictException(
        `Target period already has ${existingTargetMarks.length} attendance marks recorded for ${dto.attendance_date}. Set overwrite to true to proceed.`
      );
    }

    const nowIso = new Date().toISOString();

    // 4. Duplicate marks to target slot
    const targetRows = sourceMarks.map((m: any) => ({
      timetable_slot_id: dto.target_slot_id,
      student_id: m.student_id,
      course_id: m.course_id,
      marked_by: user.userId,
      status: m.status,
      marked_at: nowIso,
      attendance_date: dto.attendance_date,
      is_late_entry: false,
    }));

    const { error: insertError } = await this.supabase.admin
      .from('period_attendance')
      .upsert(targetRows, { onConflict: 'timetable_slot_id,student_id,attendance_date' });

    if (insertError) {
      throw new InternalServerErrorException(
        `Failed to copy practical attendance: ${insertError.message}`
      );
    }

    await this.auditLogger.log({
      eventType: 'period_attendance_copied',
      userId: user.userId,
      userRole: user.role,
      action: `copied practical attendance from slot ${dto.source_slot_id} to ${dto.target_slot_id} on ${dto.attendance_date} (${targetRows.length} records)`,
      resourceType: 'period_attendance',
      resourceId: dto.target_slot_id,
      status: 'success',
      ipAddress: ip,
      metadata: {
        source_slot_id: dto.source_slot_id,
        target_slot_id: dto.target_slot_id,
        attendance_date: dto.attendance_date,
      },
    });

    const presentCount = targetRows.filter((r) => r.status === 'present').length;
    const absentCount = targetRows.filter((r) => r.status === 'absent').length;

    return {
      success: true,
      copied_count: targetRows.length,
      present_count: presentCount,
      absent_count: absentCount,
      attendance_date: dto.attendance_date,
    };
  }

  /**
   * HOD queries student roster and marked status for a specific slot on an explicit date (F46).
   */
  async getSlotRosterForHod(user: AuthUser, slotId: string, queryDate?: string) {
    const { data: entry, error: entryError } = await this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        academic_year,
        semester,
        courses(title, course_code),
        time_slots(day_of_week, period_number, start_time, end_time),
        departments(campus_id)
      `)
      .eq('id', slotId)
      .maybeSingle();

    if (entryError || !entry) {
      throw new NotFoundException('Timetable slot not found.');
    }

    if (user.role === 'hod' && entry.department_id !== user.department_id) {
      throw new ForbiddenException('Cannot access attendance data for another department.');
    }

    const ist = getISTDateTime();
    const attendanceDate = queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)
      ? queryDate
      : ist.dateString;

    const campusId = (entry as any).departments?.campus_id;
    const roster = await this.getEnrolledRoster(
      entry.course_id,
      entry.academic_year,
      campusId,
      entry.semester
    );

    // Fetch marks strictly for this slot on this attendanceDate (F46)
    const { data: marks } = await this.supabase.admin
      .from('period_attendance')
      .select('student_id, status, marked_at, marked_by')
      .eq('timetable_slot_id', slotId)
      .eq('attendance_date', attendanceDate);

    const markMap = new Map((marks || []).map((m: any) => [m.student_id, m]));

    const rosterWithMarks = roster.map((student) => {
      const mark = markMap.get(student.id);
      return {
        ...student,
        status: mark?.status || 'unmarked',
        marked_at: mark?.marked_at || null,
      };
    });

    const totalEnrolled = roster.length;
    const presentCount = (marks || []).filter((m: any) => m.status === 'present').length;
    const absentCount = (marks || []).filter((m: any) => m.status === 'absent').length;
    const unmarkedCount = totalEnrolled - ((marks || []).length);
    const isMarked = (marks || []).length > 0;

    return {
      slot: {
        id: entry.id,
        course_id: entry.course_id,
        course_code: (entry as any).courses?.course_code,
        course_title: (entry as any).courses?.title,
        period_number: (entry as any).time_slots?.period_number,
        start_time: (entry as any).time_slots?.start_time,
        end_time: (entry as any).time_slots?.end_time,
      },
      attendance_date: attendanceDate,
      summary: {
        total_enrolled: totalEnrolled,
        present_count: presentCount,
        absent_count: absentCount,
        unmarked_count: unmarkedCount > 0 ? unmarkedCount : 0,
        is_marked: isMarked,
      },
      students: rosterWithMarks,
    };
  }

  /**
   * Returns all timetable slots for the HOD's department for a specific date (F46),
   * optionally filtered by semester and day of week.
   */
  async getDepartmentSlots(
    user: AuthUser,
    semester?: number,
    dayOfWeek?: number,
    queryDate?: string
  ) {
    if (!user.department_id) {
      throw new ForbiddenException('User is not associated with a department.');
    }

    const ist = getISTDateTime();
    const attendanceDate = queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)
      ? queryDate
      : ist.dateString;

    let query = this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        academic_year,
        semester,
        session_type,
        is_lab_block,
        courses!inner(id, course_code, title, semester),
        time_slots!inner(id, day_of_week, period_number, start_time, end_time)
      `)
      .eq('department_id', user.department_id)
      .eq('status', 'published');

    if (semester) {
      query = query.eq('courses.semester', semester);
    }
    if (dayOfWeek) {
      query = query.eq('time_slots.day_of_week', dayOfWeek);
    }

    const { data: entries, error } = await query;
    if (error) {
      throw new InternalServerErrorException(`Failed to fetch department slots: ${error.message}`);
    }

    const entryIds = (entries || []).map((e: any) => e.id);
    let marks: any[] = [];

    if (entryIds.length > 0) {
      // Query marks strictly for attendanceDate (F46)
      const { data: markData } = await this.supabase.admin
        .from('period_attendance')
        .select('timetable_slot_id, status')
        .in('timetable_slot_id', entryIds)
        .eq('attendance_date', attendanceDate);

      marks = markData || [];
    }

    const result = (entries || []).map((entry: any) => {
      const slotMarks = marks.filter((m: any) => m.timetable_slot_id === entry.id);
      const isMarked = slotMarks.length > 0;
      const presentCount = slotMarks.filter((m: any) => m.status === 'present').length;
      const absentCount = slotMarks.filter((m: any) => m.status === 'absent').length;

      return {
        id: entry.id,
        course_id: entry.course_id,
        course_code: (entry as any).courses?.course_code,
        course_title: (entry as any).courses?.title,
        semester: (entry as any).courses?.semester,
        session_type: entry.session_type,
        is_lab_block: entry.is_lab_block || false,
        day_of_week: (entry as any).time_slots?.day_of_week,
        period_number: (entry as any).time_slots?.period_number,
        start_time: (entry as any).time_slots?.start_time,
        end_time: (entry as any).time_slots?.end_time,
        attendance_date: attendanceDate,
        is_marked: isMarked,
        present_count: presentCount,
        absent_count: absentCount,
      };
    });

    return result;
  }
}
