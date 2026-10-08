import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { AuthUser } from './types'

/**
 * Authorization Policy & Scope Boundary Engine (Plan 01 / F01, F02, F03, F04, F05, F06, F61)
 *
 * Core Principles:
 * - Superadmin has university scope.
 * - Campus Directors have campus-administration powers only: NO course/prerequisite management.
 * - HODs manage their own department's courses, rules, and blueprints. Must have non-null department_id.
 * - Teachers are assigned course/class teachers. Cross-campus teaching allowed via explicit assignment.
 * - Teaching Staff is strictly ROSTER-ONLY. No mutations, no attendance submission, no credit-ledger access.
 * - Missing/null affiliations MUST fail closed (ForbiddenException), never broaden access.
 */

export class AuthorizationPolicy {
  /**
   * Asserts that an actor has valid identity and non-empty basic authentication.
   */
  static assertAuthenticated(user?: AuthUser | null): asserts user is AuthUser {
    if (!user || !user.userId || !user.role) {
      throw new UnauthorizedException('Authentication required: user session or role not resolved')
    }
  }

  /**
   * Enforces that teaching_staff cannot perform mutation/administration actions.
   */
  static assertNotRosterOnly(user: AuthUser, actionName = 'this operation'): void {
    if (user.role === 'teaching_staff') {
      throw new ForbiddenException(`Role 'teaching_staff' is roster-only and cannot perform ${actionName}`)
    }
  }

  /**
   * Enforces HOD or Superadmin authority over a specific course's department.
   * Directors, teachers, teaching_staff, and students are forbidden.
   */
  static assertCourseManagementScope(user: AuthUser, targetCourseDepartmentId: string): void {
    this.assertAuthenticated(user)

    if (user.role === 'superadmin') {
      return
    }

    if (user.role === 'campus_director') {
      throw new ForbiddenException('Campus Directors have no course or prerequisite content management privileges')
    }

    if (user.role === 'hod') {
      if (!user.department_id) {
        throw new ForbiddenException('HOD account has no assigned department affiliation (access denied)')
      }
      if (user.department_id !== targetCourseDepartmentId) {
        throw new ForbiddenException('HOD can only manage courses belonging to their own department')
      }
      return
    }

    throw new ForbiddenException(`Role '${user.role}' is not authorized to manage course content`)
  }

  /**
   * Enforces department-level scope for HOD or Superadmin.
   */
  static assertDepartmentScope(user: AuthUser, targetDepartmentId: string): void {
    this.assertAuthenticated(user)

    if (user.role === 'superadmin') {
      return
    }

    if (user.role === 'hod') {
      if (!user.department_id) {
        throw new ForbiddenException('HOD account has no department affiliation (access denied)')
      }
      if (user.department_id !== targetDepartmentId) {
        throw new ForbiddenException('Operation restricted to your own department')
      }
      return
    }

    throw new ForbiddenException(`Role '${user.role}' is not authorized for department-scoped operations`)
  }

  /**
   * Enforces campus-level scope for Campus Director or Superadmin.
   */
  static assertCampusScope(user: AuthUser, targetCampusId: string): void {
    this.assertAuthenticated(user)

    if (user.role === 'superadmin') {
      return
    }

    if (user.role === 'campus_director') {
      if (!user.campus_id) {
        throw new ForbiddenException('Campus Director account has no campus affiliation (access denied)')
      }
      if (user.campus_id !== targetCampusId) {
        throw new ForbiddenException('Operation restricted to your own campus')
      }
      return
    }

    throw new ForbiddenException(`Role '${user.role}' is not authorized for campus-scoped operations`)
  }

  /**
   * Resolves authorized department IDs for timetable queries/writes.
   * Prevents missing/null campus affiliations from falling back to unrestricted university queries.
   */
  static resolveTimetableScope(user: AuthUser): {
    campusId: string | null
    departmentId: string | null
    isUniversityScope: boolean
  } {
    this.assertAuthenticated(user)

    if (user.role === 'superadmin') {
      return {
        campusId: null,
        departmentId: null,
        isUniversityScope: true,
      }
    }

    if (user.role === 'campus_director') {
      if (!user.campus_id) {
        throw new ForbiddenException('Campus Director has no assigned campus affiliation')
      }
      return {
        campusId: user.campus_id,
        departmentId: null,
        isUniversityScope: false,
      }
    }

    if (user.role === 'hod') {
      if (!user.department_id) {
        throw new ForbiddenException('HOD has no assigned department affiliation')
      }
      return {
        campusId: user.campus_id || null,
        departmentId: user.department_id,
        isUniversityScope: false,
      }
    }

    if (user.role === 'student') {
      if (!user.campus_id) {
        throw new ForbiddenException('Student has no campus affiliation')
      }
      return {
        campusId: user.campus_id,
        departmentId: user.department_id || null,
        isUniversityScope: false,
      }
    }

    if (user.role === 'teacher' || user.role === 'teaching_staff') {
      return {
        campusId: user.campus_id || null,
        departmentId: user.department_id || null,
        isUniversityScope: false,
      }
    }

    throw new ForbiddenException(`Role '${user.role}' cannot access timetable operations`)
  }
}
