# Follow-up Plan 08 Handoff: Recoverable Graduation & Current-Semester Cleanup

**Date:** 11 October 2026
**Status:** Completed
**Primary findings owned:** R27
**Related findings:** R01 (Plan 01), R06 (Plan 03), R28 (Plan 07), R29 (Plan 07)
**Target Migration:** `supabase/migrations/20261010040000_followup_plan08_recoverable_graduation_and_retention.sql`

---

## 1. Scope and Findings Status

| Finding | Severity | Description | Status | Evidence / Verification |
|---|---|---|---|---|
| **R27** | High | Graduation previously deleted Auth users before deleting `students`. Unpatched databases with `students_id_fkey` lacking `ON DELETE CASCADE` caused PostgreSQL to reject Auth deletion with foreign-key violation, halting cleanup. Partial DB failures were logged but omitted from `failed_student_ids`, returning false `success: true`. | **Completed** | 1. **Migration Schema:** Added explicit `students_id_fkey` foreign-key definition with `ON DELETE CASCADE` (`ALTER TABLE students DROP CONSTRAINT IF EXISTS students_id_fkey; ALTER TABLE students ADD CONSTRAINT students_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;`).<br>2. **Staged Recovery Pipeline:** Inverted graduation order to execute Database deletion first (cascading dependent preferences, registrations, and marks) before calling Auth `deleteUser(id)`. Because the `students` row is already removed, foreign key checks on `auth.users` cannot deadlock.<br>3. **Honest Stage Error Reporting:** Reported `db_deleted_count`, `auth_deleted_count`, `graduated_count`, `failed_count`, and detailed stage errors (`stage: 'database'` vs `stage: 'auth'`).<br>4. **Safe Retries:** When retry runs for failed candidates, students already deleted from DB safely skip DB deletion and complete Auth deletion without errors.<br>5. **Campus Boundary:** Rejects cross-campus candidate tampering immediately. |

---

## 2. Shared Types, DTOs & RPC Contracts

### 2.1 Database Tables & Schemas

1. **`students_id_fkey` constraint**:
   - `ALTER TABLE students ADD CONSTRAINT students_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;`
   - Guarantees database-level cascade support for Auth user removals.

2. **`graduation_operations`**:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `idempotency_key TEXT UNIQUE NOT NULL`
   - `campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE`
   - `academic_year TEXT NOT NULL`
   - `initiated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
   - `status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'partially_failed', 'failed'))`
   - `total_candidates INTEGER NOT NULL DEFAULT 0`
   - `graduated_count INTEGER NOT NULL DEFAULT 0`
   - `db_deleted_count INTEGER NOT NULL DEFAULT 0`
   - `auth_deleted_count INTEGER NOT NULL DEFAULT 0`
   - `failed_count INTEGER NOT NULL DEFAULT 0`
   - `candidate_student_ids UUID[] NOT NULL DEFAULT '{}'`
   - `completed_student_ids UUID[] NOT NULL DEFAULT '{}'`
   - `failed_student_ids UUID[] NOT NULL DEFAULT '{}'`
   - `stage_details JSONB NOT NULL DEFAULT '[]'::jsonb`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())`

### 2.2 PostgreSQL RPC Contracts

1. **`atomic_graduate_candidates_db`**:
   - **Signature:** `(p_campus_id UUID, p_student_ids UUID[]) RETURNS JSONB`
   - **Behavior:** Validates candidates belong strictly to `p_campus_id` and have `current_semester = 10`. Deletes valid candidates from `students` table, triggering cascades for registrations, preferences, assignments, and period attendance.
   - **Security:** Security Definer with revoking `PUBLIC`/`anon` access; granted to `authenticated` and `service_role`.

### 2.3 Backend Service Contracts (`AdminService.graduateStudents`)

- **Method:** `graduateStudents(campusId: string, studentIds: string[], user: AuthUser)`
- **Return Type:**
  ```typescript
  {
    success: boolean,
    total_candidates: number,
    graduated_count: number,
    failed_count: number,
    failed_student_ids: string[],
    errors: Array<{
      student_id: string,
      error: string,
      stage?: 'validation' | 'database' | 'auth'
    }>
  }
  ```
- **State Transitions:**
  1. `pending`: Candidate validated for semester 10 and director campus.
  2. `db_deleted`: Database student record deleted, dependent marks cascaded.
  3. `auth_deleted` / `graduated`: Auth user successfully deleted by Supabase admin Auth.
  4. `failed` (stage: `database` or `auth`): Retained in `failed_student_ids` with honest error explanation.

---

## 3. Changed Source Paths & Migration Order

### Migration
- `supabase/migrations/20261010040000_followup_plan08_recoverable_graduation_and_retention.sql`
  - Recreates `students_id_fkey` with `ON DELETE CASCADE`.
  - Creates `graduation_operations` table with RLS and indexes.
  - Implements `atomic_graduate_candidates_db` RPC.
  - Grants least-privilege execute permissions per Plan 01.
  - Appends version to `schema_migrations`.

### Backend
- `backend/src/modules/admin/admin.service.ts`:
  - Refactored `graduateStudents` to implement staged FK-compatible execution (DB first, then Auth).
  - Added independent tracking for DB and Auth failure stages.
  - Enforced director campus boundaries and rejected cross-campus student manipulation.
  - Implemented safe retry resumption (skips DB deletion if student was already removed in prior step).
- `backend/src/modules/admin/admin.controller.ts`:
  - Verified role and campus director authorization on `@Post('campus/graduate-students')`.
- `backend/dist/modules/admin/admin.service.js`:
  - Verified compiled JS mirrors the updated TypeScript logic.

### Frontend
- `frontend/src/app/dashboard/director/page.tsx`:
  - Added `failedGraduations` and `retryingGraduation` state.
  - Updated `handlePromoteStudents` to capture failed graduation candidates.
  - Added `handleRetryGraduation` to invoke `/api/admin/campus/graduate-students` with pending candidate IDs.
  - Rendered actionable warning banner with "Retry Cleanup Now" button when graduation cleanup is pending.

### Tests
- `backend/test/followup-recoverable-graduation.test.js`:
  - Added dedicated test suite covering staged DB-then-Auth pipeline, injected Auth failure, injected DB failure, cross-campus tampering rejection, non-final semester filtering, and concluded attendance retention.
- `backend/test/campus-promotion-lifecycle.test.js`:
  - Updated test assertions to match staged FK-compatible graduation semantics.

---

## 4. Verification & Test Evidence

### Test Command: `node --test test/followup-recoverable-graduation.test.js`
```text
▶ Follow-up Plan 08: Recoverable Graduation and Current-Semester Cleanup (Finding R27)
  ✔ graduates realistic semester-10 candidates via staged DB-then-Auth pipeline (3.4636ms)
  ✔ retains failed student in retryable status on Auth failure, and retry completes Auth deletion without DB re-delete (0.7668ms)
  ✔ stops and reports database stage failure before attempting Auth deletion when DB delete fails (0.4779ms)
  ✔ rejects cross-campus graduation attempts and enforces director campus authority (1.3359ms)
  ✔ filters out candidates who are not in final semester 10 (0.965ms)
  ✔ purges attendance for concluded semester while strictly preserving student registrations and credit ledger (0.7846ms)
  ✔ verifies Plan 08 follow-up migration exists with students_id_fkey CASCADE, graduation_operations and atomic RPC (0.9969ms)
✔ Follow-up Plan 08: Recoverable Graduation and Current-Semester Cleanup (Finding R27) (10.8863ms)
ℹ tests 7
ℹ suites 1
ℹ pass 7
ℹ fail 0
```

### Test Command: `node --test test/campus-promotion-lifecycle.test.js`
```text
▶ Plan 08: Campus Setup, Promotion, Graduation & Short Retention
  ✔ 1. F54: Campus Onboarding Completeness & Verified Settings Update (6.8514ms)
  ✔ 2. F56: Director Own-Campus Atomic Promotion & 90-Day Cooldown (4.1922ms)
  ✔ 3. F55: Explicit & Recoverable Graduation Cleanup (Semester 10 Cohort) (3.3199ms)
  ✔ 4. Short Retention: Concluded-Semester Attendance Purge & Ledger Preservation (1.3052ms)
  ✔ 5. Migration Integrity & Artifact Verification (0.8573ms)
✔ Plan 08: Campus Setup, Promotion, Graduation & Short Retention (17.7303ms)
ℹ tests 11
ℹ suites 6
ℹ pass 11
ℹ fail 0
```

---

## 5. Relevant Policy Decisions Left Pending

1. **Mandatory Export Prior to Graduation:**
   - Whether academic data export is strictly mandatory prior to graduation cleanup remains a university administrative policy decision.
   - The system preserves all export opportunities and does not automatically purge records without director/superadmin action.
2. **GPS Retention During Concluded Term Purge:**
   - Concluded semester attendance purge purges only timetable session marks (`period_attendance` and `period_attendance_sessions`); it strictly avoids deleting unrelated institutional GPS logs or student registration history.

---

## 6. Downstream Checklist for Plan 09

- [x] R27 foreign-key deletion deadlock eliminated via DB-then-Auth staged sequence and migration cascade definition.
- [x] Auth and database failures reported independently with `stage: 'database'` vs `stage: 'auth'`.
- [x] Graduation retries target only recorded failed candidates, never newly promoted semester-10 students.
- [x] Director campus boundaries strictly enforced; cross-campus tampering rejected.
- [x] Concluded term cleanup leaves active term marks, registrations, and credit ledger intact.
- [x] All 18 automated tests across both test suites pass 100%.
