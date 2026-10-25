import {
  BadRequestException,
  Injectable,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { mutateTeacherAssignments } from '../../core/database/teacher-mutations';
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

  async assignTeacher(
    user: AuthUser, teacherId: string, courseId: string, ip: string,
    opts?: { campus_id?: string; academic_year?: string; semester?: number },
  ) {
    const result = await mutateTeacherAssignments(this.supabase, {
      p_actor_id: user.userId, p_operation: 'assign',
      p_items: [{ teacher_id: teacherId, course_id: courseId, ...opts }],
    });
    await this.auditLogger.log({ eventType: 'teacher_assigned', userId: user.userId, userRole: user.role,
      action: `assigned teacher ${teacherId} to course ${courseId}`, resourceType: 'course_assignment',
      resourceId: result.assignment.id, status: 'success', ipAddress: ip });
    return { success: true, assignment: result.assignment };
  }

  async batchAssignTeachers(user: AuthUser, assignments: BatchAssignmentItem[], ip: string) {
    if (!Array.isArray(assignments) || !assignments.length || assignments.length > 100) {
      throw new BadRequestException('Provide between 1 and 100 assignments.');
    }
    const result = await mutateTeacherAssignments(this.supabase, {
      p_actor_id: user.userId, p_operation: 'batch', p_items: assignments,
    });
    await this.auditLogger.log({ eventType: 'teachers_batch_assigned', userId: user.userId, userRole: user.role,
      action: `batch assigned ${result.count} courses to faculty`, resourceType: 'course_assignment_batch',
      status: 'success', ipAddress: ip, metadata: { count: result.count } });
    return { ...result, message: `Successfully saved ${result.count} faculty assignment(s).` };
  }

  async reassignTeacher(user: AuthUser, assignmentId: string, newTeacherId: string, ip: string) {
    const result = await mutateTeacherAssignments(this.supabase, {
      p_actor_id: user.userId, p_operation: 'reassign', p_assignment_id: assignmentId, p_teacher_id: newTeacherId,
    });
    await this.auditLogger.log({ eventType: 'teacher_reassigned', userId: user.userId, userRole: user.role,
      action: `reassigned course ${result.assignment.course_id} to teacher ${newTeacherId}`,
      resourceType: 'course_assignment', resourceId: assignmentId, status: 'success', ipAddress: ip });
    return { success: true, assignment: result.assignment };
  }

  async removeAssignment(user: AuthUser, assignmentId: string, ip: string) {
    const result = await mutateTeacherAssignments(this.supabase, {
      p_actor_id: user.userId, p_operation: 'remove', p_assignment_id: assignmentId,
    });
    await this.auditLogger.log({ eventType: 'teacher_assignment_removed', userId: user.userId, userRole: user.role,
      action: `removed assignment ${assignmentId}`, resourceType: 'course_assignment',
      resourceId: assignmentId, status: 'success', ipAddress: ip });
    return result;
  }
}
