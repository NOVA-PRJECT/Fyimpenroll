# Implementation Handoff — Plan 03: Schema Alignment, Class Identity and Ten-Semester Foundation

## 1. Findings Status Summary

| Finding | Priority / Severity | Status | Precise Rationale |
|---|---|---|---|
| **F38** | Architecture | **Withdrawn (Preserved)** | Timetable uniqueness retained as `UNIQUE (academic_year, semester, course_id, time_slot_id, department_id)` (and slot-level independence) to allow parallel elective classes across sections/departments without colliding. Documented in migration DDL. |
| **F53 & D07** | P1 / High | **Completed** | Extended semester domain across backend and frontend to all 10 semesters (1–10). Updated `BlueprintSchema` in `HodController` (min 1, max 10), `AllocationService` (`semNum <= 10`, `sem <= 10`), and frontend semester selectors across teaching staff, HOD, and director dashboards. Built `HodService.getCatalogReadiness` returning an accurate 10-semester matrix without inventing placeholder curricula. |
| **F64** | P1 / High | **Completed** | Fixed `getDepartmentTeachers` in `HodService`: removed nonexistent column `created_at` from `.select('id, full_name, email, role')` and filtered strictly by `.eq('role', 'teacher')`, completely excluding `teaching_staff` from teacher assignment dropdowns. |
| **F65** | P1 / High | **Completed** | Authored additive replayable migration `supabase/migrations/20261007000000_plan03_schema_alignment.sql`. Reconciled audit logging indexes: created indexes directly on base storage `public.system_logs` (`idx_system_logs_audit_events`, `idx_system_logs_user_id`), explicitly avoiding illegal index creation on the compatibility view `public.audit_logs`. |
| **F66** | P1 / High | **Completed** | Relaxes `student_registrations.total_credits` constraint to `CHECK (total_credits >= 0)` with default `0` in database migration. In `AllocationService` and manual allocation, ensured `total_credits` defaults to 0 on insert for pending allocations and recalculates across all 8 slots (`slot_1_course_id` through `slot_8_course_id`). |
| **F67** | P1 / High | **Completed** | Introduced campus offering and term identity (`campus_id`, `academic_year`, `semester`) on `teacher_course_assignments` with compound uniqueness constraint `uq_teacher_course_assignments_term (teacher_id, course_id, campus_id, academic_year, semester)`. Enabled visiting faculty across campuses to be assigned while preserving catalog ownership (`course.department_id === departmentId`). Strictly rejected `teaching_staff` with `403 Forbidden`. |
| **F68** | P0 / Critical | **Completed** | Eliminated catastrophic attendance deletion caused by foreign key cascades. Changed `period_attendance.marked_by` and `teacher_course_assignments.assigned_by` to `ON DELETE SET NULL` in SQL migration. In `HodService.deleteDepartmentTeacher`, made `assigned_by` nulling safe, verified `auth.admin.deleteUser` outcome, and reported structured partial failures if Auth deletion encounters errors. |
| **F69** | P1 / High | **Completed** | Dropped duplicate constraint `student_registrations_student_id_fkey1` in SQL migration to prevent PostgREST ambiguous relationship errors. Qualified embedded PostgREST join in `HodService.exportStudentsExcel` (`students!inner(full_name, department_id)`) and expanded queries to support slots 1 through 8. |

---

## 2. Changed Files & Migrations

### Modified Files:
- `backend/src/modules/hod/hod.controller.ts` — Extended `BlueprintSchema` semester validation to `max(10)` and added `@Get('catalog-readiness')` endpoint.
- `backend/src/modules/hod/hod.service.ts` — Added `getCatalogReadiness`, removed `created_at` from `getDepartmentTeachers` and filtered strictly to `role === 'teacher'`, updated `deleteDepartmentTeacher` to check Auth deletion error, and expanded `exportStudentsExcel` to slots 1–8 with qualified inner join.
- `backend/src/modules/allocation/allocation.service.ts` — Extended semester validations to 10 in `addPrerequisite` and `runAllocation`, expanded slot recalculations to include slots 1–8 with fallback, and ensured `total_credits` is properly initialized and updated during manual allocation.
- `backend/src/modules/assignments/dto/assign-teacher.dto.ts` — Added optional `campus_id`, `academic_year`, and `semester` to assignment schemas and interfaces.
- `backend/src/modules/assignments/assignments.controller.ts` — Forwarded term and campus options to `assignTeacher`.
- `backend/src/modules/assignments/assignments.service.ts` — Supported visiting cross-campus teachers, persisted term identity, strictly rejected `teaching_staff` with 403 Forbidden, and resolved visiting faculty names in `getCoursesAndAssignments`.
- `backend/src/modules/period-attendance/attendance-export.service.ts` — Handled slots 1–8 with fallback when determining course enrollments.
- `frontend/src/app/dashboard/teaching_staff/page.tsx` — Extended semester fallback array to semesters 1–10.
- `frontend/src/app/dashboard/hod/ManualAllocationTab.tsx` — Extended semester selector dropdown to semesters 1–10.
- `frontend/src/app/dashboard/director/page.tsx` — Extended director allocation semester dropdown to semesters 1–10.
- `backend/test/schema-class-ten-semesters.test.js` — Comprehensive unit test suite covering all Plan 03 findings (12 tests across 5 suites).

### Migrations Created:
- `supabase/migrations/20261007000000_plan03_schema_alignment.sql` — Additive, reviewable SQL migration:
  - Storage indexes on `public.system_logs`.
  - Relaxed check constraint `CHECK (total_credits >= 0)` with default `0` on `student_registrations`.
  - Extended semester checks to `BETWEEN 1 AND 10` on `student_registrations`, `semester_blueprints`, and `courses`.
  - Added `campus_id`, `academic_year`, and `semester` columns to `teacher_course_assignments` with composite unique constraint `uq_teacher_course_assignments_term`.
  - Converted `period_attendance.marked_by` and `teacher_course_assignments.assigned_by` foreign keys to `ON DELETE SET NULL`.
  - Dropped duplicate constraint `student_registrations_student_id_fkey1`.
  - Documented retention of timetable section/slot uniqueness.

---

## 3. Downstream Contracts & Invariants

1. **Semester Scope (1–10):**
   - Blueprints, courses, registration preferences, and allocation runs now natively support semesters 1 through 10.
   - Any new modules or UI tabs dealing with semesters must use the domain `[1..10]` from `@/core/constants/semesters`.
2. **Catalog Readiness vs Fabrication:**
   - Catalog gaps in higher semesters (7–10) are highlighted via `GET /api/hod/catalog-readiness` rather than being masked with fabricated courses or mock data.
3. **Teacher vs Teaching Staff Boundary:**
   - Accounts with `role === 'teaching_staff'` are strictly roster-only. They cannot be assigned to teach courses, cannot mark attendance, and are not returned in HOD teacher assignment dropdowns.
   - Visiting teachers (`role === 'teacher'`) can be assigned across campuses without transferring course catalog ownership.
4. **Attendance Preservation on Actor Deletion:**
   - Instructor accounts can be removed without cascade deleting lecture attendance records (`period_attendance.marked_by` sets to null).

---

## 4. Verification Evidence

- **Unit Tests:** `npm --workspace=backend run test` executes **48 tests across 21 test suites**, all passing with 0 failures:
  - Plan 01 suites: 22 tests passing.
  - Plan 02 suites: 14 tests passing.
  - Plan 03 suites: 12 tests passing (`backend/test/schema-class-ten-semesters.test.js`).
- **Backend Build:** `npm --workspace=backend run build` (`nest build`) passes with 0 TypeScript errors.
- **Frontend Build:** `npm --workspace=frontend run build` (`next build` with Turbopack) passes with 0 errors across all routes.
