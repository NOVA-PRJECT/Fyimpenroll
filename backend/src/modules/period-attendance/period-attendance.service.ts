import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseService } from '../../core/database/supabase.service';
import { AuditLoggerService } from '../../core/logging/audit-logger.service';
import { ServerLoggerService } from '../../core/logging/server-logger.service';
import { AuthUser } from '../../core/auth/types';
import { AuthorizationPolicy } from '../../core/auth/authorization-policy';
import { getISTDateTime } from '../../core/utils/date-time.util';
import { CopyPracticalDto } from './dto/copy-practical.dto';
import { fetchAllPaginated } from '../../core/database/pagination.util';

@Injectable()
export class PeriodAttendanceService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService,
    private readonly serverLogger?: ServerLoggerService,
  ) {}

  /**
   * Helper to convert time string (HH:MM:SS or HH:MM) to minutes from midnight.
   */
  private timeToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map((v) => parseInt(v, 10));
    return hours * 60 + (minutes || 0);
  }

  /**
   * Validates a date string against the Gregorian calendar (YYYY-MM-DD) (R28).
   * Strictly rejects impossible dates (e.g. Feb 30, Nov 31).
   */
  public isValidCalendarDate(dateStr: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    const [y, m, d] = dateStr.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }

  /**
   * Calculates calendar day-of-week in Asia/Kolkata timezone (1=Monday ... 7=Sunday) (R28).
   */
  public getCalendarDayOfWeek(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const day = dt.getUTCDay(); // 0=Sunday, 1=Monday ... 6=Saturday
    return day === 0 ? 7 : day;
  }

  /**
   * Validates adjacent practical pair within session domain (R03).
   * Only approved consecutive lab pairs are valid: (1, 2), (2, 3), (4, 5), (5, 6).
   * Lunch crossing (Period 3 to Period 4) is strictly forbidden.
   */
  public isValidPracticalPair(
    srcPeriod?: number,
    tgtPeriod?: number
  ): { valid: boolean; reason?: string } {
    if (srcPeriod == null || tgtPeriod == null) {
      return { valid: false, reason: 'Period numbers must be defined for practical copy.' };
    }
    if (srcPeriod === 3 && tgtPeriod === 4) {
      return {
        valid: false,
        reason: 'Cannot copy practical attendance across lunch boundary (Period 3 to Period 4 is forbidden) (R03).',
      };
    }
    const approvedPairs = new Set(['1-2', '2-3', '4-5', '5-6']);
    if (!approvedPairs.has(`${srcPeriod}-${tgtPeriod}`)) {
      return {
        valid: false,
        reason: `Invalid practical period pair (Period ${srcPeriod} to Period ${tgtPeriod}). Copying is only allowed between consecutive practical periods within the same session block (R03).`,
      };
    }
    return { valid: true };
  }

  /**
   * Checks whether a cohort term is active or retired (R28 / Follow-up Plan 07 contract).
   */
  public async isCohortActive(
    campusId: string,
    academicYear: string,
    semester: number
  ): Promise<boolean> {
    try {
      await this.assertActiveCohort(campusId, academicYear, semester);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Asserts that a cohort term is active and not retired/concluded (R28 / Plan 08 contract).
   */
  public async assertActiveCohort(
    campusId: string,
    academicYear: string,
    semester: number
  ): Promise<void> {
    // 1. Check explicit retired cohorts registry
    const retiredQuery = this.supabase.admin.from('retired_cohorts');
    if (typeof (retiredQuery as any)?.select === 'function') {
      const { data: retired } = await retiredQuery
        .select('id, reason, retired_at')
        .eq('campus_id', campusId)
        .eq('academic_year', academicYear)
        .eq('semester', semester)
        .maybeSingle();

      if (retired) {
        throw new BadRequestException(
          `Cannot record attendance: cohort (${academicYear} Semester ${semester} for campus ${campusId}) is retired or concluded (R28).`
        );
      }
    }

    // 2. Check campus_settings academic year
    const settingsQuery = this.supabase.admin.from('campus_settings');
    if (typeof (settingsQuery as any)?.select === 'function') {
      const { data: settings } = await settingsQuery
        .select('academic_year')
        .eq('campus_id', campusId)
        .maybeSingle();

      if (settings?.academic_year && academicYear < settings.academic_year) {
        throw new BadRequestException(
          `Cannot record attendance: academic year ${academicYear} is retired for this campus (current active: ${settings.academic_year}) (R28).`
        );
      }
    }
  }

  /**
   * Records a cohort as retired in the registry (Plan 08 retention contract).
   */
  public async retireCohort(
    campusId: string,
    academicYear: string,
    semester: number,
    userId: string,
    reason?: string
  ): Promise<void> {
    await this.supabase.admin.from('retired_cohorts').upsert(
      {
        campus_id: campusId,
        academic_year: academicYear,
        semester,
        retired_by: userId,
        retired_at: new Date().toISOString(),
        reason: reason || 'Term concluded and attendance archived/purged',
      },
      { onConflict: 'campus_id,academic_year,semester' }
    );
  }

  /**
   * Retrieves list of all retired cohorts for a campus.
   */
  public async getRetiredCohorts(campusId?: string): Promise<any[]> {
    let query = this.supabase.admin.from('retired_cohorts').select('*');
    if (campusId) {
      query = query.eq('campus_id', campusId);
    }
    const { data } = await query;
    return data || [];
  }

  /**
   * Centralized Dated-Session Resolver (R03, R28).
   * Validates timetable entry existence, publication, valid calendar date,
   * non-future constraint, scheduled weekday alignment, and active cohort state.
   */
  public async resolveDatedSession(slotId: string, attendanceDateInput?: string) {
    if (!slotId) {
      throw new BadRequestException('Timetable slot ID is required');
    }

    // 1. Fetch timetable entry and relations
    const { data: entry, error: entryError } = await this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        campus_id,
        teacher_id,
        academic_year,
        semester,
        status,
        session_type,
        is_lab_block,
        courses(id, course_code, title, category, semester, credits),
        time_slots(id, day_of_week, period_number, start_time, end_time),
        departments(id, campus_id)
      `)
      .eq('id', slotId)
      .maybeSingle();

    if (entryError || !entry) {
      throw new NotFoundException(`Timetable slot ${slotId} not found.`);
    }

    // 2. Publication guard (F43 / R06)
    if (entry.status !== 'published') {
      throw new BadRequestException(
        `Cannot mark attendance: timetable entry ${slotId} has status '${entry.status}'. Attendance requires a published schedule (F43).`
      );
    }

    // 3. Calendar date validation & non-future check (F48 / R28)
    const ist = getISTDateTime();
    let attendanceDate = ist.dateString;

    if (attendanceDateInput !== undefined && attendanceDateInput !== null && attendanceDateInput !== '') {
      if (!this.isValidCalendarDate(attendanceDateInput)) {
        throw new BadRequestException(
          `Invalid calendar date '${attendanceDateInput}'. Must be a valid Gregorian date in YYYY-MM-DD format (R28).`
        );
      }
      attendanceDate = attendanceDateInput;
    }

    if (attendanceDate > ist.dateString) {
      throw new BadRequestException('Cannot mark attendance for future dates (F43/F48).');
    }

    // 4. Weekday alignment guard (R28)
    const calendarDayOfWeek = this.getCalendarDayOfWeek(attendanceDate);
    const slotDayOfWeek = (entry as any).time_slots?.day_of_week;

    if (slotDayOfWeek != null && calendarDayOfWeek !== slotDayOfWeek) {
      throw new BadRequestException(
        `Attendance date ${attendanceDate} falls on day ${calendarDayOfWeek}, but scheduled slot is for day ${slotDayOfWeek} (R28).`
      );
    }

    // 5. Active cohort guard (R28)
    const hostCampusId = (entry as any).campus_id || (entry as any).departments?.campus_id;
    if (hostCampusId && entry.academic_year && entry.semester) {
      await this.assertActiveCohort(hostCampusId, entry.academic_year, entry.semester);
    }

    return {
      entry,
      slot: (entry as any).time_slots,
      course: (entry as any).courses,
      campusId: hostCampusId,
      attendanceDate,
      dayOfWeek: calendarDayOfWeek,
    };
  }

  /**
   * Asserts actor's class-delivery authorization (Plan 01 / Plan 03 / R03).
   * Superadmin has university scope.
   * HOD can only manage their own department.
   * Teachers must be assigned to the specific class delivery (direct teacher_id or teacher_course_assignments).
   * Roster-only teaching_staff and students fail closed.
   */
  public async assertClassDeliveryAuthority(user: AuthUser, entry: any): Promise<void> {
    AuthorizationPolicy.assertNotRosterOnly(user, 'mark or copy period attendance');

    if (user.role === 'superadmin') return;

    if (user.role === 'hod') {
      if (!user.department_id || user.department_id !== entry.department_id) {
        throw new ForbiddenException('Cannot manage attendance for another department (R03).');
      }
      return;
    }

    if (user.role === 'teacher') {
      if (entry.teacher_id === user.userId) {
        return; // Direct assignment on timetable entry
      }

      const hostCampusId = entry.campus_id || entry.departments?.campus_id;
      const { data: assignments } = await this.supabase.admin
        .from('teacher_course_assignments')
        .select('id, course_id, campus_id, academic_year, semester')
        .eq('teacher_id', user.userId)
        .eq('course_id', entry.course_id);

      const isAssigned = (assignments || []).some((a: any) => {
        if (a.campus_id && hostCampusId && a.campus_id !== hostCampusId) return false;
        if (a.academic_year && a.academic_year !== entry.academic_year) return false;
        if (a.semester && a.semester !== entry.semester) return false;
        return true;
      });

      if (!isAssigned) {
        throw new ForbiddenException(
          'You are not assigned to instruct this course. Teacher is not assigned to teach this course/class delivery (R03/R07).'
        );
      }
      return;
    }

    throw new ForbiddenException(
      `Role '${user.role}' is not authorized to manage attendance marks.`
    );
  }

  /**
   * Detects scheduled periods for the authenticated teacher today (IST),
   * showing running/upcoming periods and live marking status.
   * NOTE: Post-period 15-minute lockout is retired; authorized teachers can mark or correct at any time.
   */
  async getCurrentPeriod(user: AuthUser) {
    const { data: assignments, error: assignError } = await this.supabase.admin
      .from('teacher_course_assignments')
      .select('course_id, campus_id, academic_year, semester')
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
    const ist = getISTDateTime();
    const dayOfWeek = ist.dayOfWeek;
    const currentMinutes = ist.totalMinutes;

    const { data: rawEntries, error: entriesError } = await this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        campus_id,
        teacher_id,
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

    const todayEntries = (rawEntries || []).filter((e: any) => {
      if (e.time_slots?.day_of_week !== dayOfWeek) return false;
      if (e.teacher_id === user.userId) return true;
      const hostCampusId = e.campus_id || e.departments?.campus_id;
      return (assignments || []).some((a: any) => {
        if (a.course_id !== e.course_id) return false;
        if (a.campus_id && hostCampusId && a.campus_id !== hostCampusId) return false;
        if (a.academic_year && a.academic_year !== e.academic_year) return false;
        if (a.semester && a.semester !== e.semester) return false;
        return true;
      });
    });

    const candidateActiveEntries: { entry: any; slot: any }[] = [];
    let nextUpcomingSlot: any = null;
    let minUpcomingDiff = Infinity;

    for (const entry of todayEntries) {
      const slot = (entry as any).time_slots;
      if (!slot) continue;

      const startMin = this.timeToMinutes(slot.start_time);
      const endMin = this.timeToMinutes(slot.end_time);

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

    const targetSlots = candidateActiveEntries.length > 0
      ? candidateActiveEntries
      : todayEntries.map((entry: any) => ({ entry, slot: entry.time_slots }));

    const activeSlots = await Promise.all(
      targetSlots.map(async ({ entry, slot }) => {
        const campusId = (entry as any).campus_id || (entry as any).departments?.campus_id;
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
   * along with attendance marking status and valid adjacent practical pairs (R03).
   */
  async getTeacherSchedule(user: AuthUser, queryDate?: string) {
    const { data: faculty } = await this.supabase.admin
      .from('faculty')
      .select('id, full_name, department_id, campus_id, departments!faculty_department_id_fkey(name), campuses(name)')
      .eq('id', user.userId)
      .maybeSingle();

    const { data: assignments, error: assignError } = await this.supabase.admin
      .from('teacher_course_assignments')
      .select('course_id, campus_id, academic_year, semester, courses(id, course_code, title, category, semester, credits)')
      .eq('teacher_id', user.userId);

    if (assignError) {
      throw new InternalServerErrorException(`Failed to check assignments: ${assignError.message}`);
    }

    const assignedCourses = (assignments || []).map((a: any) => a.courses).filter(Boolean);
    const assignedCourseIds = assignedCourses.map((c: any) => c.id);

    const ist = getISTDateTime();
    let dateStr = ist.dateString;
    let dayOfWeek = ist.dayOfWeek;

    if (queryDate && this.isValidCalendarDate(queryDate)) {
      dateStr = queryDate;
      dayOfWeek = this.getCalendarDayOfWeek(queryDate);
    }

    let scheduleQuery = this.supabase.admin
      .from('timetable_entries')
      .select(`
        id,
        course_id,
        department_id,
        campus_id,
        teacher_id,
        academic_year,
        semester,
        session_type,
        is_lab_block,
        courses(id, course_code, title, category, semester, credits),
        time_slots(id, day_of_week, period_number, start_time, end_time),
        departments(campus_id)
      `)
      .eq('status', 'published');
    scheduleQuery = assignedCourseIds.length
      ? scheduleQuery.or(`teacher_id.eq.${user.userId},course_id.in.(${[...new Set(assignedCourseIds)].join(',')})`)
      : scheduleQuery.eq('teacher_id', user.userId);
    const rawEntries = await fetchAllPaginated<any>(scheduleQuery.order('id'));

    const entries = (rawEntries || []).filter((e: any) => {
      if (e.teacher_id === user.userId) return true;
      // A direct substitution takes precedence over an older course assignment.
      if (e.teacher_id) return false;
      const hostCampusId = e.campus_id || e.departments?.campus_id;
      return (assignments || []).some((a: any) => {
        if (a.course_id !== e.course_id) return false;
        if (a.campus_id && hostCampusId && a.campus_id !== hostCampusId) return false;
        if (a.academic_year && a.academic_year !== e.academic_year) return false;
        if (a.semester && a.semester !== e.semester) return false;
        return true;
      });
    });

    const weeklySchedule = (entries || []).map((entry: any) => ({
      timetable_slot_id: entry.id,
      course_id: entry.course_id,
      course_code: entry.courses?.course_code || '',
      course_title: entry.courses?.title || '',
      course_category: entry.courses?.category || '',
      course_semester: entry.semester,
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

    const periodsWithStatus = await Promise.all(
      dayEntries.map(async (entry: any) => {
        const slot = entry.time_slots;
        const campusId = (entry as any).campus_id || (entry as any).departments?.campus_id;

        const [roster, { data: marks }, { data: session }] = await Promise.all([
          this.getEnrolledRoster(entry.course_id, entry.academic_year, campusId, entry.semester),
          this.supabase.admin
            .from('period_attendance')
            .select('student_id, status, marked_at')
            .eq('timetable_slot_id', entry.id)
            .eq('attendance_date', dateStr),
          (() => {
            const sq = this.supabase.admin.from('period_attendance_sessions');
            return typeof (sq as any)?.select === 'function'
              ? sq.select('revision, revision_token').eq('timetable_slot_id', entry.id).eq('attendance_date', dateStr).maybeSingle()
              : Promise.resolve({ data: null });
          })(),
        ]);

        const isMarked = (marks || []).length > 0;
        const presentCount = (marks || []).filter((m: any) => m.status === 'present').length;
        const absentCount = (marks || []).filter((m: any) => m.status === 'absent').length;

        // R03: Validate that adjacent practical slot forms an approved consecutive pair
        const isPractical = entry.is_lab_block || entry.session_type === 'practical';
        let adjacentPracticalSlotId: string | null = null;
        if (isPractical && slot) {
          const nextPeriodNum = (slot.period_number || 0) + 1;
          const pairCheck = this.isValidPracticalPair(slot.period_number, nextPeriodNum);

          if (pairCheck.valid) {
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
        }

        return {
          timetable_slot_id: entry.id,
          course_id: entry.course_id,
          course_code: entry.courses?.course_code || '',
          course_title: entry.courses?.title || '',
          course_category: entry.courses?.category || '',
          course_semester: entry.semester,
          is_lab_block: entry.is_lab_block || false,
          session_type: entry.session_type || 'theory',
          period_number: slot?.period_number || 1,
          start_time: slot?.start_time || '',
          end_time: slot?.end_time || '',
          is_marked: isMarked,
          revision: session?.revision ?? (isMarked ? 1 : 0),
          revision_token: session?.revision_token ?? (isMarked ? '1' : '0'),
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

    const studentIdSet = new Set<string>();
    for (const reg of registrations || []) {
      studentIdSet.add(reg.student_id);
    }

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
   * Retrieves persistent dated marks and session revision for a timetable slot and date (F47, F48, R29).
   */
  async getSlotMarks(user: AuthUser, slotId: string, attendanceDate: string) {
    // 1. Centralized resolution and date/weekday validation (R28)
    const resolved = await this.resolveDatedSession(slotId, attendanceDate);

    // 2. Class authorization (R03/R07)
    await this.assertClassDeliveryAuthority(user, resolved.entry);

    // 3. Resolve current cohort roster
    const roster = await this.getEnrolledRoster(
      resolved.entry.course_id,
      resolved.entry.academic_year,
      resolved.campusId,
      resolved.entry.semester
    );

    // 4. Fetch existing marks and session revision (R29)
    const [marksRes, sessionRes] = await Promise.all([
      this.supabase.admin
        .from('period_attendance')
        .select('student_id, status, marked_at, marked_by')
        .eq('timetable_slot_id', slotId)
        .eq('attendance_date', resolved.attendanceDate),
      (() => {
        const sq = this.supabase.admin.from('period_attendance_sessions');
        return typeof (sq as any)?.select === 'function'
          ? sq.select('revision, revision_token, last_marked_at, marked_by').eq('timetable_slot_id', slotId).eq('attendance_date', resolved.attendanceDate).maybeSingle()
          : Promise.resolve({ data: null, error: null });
      })(),
    ]);

    if (marksRes.error) {
      throw new InternalServerErrorException(`Failed to fetch slot marks: ${marksRes.error.message}`);
    }

    const marks = marksRes.data || [];
    const session = sessionRes.data;
    const marksMap = new Map(marks.map((m: any) => [m.student_id, m]));
    const isMarked = marks.length > 0;

    let latestMarkedAt: string | null = session?.last_marked_at || null;
    let latestMarkedBy: string | null = session?.marked_by || null;

    if (!latestMarkedAt) {
      for (const m of marks) {
        if (!latestMarkedAt || (m.marked_at && m.marked_at > latestMarkedAt)) {
          latestMarkedAt = m.marked_at;
          latestMarkedBy = m.marked_by;
        }
      }
    }

    const currentRev = session?.revision ?? (isMarked ? 1 : 0);
    const currentRevToken =
      session?.revision_token ??
      (currentRev > 0
        ? crypto.createHash('md5').update(`${slotId}_${resolved.attendanceDate}_${currentRev}`).digest('hex')
        : '0');

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
        id: resolved.entry.id,
        course_id: resolved.entry.course_id,
        course_code: (resolved.entry as any).courses?.course_code,
        course_title: (resolved.entry as any).courses?.title,
        period_number: resolved.slot?.period_number,
        start_time: resolved.slot?.start_time,
        end_time: resolved.slot?.end_time,
        session_type: resolved.entry.session_type,
        is_lab_block: resolved.entry.is_lab_block,
      },
      attendance_date: resolved.attendanceDate,
      is_marked: isMarked,
      revision: currentRev,
      revision_token: currentRevToken,
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
   * Submits or corrects period attendance marks with atomic CAS optimistic locking (R28, R29).
   * Unrestricted correction time for valid active-semester dates; no grace or unlock limits.
   */
  async submitAttendance(
    user: AuthUser,
    slotId: string,
    absentStudentIds: string[],
    ip: string,
    attendanceDateInput?: string,
    lastMarkedAtInput?: string,
    expectedRevisionInput?: number | string
  ) {
    AuthorizationPolicy.assertNotRosterOnly(user, 'submit period attendance');

    // 1. Centralized resolution and date/weekday validation (R28)
    const resolved = await this.resolveDatedSession(slotId, attendanceDateInput);

    // 2. Class authorization (R03/R07)
    await this.assertClassDeliveryAuthority(user, resolved.entry);

    // 3. Cohort roster validation (F45 & R06)
    const roster = await this.getEnrolledRoster(
      resolved.entry.course_id,
      resolved.entry.academic_year,
      resolved.campusId,
      resolved.entry.semester
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

    // 4. Parse expected revision (R29)
    let parsedExpectedRev: number | null = null;
    if (expectedRevisionInput !== undefined && expectedRevisionInput !== null && expectedRevisionInput !== '') {
      parsedExpectedRev =
        typeof expectedRevisionInput === 'number'
          ? expectedRevisionInput
          : parseInt(expectedRevisionInput.toString(), 10);
      if (isNaN(parsedExpectedRev)) parsedExpectedRev = null;
    }

    const allRosterIds = roster.map((s) => s.id);
    const nowIso = new Date().toISOString();

    // 5. Attempt atomic database RPC with compare-and-swap (R29)
    if (typeof (this.supabase.admin as any).rpc === 'function') {
      const { data: rpcData, error: rpcError } = await (this.supabase.admin as any).rpc(
        'atomic_submit_period_attendance',
        {
          p_slot_id: slotId,
          p_attendance_date: resolved.attendanceDate,
          p_user_id: user.userId,
          p_absent_student_ids: absentStudentIds,
          p_all_roster_ids: allRosterIds,
          p_course_id: resolved.entry.course_id,
          p_expected_revision: parsedExpectedRev,
        }
      );

      if (!rpcError && rpcData) {
        await this.auditLogger.log({
          eventType: 'period_attendance_marked',
          userId: user.userId,
          userRole: user.role,
          action: `marked period attendance for slot ${slotId} on ${resolved.attendanceDate} (${absentStudentIds.length} absent, revision ${rpcData.revision})`,
          resourceType: 'period_attendance',
          resourceId: slotId,
          status: 'success',
          ipAddress: ip,
          metadata: {
            attendance_date: resolved.attendanceDate,
            revision: rpcData.revision,
            marked_at: rpcData.marked_at,
          },
        });

        return {
          success: true,
          attendance_date: resolved.attendanceDate,
          marked_at: rpcData.marked_at,
          revision: rpcData.revision,
          revision_token: rpcData.revision_token,
          total_students: rpcData.total_students,
          present_count: rpcData.present_count,
          absent_count: rpcData.absent_count,
        };
      }

      if (rpcError) {
        if (rpcError.message?.includes('ATTENDANCE_CONFLICT')) {
          throw new ConflictException(rpcError.message);
        }
        if (rpcError.message?.includes('retired or concluded')) {
          throw new BadRequestException(rpcError.message);
        }
        // If RPC is missing in mock test environment, continue to fallback below
        if (!rpcError.message?.includes('function atomic_submit_period_attendance') &&
            !rpcError.message?.includes('not found')) {
          throw new InternalServerErrorException(`Failed to record attendance: ${rpcError.message}`);
        }
      }
    }

    // Fallback atomic handling for unit tests & in-memory mocks
    // Check concurrency via existing marks / session
    const [{ data: existingMarks }, { data: existingSession }] = await Promise.all([
      this.supabase.admin
        .from('period_attendance')
        .select('student_id, marked_at')
        .eq('timetable_slot_id', slotId)
        .eq('attendance_date', resolved.attendanceDate),
      (() => {
        const sq = this.supabase.admin.from('period_attendance_sessions');
        return typeof (sq as any)?.select === 'function'
          ? sq.select('revision, revision_token, last_marked_at').eq('timetable_slot_id', slotId).eq('attendance_date', resolved.attendanceDate).maybeSingle()
          : Promise.resolve({ data: null });
      })(),
    ]);

    const isExistingMarked = (existingMarks || []).length > 0;
    const currentRev = existingSession?.revision ?? (isExistingMarked ? 1 : 0);

    // If caller provided an expected revision, enforce CAS token check
    if (parsedExpectedRev !== null) {
      if (parsedExpectedRev !== currentRev) {
        throw new ConflictException(
          `Attendance for this period was updated by another teacher (revision mismatch: current ${currentRev}, expected ${parsedExpectedRev}). Please refresh to inspect the latest marks.`
        );
      }
    } else if (lastMarkedAtInput) {
      // Legacy timestamp fallback check
      const newer = (existingMarks || []).filter((m: any) => m.marked_at && m.marked_at > lastMarkedAtInput);
      if (newer.length > 0) {
        throw new ConflictException(
          'Attendance for this period was updated by another teacher while you were editing. Please refresh to inspect the latest marks.'
        );
      }
    }

    const newRev = currentRev + 1;
    const revToken = crypto.createHash('md5').update(`${slotId}_${resolved.attendanceDate}_${newRev}`).digest('hex');
    const absentSet = new Set(absentStudentIds);

    const rows = roster.map((student) => ({
      timetable_slot_id: slotId,
      student_id: student.id,
      course_id: resolved.entry.course_id,
      marked_by: user.userId,
      status: absentSet.has(student.id) ? 'absent' : 'present',
      marked_at: nowIso,
      attendance_date: resolved.attendanceDate,
      is_late_entry: false,
    }));

    const { error: upsertError } = await this.supabase.admin
      .from('period_attendance')
      .upsert(rows, { onConflict: 'timetable_slot_id,student_id,attendance_date' });

    if (upsertError) {
      throw new InternalServerErrorException(`Failed to record attendance: ${upsertError.message}`);
    }

    // Upsert session
    const sessTable = this.supabase.admin.from('period_attendance_sessions');
    if (typeof (sessTable as any)?.upsert === 'function') {
      await sessTable.upsert(
        {
          timetable_slot_id: slotId,
          attendance_date: resolved.attendanceDate,
          revision: newRev,
          revision_token: revToken,
          marked_by: user.userId,
          last_marked_at: nowIso,
          total_students: roster.length,
          present_count: rows.length - absentStudentIds.length,
          absent_count: absentStudentIds.length,
          updated_at: nowIso,
        },
        { onConflict: 'timetable_slot_id,attendance_date' }
      );
    }

    await this.auditLogger.log({
      eventType: 'period_attendance_marked',
      userId: user.userId,
      userRole: user.role,
      action: `marked period attendance for slot ${slotId} on ${resolved.attendanceDate} (${absentStudentIds.length} absent, ${rows.length - absentStudentIds.length} present, revision ${newRev})`,
      resourceType: 'period_attendance',
      resourceId: slotId,
      status: 'success',
      ipAddress: ip,
      metadata: {
        attendance_date: resolved.attendanceDate,
        revision: newRev,
        marked_at: nowIso,
      },
    });

    return {
      success: true,
      attendance_date: resolved.attendanceDate,
      marked_at: nowIso,
      revision: newRev,
      revision_token: revToken,
      total_students: roster.length,
      present_count: rows.length - absentStudentIds.length,
      absent_count: absentStudentIds.length,
    };
  }

  /**
   * Copies attendance marks from an adjacent practical period to the next period (R03, R29).
   * Enforces exact delivery authorization, identical class/cohort/date context,
   * approved consecutive practical pairs (no lunch crossing), and atomic CAS overwrite protection.
   */
  async copyPracticalAttendance(user: AuthUser, dto: CopyPracticalDto, ip: string) {
    AuthorizationPolicy.assertNotRosterOnly(user, 'copy practical period attendance');

    // 1. Resolve source and target dated sessions (R28)
    const sourceDated = await this.resolveDatedSession(dto.source_slot_id, dto.attendance_date);
    const targetDated = await this.resolveDatedSession(dto.target_slot_id, dto.attendance_date);

    // 2. Authorize actor on BOTH class deliveries (R03)
    await this.assertClassDeliveryAuthority(user, sourceDated.entry);
    await this.assertClassDeliveryAuthority(user, targetDated.entry);

    // 3. Validate identical cohort / course delivery context (R03)
    if (sourceDated.entry.course_id !== targetDated.entry.course_id) {
      throw new BadRequestException('Cannot copy practical attendance between different courses (R03/F49).');
    }

    if (sourceDated.entry.department_id !== targetDated.entry.department_id) {
      throw new BadRequestException('Cannot copy practical attendance between different departments (R03).');
    }

    if (sourceDated.campusId !== targetDated.campusId) {
      throw new BadRequestException('Cannot copy practical attendance between different campuses (R03).');
    }

    if (
      sourceDated.entry.academic_year !== targetDated.entry.academic_year ||
      sourceDated.entry.semester !== targetDated.entry.semester
    ) {
      throw new BadRequestException(
        'Cannot copy practical attendance between different academic years or semesters (R03).'
      );
    }

    // 4. Validate practical session types (R03)
    const isSourcePractical =
      sourceDated.entry.is_lab_block === true || sourceDated.entry.session_type === 'practical';
    const isTargetPractical =
      targetDated.entry.is_lab_block === true || targetDated.entry.session_type === 'practical';

    if (!isSourcePractical || !isTargetPractical) {
      throw new BadRequestException(
        'Practical attendance copying is only allowed between practical / lab sessions (R03).'
      );
    }

    // 5. Validate consecutive practical pair (R03: rejects lunch crossing P3-P4 & non-adjacent)
    const srcPeriod = sourceDated.slot?.period_number;
    const tgtPeriod = targetDated.slot?.period_number;
    const pairCheck = this.isValidPracticalPair(srcPeriod, tgtPeriod);

    if (!pairCheck.valid) {
      throw new BadRequestException(pairCheck.reason);
    }

    // 6. Fetch marks from source slot on requested attendance_date
    const { data: sourceMarks, error: sourceMarksError } = await this.supabase.admin
      .from('period_attendance')
      .select('student_id, status, course_id')
      .eq('timetable_slot_id', dto.source_slot_id)
      .eq('attendance_date', dto.attendance_date);

    if (sourceMarksError || !sourceMarks || sourceMarks.length === 0) {
      throw new BadRequestException(
        `Source practical period has no attendance recorded for ${dto.attendance_date}. Mark the source period first (R03).`
      );
    }

    // 7. Parse expected target revision (R29)
    let parsedExpectedTargetRev: number | null = null;
    const candidateRev = dto.expected_target_revision ?? dto.expected_revision;
    if (candidateRev !== undefined && candidateRev !== null && candidateRev !== '') {
      parsedExpectedTargetRev =
        typeof candidateRev === 'number' ? candidateRev : parseInt(candidateRev.toString(), 10);
      if (isNaN(parsedExpectedTargetRev)) parsedExpectedTargetRev = null;
    }

    // 8. Attempt atomic database RPC (R03, R29)
    if (typeof (this.supabase.admin as any).rpc === 'function') {
      const { data: rpcData, error: rpcError } = await (this.supabase.admin as any).rpc(
        'atomic_copy_practical_attendance',
        {
          p_source_slot_id: dto.source_slot_id,
          p_target_slot_id: dto.target_slot_id,
          p_attendance_date: dto.attendance_date,
          p_user_id: user.userId,
          p_expected_target_revision: parsedExpectedTargetRev,
        }
      );

      if (!rpcError && rpcData) {
        await this.auditLogger.log({
          eventType: 'period_attendance_copied',
          userId: user.userId,
          userRole: user.role,
          action: `copied practical attendance from slot ${dto.source_slot_id} to ${dto.target_slot_id} on ${dto.attendance_date} (${rpcData.copied_count} records, revision ${rpcData.target_revision})`,
          resourceType: 'period_attendance',
          resourceId: dto.target_slot_id,
          status: 'success',
          ipAddress: ip,
          metadata: {
            source_slot_id: dto.source_slot_id,
            target_slot_id: dto.target_slot_id,
            attendance_date: dto.attendance_date,
            target_revision: rpcData.target_revision,
          },
        });

        return {
          success: true,
          copied_count: rpcData.copied_count,
          present_count: rpcData.present_count,
          absent_count: rpcData.absent_count,
          target_revision: rpcData.target_revision,
          attendance_date: dto.attendance_date,
        };
      }

      if (rpcError) {
        if (rpcError.message?.includes('ATTENDANCE_CONFLICT')) {
          throw new ConflictException(rpcError.message);
        }
        if (rpcError.message?.includes('lunch boundary') ||
            rpcError.message?.includes('different') ||
            rpcError.message?.includes('Invalid practical period pair')) {
          throw new BadRequestException(rpcError.message);
        }
        if (!rpcError.message?.includes('function atomic_copy_practical_attendance') &&
            !rpcError.message?.includes('not found')) {
          throw new InternalServerErrorException(`Failed to copy practical attendance: ${rpcError.message}`);
        }
      }
    }

    const [{ data: existingTargetMarks }, { data: existingTargetSession }] = await Promise.all([
      this.supabase.admin
        .from('period_attendance')
        .select('student_id')
        .eq('timetable_slot_id', dto.target_slot_id)
        .eq('attendance_date', dto.attendance_date),
      (() => {
        const sq = this.supabase.admin.from('period_attendance_sessions');
        return typeof (sq as any)?.select === 'function'
          ? sq.select('revision, revision_token').eq('timetable_slot_id', dto.target_slot_id).eq('attendance_date', dto.attendance_date).maybeSingle()
          : Promise.resolve({ data: null });
      })(),
    ]);

    const isTargetMarked = (existingTargetMarks || []).length > 0;
    const currentTargetRev = existingTargetSession?.revision ?? (isTargetMarked ? 1 : 0);

    // Overwrite guard & revision CAS
    if (parsedExpectedTargetRev !== null) {
      if (parsedExpectedTargetRev !== currentTargetRev) {
        throw new ConflictException(
          `Target period revision mismatch (current ${currentTargetRev}, expected ${parsedExpectedTargetRev}). Please inspect current target marks before copying (R29).`
        );
      }
    } else if (isTargetMarked && !dto.overwrite) {
      throw new ConflictException(
        `Target period already has ${existingTargetMarks.length} attendance marks recorded for ${dto.attendance_date}. Set overwrite to true or provide expected target revision to proceed (F49/R29).`
      );
    }

    const nowIso = new Date().toISOString();
    const newTargetRev = currentTargetRev + 1;
    const targetRevToken = crypto
      .createHash('md5')
      .update(`${dto.target_slot_id}_${dto.attendance_date}_${newTargetRev}`)
      .digest('hex');

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

    // Upsert target session
    const presentCount = targetRows.filter((r) => r.status === 'present').length;
    const absentCount = targetRows.filter((r) => r.status === 'absent').length;

    const targetSessTable = this.supabase.admin.from('period_attendance_sessions');
    if (typeof (targetSessTable as any)?.upsert === 'function') {
      await targetSessTable.upsert(
        {
          timetable_slot_id: dto.target_slot_id,
          attendance_date: dto.attendance_date,
          revision: newTargetRev,
          revision_token: targetRevToken,
          marked_by: user.userId,
          last_marked_at: nowIso,
          total_students: targetRows.length,
          present_count: presentCount,
          absent_count: absentCount,
          updated_at: nowIso,
        },
        { onConflict: 'timetable_slot_id,attendance_date' }
      );
    }

    await this.auditLogger.log({
      eventType: 'period_attendance_copied',
      userId: user.userId,
      userRole: user.role,
      action: `copied practical attendance from slot ${dto.source_slot_id} to ${dto.target_slot_id} on ${dto.attendance_date} (${targetRows.length} records, revision ${newTargetRev})`,
      resourceType: 'period_attendance',
      resourceId: dto.target_slot_id,
      status: 'success',
      ipAddress: ip,
      metadata: {
        source_slot_id: dto.source_slot_id,
        target_slot_id: dto.target_slot_id,
        attendance_date: dto.attendance_date,
        target_revision: newTargetRev,
      },
    });

    return {
      success: true,
      copied_count: targetRows.length,
      present_count: presentCount,
      absent_count: absentCount,
      target_revision: newTargetRev,
      attendance_date: dto.attendance_date,
    };
  }

  /**
   * HOD queries student roster and marked status for a specific slot on an explicit date (F46, R28).
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
    let attendanceDate = ist.dateString;
    if (queryDate && this.isValidCalendarDate(queryDate)) {
      attendanceDate = queryDate;
    }

    const campusId = (entry as any).departments?.campus_id;
    const roster = await this.getEnrolledRoster(
      entry.course_id,
      entry.academic_year,
      campusId,
      entry.semester
    );

    const [{ data: marks }, { data: session }] = await Promise.all([
      this.supabase.admin
        .from('period_attendance')
        .select('student_id, status, marked_at, marked_by')
        .eq('timetable_slot_id', slotId)
        .eq('attendance_date', attendanceDate),
      (() => {
        const sq = this.supabase.admin.from('period_attendance_sessions');
        return typeof (sq as any)?.select === 'function'
          ? sq.select('revision, revision_token').eq('timetable_slot_id', slotId).eq('attendance_date', attendanceDate).maybeSingle()
          : Promise.resolve({ data: null });
      })(),
    ]);

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
    const unmarkedCount = totalEnrolled - (marks || []).length;
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
      revision: session?.revision ?? (isMarked ? 1 : 0),
      revision_token: session?.revision_token ?? (isMarked ? '1' : '0'),
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
    let attendanceDate = ist.dateString;
    if (queryDate && this.isValidCalendarDate(queryDate)) {
      attendanceDate = queryDate;
    }

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
    let sessions: any[] = [];

    if (entryIds.length > 0) {
      const [marksRes, sessionsRes] = await Promise.all([
        this.supabase.admin
          .from('period_attendance')
          .select('timetable_slot_id, status')
          .in('timetable_slot_id', entryIds)
          .eq('attendance_date', attendanceDate),
        (() => {
          const sq = this.supabase.admin.from('period_attendance_sessions');
          return typeof (sq as any)?.select === 'function'
            ? sq.select('timetable_slot_id, revision, revision_token').in('timetable_slot_id', entryIds).eq('attendance_date', attendanceDate)
            : Promise.resolve({ data: [] });
        })(),
      ]);

      marks = marksRes.data || [];
      sessions = sessionsRes.data || [];
    }

    const sessionMap = new Map(sessions.map((s: any) => [s.timetable_slot_id, s]));

    const result = (entries || []).map((entry: any) => {
      const slotMarks = marks.filter((m: any) => m.timetable_slot_id === entry.id);
      const isMarked = slotMarks.length > 0;
      const presentCount = slotMarks.filter((m: any) => m.status === 'present').length;
      const absentCount = slotMarks.filter((m: any) => m.status === 'absent').length;
      const session = sessionMap.get(entry.id);

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
        revision: session?.revision ?? (isMarked ? 1 : 0),
        revision_token: session?.revision_token ?? (isMarked ? '1' : '0'),
        present_count: presentCount,
        absent_count: absentCount,
      };
    });

    return result;
  }
}
