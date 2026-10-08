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
import { AuthUser } from '../../core/auth/types';

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

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Helper to convert time string (HH:MM:SS or HH:MM) to minutes from midnight.
   */
  private timeStringToMinutes(timeStr: string): number {
    const parts = timeStr.split(':').map((p) => parseInt(p, 10));
    return parts[0] * 60 + (parts[1] || 0);
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
      totalMinutes: hours * 60 + minutes,
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
    ip: string
  ) {
    const studentId = user.userId;

    // 1. Resolve student and their assigned campus
    const { data: student, error: studentError } = await this.supabase.admin
      .from('students')
      .select('id, full_name, department_id, campus_id, campuses(*)')
      .eq('id', studentId)
      .maybeSingle();

    if (studentError || !student) {
      throw new NotFoundException('Student profile not found.');
    }

    const campus = (student as any).campuses as CampusRecord;
    if (!campus) {
      throw new NotFoundException('No university campus linked to your student account.');
    }

    if (campus.center_latitude === null || campus.center_longitude === null) {
      throw new InternalServerErrorException(
        `Campus geofence coordinates are not configured for ${campus.name}. Please contact your administrator.`
      );
    }

    // 2. Server-side Haversine Distance Check
    const distanceMeters = this.calculateHaversineDistance(
      clientLat,
      clientLon,
      Number(campus.center_latitude),
      Number(campus.center_longitude)
    );

    const allowedRadius = campus.radius_meters || 400;
    if (distanceMeters > allowedRadius) {
      const excess = Math.round(distanceMeters - allowedRadius);
      throw new BadRequestException(
        `Outside campus geofence: You are ${Math.round(distanceMeters)}m from ${campus.name} center (allowed: ${allowedRadius}m, ${excess}m outside boundary). Please sign in from within campus premises.`
      );
    }

    // 3. IST Time and Session Evaluation
    const now = new Date();
    const ist = this.getISTDateTime(now);

    const morningCutoffMin = this.timeStringToMinutes(campus.morning_cutoff_time || '09:30:00');
    const middaySplitMin = this.timeStringToMinutes(campus.midday_split_time || '13:30:00');
    const eveningCutoffMin = this.timeStringToMinutes(campus.evening_cutoff_time || '15:30:00');
    const dayEndMin = this.timeStringToMinutes(campus.day_end_time || '17:00:00');

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
        'Campus attendance checkpoints are closed for today (Day closed at 17:00 IST).'
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
        signed_in_date: ist.dateString,
        location_accuracy_meters: Math.round(accuracy * 10) / 10,
        status: status,
        source: 'gps',
      })
      .select('id, session_type, status, signed_in_at, location_accuracy_meters')
      .single();

    if (insertError) {
      throw new InternalServerErrorException(
        `Failed to record campus sign-in: ${insertError.message}`
      );
    }

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
          ? `⚠️ Morning sign-in recorded (Late: after ${campus.morning_cutoff_time.slice(0, 5)} AM)`
          : `⚠️ Evening sign-in recorded (Early Leave: before ${campus.evening_cutoff_time.slice(0, 5)} PM)`,
    };
  }

  /**
   * Retrieves today's morning & evening campus verification status for a student.
   */
  async getStudentCampusStatus(user: AuthUser, studentId: string) {
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

    if (studentError || !student) {
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

    // Query today's sign-in rows
    const { data: records, error: recordsError } = await this.supabase.admin
      .from('campus_sign_ins')
      .select('id, session_type, status, signed_in_at, location_accuracy_meters')
      .eq('student_id', studentId)
      .eq('signed_in_date', ist.dateString);

    if (recordsError) {
      throw new InternalServerErrorException(`Failed to fetch status: ${recordsError.message}`);
    }

    const morningRecord = records?.find((r) => r.session_type === 'morning');
    const eveningRecord = records?.find((r) => r.session_type === 'evening');

    const middaySplitMin = this.timeStringToMinutes(campus?.midday_split_time || '13:30:00');
    const dayEndMin = this.timeStringToMinutes(campus?.day_end_time || '17:00:00');

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
    } else if (ist.totalMinutes < dayEndMin) {
      eveningState = 'pending';
    } else {
      eveningState = 'absent';
    }

    return {
      date: ist.dateString,
      current_time_ist: ist.timeString,
      campus: {
        id: campus?.id,
        name: campus?.name,
        radius_meters: campus?.radius_meters || 400,
        morning_cutoff: campus?.morning_cutoff_time,
        midday_split: campus?.midday_split_time,
        evening_cutoff: campus?.evening_cutoff_time,
        day_end: campus?.day_end_time,
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
    const targetDate = queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate) ? queryDate : istNow.dateString;
    const isToday = targetDate === istNow.dateString;

    let campus: CampusRecord | null = null;
    let dept: any = null;
    let studentsQuery = this.supabase.admin
      .from('students')
      .select('id, full_name, cap_application_number, current_semester, department_id, campus_id')
      .order('full_name', { ascending: true });

    if (user.role === 'hod') {
      if (!user.department_id) {
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
      campus = (dept as any).campuses as CampusRecord;
      studentsQuery = studentsQuery.eq('department_id', user.department_id);
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
    } else if (user.role === 'superadmin') {
      const { data: campusData } = await this.supabase.admin
        .from('campuses')
        .select('*')
        .limit(1)
        .maybeSingle();
      campus = campusData as CampusRecord;
    } else {
      throw new ForbiddenException(`Role '${user.role}' is not authorized to view attendance roster.`);
    }

    const middaySplitMin = this.timeStringToMinutes(campus?.midday_split_time || '13:30:00');
    const dayEndMin = this.timeStringToMinutes(campus?.day_end_time || '17:00:00');

    // 2. Fetch scoped students
    const { data: students, error: studentsError } = await studentsQuery;

    if (studentsError) {
      throw new InternalServerErrorException(`Failed to fetch students: ${studentsError.message}`);
    }

    const studentIds = (students || []).map((s) => s.id);

    // 3. Fetch sign-in rows for these students on targetDate
    let signIns: any[] = [];
    if (studentIds.length > 0) {
      const { data: signInData, error: signInError } = await this.supabase.admin
        .from('campus_sign_ins')
        .select('id, student_id, session_type, status, signed_in_at')
        .in('student_id', studentIds)
        .eq('signed_in_date', targetDate);

      if (signInError) {
        throw new InternalServerErrorException(`Failed to fetch sign-ins: ${signInError.message}`);
      }
      signIns = signInData || [];
    }

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
      const morningRecord = signIns.find(
        (si) => si.student_id === student.id && si.session_type === 'morning'
      );
      const eveningRecord = signIns.find(
        (si) => si.student_id === student.id && si.session_type === 'evening'
      );

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
      } else if (isToday && istNow.totalMinutes < dayEndMin) {
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
        campus_name: campus?.name || 'Main Campus',
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
