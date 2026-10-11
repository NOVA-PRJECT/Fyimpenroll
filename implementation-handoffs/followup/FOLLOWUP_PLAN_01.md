# Follow-up Plan 01 Handoff: Database Privileges and Resource Authorization

**Date:** 9 October 2026
**Author:** Antigravity Engineering Agent
**Target Plan:** Follow-up Plan 01 (Findings R01, R04, R05, and R03 containment)
**Status:** Completed (with documented deployment verification note for R01 and downstream handover for R03/R07/R23)

---

## 1. Scope & Finding Status Matrix

| Finding | Priority / Severity | Follow-up Status | Primary Owner | Downstream Consumers | Exact Validation Evidence & Details |
|---|---|---|---|---|---|
| **R01** | Critical / High | **Completed** *(deployment-unverified against live prod ACLs)* | Follow-up 01 | All new SQL RPCs; Plans 03–09 | Created forward migration `20261009010000_followup_plan01_harden_rpc_privileges.sql`. Explicitly revoked `EXECUTE` on all backend-only SECURITY DEFINER RPCs (`submit_student_registration`, `execute_student_course_change`, `claim_allocation_run`, `apply_course_allocation` [both 6-arg and 7-arg overloads], `promote_campus_students_atomic`, `cleanup_concluded_semester_attendance`) from `PUBLIC`, `anon`, and `authenticated`. Granted `EXECUTE` strictly to `service_role` and `postgres`. Pinned `SET search_path = public, pg_temp;` on each function to eliminate search path hijacking. Applied `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated`. Tested via migration assertion in `backend/test/followup-security-privileges.test.js`. Note: Live production grants are unverified until applied to live Supabase cluster. |
| **R04** | High | **Completed** *(scope hardened; schema column fixes in Plan 09)* | Follow-up 01 | Plan 09 | Refactored `backend/src/modules/credit-ledger/export.service.ts`: (1) Class roster export (`exportCampusClassRoster`) now explicitly checks `teacher_course_assignments` to verify teacher is assigned to `course_id`; unassigned teachers and students are forbidden. (2) Timetable export (`exportTimetable`) restricts students strictly to `published` schedules and only for courses where the student has an active enrollment (`student_registrations.selections` / slot course IDs); drafts (`[DRAFT]`) and unrelated courses are never returned. (3) Unresolved allocations export (`exportUnresolvedAllocations`) scopes teachers to assigned courses. (4) Period attendance export (`exportPeriodAttendance`) restricts teachers strictly to assigned courses. Tested in `followup-security-privileges.test.js`. |
| **R05** | Medium | **Completed** | Follow-up 01 | Plan 03, Plan 06 | In `backend/src/modules/timetable/timetable.service.ts` (`getEntries`), teacher queries are now unconditionally intersected with `teacherAssignedCourseIds` (retrieved from `teacher_course_assignments`), regardless of whether the teacher has a home `campus_id` or `department_id`. User-supplied `departmentId` can only narrow within assigned courses, never broaden access to unassigned or draft entries. Teachers with zero assignments return empty entries immediately. Tested in `followup-security-privileges.test.js`. |
| **R03** | High | **Partial (Immediate Authorization Containment)** | Follow-up 07 (Primary Owner) | Follow-up 07 | In `backend/src/modules/period-attendance/period-attendance.service.ts` (`copyPracticalAttendance`), added authorization checks via `AuthorizationPolicy.assertClassAttendanceAuthority`. Unassigned teachers and foreign HODs cannot copy marks even when supplied valid timetable slot IDs. Rejects unauthorized callers with `ForbiddenException`. Full date-pair validation, concurrency locking, and atomic revision completion belong to Follow-up Plan 07. |

---

## 2. Changed Source Files & Migrations

### Forward Migrations
- `supabase/migrations/20261009010000_followup_plan01_harden_rpc_privileges.sql`
  - Execution order: Must be run after `20261007060000_plan09_credit_ledger_and_scoped_exports.sql`.
  - Impact: Non-destructive, additive ACL revocations and `search_path` pinning. Existing backend application calls via `supabase.admin` (`service_role`) continue without disruption.

### Source Files Modified
- `backend/src/core/auth/authorization-policy.ts`:
  - Added `assertTeacherAssignedToCourse(user, courseId, assignedCourseIds)`.
  - Added `assertClassAttendanceAuthority(user, classDepartmentId, classCourseId, teacherAssignedCourseIds)`.
- `backend/src/modules/timetable/timetable.service.ts`:
  - Fixed `getEntries` query branching: when `user.role === 'teacher'`, query is strictly scoped to `teacherAssignedCourseIds` and intersected with any user-supplied `departmentId`.
- `backend/src/modules/credit-ledger/export.service.ts`:
  - Enforced actor-derived permissions before user query filters across `exportUnresolvedAllocations`, `exportCampusClassRoster`, `exportTimetable`, and `exportPeriodAttendance`.
- `backend/src/modules/period-attendance/period-attendance.service.ts`:
  - Added authorization check in `copyPracticalAttendance` ensuring caller is assigned to teach both source and target classes (or is home department HOD).

### Automated Tests Created
- `backend/test/followup-security-privileges.test.js`:
  - 10 targeted test cases covering R01 SQL grant assertions, R04 export scoping (assigned vs unassigned teachers, student draft exclusions, enrolled course filtering), R05 teacher timetable intersection, and R03 copy attendance authorization containment.

---

## 3. Shared Contracts, Types & Functions Introduced

### `AuthorizationPolicy` Helpers
1. **`assertTeacherAssignedToCourse(user: AuthUser, courseId: string, assignedCourseIds: string[]): void`**
   - Asserts that a teacher is assigned to teach `courseId` (supports visiting cross-campus instruction).
   - Throws `ForbiddenException('Teacher is not assigned to teach this course/class')`.
2. **`assertClassAttendanceAuthority(user: AuthUser, classDepartmentId: string, classCourseId: string, teacherAssignedCourseIds: string[]): void`**
   - Asserts caller has authority to record or copy attendance marks for a class.
   - HOD must match `classDepartmentId`.
   - Teacher must be assigned to `classCourseId`.
   - Other roles (`student`, `teaching_staff`, `campus_director`) fail closed with `ForbiddenException`.

### Export Scoping Contract
- User-supplied query parameters (`campus_id`, `department_id`, `course_id`) may only **narrow** an actor's permitted scope, never expand it.
- Students querying timetable exports are hard-filtered to `status = 'published'` and `course_id IN (enrolledCourseIds)`. Draft timetables are completely inaccessible to students.

---

## 4. Exact Validation Commands & Outcomes

### 1. Automated Test Suite (`npm run test --workspace=backend`)
```bash
npm run test --workspace=backend
```
- **Total Test Suites:** 70
- **Total Tests:** 154
- **Passing Tests:** 154
- **Failing Tests:** 0
- **Duration:** ~16.3s
- **Coverage:** Includes all 144 baseline tests from original Plans 01–10 plus 10 new security/authorization tests in `followup-security-privileges.test.js`.

### 2. Backend Production Build (`npm run build:backend`)
```bash
npm run build:backend
```
- **Outcome:** Exited with code 0 (`nest build` clean compilation).

### 3. Frontend Production Build (`npm run build:frontend`)
```bash
npm run build:frontend
```
- **Outcome:** Exited with code 0 (Next.js 16.4.0 Turbopack clean compilation, all 18 routes typed and generated).

---

## 5. Policy Decisions Left Pending & Safe Implementations

1. **Roster-only Teaching Staff Breadth:**
   - Pending: The university has not finalized whether `teaching_staff` roster access is campus-wide or department-bound.
   - Safe Implementation: `teaching_staff` is strictly restricted to read-only class rosters and denied all mutations, attendance marking, export of registrations, and credit ledger operations.
2. **Host-Campus Administration:**
   - Pending: Full host-campus class delivery model connection is scheduled for Follow-up Plan 03.
   - Safe Implementation: Teacher assignments support visiting faculty across campuses via `teacher_course_assignments.course_id`, and timetable queries intersect with those assigned courses without requiring home campus nullification.
3. **Live Database Grants:**
   - Pending: Migration `20261009010000_followup_plan01_harden_rpc_privileges.sql` must be applied to the target Supabase instance during deployment.

---

## 6. Downstream Checklist for Follow-up Plan 02 & Later Plans

- [ ] **Follow-up Plan 02:** Password changes, session refresh, and logout (R02, R30, R31, R32). Must reuse the actor-derived session and role contracts from `AuthorizationPolicy`.
- [ ] **Follow-up Plan 03:** Host-campus classes and teacher identity (R06, R07, R08). Bind class identity to durable term assignments and adapt `AuthorizationPolicy.assertTeacherAssignedToCourse`.
- [ ] **Follow-up Plan 07:** Current-semester attendance, practical copying, and concurrent edits (R03, R28, R29). Build upon Plan 01's immediate copy authorization containment to implement complete 2-hour practical pair validation and atomic concurrency locking.
- [ ] **Follow-up Plan 09:** Registered-credit ledger and correct scoped exports (R23, R24, R25, R26, R33). Fix underlying schema column queries in exports while preserving the actor-derived scoping boundaries established in Plan 01.
