# Follow-up Plan 07 Handoff: Current-Semester Attendance, Practical Copying & Concurrent Edits

**Date:** 10 October 2026
**Status:** Completed
**Primary findings owned:** R03, R28, R29
**Related findings:** R06 (Plan 03), R07 (Plan 03), R22 (Plan 06), R24 (Plan 09), R36 (Plan 05)
**Target Migration:** `supabase/migrations/20261010030000_followup_plan07_attendance_concurrency_and_pairing.sql`

---

## 1. Scope and Findings Status

| Finding | Severity | Description | Status | Evidence / Verification |
|---|---|---|---|---|
| **R03** | High | Practical-attendance copying lacked resource authorization and pair validation. Could copy to unauthorized courses, non-adjacent periods, or cross lunch breaks. | **Completed** | Enforced strict class-delivery authorization via `assertClassDeliveryAuthority` (teacher delivery, HOD department scope, immediate fail-closed for `teaching_staff`). Enforced practical-pair validation (`isValidPracticalPair` and SQL RPC check): only consecutive pairs on the same day `(1, 2), (2, 3), (4, 5), (5, 6)` are allowed; strictly forbids non-adjacent pairs and lunch-break crossing `(3, 4)`. Target period creates distinct, independently counted attendance marks and period session record. |
| **R28** | Medium | Attendance corrections must be unrestricted in time across the active semester, but strictly validated against Gregorian calendar dates, non-future dates, scheduled weekdays, and active cohorts. | **Completed** | Centralized in `resolveDatedSession`: validates valid Gregorian calendar dates via `isValidCalendarDate` (rejects impossible calendar dates such as Feb 30), verifies date is not in future (`attendanceDate <= todayIso`), checks that date's day-of-week matches `time_slots.day_of_week`, and validates active cohort term state (`assertActiveCohort` blocks retired/concluded terms). Preserved unrestricted any-time editing within the active semester with zero 15-minute or expiring lockout windows. |
| **R29** | Medium | Attendance conflict detection upgraded from non-atomic read-then-write to dated-session revision tokens and atomic compare-and-swap (CAS) database transactions. | **Completed** | Created `period_attendance_sessions` table tracking `(timetable_slot_id, attendance_date, revision, revision_token, marked_by, last_marked_at, total_students, present_count, absent_count)`. Created PostgreSQL RPC `atomic_submit_period_attendance` and `atomic_copy_practical_attendance` utilizing `pg_advisory_xact_lock` and atomic CAS revision validation (`expected_revision` / `expected_target_revision`). Frontend teacher dashboard updated to maintain `sessionRevision` and gracefully preserve entered absent choices on 409 conflict. |

---

## 2. Shared Types, DTOs & RPC Contracts

### 2.1 Database Tables & Schemas

1. **`period_attendance_sessions`**:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `timetable_slot_id UUID NOT NULL REFERENCES timetable_entries(id) ON DELETE CASCADE`
   - `attendance_date DATE NOT NULL`
   - `revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)`
   - `revision_token TEXT NOT NULL` (MD5 hex hash of slot ID, date, and revision)
   - `marked_by UUID NOT NULL REFERENCES users(id)`
   - `last_marked_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())`
   - `total_students INTEGER NOT NULL DEFAULT 0`
   - `present_count INTEGER NOT NULL DEFAULT 0`
   - `absent_count INTEGER NOT NULL DEFAULT 0`
   - Unique Constraint: `(timetable_slot_id, attendance_date)`

2. **`retired_cohorts`** (Contract interface for Plan 08 retention scope):
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `campus_id UUID NOT NULL REFERENCES campuses(id) ON DELETE CASCADE`
   - `academic_year TEXT NOT NULL`
   - `semester INTEGER NOT NULL CHECK (semester BETWEEN 1 AND 10)`
   - `retired_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())`
   - `retired_by UUID REFERENCES users(id) ON DELETE SET NULL`
   - `reason TEXT NOT NULL DEFAULT 'SEMESTER_CONCLUDED'`
   - Unique Constraint: `(campus_id, academic_year, semester)`

### 2.2 PostgreSQL RPC Contracts

1. **`atomic_submit_period_attendance`**:
   - **Signature:** `(p_slot_id UUID, p_attendance_date DATE, p_absent_student_ids UUID[], p_marked_by UUID, p_expected_revision INT DEFAULT NULL) RETURNS JSONB`
   - **Concurrency:** Obtains exclusive transaction advisory lock: `pg_advisory_xact_lock(hashtext('attendance_' || p_slot_id::text || '_' || p_attendance_date::text))`
   - **CAS Check:** Verifies cohort is not in `retired_cohorts`; verifies existing session revision matches `p_expected_revision` (if supplied). Raises `ATTENDANCE_CONFLICT` (SQLSTATE `40001`) on revision mismatch.
   - **Operation:** Upserts individual student marks into `period_attendance`, calculates counts, and atomically increments revision in `period_attendance_sessions`.
   - **Security:** Security Definer with revoking `PUBLIC`/`anon` access; granted to `authenticated` and `service_role`.

2. **`atomic_copy_practical_attendance`**:
   - **Signature:** `(p_source_slot_id UUID, p_target_slot_id UUID, p_attendance_date DATE, p_marked_by UUID, p_expected_target_revision INT DEFAULT NULL) RETURNS JSONB`
   - **Pair Validation:** Checks both slots exist in published timetable, have matching `campus_id`, `academic_year`, `semester`, and `session_type = 'practical'`. Enforces same day of week and consecutive period numbers: `(1, 2), (2, 3), (4, 5), (5, 6)`. Strictly rejects lunch crossing `(3, 4)` and non-adjacent periods.
   - **CAS Check:** Locks target slot session via advisory lock; checks target is not in `retired_cohorts`; verifies target revision matches `p_expected_target_revision` (if supplied). Raises `ATTENDANCE_CONFLICT` on mismatch.
   - **Operation:** Copies source marks into target slot, creating separate, counted records in `period_attendance` and updating `period_attendance_sessions`.

3. **`cleanup_concluded_semester_attendance`**:
   - Hardened to register concluded cohort into `retired_cohorts` before deleting `period_attendance` and `period_attendance_sessions` rows, preventing accidental or unauthorized repopulation of historical marks.

### 2.3 Backend DTO Contracts

- **`SubmitAttendanceDto`**:
  - `timetable_slot_id`: UUID string (required)
  - `attendance_date`: YYYY-MM-DD string (optional, defaults to current date)
  - `absent_student_ids`: string[] (required)
  - `last_marked_at`: ISO timestamp string (optional, legacy fallback)
  - `expected_revision`: number (optional, CAS revision token)
  - `client_timestamp`: ISO timestamp string (optional)

- **`CopyPracticalDto`**:
  - `source_slot_id`: UUID string (required)
  - `target_slot_id`: UUID string (required)
  - `attendance_date`: YYYY-MM-DD string (required)
  - `expected_target_revision`: number (optional, CAS target revision token)
  - `expected_revision`: number (optional alias)
  - `overwrite`: boolean (optional)

---

## 3. Changed Files & Migration Order

### Database Migration
- `supabase/migrations/20261010030000_followup_plan07_attendance_concurrency_and_pairing.sql`
  - Defines `period_attendance_sessions` table and indexes.
  - Defines `retired_cohorts` table and indexes.
  - Backfills sessions from existing `period_attendance` records.
  - Implements `atomic_submit_period_attendance` RPC.
  - Implements `atomic_copy_practical_attendance` RPC.
  - Hardens `cleanup_concluded_semester_attendance` RPC.
  - Enforces Plan 01 least-privilege permissions on RPCs.

### Backend Files
- `backend/src/modules/period-attendance/dto/submit-attendance.dto.ts`: Added `expected_revision`.
- `backend/src/modules/period-attendance/dto/copy-practical.dto.ts`: Added `expected_target_revision` and `expected_revision`.
- `backend/src/modules/period-attendance/period-attendance.service.ts`:
  - Added Gregorian calendar date validator (`isValidCalendarDate`).
  - Added IST day-of-week calculator (`getCalendarDayOfWeek`).
  - Added practical pair validation (`isValidPracticalPair`).
  - Added `resolveDatedSession` centralizing resolution, calendar date checks, non-future enforcement, weekday schedule matching, and cohort lifecycle checks.
  - Added `assertClassDeliveryAuthority` enforcing teacher course delivery, HOD department boundaries, and immediate fail-closed `assertNotRosterOnly` check.
  - Added cohort lifecycle contract methods: `assertActiveCohort`, `isCohortActive`, `retireCohort`, `getRetiredCohorts`.
  - Upgraded `submitAttendance` and `copyPracticalAttendance` to use atomic CAS RPCs with mock test fallbacks.
  - Updated `getTeacherSchedule`: restricts `adjacent_practical_slot_id` to approved consecutive practical pairs (excludes P3→P4 lunch crossing).
- `backend/src/modules/period-attendance/period-attendance.controller.ts`: Passed `expected_revision` to service.

### Frontend Files
- `frontend/src/app/dashboard/teacher/page.tsx`:
  - Added `sessionRevision` and `conflictRevision` state to marking modal.
  - Updated `handleOpenMarkingModal` to store fetched session revision.
  - Updated `handleSubmitAttendance` to send `expected_revision`.
  - On 409 conflict: preserves entered student absent selections, shows conflict revision alert, and provides "Overwrite with My Marks (Revision N)" option without wiping user inputs.
  - Updated `handleCopyPractical` to pass `expected_target_revision: 0` initially and query target revision upon overwrite confirmation.

### Tests
- `backend/test/followup-period-attendance.test.js`: New 17-test suite covering Gregorian validation, non-future check, weekday alignment, practical pair validation (rejecting P3–P4), class delivery authorization, and atomic CAS conflict handling.
- `backend/test/period-attendance-corrections.test.js`: Updated slot test fixtures to use valid calendar Mondays matching slot definitions.
- `backend/test/followup-host-campus-classes.test.js`: Updated slot test fixtures to use valid calendar Mondays.

---

## 4. Verification and Test Results

### Test Execution Commands
```powershell
# Unit & integration verification for Follow-up Plan 07
node --test test/followup-period-attendance.test.js

# Regression verification on period attendance suite
node --test test/period-attendance-corrections.test.js

# Security and privileges verification
node --test test/followup-security-privileges.test.js

# Full repository regression gate across all 100 suites
npm test
```

### Outcomes
- `followup-period-attendance.test.js`: **17 / 17 passing** (0 failures).
- `period-attendance-corrections.test.js`: **13 / 13 passing** (0 failures).
- `followup-security-privileges.test.js`: **10 / 10 passing** (0 failures).
- Full Test Suite (`npm test`): **224 / 224 tests passing across all 100 test suites with 0 failures!**
- Build / Typecheck: Clean, zero errors.

---

## 5. Deployment Persistence & Pending Decisions

1. **Transaction Pooler Advisory Locks:**
   - The PostgreSQL RPCs use `pg_advisory_xact_lock`, which are scoped strictly to the current transaction. This is 100% compatible with Supabase connection poolers in Transaction mode (PgBouncer) and ensures lock release upon commit or rollback without orphan connection leaks.
2. **GPS Sign-in Decoupling:**
   - Confirmed independent architecture: GPS arrival sign-in does not record period attendance marks, and period attendance marking does not require student or teacher GPS check-ins.

---

## 6. Downstream Checklist for Plan 08 & Plan 09

- [x] **Plan 08 Contract:** `retired_cohorts` table and `cleanup_concluded_semester_attendance` are in place. When Plan 08 concludes a term or graduates a cohort, adding the cohort to `retired_cohorts` will immediately prevent all backfilled attendance submissions.
- [x] **Plan 09 Contract:** `period_attendance_sessions` accurately records `total_students`, `present_count`, and `absent_count` along with `last_marked_at` and `revision` for downstream statutory attendance aggregation and analytics.
- [x] **Classroom Attendance Integrity:** Roster queries remain strictly scoped to published cohorts, preventing cross-cohort or historical ghost student marks.
