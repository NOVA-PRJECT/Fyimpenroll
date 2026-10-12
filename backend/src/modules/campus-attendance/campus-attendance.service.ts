import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../../core/database/supabase.service';
import { AuditLoggerService } from '../../core/logging/audit-logger.service';
import { fetchAllPaginated, fetchByIdChunks } from '../../core/database/pagination.util';
import { AuthUser } from '../../core/auth/types';
import { CampusAttendanceStatus, formatCampusTime } from '@fyimp/contracts';
import { attendanceSettings, campusSetupError, timeMinutes } from './campus-settings';
import { CampusSignInSchema } from './dto/campus-attendance.dto';

interface CampusRecord {
  id: string;
  name: string;
  code: string;
  center_latitude: number | null;
  center_longitude: number | null;
  radius_meters: number;
  morning_cutoff_time: string;
  midday_split_time: string;
  evening_cutoff_time: string;
  day_end_time: string;
}

@Injectable()
export class CampusAttendanceService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService
  ) {}

  /**
   * Computes the great-circle distance between two coordinates in meters
   * using the Haversine formula. Server-side only; never trust client distance.
   */
  public calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371000; // Earth radius in meters
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const clamped = Math.max(0, Math.min(1, a));
    const c = 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
    return R * c;
  }

  /**
   * Converts current UTC server time to Indian Standard Time (IST, UTC+5:30)
   */
  private getISTDateTime(date: Date = new Date()): {
    totalMinutes: number;
    timeString: string;
    dateString: string;
  } {
    // Convert to IST
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(date.getTime() + istOffsetMs);

    const hours = istDate.getUTCHours();
    const minutes = istDate.getUTCMinutes();
    const seconds = istDate.getUTCSeconds();

    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');

    const year = istDate.getUTCFullYear();
    const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(istDate.getUTCDate()).padStart(2, '0');

    return {
      totalMinutes: hours * 60 + minutes + seconds / 60 + istDate.getUTCMilliseconds() / 60000,
      timeString: `${hh}:${mm}:${ss}`,
      dateString: `${year}-${month}-${day}`,
    };
  }

  /**
   * Records student campus arrival/departure after GPS geofence verification.
   * Coordinates are verified in memory and never saved to the database.
   */
  async recordCampusSignIn(
    user: AuthUser,
    clientLat: number,
    clientLon: number,
    accuracy: number,
    ip: string,
    clientTimestamp: string,
  ) {
    if (user.role !== 'student') throw new ForbiddenException('Only students can sign in.');
    const input = CampusSignInSchema.safeParse({ latitude: clientLat, longitude: clientLon, accuracy, client_timestamp: clientTimestamp });
    if (!input.success) throw new BadRequestException(input.error.issues[0].message);
    const requestTime = new Date();
    const capturedAt = new Date(clientTimestamp);
    const age = requestTime.getTime() - capturedAt.getTime();
    if (age > 60000 || age < -10000) {
      throw new BadRequestException('Location expired or device clock is incorrect. Enable automatic time and sign in again while online.');
    }
    const studentId = user.userId;

    // 1. Resolve student and their assigned campus
    const { data: student, error: studentError } = await this.supabase.admin
      .from('students')
      .select('id, full_name, department_id, campus_id, campuses(*)')
      .eq('id', studentId)
      .maybeSingle();

    if (studentError) throw new InternalServerErrorException('Unable to load your student profile. Please try again.');
    if (!student) {
      throw new NotFoundException('Student profile not found.');
    }

    const campus = (student as any).campuses as CampusRecord;
    if (!campus) {
      throw new NotFoundException('No university campus linked to your student account.');
    }

    const setupError = campusSetupError(campus);
    if (setupError) throw new BadRequestException(setupError);
    const settings = attendanceSettings(campus);

    // 2. Server-side Haversine Distance Check
    const distanceMeters = this.calculateHaversineDistance(
      clientLat,
      clientLon,
      Number(campus.center_latitude),
      Number(campus.center_longitude)
    );

    const allowedRadius = settings.radius_meters;
    if (distanceMeters > allowedRadius) {
      const excess = Math.round(distanceMeters - allowedRadius);
      throw new BadRequestException(
        `Outside campus geofence: You are ${Math.round(distanceMeters)}m from ${campus.name} center (allowed: ${allowedRadius}m, ${excess}m outside boundary). Please sign in from within campus premises.`
      );
    }

    // 3. IST Time and Session Evaluation
    const now = requestTime;
    const ist = this.getISTDateTime(now);

    const morningCutoffMin = timeMinutes(settings.morning_cutoff_time);
    const middaySplitMin = timeMinutes(settings.midday_split_time);
    const eveningCutoffMin = timeMinutes(settings.evening_cutoff_time);
    const dayEndMin = timeMinutes(settings.day_end_time);
    const capturedIST = this.getISTDateTime(capturedAt);
    if (capturedIST.dateString !== ist.dateString ||
        (capturedIST.totalMinutes < middaySplitMin) !== (ist.totalMinutes < middaySplitMin)) {
      throw new BadRequestException('The attendance session changed. Acquire a fresh location and sign in again.');
    }

    let sessionType: 'morning' | 'evening';
    let status: 'on_time' | 'late' | 'early_leave';

    if (ist.totalMinutes < middaySplitMin) {
      sessionType = 'morning';
      status = ist.totalMinutes <= morningCutoffMin ? 'on_time' : 'late';
    } else if (ist.totalMinutes >= middaySplitMin && ist.totalMinutes <= dayEndMin) {
      sessionType = 'evening';
      status = ist.totalMinutes >= eveningCutoffMin ? 'on_time' : 'early_leave';
    } else {
      throw new BadRequestException(
        `Campus attendance checkpoints are closed for today (day ends at ${formatCampusTime(settings.day_end_time)} IST).`
      );
    }

    // 4. Idempotency Check: check if already signed in for this session today
    const { data: existing, error: existingError } = await this.supabase.admin
      .from('campus_sign_ins')
      .select('id, signed_in_at, status')
      .eq('student_id', studentId)
      .eq('campus_id', campus.id)
      .eq('signed_in_date', ist.dateString)
      .eq('session_type', sessionType)
      .maybeSingle();

    if (existingError) throw new InternalServerErrorException('Unable to check existing sign-in. Please try again.');
    if (existing) {
      throw new ConflictException(
        `You have already completed your ${sessionType} campus verification today at ${new Date(existing.signed_in_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}.`
      );
    }

    // 5. Insert Record (ZERO COORDINATE RETENTION: lat/lon are NOT saved)
    const { data: inserted, error: insertError } = await this.supabase.admin
      .from('campus_sign_ins')
      .insert({
        student_id: studentId,
        campus_id: campus.id,
        session_type: sessionType,
        signed_in_at: now.toISOString(),
        location_accuracy_meters: Math.round(accuracy * 10) / 10,
        status: status,
        source: 'gps',
      })
      .select('id, session_type, status, signed_in_at, location_accuracy_meters')
      .single();

    if (insertError?.code === '23505') throw new ConflictException(`Your ${sessionType} campus sign-in is already recorded. Refresh your status.`);
    if (insertError || !inserted) throw new InternalServerErrorException('Failed to record campus sign-in. Please refresh your status before trying again.');

    // 6. Audit Logging
    await this.auditLogger.log({
      eventType: 'campus_sign_in',
      userId: user.userId,
      userRole: user.role,
      action: `${sessionType} campus sign-in at ${campus.name} (Status: ${status})`,
      resourceType: 'campus_sign_in',
      resourceId: inserted.id,
      status: 'success',
      ipAddress: ip,
      metadata: {
        campus_name: campus.name,
        session_type: sessionType,
        status: status,
        distance_meters: Math.round(distanceMeters),
        accuracy_meters: accuracy,
      },
    });

    return {
      success: true,
      session_type: sessionType,
      campus_name: campus.name,
      status: status,
      distance_meters: Math.round(distanceMeters),
      signed_in_at: inserted.signed_in_at,
      message:
        status === 'on_time'
          ? `✓ ${sessionType.toUpperCase()} sign-in verified on-time at ${campus.name}!`
          : status === 'late'
          ? `Morning sign-in recorded (late: after ${formatCampusTime(settings.morning_cutoff_time)} IST).`
          : `Evening sign-in recorded (early leave: before ${formatCampusTime(settings.evening_cutoff_time)} IST).`,
    };
  }

  /**
   * Retrieves today's morning & evening campus verification status for a student.
   */
  async getStudentCampusStatus(user: AuthUser, studentId: string): Promise<CampusAttendanceStatus> {
    // Students can only view themselves. Staff scope is checked against the
    // student's database profile below; route roles alone are not enough.
    if (user.role === 'student' && user.userId !== studentId) {
      throw new ForbiddenException('Cannot access attendance for another student.');
    }

    const { data: student, error: studentError } = await this.supabase.admin
      .from('students')
      .select('id, full_name, campus_id, department_id, campuses(*)')
      .eq('id', studentId)
      .maybeSingle();

    if (studentError) throw new InternalServerErrorException('Unable to load your student profile. Please try again.');
    if (!student) {
      throw new NotFoundException('Student profile not found.');
    }

    const belongsToUserScope = (() => {
      switch (user.role) {
        case 'student':
          return student.id === user.userId;
        case 'hod':
        case 'teacher':
          return !!user.department_id &&
            student.department_id === user.department_id &&
            student.campus_id === user.campus_id;
        case 'teaching_staff':
        case 'campus_director':
          return !!user.campus_id && student.campus_id === user.campus_id;
        case 'superadmin':
          return true;
        default:
          return false;
      }
    })();

    if (!belongsToUserScope) {
      throw new ForbiddenException('Cannot access attendance outside your campus or department.');
    }

    const campus = (student as any).campuses as CampusRecord;
    const ist = this.getISTDateTime();
    const settings = attendanceSettings(campus);
    const setupError = campusSetupError(campus);

    // Query today's sign-in rows
    const { data: records, error: recordsError } = await this.supabase.admin
      .from('campus_sign_ins')
      .select('id, session_type, status, signed_in_at, location_accuracy_meters')
      .eq('student_id', studentId)
      .eq('campus_id', student.campus_id || '00000000-0000-0000-0000-000000000000')
      .eq('signed_in_date', ist.dateString);

    if (recordsError) {
      throw new InternalServerErrorException('Unable to load campus attendance. Please try again.');
    }

    const morningRecord = records?.find((r) => r.session_type === 'morning');
    const eveningRecord = records?.find((r) => r.session_type === 'evening');

    const middaySplitMin = timeMinutes(settings.midday_split_time);
    const dayEndMin = timeMinutes(settings.day_end_time);

    // Resolve Morning Session
    let morningState: 'completed' | 'pending' | 'absent';
    if (morningRecord) {
      morningState = 'completed';
    } else if (ist.totalMinutes < middaySplitMin) {
      morningState = 'pending';
    } else {
      morningState = 'absent';
    }

    // Resolve Evening Session
    let eveningState: 'completed' | 'pending' | 'absent';
    if (eveningRecord) {
      eveningState = 'completed';
    } else if (ist.totalMinutes <= dayEndMin) {
      eveningState = 'pending';
    } else {
      eveningState = 'absent';
    }

    const activeSession = ist.totalMinutes < middaySplitMin ? 'morning' : ist.totalMinutes <= dayEndMin ? 'evening' : 'closed';
    const completed = activeSession === 'morning' ? !!morningRecord : activeSession === 'evening' && !!eveningRecord;
    return {
      date: ist.dateString,
      current_time_ist: ist.timeString,
      active_session: activeSession,
      can_sign_in: !setupError && activeSession !== 'closed' && !completed,
      unavailable_reason: setupError || (activeSession === 'closed' ? `Campus checkpoints closed at ${formatCampusTime(settings.day_end_time)} IST.` : completed ? 'This session is already recorded.' : null),
      campus: {
        id: campus?.id ?? null,
        name: campus?.name ?? null,
        radius_meters: settings.radius_meters,
        morning_cutoff: settings.morning_cutoff_time,
        midday_split: settings.midday_split_time,
        evening_cutoff: settings.evening_cutoff_time,
        day_end: settings.day_end_time,
      },
      morning: {
        state: morningState,
        status: morningRecord?.status || null,
        signed_in_at: morningRecord?.signed_in_at || null,
      },
      evening: {
        state: eveningState,
        status: eveningRecord?.status || null,
        signed_in_at: eveningRecord?.signed_in_at || null,
      },
    };
  }

  /**
   * HOD roster query: Joins all students in the HOD's department with today's (or given date's)
   * campus sign-ins, resolving morning and evening status, with urgency sorting.
   */
  async getDepartmentCampusRoster(user: AuthUser, queryDate?: string) {
    const istNow = this.getISTDateTime();
    if (queryDate && (!/^\d{4}-\d{2}-\d{2}$/.test(queryDate) ||
        !Number.isFinite(Date.parse(`${queryDate}T00:00:00Z`)) ||
        new Date(`${queryDate}T00:00:00Z`).toISOString().slice(0, 10) !== queryDate)) {
      throw new BadRequestException('Use a valid attendance date (YYYY-MM-DD).');
    }
    const targetDate = queryDate || istNow.dateString;
    if (targetDate > istNow.dateString) throw new BadRequestException('Attendance cannot be viewed for a future date.');
    const isToday = targetDate === istNow.dateString;

    let campus: CampusRecord | null = null;
    let dept: any = null;
    let studentsQuery = this.supabase.admin
      .from('students')
      .select('id, full_name, cap_application_number, current_semester, department_id, campus_id, campuses(*)')
      .order('full_name', { ascending: true });

    if (user.role === 'hod') {
      if (!user.department_id || !user.campus_id) {
        throw new ForbiddenException('HOD is not associated with any academic department.');
      }
      const { data: deptData, error: deptError } = await this.supabase.admin
        .from('departments')
        .select('id, name, campus_id, campuses(*)')
        .eq('id', user.department_id)
        .single();

      if (deptError || !deptData) {
        throw new NotFoundException('Department details not found.');
      }
      dept = deptData;
      if (dept.campus_id !== user.campus_id) throw new ForbiddenException('Department is outside your campus.');
      campus = (dept as any).campuses as CampusRecord;
      studentsQuery = studentsQuery.eq('department_id', user.department_id).eq('campus_id', user.campus_id);
    } else if (user.role === 'campus_director') {
      if (!user.campus_id) {
        throw new ForbiddenException('Campus Director has no assigned campus affiliation.');
      }
      const { data: campusData, error: campusError } = await this.supabase.admin
        .from('campuses')
        .select('*')
        .eq('id', user.campus_id)
        .single();

      if (campusError || !campusData) {
        throw new NotFoundException('Campus details not found.');
      }
      campus = campusData as CampusRecord;
      studentsQuery = studentsQuery.eq('campus_id', user.campus_id);
    } else if (user.role !== 'superadmin') {
      throw new ForbiddenException(`Role '${user.role}' is not authorized to view attendance roster.`);
    }

    // 2. Fetch scoped students
    const students = await fetchAllPaginated<any>(studentsQuery.order('id'));

    const studentIds = (students || []).map((s) => s.id);

    // 3. Fetch sign-in rows for these students on targetDate
    let signIns: any[] = [];
    if (studentIds.length > 0) {
      signIns = await fetchByIdChunks<any>(studentIds, ids => this.supabase.admin
        .from('campus_sign_ins').select('id, student_id, campus_id, session_type, status, signed_in_at')
        .in('student_id', ids).eq('signed_in_date', targetDate).order('id'));
    }
    const signInByStudentSession = new Map(signIns.map(row => [`${row.student_id}:${row.campus_id}:${row.session_type}`, row]));

    // 4. Map students to status derivation
    let morningOnTime = 0;
    let morningLate = 0;
    let morningAbsent = 0;
    let morningPending = 0;

    let eveningOnTime = 0;
    let eveningEarlyLeave = 0;
    let eveningAbsent = 0;
    let eveningPending = 0;

    const roster = (students || []).map((student) => {
      const morningRecord = signInByStudentSession.get(`${student.id}:${student.campus_id}:morning`);
      const eveningRecord = signInByStudentSession.get(`${student.id}:${student.campus_id}:evening`);
      const settings = attendanceSettings(student.campuses || campus);
      const middaySplitMin = timeMinutes(settings.midday_split_time);
      const dayEndMin = timeMinutes(settings.day_end_time);

      // Derive Morning Status
      let morningDerivedStatus: 'on_time' | 'late' | 'absent' | 'pending';
      if (morningRecord) {
        morningDerivedStatus = morningRecord.status;
        if (morningRecord.status === 'on_time') morningOnTime++;
        else morningLate++;
      } else if (isToday && istNow.totalMinutes < middaySplitMin) {
        morningDerivedStatus = 'pending';
        morningPending++;
      } else {
        morningDerivedStatus = 'absent';
        morningAbsent++;
      }

      // Derive Evening Status
      let eveningDerivedStatus: 'on_time' | 'early_leave' | 'absent' | 'pending';
      if (eveningRecord) {
        eveningDerivedStatus = eveningRecord.status;
        if (eveningRecord.status === 'on_time') eveningOnTime++;
        else eveningEarlyLeave++;
      } else if (isToday && istNow.totalMinutes <= dayEndMin) {
        eveningDerivedStatus = 'pending';
        eveningPending++;
      } else {
        eveningDerivedStatus = 'absent';
        eveningAbsent++;
      }

      // Compute Urgency Score for sorting (Absent = 4, Late/Early = 3, Pending = 2, On Time = 1)
      let urgencyScore = 0;
      if (morningDerivedStatus === 'absent' || eveningDerivedStatus === 'absent') urgencyScore += 4;
      if (morningDerivedStatus === 'late' || eveningDerivedStatus === 'early_leave') urgencyScore += 3;
      if (morningDerivedStatus === 'pending' || eveningDerivedStatus === 'pending') urgencyScore += 2;
      if (morningDerivedStatus === 'on_time' && eveningDerivedStatus === 'on_time') urgencyScore += 1;

      return {
        id: student.id,
        full_name: student.full_name,
        cap_application_number: student.cap_application_number,
        current_semester: student.current_semester,
        morning: {
          status: morningDerivedStatus,
          signed_in_at: morningRecord?.signed_in_at || null,
        },
        evening: {
          status: eveningDerivedStatus,
          signed_in_at: eveningRecord?.signed_in_at || null,
        },
        urgency_score: urgencyScore,
      };
    });

    // Default Sort: Most urgent problems first (Absent -> Late/Early Leave -> Pending -> On Time)
    roster.sort((a, b) => b.urgency_score - a.urgency_score);

    return {
      department: {
        id: dept?.id || null,
        name: dept?.name || (user.role === 'campus_director' ? 'All Departments' : 'Department'),
        campus_name: campus?.name || (user.role === 'superadmin' ? 'All campuses' : 'Unknown campus'),
      },
      date: targetDate,
      summary: {
        total_students: students.length,
        morning: {
          on_time: morningOnTime,
          late: morningLate,
          absent: morningAbsent,
          pending: morningPending,
        },
        evening: {
          on_time: eveningOnTime,
          early_leave: eveningEarlyLeave,
          absent: eveningAbsent,
          pending: eveningPending,
        },
      },
      roster: roster,
    };
  }
}
