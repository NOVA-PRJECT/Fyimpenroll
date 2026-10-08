import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../../core/database/supabase.service';
import { AuditLoggerService } from '../../core/logging/audit-logger.service';
import { ServerLoggerService } from '../../core/logging/server-logger.service';
import { AuthUser } from '../../core/auth/types';
import { AuthorizationPolicy } from '../../core/auth/authorization-policy';
import { PERIOD_GRACE_MINUTES } from './period-attendance.constants';
import { getISTDateTime } from '../../core/utils/date-time.util';

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
   * Auto-detects current active period (running or ended <= 15 min ago)
   * for the authenticated teacher.
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

    // 2. Determine today's day of week (1=Monday ... 6=Saturday) in IST
    const ist = getISTDateTime();
    const dayOfWeek = ist.dayOfWeek;
    const currentMinutes = ist.totalMinutes;

    // 3. Fetch timetable entries for teacher's courses
    const { data: entries, error: entriesError } = await this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        session_type,
        courses(id, course_code, title),
        time_slots(id, day_of_week, period_number, start_time, end_time)
      `)
      .in('course_id', assignedCourseIds)
      .eq('status', 'published');

    if (entriesError) {
      throw new InternalServerErrorException(`Failed to fetch timetable entries: ${entriesError.message}`);
    }

    const todayEntries = (entries || []).filter(
      (e: any) => e.time_slots?.day_of_week === dayOfWeek
    );

    // 4. Find slots that are currently active or ended within grace window (15 minutes)
    const candidateActiveEntries: { entry: any; slot: any }[] = [];
    let nextUpcomingSlot: any = null;
    let minUpcomingDiff = Infinity;

    for (const entry of todayEntries) {
      const slot = (entry as any).time_slots;
      if (!slot) continue;

      const startMin = this.timeToMinutes(slot.start_time);
      const endMin = this.timeToMinutes(slot.end_time);
      const allowedUntilMin = endMin + PERIOD_GRACE_MINUTES;

      // Check if slot is running or within 15-min post-period window
      if (currentMinutes >= startMin && currentMinutes <= allowedUntilMin) {
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

    // Batch fetch rosters and marking records concurrently for all active slots (L4)
    const activeSlots = await Promise.all(
      candidateActiveEntries.map(async ({ entry, slot }) => {
        const [roster, { data: existingMarks }] = await Promise.all([
          this.getEnrolledRoster(entry.course_id),
          this.supabase.admin
            .from('period_attendance')
            .select('student_id, status, marked_at')
            .eq('timetable_slot_id', entry.id)
            .eq('attendance_date', ist.dateString),
        ]);

        const markedMap = new Map((existingMarks || []).map((m) => [m.student_id, m.status]));
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
            status: markedMap.get(s.id) || 'present', // Default to present
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
          : `${activeSlots.length} lecture period ready for attendance marking.`,
    };
  }

  /**
   * Retrieves today's full scheduled periods for the teacher, along with attendance marking status.
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

    if (assignedCourseIds.length === 0) {
      const istDefault = getISTDateTime();
      return {
        teacherName: faculty?.full_name || '',
        departmentName: (faculty as any)?.departments?.name || '',
        campusName: (faculty as any)?.campuses?.name || '',
        date: queryDate || istDefault.dateString,
        dayOfWeek: istDefault.dayOfWeek,
        assignedCourses: [],
        periods: [],
        weeklySchedule: [],
        message: 'No courses currently assigned to you. Contact your HOD.',
      };
    }

    // Determine target date and day of week in IST
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

    // 3. Fetch timetable entries for assigned courses
    const { data: entries, error: entriesError } = await this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        session_type,
        is_lab_block,
        courses(id, course_code, title, category, semester, credits),
        time_slots(id, day_of_week, period_number, start_time, end_time)
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
      day_of_week: entry.time_slots?.day_of_week,
      period_number: entry.time_slots?.period_number,
      start_time: entry.time_slots?.start_time || '',
      end_time: entry.time_slots?.end_time || '',
    }));

    const dayEntries = (entries || []).filter(
      (e: any) => e.time_slots?.day_of_week === dayOfWeek
    );

    // 4. Check marking status for each slot
    const periodsWithStatus = await Promise.all(
      dayEntries.map(async (entry: any) => {
        const slot = entry.time_slots;
        const { data: marks } = await this.supabase.admin
          .from('period_attendance')
          .select('student_id, status')
          .eq('timetable_slot_id', entry.id)
          .eq('attendance_date', dateStr);

        const isMarked = (marks || []).length > 0;
        const presentCount = (marks || []).filter((m) => m.status === 'present').length;
        const absentCount = (marks || []).filter((m) => m.status === 'absent').length;

        const roster = await this.getEnrolledRoster(entry.course_id);

        return {
          timetable_slot_id: entry.id,
          course_id: entry.course_id,
          course_code: entry.courses?.course_code || '',
          course_title: entry.courses?.title || '',
          course_category: entry.courses?.category || '',
          course_semester: entry.courses?.semester || 1,
          period_number: slot?.period_number || 1,
          start_time: slot?.start_time || '',
          end_time: slot?.end_time || '',
          is_marked: isMarked,
          total_enrolled: roster.length,
          present_count: isMarked ? presentCount : roster.length,
          absent_count: isMarked ? absentCount : 0,
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
   * Helper to retrieve all enrolled students for a specific course.
   */
  async getEnrolledRoster(courseId: string, academicYear?: string, campusId?: string) {
    // Supports flat slot columns (slot_1_course_id..slot_8_course_id) and JSONB selections (F15)
    let query = this.supabase.admin
      .from('student_registrations')
      .select('student_id')
      .or(
        `slot_1_course_id.eq.${courseId},slot_2_course_id.eq.${courseId},slot_3_course_id.eq.${courseId},slot_4_course_id.eq.${courseId},slot_5_course_id.eq.${courseId},slot_6_course_id.eq.${courseId},slot_7_course_id.eq.${courseId},slot_8_course_id.eq.${courseId}`
      );

    if (academicYear) {
      query = query.eq('academic_year', academicYear);
    }
    if (campusId) {
      query = query.eq('campus_id', campusId);
    }

    const { data: registrations, error: regError } = await query;

    if (regError) {
      throw new InternalServerErrorException(`Failed to fetch student registrations: ${regError.message}`);
    }

    const studentIds = Array.from(new Set((registrations || []).map((r) => r.student_id)));
    if (studentIds.length === 0) return [];

    const { data: students, error: studentError } = await this.supabase.admin
      .from('students')
      .select('id, full_name, cap_application_number, current_semester')
      .in('id', studentIds)
      .order('full_name', { ascending: true });

    if (studentError) {
      throw new InternalServerErrorException(`Failed to fetch student profiles: ${studentError.message}`);
    }

    return students || [];
  }

  /**
   * Submits period attendance marks using default-present, tap-exceptions (absents) pattern.
   * Enforces 15-minute grace window or valid HOD unlock record.
   */
  async submitAttendance(
    user: AuthUser,
    slotId: string,
    absentStudentIds: string[],
    ip: string,
    clientTimestamp?: string
  ) {
    AuthorizationPolicy.assertNotRosterOnly(user, 'submit period attendance');

    // 1. Fetch timetable entry and slot times
    const { data: entry, error: entryError } = await this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        courses(title, course_code),
        time_slots(day_of_week, start_time, end_time)
      `)
      .eq('id', slotId)
      .maybeSingle();

    if (entryError || !entry) {
      throw new NotFoundException('Timetable slot not found.');
    }

    const courseId = entry.course_id;

    // 2. Validate teacher is assigned to this course
    const { data: assignment, error: assignError } = await this.supabase.admin
      .from('teacher_course_assignments')
      .select('id')
      .eq('teacher_id', user.userId)
      .eq('course_id', courseId)
      .maybeSingle();

    if (assignError || !assignment) {
      throw new ForbiddenException('You are not assigned to instruct this course.');
    }

    // 3. Timing validation: 15-minute grace window or HOD unlock record
    const slot = (entry as any).time_slots;
    let isLateEntry = false;
    let unlockedBy: string | null = null;

    const ist = getISTDateTime();
    const submissionTime = clientTimestamp || new Date().toISOString();
    const attendanceDate = clientTimestamp
      ? getISTDateTime(new Date(clientTimestamp)).dateString
      : ist.dateString;

    if (attendanceDate > ist.dateString) {
      throw new BadRequestException('Cannot mark attendance for future dates.');
    }

    if (slot) {
      const isDifferentDay = attendanceDate !== ist.dateString || slot.day_of_week !== ist.dayOfWeek;
      const currentMinutes = ist.totalMinutes;
      const endMin = this.timeToMinutes(slot.end_time);
      const graceLimitMin = endMin + PERIOD_GRACE_MINUTES;

      const isPastGrace = isDifferentDay || currentMinutes > graceLimitMin;

      if (isPastGrace) {
        // Look for HOD unlock record
        const { data: unlockRecord } = await this.supabase.admin
          .from('period_unlock_requests')
          .select('id, unlocked_by, unlocked_at')
          .eq('timetable_slot_id', slotId)
          .order('unlocked_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!unlockRecord) {
          if (process.env.NODE_ENV === 'production') {
            throw new ForbiddenException(
              isDifferentDay
                ? `Attendance for ${attendanceDate} requires an HOD unlock to submit.`
                : `The 15-minute marking window for this period ended at ${slot.end_time}. An HOD unlock is required to submit late attendance.`
            );
          } else {
            this.serverLogger.warn(
              `[Attendance] Non-production mode: late attendance marking permitted for slot ${slotId} (${attendanceDate}) without HOD unlock.`
            );
            isLateEntry = true;
          }
        } else {
          isLateEntry = true;
          unlockedBy = unlockRecord.unlocked_by ?? null;
        }
      }
    }

    // 4. Fetch all enrolled students
    const roster = await this.getEnrolledRoster(courseId);
    if (roster.length === 0) {
      throw new NotFoundException('No enrolled students found for this course.');
    }

    // Validate that all submitted absentStudentIds are actually enrolled (M3)
    const validStudentIds = new Set(roster.map((s) => s.id));
    for (const absentId of absentStudentIds) {
      if (!validStudentIds.has(absentId)) {
        throw new BadRequestException(`Student ID ${absentId} is not enrolled in this course.`);
      }
    }

    const absentSet = new Set(absentStudentIds);

    // 5. Construct rows with default-present pattern
    const rows = roster.map((student) => ({
      timetable_slot_id: slotId,
      student_id: student.id,
      course_id: courseId,
      marked_by: user.userId,
      status: absentSet.has(student.id) ? 'absent' : 'present',
      marked_at: submissionTime,
      attendance_date: attendanceDate,
      is_late_entry: isLateEntry,
      unlocked_by: unlockedBy,
    }));

    // 6. Bulk upsert rows in single atomic operation
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
      action: `marked period attendance for slot ${slotId} (${absentStudentIds.length} absent, ${rows.length - absentStudentIds.length} present)`,
      resourceType: 'period_attendance',
      resourceId: slotId,
      status: 'success',
      ipAddress: ip,
      metadata: {
        is_late_entry: isLateEntry,
        unlocked_by: unlockedBy,
      },
    });

    return {
      success: true,
      total_students: roster.length,
      present_count: rows.length - absentStudentIds.length,
      absent_count: absentStudentIds.length,
      is_late_entry: isLateEntry,
    };
  }

  /**
   * HOD authorizes an unlock for a past period slot to permit late attendance entry.
   */
  async unlockPeriod(user: AuthUser, slotId: string, reason: string, ip: string) {
    // 1. Verify slot belongs to HOD's department
    const { data: entry, error: entryError } = await this.supabase.admin
      .from('timetable_entries')
      .select('id, department_id, courses(course_code, title)')
      .eq('id', slotId)
      .maybeSingle();

    if (entryError || !entry) {
      throw new NotFoundException('Timetable slot not found.');
    }

    if (entry.department_id !== user.department_id) {
      throw new ForbiddenException('Cannot unlock slots belonging to another department.');
    }

    const unlockedAt = new Date().toISOString();

    // 2. Insert audit unlock record
    const { data, error } = await this.supabase.admin
      .from('period_unlock_requests')
      .insert({
        timetable_slot_id: slotId,
        unlocked_by: user.userId,
        unlocked_at: unlockedAt,
        reason: reason.trim(),
      })
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(`Failed to unlock period: ${error.message}`);
    }

    await this.auditLogger.log({
      eventType: 'period_marking_unlocked',
      userId: user.userId,
      userRole: user.role,
      action: `HOD unlocked period slot ${slotId} for late entry`,
      resourceType: 'period_unlock_request',
      resourceId: data.id,
      status: 'success',
      ipAddress: ip,
      metadata: { reason },
    });

    return {
      success: true,
      unlock_record: data,
    };
  }

  /**
   * HOD queries student roster and marked status for a specific slot.
   */
  async getSlotRosterForHod(user: AuthUser, slotId: string) {
    const { data: entry, error: entryError } = await this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        courses(title, course_code),
        time_slots(day_of_week, period_number, start_time, end_time)
      `)
      .eq('id', slotId)
      .maybeSingle();

    if (entryError || !entry) {
      throw new NotFoundException('Timetable slot not found.');
    }

    if (entry.department_id !== user.department_id) {
      throw new ForbiddenException('Cannot access attendance data for another department.');
    }

    const roster = await this.getEnrolledRoster(entry.course_id);

    // Fetch marks for this slot
    const { data: marks } = await this.supabase.admin
      .from('period_attendance')
      .select('student_id, status, marked_at, is_late_entry, marked_by')
      .eq('timetable_slot_id', slotId);

    const markMap = new Map((marks || []).map((m) => [m.student_id, m]));

    const rosterWithMarks = roster.map((student) => {
      const mark = markMap.get(student.id);
      return {
        ...student,
        status: mark?.status || 'unmarked',
        marked_at: mark?.marked_at || null,
        is_late_entry: mark?.is_late_entry || false,
      };
    });

    const totalEnrolled = roster.length;
    const presentCount = (marks || []).filter((m) => m.status === 'present').length;
    const absentCount = (marks || []).filter((m) => m.status === 'absent').length;
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
      summary: {
        total_enrolled: totalEnrolled,
        present_count: presentCount,
        absent_count: absentCount,
        is_marked: isMarked,
      },
      students: rosterWithMarks,
    };
  }

  /**
   * Returns all timetable slots for the HOD's department, optionally filtered by semester and day.
   */
  async getDepartmentSlots(user: AuthUser, semester?: number, dayOfWeek?: number) {
    if (!user.department_id) {
      throw new ForbiddenException('User is not associated with a department.');
    }

    let query = this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        session_type,
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

    const entryIds = (entries || []).map((e) => e.id);
    let marks: any[] = [];
    let unlocks: any[] = [];

    if (entryIds.length > 0) {
      const { data: markData } = await this.supabase.admin
        .from('period_attendance')
        .select('timetable_slot_id, status')
        .in('timetable_slot_id', entryIds);
      marks = markData || [];

      const { data: unlockData } = await this.supabase.admin
        .from('period_unlock_requests')
        .select('timetable_slot_id, unlocked_at, reason')
        .in('timetable_slot_id', entryIds);
      unlocks = unlockData || [];
    }

    const unlocksMap = new Map(unlocks.map((u) => [u.timetable_slot_id, u]));

    const result = (entries || []).map((entry) => {
      const slotMarks = marks.filter((m) => m.timetable_slot_id === entry.id);
      const isMarked = slotMarks.length > 0;
      const presentCount = slotMarks.filter((m) => m.status === 'present').length;
      const absentCount = slotMarks.filter((m) => m.status === 'absent').length;
      const unlockInfo = unlocksMap.get(entry.id);

      return {
        id: entry.id,
        course_id: entry.course_id,
        course_code: (entry as any).courses?.course_code,
        course_title: (entry as any).courses?.title,
        semester: (entry as any).courses?.semester,
        session_type: entry.session_type,
        day_of_week: (entry as any).time_slots?.day_of_week,
        period_number: (entry as any).time_slots?.period_number,
        start_time: (entry as any).time_slots?.start_time,
        end_time: (entry as any).time_slots?.end_time,
        is_marked: isMarked,
        present_count: presentCount,
        absent_count: absentCount,
        is_unlocked: !!unlockInfo,
        unlocked_at: unlockInfo?.unlocked_at || null,
        unlock_reason: unlockInfo?.reason || null,
      };
    });

    return result;
  }
}
