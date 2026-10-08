# Implementation Handoff: PLAN 01 — Authorization and Role Boundaries

**Date:** 7 October 2026  
**Primary finding ownership:** F01, F02, F03, F04, F05, F06, F61.  
**Status:** Completed in full within Plan 01 scope; shared consumers documented for downstream plans.

---

## 1. Findings Status Summary

| Finding | Priority / Severity | Status | Scope & Resolution Details |
|---|---|---|---|
| **F01** | P0 / Critical | **Completed** | HOD student removal in `hod.service.ts` now strictly verifies target identity and checks student department (`student.department_id === user.department_id`) and campus affiliation *prior* to mutation. Supabase Auth `deleteUser` is only invoked after verified database record deletion. Foreign IDs, admin IDs, or non-student UUIDs produce 403/404 with zero mutation calls to the database or Auth admin. |
| **F02** | P0 / High | **Completed** | Course ownership in `hod.service.ts` is strictly derived from the authenticated HOD's `user.department_id`. For updates and deletions, existing courses are loaded and verified against the caller's department. Ownership transfer via edit payloads is rejected with 403 Forbidden. University-wide catalogue lookup for blueprints remains intact. |
| **F03** | P0 / High | **Completed** | Removed `campus_director` role from prerequisite rule configuration routes in `allocation.controller.ts`. In `allocation.service.ts`, prerequisite addition, deletion, and retrieval strictly require course department ownership (`user.department_id === course.department_id`) for HODs, or university scope for Superadmin. Campus directors receive 403 Forbidden. |
| **F04** | P0 / High | **Completed** | Built server-side authorized scope resolution in `timetable.service.ts`. Query parameter `departmentId` cannot bypass the caller's campus boundary. Students are restricted strictly to `status = 'published'` entries and never receive drafts or conflict rows. Assigned visiting teachers can query their assigned course delivery slots across campuses via `teacher_course_assignments`. |
| **F05** | P0 / High | **Completed** | In `timetable.service.ts` (`publish`) and `solver/job.ts`, empty campus department lookups return explicit safe no-ops (0 published entries) rather than omitting the department filter and mutating university-wide data. Timetable entries deletion and conflict cleanup in solver jobs are strictly scoped to the campus's department courses. |
| **F06** | P0 / High | **Completed** | Credit ledger access in `credit-ledger.service.ts` and `credit-ledger.controller.ts` denies `teaching_staff` with 403 Forbidden (strictly roster-only). Missing or null affiliations (`department_id`, `campus_id`) fail closed with 403 Forbidden. Teachers can only access students in their department or students they instruct in assigned courses. In `admin.service.ts`, faculty creation requires campus and department assignments. |
| **F61** | P1 / High | **Completed** | Unified controller role lists and service scope assumptions. `teaching_staff` was removed from attendance submission in `period-attendance.controller.ts` and `period-attendance.service.ts`, and excluded from assignable instructors in `assignments.service.ts`. In `campus-attendance.service.ts`, `getDepartmentCampusRoster` now cleanly resolves both HOD department and Director campus scopes. |

---

## 2. Changed Files & Execution Order

### Added Files:
1. `backend/src/core/auth/authorization-policy.ts` — Centralized actor scope boundary verification engine.
2. `backend/test/authorization-boundaries.test.js` — Automated unit and adversarial test suite covering all Plan 01 findings.

### Modified Files:
1. `backend/src/modules/hod/hod.service.ts` — F01 student pre-authorization and safe auth deletion sequence; F02 actor-derived course department.
2. `backend/src/modules/allocation/allocation.controller.ts` — F03 removal of `campus_director` from prerequisite endpoints.
3. `backend/src/modules/allocation/allocation.service.ts` — F03 HOD department ownership and superadmin scope enforcement for prerequisite management.
4. `backend/src/modules/timetable/timetable.service.ts` — F04 server-side timetable query scoping + student published-only guarantee; F05 empty-campus guard on publish.
5. `backend/src/modules/timetable/solver/job.ts` — F05 campus-scoped conflict and prior entries cleanup.
6. `backend/src/modules/credit-ledger/credit-ledger.controller.ts` — F06 removal of `teaching_staff` from ledger route.
7. `backend/src/modules/credit-ledger/credit-ledger.service.ts` — F06 fail-closed affiliation checks and `teaching_staff` denial.
8. `backend/src/modules/period-attendance/period-attendance.controller.ts` — F61 removal of `teaching_staff` from attendance submission route.
9. `backend/src/modules/period-attendance/period-attendance.service.ts` — F61 assertion preventing roster-only staff from submitting attendance.
10. `backend/src/modules/assignments/assignments.service.ts` — F61 restriction of assignable instructors strictly to role `'teacher'`.
11. `backend/src/modules/campus-attendance/campus-attendance.service.ts` — F61 support for both HOD department and Director campus scopes in `getDepartmentCampusRoster`.
12. `backend/src/modules/admin/admin.service.ts` — F06 required department for teachers and campus for faculty creation.
13. `backend/package.json` — Added `"test": "nest build && node --test test/**/*.test.js"`.

### Database Migrations:
- No database schema migrations were required for Plan 01 (all repairs enforce server-side and controller role boundaries over existing schemas).

---

## 3. Shared Contracts, Types & Expected Invariants

### Centralized Scope Matrix: `AuthorizationPolicy` (`backend/src/core/auth/authorization-policy.ts`)
- `AuthorizationPolicy.assertAuthenticated(user)`: Validates identity and non-empty role.
- `AuthorizationPolicy.assertNotRosterOnly(user, action)`: Throws `ForbiddenException` (403) if `user.role === 'teaching_staff'`.
- `AuthorizationPolicy.assertCourseManagementScope(user, targetCourseDepartmentId)`: Grants access only to `superadmin` or `hod` where `user.department_id === targetCourseDepartmentId`. Rejects `campus_director` with 403 Forbidden.
- `AuthorizationPolicy.assertDepartmentScope(user, targetDepartmentId)`: Fails closed if HOD department affiliation is null or mismatched.
- `AuthorizationPolicy.assertCampusScope(user, targetCampusId)`: Fails closed if Director campus affiliation is null or mismatched.
- `AuthorizationPolicy.resolveTimetableScope(user)`: Returns `{ campusId, departmentId, isUniversityScope }` and fails closed on missing affiliations.

### Invariants for Downstream Plans:
1. **Roster-Only Staff:** `teaching_staff` must NEVER be granted mutation rights, attendance submission, or ledger access in Plan 02, 04, 05, 06, or 07.
2. **Campus Director Boundaries:** Campus Directors administer campus operations (runs, deadlines, publications), but have ZERO authority to author courses or prerequisites (Plan 03, 04).
3. **Draft Schedule Protection:** Students must NEVER receive draft/generated timetable rows or timetable conflicts (Plan 06).
4. **Visiting Teachers:** Cross-campus teachers are authorized by explicit `teacher_course_assignments` records, not by loose query parameters or department overrides (Plan 03, 06, 07).

---

## 4. Validation Commands & Outcomes

### 1. TypeScript Build:
```bash
npm --workspace=backend run build
```
- **Outcome:** Clean compilation with `nest build` (Exit code: 0, 0 TypeScript errors).

### 2. Automated & Adversarial Authorization Test Suite:
```bash
npm --workspace=backend run test
# Command: nest build && node --test test/**/*.test.js
```
- **Outcome:** **22 tests passed across 8 test suites** with **0 failures**, 0 cancellations:
  - Centralized AuthorizationPolicy Matrix (7 tests passed)
  - F01: HOD Student Deletion Target Authorization (3 tests passed: foreign student blocked, admin ID blocked with 0 auth deletions, authorized student deleted)
  - F02: HOD Course Mutations & Department Derivation (3 tests passed: creation forced to own dept, foreign update blocked, ownership transfer blocked)
  - F03: Prerequisite Management Role Boundaries (2 tests passed: campus director 403, foreign HOD 403)
  - F06: Credit Ledger Affiliation and teaching_staff Protection (2 tests passed: teaching staff 403, null affiliation fails closed)
  - F61: Teaching Staff Role Limits in Assignments & Period Attendance (2 tests passed: teacher-only assignment, attendance submission blocked)
  - F04 & F05: Timetable Scoping, Draft Isolation & Empty-Campus Safety (3 tests passed: empty campus 0 published / 0 updates, foreign dept blocked, students receive published-only and 0 conflicts)

---

## 5. Policy Choices Kept Unchanged & Implementation Assumptions

1. **`teaching_staff` Roster Breadth:** The exact roster breadth permitted for `teaching_staff` remains undecided. As mandated, this plan strictly enforces roster-only boundaries by blocking all mutations, attendance submissions, and ledger accesses.
2. **Host-Campus Assignment Administration:** Administration of host-class assignments remains undecided. This plan validates teachers through existing `teacher_course_assignments` and rejects non-teachers (`teaching_staff`, `hod`).
3. **Credit Ledger Warning vs Blocking:** Left unchanged for Plan 04/09; Plan 01 strictly secures ledger read authorization and fail-closed affiliations.

---

## 6. Downstream Work & Handoff to Plan 02

- **Receiving Plan:** **Plan 02: Accounts, Sessions, Consent and Dependencies**
- **Items Handed Off:**
  - `AuthorizationPolicy` is ready for consumption by session and route authentication middleware in Plan 02.
  - Plan 02 will address restricted-session states, initial password changes, consent tracking, and session refresh across routine token expiry.
  - Dependent-record cascades and student lifecycle graduation cleanup will coordinate with Plan 03 and Plan 08.
