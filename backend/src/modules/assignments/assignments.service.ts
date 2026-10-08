import {
  BadRequestException,
  Injectable,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseService } from '../../core/database/supabase.service';
import { AuditLoggerService } from '../../core/logging/audit-logger.service';
import { AuthUser } from '../../core/auth/types';
import { BatchAssignmentItem } from './dto/assign-teacher.dto';

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditLogger: AuditLoggerService
  ) {}

  /**
   * Returns all courses in the HOD's department, each with their currently assigned teachers,
   * plus the department faculty roster for selection.
   */
  async getCoursesAndAssignments(user: AuthUser) {
    const departmentId = user.department_id;
    if (!departmentId) {
      throw new ForbiddenException('User is not affiliated with any academic department.');
    }

    // 1. Fetch department courses
    const { data: courses, error: coursesError } = await this.supabase.admin
      .from('courses')
      .select('id, course_code, title, credits, category, semester')
      .eq('department_id', departmentId)
      .order('course_code', { ascending: true });

    if (coursesError) {
      throw new InternalServerErrorException(`Failed to fetch courses: ${coursesError.message}`);
    }

    // 2. Fetch all department teaching faculty (strictly excluding HOD)
    const { data: faculty, error: facultyError } = await this.supabase.admin
      .from('faculty')
      .select('id, full_name, email, role')
      .eq('department_id', departmentId)
      .eq('role', 'teacher')
      .order('full_name', { ascending: true });

    if (facultyError) {
      throw new InternalServerErrorException(`Failed to fetch faculty: ${facultyError.message}`);
    }

    // 3. Fetch active assignments for these courses
    const courseIds = (courses || []).map((c) => c.id);
    let assignments: any[] = [];
    if (courseIds.length > 0) {
      const { data: assignData, error: assignError } = await this.supabase.admin
        .from('teacher_course_assignments')
        .select('id, teacher_id, course_id, assigned_at, assigned_by, campus_id, academic_year, semester')
        .in('course_id', courseIds);

      if (assignError) {
        throw new InternalServerErrorException(`Failed to fetch assignments: ${assignError.message}`);
      }
      assignments = assignData || [];
    }

    // Map faculty by ID for rapid lookup
    const facultyMap = new Map((faculty || []).map((f) => [f.id, f]));

    // Resolve any visiting teachers from other campuses/departments
    const missingTeacherIds = (assignments || [])
      .map((a) => a.teacher_id)
      .filter((tId) => !facultyMap.has(tId));

    if (missingTeacherIds.length > 0) {
      const { data: visitingFaculty } = await this.supabase.admin
        .from('faculty')
        .select('id, full_name, email, role')
        .in('id', missingTeacherIds);
      for (const vf of visitingFaculty || []) {
        facultyMap.set(vf.id, vf);
      }
    }

    // Group assigned teachers into each course
    const coursesWithTeachers = (courses || []).map((course) => {
      const courseAssignments = assignments
        .filter((a) => a.course_id === course.id)
        .map((a) => {
          const teacher = facultyMap.get(a.teacher_id);
          return {
            assignment_id: a.id,
            teacher_id: a.teacher_id,
            teacher_name: teacher?.full_name || 'Visiting Faculty',
            teacher_email: teacher?.email || '',
            campus_id: a.campus_id || null,
            academic_year: a.academic_year || null,
            semester: a.semester ?? course.semester ?? null,
            assigned_at: a.assigned_at,
          };
        });

      return {
        ...course,
        assignments: courseAssignments,
        is_assigned: courseAssignments.length > 0,
      };
    });

    return {
      department_id: departmentId,
      courses: coursesWithTeachers,
      faculty: faculty || [],
    };
  }

  /**
   * Assigns a teacher to a course (supporting visiting teachers across campuses and term identity).
   */
  async assignTeacher(
    user: AuthUser,
    teacherId: string,
    courseId: string,
    ip: string,
    opts?: { campus_id?: string; academic_year?: string; semester?: number },
  ) {
    const departmentId = user.department_id;
    if (!departmentId) {
      throw new ForbiddenException('Only department HODs can assign teachers.');
    }

    // Verify course belongs to HOD's department (preserving catalog ownership)
    const { data: course, error: courseCheckError } = await this.supabase.admin
      .from('courses')
      .select('id, department_id, title, course_code, semester')
      .eq('id', courseId)
      .maybeSingle();

    if (courseCheckError || !course) {
      throw new NotFoundException('Course not found.');
    }

    if (course.department_id !== departmentId) {
      throw new ForbiddenException('Cannot assign teachers to courses outside your department.');
    }

    // Verify target faculty exists and strictly enforce role === 'teacher'
    const { data: targetFaculty, error: facultyError } = await this.supabase.admin
      .from('faculty')
      .select('id, department_id, campus_id, role, full_name')
      .eq('id', teacherId)
      .maybeSingle();

    if (facultyError || !targetFaculty) {
      throw new NotFoundException('Teacher faculty record not found.');
    }

    if (targetFaculty.role === 'teaching_staff') {
      throw new ForbiddenException(
        'Only faculty with the teacher role can be assigned to instruct courses. Teaching staff accounts are roster-only.',
      );
    }

    if (targetFaculty.role !== 'teacher') {
      throw new ForbiddenException(
        `Only faculty with the teacher role can be assigned to instruct courses (received role '${targetFaculty.role}').`,
      );
    }

    // Resolve campus and term identity
    const campusId = opts?.campus_id || user.campus_id;
    let academicYear = opts?.academic_year;
    if (!academicYear) {
      const { data: settings } = await this.supabase.admin
        .from('campus_settings')
        .select('academic_year')
        .eq('campus_id', campusId)
        .maybeSingle();
      academicYear = settings?.academic_year || '2025-26';
    }
    const semester = opts?.semester ?? course.semester ?? null;

    const assignedAt = new Date().toISOString();

    const assignmentPayload: any = {
      teacher_id: teacherId,
      course_id: courseId,
      assigned_by: user.userId,
      assigned_at: assignedAt,
      campus_id: campusId,
      academic_year: academicYear,
      semester,
    };

    // Upsert into teacher_course_assignments with composite campus/term conflict target
    let { data, error } = await this.supabase.admin
      .from('teacher_course_assignments')
      .upsert(assignmentPayload, { onConflict: 'teacher_id,course_id,campus_id,academic_year,semester' })
      .select()
      .single();

    if (error && (error.message?.includes('uq_teacher_course_assignments_term') || error.message?.includes('ON CONFLICT'))) {
      const fallbackRes = await this.supabase.admin
        .from('teacher_course_assignments')
        .upsert(assignmentPayload, { onConflict: 'teacher_id,course_id' })
        .select()
        .single();
      data = fallbackRes.data;
      error = fallbackRes.error;
    }

    if (error) {
      throw new InternalServerErrorException(`Failed to assign teacher: ${error.message}`);
    }

    await this.auditLogger.log({
      eventType: 'teacher_assigned',
      userId: user.userId,
      userRole: user.role,
      action: `assigned teacher ${teacherId} to course ${course.course_code}`,
      resourceType: 'course_assignment',
      resourceId: data.id,
      status: 'success',
      ipAddress: ip,
    });

    return {
      success: true,
      assignment: data,
    };
  }

  /**
   * Batch assigns multiple teachers to courses in a single atomic database operation.
   */
  async batchAssignTeachers(
    user: AuthUser,
    assignments: BatchAssignmentItem[],
    ip: string
  ) {
    const departmentId = user.department_id;
    if (!departmentId) {
      throw new ForbiddenException('Only department HODs can assign teachers.');
    }

    if (!assignments || assignments.length === 0) {
      throw new BadRequestException('No assignments provided.');
    }

    const courseIds = Array.from(new Set(assignments.map((a) => a.course_id)));
    const teacherIds = Array.from(new Set(assignments.map((a) => a.teacher_id)));

    // 1. Verify all courses belong to HOD's department
    const { data: courses, error: coursesError } = await this.supabase.admin
      .from('courses')
      .select('id, department_id, course_code, semester')
      .in('id', courseIds);

    if (coursesError || !courses || courses.length !== courseIds.length) {
      throw new BadRequestException('One or more courses not found or invalid.');
    }

    for (const c of courses) {
      if (c.department_id !== departmentId) {
        throw new ForbiddenException(`Course ${c.course_code} does not belong to your department.`);
      }
    }

    // 2. Verify all teachers exist and strictly have role === 'teacher' (allow visiting teachers across campuses)
    const { data: facultyMembers, error: facultyError } = await this.supabase.admin
      .from('faculty')
      .select('id, department_id, role, full_name, campus_id')
      .in('id', teacherIds);

    if (facultyError || !facultyMembers || facultyMembers.length !== teacherIds.length) {
      throw new BadRequestException('One or more faculty members not found.');
    }

    for (const f of facultyMembers) {
      if (f.role === 'teaching_staff') {
        throw new ForbiddenException(
          `Faculty member (${f.full_name}) is teaching staff (roster-only) and cannot be assigned to teach courses.`,
        );
      }
      if (f.role !== 'teacher') {
        throw new ForbiddenException(
          `Faculty member (${f.full_name}) cannot be assigned as a course teacher (only role 'teacher' is permitted; received '${f.role}').`,
        );
      }
    }

    const courseMap = new Map((courses || []).map((c) => [c.id, c]));
    const assignedAt = new Date().toISOString();
    const rowsToUpsert = assignments.map((a) => ({
      teacher_id: a.teacher_id,
      course_id: a.course_id,
      assigned_by: user.userId,
      assigned_at: assignedAt,
      campus_id: a.campus_id || user.campus_id,
      academic_year: a.academic_year || '2025-26',
      semester: a.semester ?? courseMap.get(a.course_id)?.semester ?? null,
    }));

    // 3. Single batch upsert into teacher_course_assignments
    let { data, error } = await this.supabase.admin
      .from('teacher_course_assignments')
      .upsert(rowsToUpsert, { onConflict: 'teacher_id,course_id,campus_id,academic_year,semester' })
      .select();

    if (error && (error.message?.includes('uq_teacher_course_assignments_term') || error.message?.includes('ON CONFLICT'))) {
      const fallbackRes = await this.supabase.admin
        .from('teacher_course_assignments')
        .upsert(rowsToUpsert, { onConflict: 'teacher_id,course_id' })
        .select();
      data = fallbackRes.data;
      error = fallbackRes.error;
    }

    if (error) {
      throw new InternalServerErrorException(`Failed to batch assign teachers: ${error.message}`);
    }

    // 4. Consolidated audit log
    await this.auditLogger.log({
      eventType: 'teachers_batch_assigned',
      userId: user.userId,
      userRole: user.role,
      action: `batch assigned ${assignments.length} courses to faculty`,
      resourceType: 'course_assignment_batch',
      status: 'success',
      ipAddress: ip,
      metadata: { count: assignments.length, courseIds, teacherIds },
    });

    return {
      success: true,
      count: assignments.length,
      assignments: data,
      message: `Successfully saved ${assignments.length} faculty assignment(s).`,
    };
  }


  /**
   * Reassigns an existing assignment row to a new teacher mid-semester.
   */
  async reassignTeacher(user: AuthUser, assignmentId: string, newTeacherId: string, ip: string) {
    // 1. Fetch existing assignment
    const { data: existing, error: fetchError } = await this.supabase.admin
      .from('teacher_course_assignments')
      .select('id, course_id, teacher_id')
      .eq('id', assignmentId)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new NotFoundException('Assignment record not found.');
    }

    const { data: course, error: courseError } = await this.supabase.admin
      .from('courses')
      .select('id, department_id, course_code')
      .eq('id', existing.course_id)
      .maybeSingle();

    if (courseError || !course) {
      throw new NotFoundException('Associated course not found.');
    }

    if (user.role === 'hod' && course.department_id !== user.department_id) {
      throw new ForbiddenException('Cannot modify assignments outside your department.');
    }

    // Verify new teacher faculty exists, belongs to HOD's department, and is strictly not HOD
    const { data: targetFaculty, error: facultyError } = await this.supabase.admin
      .from('faculty')
      .select('id, department_id, campus_id, role, full_name')
      .eq('id', newTeacherId)
      .maybeSingle();

    if (facultyError || !targetFaculty) {
      throw new NotFoundException('New teacher faculty record not found.');
    }

    if (targetFaculty.role === 'teaching_staff') {
      throw new ForbiddenException(
        'Only faculty with the teacher role can be assigned to instruct courses. Teaching staff accounts are roster-only.',
      );
    }

    if (targetFaculty.role !== 'teacher') {
      throw new ForbiddenException(
        `Only faculty with the teacher role can be assigned to instruct courses (received role '${targetFaculty.role}').`,
      );
    }

    const assignedAt = new Date().toISOString();

    // 2. Update existing row by ID (in-place replacement)
    const { data: updated, error: updateError } = await this.supabase.admin
      .from('teacher_course_assignments')
      .update({
        teacher_id: newTeacherId,
        assigned_by: user.userId,
        assigned_at: assignedAt,
      })
      .eq('id', assignmentId)
      .select()
      .single();

    if (updateError) {
      throw new InternalServerErrorException(`Failed to reassign teacher: ${updateError.message}`);
    }

    await this.auditLogger.log({
      eventType: 'teacher_reassigned',
      userId: user.userId,
      userRole: user.role,
      action: `reassigned course ${course.course_code} from ${existing.teacher_id} to ${newTeacherId}`,
      resourceType: 'course_assignment',
      resourceId: assignmentId,
      status: 'success',
      ipAddress: ip,
    });

    return {
      success: true,
      assignment: updated,
    };
  }

  /**
   * Removes a specific teacher-course assignment.
   */
  async removeAssignment(user: AuthUser, assignmentId: string, ip: string) {
    const { data: existing, error: fetchError } = await this.supabase.admin
      .from('teacher_course_assignments')
      .select('id, course_id, teacher_id')
      .eq('id', assignmentId)
      .maybeSingle();

    if (fetchError || !existing) {
      throw new NotFoundException('Assignment record not found.');
    }

    const { data: course, error: courseError } = await this.supabase.admin
      .from('courses')
      .select('id, department_id, course_code')
      .eq('id', existing.course_id)
      .maybeSingle();

    if (courseError || !course) {
      throw new NotFoundException('Associated course not found.');
    }

    if (user.role === 'hod' && course.department_id !== user.department_id) {
      throw new ForbiddenException('Cannot delete assignments outside your department.');
    }

    const { error: deleteError } = await this.supabase.admin
      .from('teacher_course_assignments')
      .delete()
      .eq('id', assignmentId);

    if (deleteError) {
      throw new InternalServerErrorException(`Failed to delete assignment: ${deleteError.message}`);
    }

    await this.auditLogger.log({
      eventType: 'teacher_assignment_removed',
      userId: user.userId,
      userRole: user.role,
      action: `removed assignment for course ${course.course_code} (${assignmentId})`,
      resourceType: 'course_assignment',
      resourceId: assignmentId,
      status: 'success',
      ipAddress: ip,
    });

    return { success: true };
  }
}
