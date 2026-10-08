# Implementation Handoff — Plan 07: Period Attendance and Independent GPS Sign-Ins

## 1. Findings Status Summary

| Finding | Priority / Severity | Status | Precise Rationale |
|---|---|---|---|
| **F43** | P1 / High | **Completed** | Unrestricted current-semester correction; requires published class; server-generated `marked_at`. Removed the 15-minute grace window and all time-of-day lockouts. Authorized teachers can mark or correct current-semester dates at any time. `PeriodAttendanceService.submitAttendance` requires `timetable_entries.status === 'published'` (rejecting drafts with `BadRequestException`), validates assignment, validates date in IST (`attendance_date <= today`), and records server-authoritative `marked_at = now()`. |
| **F44** | P1 / — | **Superseded & Retired** | The attendance unlock approval workflow is superseded by unrestricted authorized editing. Completely retired `@Post('unlock')` in `PeriodAttendanceController`, removed `unlockPeriod` and `PERIOD_GRACE_MINUTES = 15` in `PeriodAttendanceService`, and removed the unlock modal, unlock button, and unlock badges from `PeriodMarkingTab.tsx`. Made `period_attendance.is_late_entry` and `unlocked_by` deprecated/optional in migration. |
| **F45** | P1 / High | **Completed** | Strict campus-class cohort roster scoping. `PeriodAttendanceService.getEnrolledRoster` scopes student discovery strictly to `academic_year`, `campus_id`, and `semester` across all 8 slots (`slot_1_course_id` .. `slot_8_course_id`) and JSONB selections (covering papers 7–8). Historical students from prior academic years and students from other campuses are completely excluded from the roster and write validation. Submissions with foreign student IDs fail fast with `BadRequestException`. |
| **F46** | P1 / High | **Completed** | Dated period HOD summaries & slot rosters. Updated `getDepartmentSlots` and `getSlotRosterForHod` in `PeriodAttendanceService` to query `period_attendance` strictly filtered by the explicit `attendance_date`. Distinct counts for the chosen date (`total_enrolled`, `present_count`, `absent_count`, `unmarked_count`) are returned rather than aggregating marks across all historical dates. In `PeriodMarkingTab.tsx`, added an academic date picker to inspect each date independently. |
| **F47** | P1 / High | **Completed** | Persisted marks reloading & overwrite preservation. Added `GET /api/attendance/period/slot-marks` endpoint returning saved marks (`present` vs `absent`) and explicit `unmarked` status for each enrolled student on the requested date, along with `last_marked_at`. Teacher UI modal (`teacher/page.tsx`) reloads persisted marks on open, preserving legitimate absences on reopen instead of resetting everyone to present. Added concurrency conflict detection: stale submissions with `last_marked_at` older than existing records throw `409 Conflict`. |
| **F48** | P1 / High | **Completed** | Explicit academic date in Asia/Kolkata timezone. Teacher UI sends `attendance_date: scheduleDate` (YYYY-MM-DD), decoupling the selected academic date from the server's `marked_at` timestamp. Midnight UTC boundaries are handled strictly in Asia/Kolkata timezone without date shifts. `period_attendance` enforces compound uniqueness on `(timetable_slot_id, student_id, attendance_date)`. |
| **F49** | P1 / High | **Completed** | Two-hour practical session copying & distinct period records. Implemented `POST /api/attendance/period/copy-to-next-period` with overwrite safeguards. For adjacent practical blocks on the same date and course, copies marks to the next period with fresh server timestamps, generating two independently counted period records for the attendance denominator in exports. Added "Copy to Next Period" button in teacher schedule cards. |

---

## 2. Changed Files & Migrations

### Modified Files:
- `backend/src/modules/period-attendance/period-attendance.constants.ts`:
  - Removed `PERIOD_GRACE_MINUTES = 15`. Added `ASIA_KOLKATA_TIMEZONE`.
- `backend/src/modules/period-attendance/dto/submit-attendance.dto.ts`:
  - Added `attendance_date` (YYYY-MM-DD), `present_student_ids`, and `last_marked_at` for concurrency checks.
- `backend/src/modules/period-attendance/dto/copy-practical.dto.ts` *(New File)*:
  - Created `CopyPracticalSchema` validating `source_slot_id`, `target_slot_id`, `attendance_date`, and `overwrite`.
- `backend/src/modules/period-attendance/period-attendance.service.ts`:
  - Scoped `getEnrolledRoster` to current campus, academic year, and semester across slots 1–8 and JSONB selections (F45).
  - Enforced `status === 'published'` check on timetable entries (F43).
  - Removed 15-minute grace window, time-of-day blocks, and HOD unlock dependencies (F43, F44).
  - Implemented `getSlotMarks` returning persisted marks and `unmarked` states (F47).
  - Added concurrency conflict check via `last_marked_at` (F47).
  - Implemented `copyPracticalAttendance` for 2-hour practical sessions (F49).
  - Scoped HOD slot queries and roster views to explicit `attendance_date` (F46).
- `backend/src/modules/period-attendance/period-attendance.controller.ts`:
  - Added `GET /api/attendance/period/slot-marks` endpoint (F47).
  - Added `POST /api/attendance/period/copy-to-next-period` endpoint (F49).
  - Retired `POST /api/attendance/period/unlock` endpoint (F44).
  - Updated `submitAttendance` to accept `attendance_date` and `last_marked_at` (F48).
- `frontend/src/app/dashboard/teacher/page.tsx`:
  - Replaced naive roster fetch with `GET /api/attendance/period/slot-marks` on modal open, preserving absences and unmarked states (F47).
  - Passed teacher-selected `scheduleDate` as `attendance_date` and handled 409 Conflict (F48).
  - Added "📋 Copy to P{next}" button on marked practical periods with overwrite confirmation prompt (F49).
- `frontend/src/app/dashboard/hod/PeriodMarkingTab.tsx`:
  - Removed unlock modal, unlock button, and unlock badges (F44).
  - Added academic date picker filtering slots and rosters strictly by date (F46).
  - Displayed real-time marked/pending counts for the chosen date.
- `backend/test/period-attendance-corrections.test.js` *(New File)*:
  - 13 automated unit tests covering all Plan 07 findings.

### Migrations Created:
- `supabase/migrations/20261007040000_plan07_period_attendance_refinements.sql`:
  - Backfilled and enforced `attendance_date DATE NOT NULL` on `period_attendance`.
  - Enforced compound unique constraint `period_attendance_unique (timetable_slot_id, student_id, attendance_date)`.
  - Added composite indexes `idx_period_attendance_slot_date` and `idx_period_attendance_student_date`.
  - Set `is_late_entry` default false and made `unlocked_by` nullable with deprecation comments.
  - Recorded migration in `schema_migrations`.

---

## 3. Downstream Contracts & Invariants

1. **Unrestricted Current-Semester Correction:**
   - Any authorized teacher can correct attendance marks for their assigned courses on any date within the current semester. No grace period or unlock record is required.
2. **Dated Period Session Uniqueness:**
   - Attendance marks are keyed on `(timetable_slot_id, student_id, attendance_date)`. Queries and exports must always filter by explicit date or aggregate across distinct `(timetable_slot_id, attendance_date)` pairs.
3. **Roster Scoping Contract (for Plan 08 & Plan 09):**
   - Roster resolution must strictly evaluate `student_registrations` for `(academic_year, campus_id, semester)`. Cross-campus deliveries for the same catalogue course code represent separate classes with separate student rosters.
4. **Practical Denominator (for Plan 09 APC Statement):**
   - Two-hour practical classes copied via `copyPracticalAttendance` produce two distinct `period_attendance` records with identical student marks, ensuring the attendance statement denominator reflects two completed lecture/lab hours.
5. **GPS Independence:**
   - `campus_sign_ins` remain entirely separate from classroom `period_attendance`. GPS arrivals/departures never create or overwrite period attendance records.

---

## 4. Policy Choices Kept Unchanged & Undecided Decisions

1. **GPS Staff-Verified Fallback:**
   - Remained an unapproved policy recommendation; no automatic staff manual override power was added to GPS sign-ins.
2. **Attendance Percentage Denominator Policy:**
   - Denominator in export continues to reflect distinct conducted sessions `(timetable_slot_id, attendance_date)` where attendance was marked. Unmarked or cancelled slots are not silently classified as student absences.
3. **Future Pre-Marking Policy:**
   - Strictly forbidden (`attendance_date <= today` in IST). Teachers cannot mark attendance in advance.

---

## 5. Verification Evidence

- **Automated Backend Tests:** `npm --workspace=backend run test` executes **102 automated tests across 49 test suites**, passing with **0 failures**:
  - Plan 01 suites: 22 tests passing.
  - Plan 02 suites: 14 tests passing.
  - Plan 03 suites: 12 tests passing.
  - Plan 04 suites: 16 tests passing.
  - Plan 05 suites: 11 tests passing.
  - Plan 06 suites: 14 tests passing.
  - Plan 07 suites: 13 tests passing (`backend/test/period-attendance-corrections.test.js`).
- **Backend Build:** `npm --workspace=backend run build` (`nest build`) compiles with 0 errors.
- **Frontend Build:** `npm --workspace=frontend run build` (`next build` with Turbopack) compiles with 0 errors across all routes.
