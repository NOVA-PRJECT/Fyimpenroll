# Implementation Handoff — Plan 04: Registration, Eligibility, Credits and Global Seats

## 1. Findings Status Summary

| Finding | Priority / Severity | Status | Precise Rationale |
|---|---|---|---|
| **F13** | P1 / High | **Completed** | Dynamic blueprint and variable pathway validation in `RegistrationsService.submitCourses`. Accommodates variable component counts (1–8 slots) for project, research, and internship semesters without hardcoded 6-course assumptions. |
| **F14** | P1 / High | **Completed** | Fixed courses in blueprints are resolved globally by unique `course_code` across all campuses/departments (`courses.course_code in (fixedTargets)`), and delivered locally at the student's campus. |
| **F15** | P1 / High | **Completed** | Full 8-slot support integrated across downstream consumers: `TimetableSolver` (`loader.ts`), `CreditLedgerService`, `FacultyService`, `PeriodAttendanceService`, and `AllocationService` (`apply_course_allocation`). |
| **F16** | P1 / High | **Completed** | Distinct credit partitioning: slots 1–6 populate `core_credits`, slots 7–8 populate `additional_credits`, and `total_credits = core_credits + additional_credits`. Validated against `campus_settings.min_credits` and `max_credits`. |
| **F17** | P0 / Critical | **Completed** | Implemented `submit_student_registration` RPC with fallback. Re-ranking elective preferences preserves initial `submitted_at` timestamp as canonical tiebreaker for allocation scoring, atomically syncing `registration_preferences` and `student_registrations`. |
| **F19** | P0 / Critical | **Completed** | Unified prerequisite evaluation engine `evaluateCoursePrerequisites` in `backend/src/core/utils/slotRules.ts`. Prior registration in a course is treated as canonical proof of completion across all assignment paths (preference submission, direct slot update, algorithmic rounds, direct confirmation, and manual allocation). |
| **F20 & D02** | P1 / High | **Completed** | Prevent duplicate course assignments: `validatePathwaySlots` rejects duplicate fixed course targets in blueprints; `check_unique_course_slots` constraint in DB and validation checks in `submitCourses`, `updateSlot`, and `manualAllocate` strictly prevent enrolling a student in the same course across multiple slots. |
| **F21** | P0 / Critical | **Completed** | Global capacity enforcement: seat counts for elective and fixed courses are checked and deducted across all campuses for the active `academic_year` and `semester`. `execute_student_course_change` RPC applies deterministic row locking (`ORDER BY id`) to prevent race conditions and oversubscription. |
| **F27** | P1 / High | **Completed** | `academic_year` derived from authoritative `campus_settings` (fails closed if unconfigured or null; hardcoded fallback removed). |
| **F28** | P1 / High | **Completed** | Manual allocation authorization: HOD is authorized via student's home department (`student.department_id === user.department_id`, course catalog ownership not required); Teacher is authorized strictly if assigned to teach that course at the student's campus for that term in `teacher_course_assignments`. |
| **F29** | P1 / High | **Completed** | Manual allocation enforces prerequisite checks, distinct slot assignments, non-override of fixed core slots, global capacity, and atomic credit recalculation across all 8 slots. |
| **F30** | P1 / High | **Completed** | In-window course changes strictly locked out when registration window is closed (`now >= deadline`) OR cohort timetable has been published (`timetable_entries.status = 'published'`). |
| **F31** | P1 / High | **Completed** | Rolling rate limit of max 3 course changes within a 27-hour window, recording `slot_change_history` in `allocation_metadata` and reporting exact cooldown duration to student on limit reached. |
| **F32** | P1 / High | **Completed** | Created database indexes on `(student_id, semester, academic_year)` and `(academic_year, semester)` for both `student_registrations` and `registration_preferences`. Scoped downstream roster and ledger queries by `academic_year`. |
| **D01, D06, D08**| Advisory / Data | **Completed** | Added readiness warnings in `HodService.getCatalogReadiness` for course semester mismatch (D01), duplicate fixed targets (D02), and tight AEC capacity (D06). Upgraded `apply_course_allocation` to reset unallocated elective slots and recalculate credits across all 8 slots (D08). |

---

## 2. Changed Files & Migrations

### Modified Files:
- `backend/src/core/utils/slotRules.ts` — Added `validatePathwaySlots` and `evaluateCoursePrerequisites`.
- `backend/src/modules/hod/hod.service.ts` — Integrated `validatePathwaySlots` in `updateBlueprint` and added advisory warnings in `getCatalogReadiness`.
- `backend/src/modules/registrations/registrations.service.ts` — Implemented 8-slot DTO validation, variable pathways, prerequisite checking, distinct credit division, timestamp preservation, and direct change window/lockout/quota checks.
- `backend/src/modules/allocation/allocation.controller.ts` — Updated `@Roles('hod', 'teacher', 'superadmin')` on `manual-allocate`.
- `backend/src/modules/allocation/allocation.service.ts` — Updated direct confirmation and scoring rounds with prerequisite and duplicate checks; updated `getUnresolvedStudents`, `getRemainingSeats`, and `manualAllocate` for 8 slots, authoritative academic year, role authorization, and global capacity.
- `backend/src/modules/student/student.service.ts` — Scoped student profile and allocation queries by `campus_settings.academic_year`.
- `backend/src/modules/timetable/solver/loader.ts` — Extended timetable solver student enrollment queries to include slots 7 and 8.
- `backend/src/modules/credit-ledger/credit-ledger.service.ts` — Extended credit ledger calculations to include slots 7 and 8.
- `backend/src/modules/faculty/faculty.service.ts` — Extended faculty student enrollment queries across all 8 slots.
- `backend/src/modules/period-attendance/period-attendance.service.ts` — Extended `getEnrolledRoster` to include slots 7 and 8 with term scoping.
- `backend/test/registration-eligibility-capacity.test.js` — Authoritative unit test suite for Plan 04 (16 tests across 6 suites).

### Migrations Created:
- `supabase/migrations/20261007010000_plan04_enrollment_capacity_transactions.sql` — Additive, reviewable SQL migration:
  - Table check constraint `chk_student_registrations_unique_slots` preventing duplicate course assignments across slots 1–8.
  - Performance indexes on `student_registrations` and `registration_preferences` for term filtering.
  - Stored procedure `apply_course_allocation` upgraded to support 8 slots with atomic credit recalculation.
  - Stored procedure `submit_student_registration` preserving initial `submitted_at`.
  - Stored procedure `execute_student_course_change` with deterministic row locking (`ORDER BY id`), global capacity enforcement, window check, and 27-hour rolling quota.

---

## 3. Downstream Contracts & Invariants

1. **Global Capacity Authority:**
   - Course seat limits are global across all campuses for the active `(academic_year, semester)`.
   - Never query or filter capacity by `campus_id` when checking available seats.
2. **Student Change Lockout:**
   - Once a campus registration window closes OR the cohort timetable is published, students cannot perform direct course changes under any circumstances.
3. **Credit Accounting Invariant:**
   - `core_credits`: sum of credits from slots 1–6.
   - `additional_credits`: sum of credits from slots 7–8.
   - `total_credits = core_credits + additional_credits`.
4. **Manual Allocation Scope:**
   - HODs allocate courses to students based on student department affiliation (`student.department_id === user.department_id`). They may allocate electives belonging to external departments.
   - Teachers may allocate unresolved students only if assigned to deliver that specific course at that student's campus for that academic year in `teacher_course_assignments`.

---

## 4. Verification Evidence

- **Unit Tests:** `npm --workspace=backend run test` executes **64 tests across 28 test suites**, passing with **0 failures**:
  - Plan 01 suites: 22 tests passing.
  - Plan 02 suites: 14 tests passing.
  - Plan 03 suites: 12 tests passing.
  - Plan 04 suites: 16 tests passing (`backend/test/registration-eligibility-capacity.test.js`).
- **Backend Build:** `npm --workspace=backend run build` (`nest build`) passes with 0 TypeScript compilation errors.
- **Frontend Build:** `npm --workspace=frontend run build` (`next build` with Turbopack) passes with 0 errors across all routes.
