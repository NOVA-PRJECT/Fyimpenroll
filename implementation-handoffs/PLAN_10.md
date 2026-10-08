# Implementation Handoff: Plan 10 — Frontend Reliability & Final Release Checks

**Date:** 8 October 2026  
**Author:** Antigravity Engineering Agent  
**Prerequisites:** Plan 01 through Plan 09 (Fully Completed)  
**Primary Finding Ownership:** F58, F59, F60, F63  
**Target Release:** FYIMP Academic Portal v7.0.0 (Production Candidate)

---

## 1. Findings Reconciliation Matrix

| Finding | Priority / Severity | Primary Plan | Downstream Plan(s) | Status | Precise Reconciliation Reason |
|---|---|---|---|---|---|
| **F58** | P1 / Medium | **Plan 10** | — | **Completed** | Registration deadlines now display and parse strictly in `Asia/Kolkata` (+05:30) via `frontend/src/core/utils/dateTime.ts`. Slicing UTC `toISOString().slice(0, 16)` into naive HTML5 `<input type="datetime-local">` has been removed. Deadlines convert once to UTC ISO instant for API persistence, eliminating the 5h 30m offset shift across midnight and any client browser timezone. |
| **F59** | P2 / Medium | **Plan 10** | — | **Completed** | Permanent client caching via `sessionStorage.getItem('fyimp_director_settings_cache')` no longer bypasses revalidation. The dashboard uses Stale-While-Revalidate with instant initial render followed by authoritative background fetch, plus invalidation on tab focus and after any window/promotion mutation. Backend `/api/registrations/submit` enforces current database deadline in UTC. |
| **F60** | P2 / Medium | **Plan 10** | — | **Completed** | Asynchronous mutations in `DirectorDashboard` (`handleSaveWindow`, `executeCloseImmediately`, `handlePromoteStudents`) and `StudentRegisterPage` (`handleSubmit`, `selectPathway`) are enclosed in structured `try ... catch ... finally` blocks. Loading spinners (`savingWindow`, `submitting`, `loading_slots`) are guaranteed to clear on network drops, non-2xx responses, or gateway timeouts. User form inputs and ranked preferences are preserved on error, and safe idempotency headers (`X-Idempotency-Key`) are attached. |
| **F63** | P1 / Medium | **Plan 10** | — | **Completed** | Root `package.json` now exposes `npm run test` and `npm run test:all`. Created unified cross-plan regression gate `backend/test/cross-plan-regression-gate.test.js` validating authorization, consent, capacity, allocation, timetable immutability, attendance, promotion cooldown, credit ledger, and timezone round-tripping. Full regression suite runs 144 passing tests across 66 suites with 0 failures, and both frontend (`next build`) and backend (`nest build`) compile with zero errors. |
| **F15** | P1 / High | Plan 01, Plan 02 | Plan 10 | **Completed** | Restricted-session boundaries and password reset guards verified end-to-end. Students/teachers with `must_change_password` or outdated consent are prevented from normal portal access without terminating legitimate active refresh flows. |
| **F53** | P1 / High | Plan 03 | Plan 09, Plan 10 | **Completed** | All 10 semesters (Semesters 1 through 10) verified across catalog blueprints, registration, allocation, timetable generation, and advisory credit ledger tiers (including Semesters 9–10 research-only dissertation credits). |

---

## 2. Changed Files & Migration Order

### Files Created
- `frontend/src/core/utils/dateTime.ts` — Asia/Kolkata timezone helpers (`utcIsoToKolkataInput`, `kolkataInputToUtcIso`, `formatKolkataDisplay`, `isRegistrationWindowOpen`).
- `backend/test/cross-plan-regression-gate.test.js` — Cross-plan integration test gate covering core business invariants from Plan 01 through Plan 10.
- `implementation-handoffs/PLAN_10.md` — Final handoff documentation and release audit reconciliation.

### Files Modified
- `frontend/src/app/dashboard/director/page.tsx`:
  - Timezone-safe deadline formatting and parsing in `Asia/Kolkata` (F58).
  - Explicit UI timezone annotation `(Asia/Kolkata IST, UTC+05:30)` and `formatKolkataDisplay` (F58).
  - Cache invalidation helper `invalidateDirectorCache()` called after save, close, and promote (F59).
  - Tab focus revalidation listener to refresh settings from server (F59).
  - Try/catch/finally wrapping for `handleSaveWindow`, `executeCloseImmediately`, and `handlePromoteStudents` (F60).
- `frontend/src/app/dashboard/student/register/page.tsx`:
  - Try/catch/finally wrapping for `handleSubmit` and `selectPathway` (F60).
  - Idempotency key generation (`X-Idempotency-Key`) for registration submissions (F60).
  - Clean error categorization and input preservation on failure (F60).
- `package.json`:
  - Added root CI scripts: `"test": "npm run test --workspace=backend"`, `"test:backend": "npm run test --workspace=backend"`, `"test:all": "npm run test --workspace=backend && npm run build"`.

### Complete Repository Migration Execution Order (Plan 01 to Plan 10)
All migrations are strictly additive, non-destructive, and idempotent:
1. `supabase/migrations/20261007010000_plan01_authorization_and_guards.sql` (Plan 01)
2. `supabase/migrations/20261007020000_plan02_auth_sessions_and_consent.sql` (Plan 02)
3. `supabase/migrations/20261007030000_plan03_schema_ten_semesters.sql` (Plan 03)
4. `supabase/migrations/20261007040000_plan04_registration_capacity_rpc.sql` (Plan 04)
5. `supabase/migrations/20261007050000_plan05_deterministic_allocation.sql` (Plan 05)
6. `supabase/migrations/20261007030000_plan06_timetable_constraints_and_guards.sql` (Plan 06)
7. `supabase/migrations/20261007040000_plan07_period_attendance.sql` (Plan 07)
8. `supabase/migrations/20261007050000_plan08_campus_lifecycle.sql` (Plan 08)
9. `supabase/migrations/20261007060000_plan09_credit_ledger_and_scoped_exports.sql` (Plan 09)
*(Plan 10 introduces frontend reliability and testing infrastructure; no new database migration required).*

---

## 3. Shared Services, Types & Contracts Introduced

### `dateTime.ts` Utilities
- **`utcIsoToKolkataInput(utcIso: string | Date | null | undefined): string`**:
  Converts UTC timestamp to `YYYY-MM-DDTHH:mm` Asia/Kolkata wall clock for `<input type="datetime-local">`.
- **`kolkataInputToUtcIso(kolkataDateTime: string | null | undefined): string`**:
  Converts `YYYY-MM-DDTHH:mm` Asia/Kolkata input string to deterministic UTC ISO instant (`...Z`) by applying the constant +05:30 offset (`Date.UTC(...) - 19800000ms`).
- **`formatKolkataDisplay(utcIso: string | Date | null | undefined): string`**:
  Formats UTC instant into `"DD MMM YYYY, hh:mm A IST"`.
- **`isRegistrationWindowOpen(deadlineUtcIso: string | null | undefined, now?: Date): boolean`**:
  Evaluates whether the current moment is strictly before the UTC deadline instant.

### Client Mutation Resilience Invariants
- Async mutation functions must enclose network requests in `try ... catch ... finally` blocks.
- Loading flags must always reset in the `finally` block or explicit terminal branch.
- Form inputs must never be wiped upon network failures or non-2xx API responses.
- Idempotency tokens must be included in sensitive state-mutating requests to guard against duplicate execution on retry.

---

## 4. Exact Validation Commands and Outcomes

### Automated Regression Suites (`npm run test`)
```bash
npm run test
```
**Output Summary:**
- Suites: 66
- Tests: 144
- Passing: 144
- Failing: 0
- Cancelled: 0
- Skipped: 0
- Duration: ~8.6s

**Suite Breakdown:**
1. `backend/test/cross-plan-regression-gate.test.js` (Plan 10 Gate — 17 tests passing)
2. `backend/test/credit-ledger-exports.test.js` (Plan 09 — 14 tests passing)
3. `backend/test/campus-promotion-lifecycle.test.js` (Plan 08 — 15 tests passing)
4. `backend/test/period-attendance-corrections.test.js` (Plan 07 — 13 tests passing)
5. `backend/test/ortools-timetable-solver.test.js` (Plan 06 — 13 tests passing)
6. `backend/test/deterministic-allocation-jobs.test.js` (Plan 05 — 16 tests passing)
7. `backend/test/registration-eligibility-capacity.test.js` (Plan 04 — 14 tests passing)
8. `backend/test/schema-class-ten-semesters.test.js` (Plan 03 — 13 tests passing)
9. `backend/test/accounts-sessions-consent.test.js` (Plan 02 — 14 tests passing)
10. `backend/test/authorization-boundaries.test.js` (Plan 01 — 15 tests passing)

### Backend Build Verification (`npm run build:backend`)
```bash
npm run build:backend
```
**Outcome:** Exited with code 0 (`nest build` clean compilation).

### Frontend Build Verification (`npm run build:frontend`)
```bash
npm run build:frontend
```
**Outcome:** Exited with code 0 (`next build` Next.js 16.4.0 Turbopack clean compilation, all 18 routes compiled and typed).

---

## 5. Policy Choices & Implementation Assumptions

1. **Academic Timezone Policy:** Fixed Indian Standard Time (`Asia/Kolkata`, UTC+05:30) is the sole authoritative academic timezone for all university campuses. No Daylight Saving Time applies.
2. **16–30 Waitlist Policy:** Unapproved automated waitlist auto-allocation was left disabled. Direct slot change is available post-allocation for remaining course capacity as confirmed in product rules.
3. **Teaching Staff Breadth:** `teaching_staff` remains strictly roster-only across all campuses; attendance submission and timetable editing are forbidden and fail closed.
4. **Attendance Retention:** Classroom period attendance records remain scoped to the active semester; long-term multi-year archival is outside the portal scope.
5. **GPS Fallback:** GPS campus sign-ins are independent of classroom period attendance; physical GPS sign-in does not substitute or auto-populate classroom marks.
6. **Credit Ledger Certification:** The registered-credit ledger explicitly reports registered and allocated credits with disclaimer `KU-FYIMP-2024-V1-ADVISORY` and makes zero claims of authoritative degree certification.

---

## 6. Downstream Status & Release Readiness

With the completion of Plan 10, all 10 implementation plans (Plans 01 through 10) have been executed, validated, and reconciled against the consolidated audit.

- **Total Plans Completed:** 10 of 10 (100%)
- **Total Automated Invariant Tests:** 144 passing
- **Migrations Ready:** 9 staged additive migrations
- **Release Status:** Ready for staging verification and scheduled deployment on Render (backend) and Vercel (frontend) with Supabase database.
