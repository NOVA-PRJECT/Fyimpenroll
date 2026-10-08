# Implementation Handoff — Plan 08: Campus Setup, Promotion, Graduation and Short Retention

## 1. Findings Status Summary

| Finding | Priority / Severity | Status | Precise Rationale |
|---|---|---|---|
| **F54** | P1 / High | **Completed** | Campus onboarding completeness & verified settings updates. Created trigger `trg_campuses_init_settings` on `campuses` inserting default `campus_settings` row (`academic_year: '2025-26'`, `min_credits: 18`, `max_credits: 26`). Added fallback upsert in `AdminService.createCampus` guaranteeing row existence even if triggers are bypassed. Updated `DirectorService.getSettings` to surface explicit `setup_status` (`'ready'`, `'incomplete_geofence'`, `'incomplete_registration_window'`, `'uninitialized'`) and `is_ready` boolean. Updated `DirectorService.updateSettings` to use `.update().select('id')` and throw `NotFoundException` if 0 rows are affected, eliminating silent zero-row update bugs. |
| **F55** | P1 / High | **Completed** | Explicit, recoverable graduation cleanup for semester 10 cohort. In PostgreSQL RPC `promote_campus_students_atomic`, students in semester 10 are collected in `graduating_student_ids` and are strictly excluded from semester advancement (`current_semester < 10` only), preventing invalid writes of semester 11 (domain strictly capped at 1–10). In `AdminService.promoteStudents` and `graduateStudents`, external Auth deletion (`deleteUser`) is coordinated across candidates using `Promise.allSettled`. For successfully de-authed students, database records are deleted. Partial failures are reported honestly (`{ total_candidates, graduated_count, failed_count, failed_student_ids, errors }`) without leaving phantom states or ghost records, and can be retried safely. |
| **F56** | P1 / High | **Completed** | Atomic director own-campus promotion in a trusted transaction. Created PostgreSQL function `promote_campus_students_atomic(p_campus_id, p_director_id, p_idempotency_key)` which locks `campus_settings` row `FOR UPDATE`, enforces the 90-day cooldown within the transaction (`v_last_promoted > now() - interval '90 days'`), increments `current_semester` for semesters 1–9, updates `last_promoted_at`, logs to `system_logs`, and returns atomic counts. Directors are restricted to their assigned campus (`director.campus_id`). Eliminated multi-tab race conditions and double-promotion bugs. |
| **Retention** | P2 / Med | **Completed** | Concluded-semester attendance retention purge. Created RPC `cleanup_concluded_semester_attendance(p_campus_id, p_academic_year, p_semester)` and service/controller endpoints. Purges `period_attendance` records belonging to timetable entries of the concluded term while strictly preserving `student_registrations` (prerequisite history & credit ledger) until student graduation. Rejects directors attempting cleanup for foreign campuses. |

---

## 2. Changed Files & Migrations

### Modified Files:
- `backend/src/modules/director/director.service.ts`:
  - `getSettings`: computes and returns `setup_status` and `is_ready` based on geofence coordinates and registration window configuration.
  - `updateSettings`: verifies updated row count via `.select('id')` and throws `NotFoundException` on 0 rows affected (F54).
- `backend/src/modules/admin/admin.service.ts`:
  - `createCampus`: ensures base `campus_settings` are upserted and returns `setup_status` and `is_ready` metadata (F54).
  - `deleteCampus`: logs warnings when external Auth deletions fail instead of swallowing silently.
  - `promoteStudents`: restricts directors to their own campus, invokes atomic PostgreSQL RPC `promote_campus_students_atomic` with `FOR UPDATE` lock and 90-day cooldown (F56), triggers explicit graduation cleanup on semester-10 candidates (F55).
  - `graduateStudents`: explicitly de-auths semester-10 students, inspects `Promise.allSettled` results, cleans up database rows for confirmed de-auths, and reports failed IDs for retry (F55).
  - `cleanupConcludedSemesterAttendance`: invokes `cleanup_concluded_semester_attendance` RPC to purge concluded attendance while preserving registrations.
- `backend/src/modules/admin/admin.controller.ts`:
  - Updated `@Post('campus/promote-students')` to accept optional `idempotency_key`.
  - Added `@Post('campus/graduate-students')` with director campus scoping and retry support.
  - Added `@Post('campus/concluded-attendance-cleanup')` for retention purging.
- `backend/test/campus-promotion-lifecycle.test.js` *(New File)*:
  - 11 comprehensive automated tests covering all Plan 08 findings.

### Migrations Created:
- `supabase/migrations/20261007050000_plan08_campus_onboarding_and_atomic_promotion.sql`:
  - `trg_init_campus_settings`: trigger on `campuses` creating base settings row upon campus creation (F54).
  - Backfill query initializing missing `campus_settings` for existing campuses.
  - `promote_campus_students_atomic(p_campus_id, p_director_id, p_idempotency_key)`: atomic procedure with row-level lock `FOR UPDATE`, 90-day cooldown check, semester 10 cohort collection, semester 1..9 increment, and audit log write.
  - `cleanup_concluded_semester_attendance(p_campus_id, p_academic_year, p_semester)`: purges `period_attendance` records without deleting student registrations.
  - Registered in `schema_migrations`.

---

## 3. Downstream Contracts & Invariants

1. **Guaranteed Campus Settings Invariant (F54):**
   - Every campus row in `campuses` has an associated `campus_settings` row. Missing settings records cause `promote_campus_students_atomic` and `updateSettings` to fail closed with clear exceptions.
2. **Atomic Promotion & 90-Day Cooldown (F56):**
   - Promotions lock the campus settings row `FOR UPDATE`. If `last_promoted_at` is within 90 days, the transaction aborts with an exception. Concurrent calls are serialized by the row lock.
3. **Semester-10 Graduation Boundary (F55):**
   - The database constraint `CHECK (current_semester BETWEEN 1 AND 10)` is strictly respected. Students in semester 10 are never incremented to semester 11. Instead, they are collected and graduated.
4. **Honest Auth Deletion & Retryability (F55):**
   - Because Supabase Auth deletion is an external network call outside the SQL engine, partial failures are tracked and returned in `{ failed_student_ids, errors }`. Only successfully de-authed students are deleted from the database. Unprocessed students can be safely retried via `POST /api/admin/campus/graduate-students`.
5. **Short Attendance Retention vs Permanent Registration History:**
   - Term cleanup purges `period_attendance` for concluded terms to conserve database storage on free tier plans.
   - `student_registrations` are never deleted during term cleanup; they persist until student graduation to support prerequisite checking and credit ledgers.

---

## 4. Policy Choices Kept Unchanged & Undecided Decisions

1. **Long-Term University Archive:**
   - As affirmed in Plan 08 rules, this portal operates on free-tier infrastructure and is not designed as a multi-decade university archive. Once students graduate and terms conclude, attendance records and student accounts are cleaned up.
2. **Promotion Cooldown Period:**
   - 90 days remains the standard cooldown period between promotions for a campus.
3. **Autonomous Scheduled Crons:**
   - Cleanups and promotions remain explicit director/admin initiated operations rather than automated background daemons, preventing uncoordinated unexpected account deletions.

---

## 5. Verification Evidence

- **Automated Backend Tests:**
  - `backend/test/campus-promotion-lifecycle.test.js`: **11 tests passing, 0 failing**.
  - Full suite (`npm --prefix backend run test`): **113 automated tests across 55 test suites**, passing with **0 failures**:
    - Plan 01 suites: 22 tests passing
    - Plan 02 suites: 14 tests passing
    - Plan 03 suites: 12 tests passing
    - Plan 04 suites: 16 tests passing
    - Plan 05 suites: 11 tests passing
    - Plan 06 suites: 14 tests passing
    - Plan 07 suites: 13 tests passing
    - Plan 08 suites: 11 tests passing
- **Backend Build:** `npm --prefix backend run build` (`nest build`) compiles with 0 errors.
- **Frontend Build:** `npm --prefix frontend run build` (`next build` with Turbopack) compiles with 0 errors across all routes.
