# Follow-up Plan 05 Handoff: Allocation Accounting, Scoped Jobs and Complete Cohort Data

**Date:** 10 October 2026
**Author:** Antigravity Engineering Agent
**Target Plan:** Follow-up Plan 05 (Findings R13, R15, R16, R36)
**Prerequisites:** Follow-up Plan 01 (Database privileges & resource authorization), Follow-up Plan 02 (Password changes, session refresh & logout), Follow-up Plan 03 (Host-campus classes & delivery identity), Follow-up Plan 04 (Atomic enrollment, global seats & blueprint eligibility)
**Status:** Completed

---

## 1. Scope & Finding Status Matrix

| Finding | Priority / Severity | Follow-up Status | Primary Owner | Downstream Consumers | Exact Validation Evidence & Details |
|---|---|---|---|---|---|
| **R13** | Critical | **Completed** | Follow-up 05 | Follow-up 06, Follow-up 09 | (1) Eliminated double deduction of fixed course seats in [`allocation.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/allocation/allocation.service.ts) (`runAllocation`). The service pre-indexes `existingStudentFixedCourses` from existing baseline registrations; during Step 1 fixed slot resolution, a fixed course is only deducted from available memory capacity if not already recorded in `existingRegistrations` for that student. (2) For a course with capacity 2 and 1 existing fixed student, exactly 1 seat remains open for elective round allocation (verified: allocating student 2 to C1 instead of failing with 0 seats). (3) Subsequent runs/retries do not re-deduct existing enrollments. Verified in [`backend/test/followup-allocation-accounting.test.js`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/test/followup-allocation-accounting.test.js) (Suite 1). |
| **R15** | Critical | **Completed** | Follow-up 05 | Follow-up 06, Follow-up 07, Follow-up 09 | (1) Scoped timetable publication guards across all database RPCs (`claim_allocation_run`, `apply_course_allocation`, `execute_student_course_change`) to `campus_id = p_campus_id`. (2) Scoped publication guards across backend services ([`allocation.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/allocation/allocation.service.ts), [`registrations.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/registrations/registrations.service.ts), [`timetable.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/timetable/timetable.service.ts)) to student's/director's `campus_id`. (3) Verified that published timetable slots in Campus B do NOT block student course changes or allocation runs in Campus A. Verified in [`backend/test/followup-allocation-accounting.test.js`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/test/followup-allocation-accounting.test.js) (Suite 2). |
| **R16** | Critical | **Completed** | Follow-up 05 | Follow-up 06 | (1) Added partial unique indexes on `system_logs` (`uq_active_allocation_run_cohort` and `uq_active_timetable_generation_job_cohort`) enforcing active job exclusivity for `(campus_id, academic_year, semester)`. (2) Upgraded `claim_allocation_run` to use transactional advisory locking (`pg_advisory_xact_lock`) and worker fencing tokens. (3) Added `claim_timetable_generation_job` RPC enforcing serialized claims and issuing fencing tokens. (4) Upgraded `apply_course_allocation` to verify that worker's fencing token matches active run before committing allocations. (5) In [`solver/job.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/timetable/solver/job.ts), added worker lease verification before persisting generated timetable entries. Verified in [`backend/test/followup-allocation-accounting.test.js`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/test/followup-allocation-accounting.test.js) (Suite 3). |
| **R36** | High | **Completed** | Follow-up 05 | Follow-up 06, Follow-up 09, Follow-up 10 | (1) Created reusable [`pagination.util.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/core/database/pagination.util.ts) (`fetchAllPaginated`) with `.range(from, to)` batch traversal. (2) Integrated pagination in [`allocation.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/allocation/allocation.service.ts) for `registration_preferences` and `student_registrations`. (3) Integrated pagination in [`solver/loader.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/timetable/solver/loader.ts) for timetable solver registrations. (4) Integrated pagination in [`export.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/credit-ledger/export.service.ts) (`exportFinalRegistrations`). (5) Verified full-cohort retrieval of 2,500 records across 3 batches with zero truncation. Verified in [`backend/test/followup-allocation-accounting.test.js`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/test/followup-allocation-accounting.test.js) (Suite 4). |

---

## 2. Changed Source Files & Created Artifacts

### Database Migrations
- [`supabase/migrations/20261010010000_followup_plan05_scoped_jobs_and_cohort_accounting.sql`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/supabase/migrations/20261010010000_followup_plan05_scoped_jobs_and_cohort_accounting.sql):
  - **Partial Unique Indexes:**
    - `uq_active_allocation_run_cohort` on `system_logs` for `(campus_id, academic_year, semester)` where `event_type = 'allocation_run'` and `status IN ('queued', 'running')`.
    - `uq_active_timetable_generation_job_cohort` on `system_logs` for `(campus_id, academic_year, semester)` where `event_type = 'timetable_generation_job'` and `status IN ('queued', 'running')`.
  - **`claim_allocation_run` RPC:**
    - Scopes publication check strictly to `p_campus_id`.
    - Acquires transactional advisory lock `pg_advisory_xact_lock(hashtext(...))`.
    - Stores `p_fencing_token` in `system_logs.metadata`.
  - **`apply_course_allocation` RPC:**
    - Scopes publication check strictly to `p_campus_id`.
    - Verifies worker fencing token `p_fencing_token` against active run metadata, preventing superseded workers from committing writes.
    - Locks course rows deterministically with `FOR UPDATE`.
  - **`claim_timetable_generation_job` RPC:**
    - Transactionally claims timetable generation job with advisory locking and fencing token.
    - Expired worker recovery: marks jobs running > 10 minutes as failed before re-claiming.
  - **`execute_student_course_change` RPC:**
    - Scopes publication check strictly to `p_campus_id`.
  - **Plan 01 Privilege Hardening:**
    - All functions defined with `SECURITY DEFINER` and `SET search_path = public, pg_temp;`.
    - Revoked `EXECUTE` on all functions from `PUBLIC`, `anon`, and `authenticated`.
    - Granted `EXECUTE` exclusively to `service_role` and `postgres`.

### Backend Utilities & Services Modified
- [`backend/src/core/database/pagination.util.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/core/database/pagination.util.ts):
  - Created `fetchAllPaginated` helper supporting both query builder chaining (`.range()`) and page fetcher factory functions `(from, to) => Promise<{ data, error }>`.
- [`backend/src/modules/allocation/allocation.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/allocation/allocation.service.ts):
  - Scoped timetable publication checks in `runAllocation` and `clearFailedRun` to `campus_id`.
  - R13: Built `existingStudentFixedCourses` lookup map; fixed course memory deduction only applies to students not already counted in baseline enrollments.
  - Generates worker `fencingToken` (UUID) and passes it to `claim_allocation_run` and `apply_course_allocation`.
  - Uses `fetchAllPaginated` for `registration_preferences` and `student_registrations`.
- [`backend/src/modules/registrations/registrations.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/registrations/registrations.service.ts):
  - Scoped timetable publication check in `updateSlot` to student's `campusId`.
- [`backend/src/modules/timetable/timetable.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/timetable/timetable.service.ts):
  - Scoped publication guard in `generate` to `user.campus_id`.
  - Integrates `claim_timetable_generation_job` RPC with worker fencing token.
- [`backend/src/modules/timetable/solver/job.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/timetable/solver/job.ts):
  - Added worker lease and active job status check before committing generated timetable entries to database.
- [`backend/src/modules/timetable/solver/loader.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/timetable/solver/loader.ts):
  - Paginates student registrations using `fetchAllPaginated`.
- [`backend/src/modules/credit-ledger/export.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/credit-ledger/export.service.ts):
  - Paginates `student_registrations` in `exportFinalRegistrations` using `fetchAllPaginated`.

### Acceptance Test Suite
- [`backend/test/followup-allocation-accounting.test.js`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/test/followup-allocation-accounting.test.js):
  - 7 comprehensive automated tests covering R13, R15, R16, R36, and Plan 01 privileges.

---

## 3. Shared Contracts, Types & Downstream Obligations

### 1. Fencing Token Contract
- **Generation:** Before claiming an allocation or timetable generation job, the backend generates a cryptographically random UUID (`fencingToken`).
- **Claim:** Fencing token is recorded in `system_logs.metadata->>'fencing_token'`.
- **Commit Verification:** Committing operations (`apply_course_allocation`) require `p_fencing_token`. If the token in the active run metadata does not match or the run has been superseded/cleared, the commit is aborted with `409 Conflict`.
- **Downstream Obligation (Plan 06):** Any timetable solver worker must verify its job has not been cancelled or superseded before writing final schedules.

### 2. Complete-Cohort Pagination Contract (`fetchAllPaginated`)
- **Import:** `import { fetchAllPaginated } from '@/core/database/pagination.util'`
- **Default Batch Size:** 1,000 rows (PostgREST max page limit).
- **Hard Cap:** 100,000 rows.
- **Downstream Obligation (Plans 06, 09, 10):** All operations that load whole-cohort entities (`student_registrations`, `students`, `audit_logs`, `attendance_records`) must use `fetchAllPaginated` or batch iteration to prevent silent truncation.

### 3. Campus-Scoped Timetable Publication Contract
- Timetable publication status is strictly cohort-and-campus scoped: `(academic_year, semester, campus_id)`.
- When querying `timetable_entries` for `status = 'published'`, queries must filter by `campus_id = user.campus_id`.
- Un-scoped global publication queries are strictly prohibited.

---

## 4. Verification Evidence & Test Results

1. **Follow-up Plan 05 Acceptance Suite:**
   ```powershell
   node --test test/followup-allocation-accounting.test.js
   # Output:
   # ✔ Follow-up Plan 05 · Allocation Accounting, Scoped Jobs & Complete Cohort Data
   # tests: 7 | suites: 6 | pass: 7 | fail: 0
   ```

2. **Deterministic Allocation & Solver Suites:**
   ```powershell
   node --test test/deterministic-allocation-jobs.test.js test/ortools-timetable-solver.test.js
   # Output:
   # ✔ Plan 05: Deterministic Allocation and Atomic Jobs (pass: 10/10)
   # ✔ Plan 06: Local OR-Tools Timetables, JSON Constraints & Recovery (pass: 15/15)
   # tests: 25 | suites: 15 | pass: 25 | fail: 0
   ```

3. **Complete Backend Regression Suite:**
   ```powershell
   npm run test --workspace=backend
   # Output:
   # tests: 192 | suites: 88 | pass: 192 | fail: 0
   ```

4. **Production Compilation:**
   - `npm run build:backend`: Clean build (code 0).
   - `npm run build:frontend`: Clean Turbopack production build (code 0).
