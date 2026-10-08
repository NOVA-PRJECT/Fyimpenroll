# Implementation Handoff — Plan 02: Accounts, Sessions, Consent and Dependency Security

## 1. Findings Status Summary

| Finding | Priority / Severity | Status | Precise Rationale |
|---|---|---|---|
| **F07** | P1 / High | **Completed** | Distinguished authenticated restricted sessions (`must_change_password: true`) from invalid/unauthenticated sessions in `AuthGuard` and `frontend/middleware.ts`. Restricted accounts have access to `/api/auth/profile`, `/api/auth/me`, `/api/auth/change-password`, `/api/auth/sync-password-status`, `/api/auth/complete-password-reset`, `/api/auth/logout`, `/api/auth/refresh`, and consent endpoints without redirect loops. Normal dashboard routes redirect to the password change flow without cookie deletion. |
| **F08** | P1 / High | **Completed** | Preserved `must_change_password` during login and refresh in `AuthService.determineUserRoute` and `AuthService.refreshSession`. The flag is set for provisioned student and teacher accounts and cleared only upon verified password change. Non-student/teacher roles (`hod`, `campus_director`, `teaching_staff`, `superadmin`) are never forced into the mandatory password change flow. |
| **F09** | P1 / High | **Completed** | Decoupled password change verification from arbitrary metadata `updated_at` timestamps in `AuthService.completePasswordReset`. Completion now requires an explicit verified password update operation or authenticated password change execution. |
| **F10** | P1 / Medium | **Completed** | Checked both Supabase Auth and database profile write outcomes. If database profile write fails after auth update, `AuthService` returns a structured partial failure (`{ success: false, code: 'SYNC_FAILED', canRetrySync: true }`). `frontend/src/app/reset-password/confirm/page.tsx` now captures errors, blocks false success redirects, and provides an actionable "Retry Synchronization" action calling `/api/auth/sync-password-status`. |
| **F11** | P1 / High | **Completed** | Implemented a complete access/refresh token lifecycle. `AuthService.login` and `AuthService.refreshSession` issue both access tokens (routine expiry) and refresh tokens (7 days) in httpOnly secure cookies and response payloads. Added `/api/auth/refresh` endpoint with in-flight deduplication and a 10-second cache to prevent race conditions on concurrent rotated requests. `AuthService.logout` calls `admin.auth.admin.signOut(userId, 'global')` to invalidate the refresh session and clears all authentication cookies. `frontend/middleware.ts` automatically attempts token refresh when an access token is expired before falling back to login. |
| **F12** | P1 / Medium | **Completed** | Unified versioned consent enforcement using `CURRENT_POLICY_VERSION = '2026-09-08'`. `AuthGuard` checks the user's accepted version on protected operations and rejects outdated consent with `403 Forbidden` (`consent_required: true`), while allowing profile, consent status/accept, password change, and logout so the user can comply. `ConsentGate.tsx` prevents rendering protected children until current consent is verified. |
| **F57** | P2 / Medium | **Completed** | Configured `SHARED_DASHBOARD_ROUTES` in `frontend/src/core/security/routeConfig.ts` and `frontend/middleware.ts`. Permitted roles (`student`, `teacher`, `hod`, `campus_director`, `superadmin`) can access `/dashboard/credit-ledger` and child routes. `teaching_staff` is explicitly denied and redirected to `/dashboard/teaching_staff`, preserving Plan 01's roster-only boundary. |
| **F62** | P1 / High | **Completed** | Triaged dependency graph: separated mobile workspace issues from web/backend. Removed unmaintained `xlsx` from `backend/package.json` and migrated all frontend spreadsheet generation (`exportExcel.ts` and `timetable/page.tsx`) to maintained `exceljs`. Removed `xlsx` from `frontend/package.json` and regenerated lockfiles. Verified frontend Turbopack build and backend NestJS build pass cleanly with 0 TypeScript/compilation errors. |

---

## 2. Changed Files & Migrations

### Modified Files:
- `backend/src/core/auth/guards/auth.guard.ts` — Handled restricted sessions, role-scoped password change rules, allowed restricted paths, and versioned consent enforcement.
- `backend/src/modules/auth/auth.service.ts` — Preserved `must_change_password`, added `refreshSession` with concurrency deduplication, enhanced `logout` with Supabase session revocation, added unified `changePassword`, updated `completePasswordReset` (removed `updated_at` dependency), and added `syncPasswordStatus`.
- `backend/src/modules/auth/auth.controller.ts` — Added `/refresh`, `/change-password`, `/sync-password-status` endpoints and updated cookie lifecycles (`auth_token` and `refresh_token`).
- `backend/src/modules/consent/consent.service.ts` — Fast-path cache of `accepted_policy_version` into `app_metadata` upon consent acceptance.
- `backend/src/modules/student/student.service.ts` — Structured partial-failure handling and refresh token return in `changePassword`.
- `backend/src/modules/student/student.controller.ts` — Refresh token cookie handling.
- `frontend/src/core/security/routeConfig.ts` — Introduced `SHARED_DASHBOARD_ROUTES` permitting ledger access for authorized roles and denying `teaching_staff`.
- `frontend/middleware.ts` — Restricted session path routing, automatic token refresh on 401/expired access token, and shared ledger routing.
- `frontend/src/components/ConsentGate.tsx` — Non-dismissible gating blocking render of protected content until current consent version is verified.
- `frontend/src/app/reset-password/confirm/page.tsx` — Handling partial sync failures without false success messages, with retryable synchronization.
- `frontend/src/core/utils/exportExcel.ts` — Migrated student papers export from `xlsx` to `exceljs`.
- `frontend/src/app/dashboard/director/timetable/page.tsx` — Migrated timetable workbook export from `xlsx` to `exceljs`.
- `backend/package.json` & `frontend/package.json` — Removed `xlsx`, added `exceljs` in frontend, regenerated lockfiles.
- `backend/test/accounts-sessions-consent.test.js` — Comprehensive unit test suite for Plan 02.

### Migrations:
- No destructive or table DDL migrations were required for Plan 02. Existing database schema columns (`students.must_change_password`, `consent_records.policy_version`, `consent_records.accepted_at`, and Supabase `app_metadata`) are fully leveraged and aligned.

---

## 3. Shared Services, Types, DTOs & Invariants

### 1. Restricted Session Contract:
- **Condition:** `authUser.must_change_password === true` (only applicable when `role === 'student' || role === 'teacher'`).
- **Allowed Endpoints:**
  - `/api/auth/profile`, `/api/auth/me`
  - `/api/auth/change-password`, `/api/student/change-password`
  - `/api/auth/complete-password-reset`, `/api/auth/sync-password-status`
  - `/api/auth/logout`, `/api/auth/refresh`
  - `/api/consent/status`, `/api/consent/accept`
- **Violation Behavior:** Protected operational endpoints return `403 Forbidden` with body `{ statusCode: 403, error: 'Forbidden', message: '...', must_change_password: true }`. Callers MUST NOT interpret this as invalid credentials (401).

### 2. Versioned Consent Contract:
- **Constant:** `CURRENT_POLICY_VERSION = '2026-09-08'` in `backend/src/modules/consent/consent.constants.ts`.
- **Backend Invariant:** Protected operations reject requests where accepted consent version does not equal `CURRENT_POLICY_VERSION` with `403 Forbidden` (`consent_required: true, current_policy_version: ...`).
- **Frontend Invariant:** `ConsentGate` and `middleware.ts` block navigation to dashboard pages until `/api/consent/status` returns `{ accepted: true }`.

### 3. Session Refresh Lifecycle:
- **Endpoint:** `POST /api/auth/refresh`
- **Cookies Issued:**
  - `auth_token`: `httpOnly: true`, `sameSite: 'lax'`, `maxAge: 3600` (1 hour routine access token).
  - `refresh_token`: `httpOnly: true`, `sameSite: 'lax'`, `maxAge: 604800` (7 days persistent session).
- **Concurrency Invariant:** In-flight refresh deduplication and 10-second recent refresh cache ensure concurrent requests with rotated tokens do not trigger invalid-grant errors.

### 4. Shared Dashboard Routes Contract (F57):
- **Constant:** `SHARED_DASHBOARD_ROUTES` in `frontend/src/core/security/routeConfig.ts`.
- `/dashboard/credit-ledger`: Permitted for `student`, `teacher`, `hod`, `campus_director`, `superadmin`. Strictly excludes `teaching_staff`.

---

## 4. Validation Commands & Outcomes

1. **Backend TypeScript Compilation:**
   - Command: `npm --workspace=backend run build`
   - Outcome: **PASS** (`nest build` exited with code 0).
2. **Frontend Next.js Compilation (Turbopack):**
   - Command: `npm --workspace=frontend run build`
   - Outcome: **PASS** (10 static pages + dynamic routes compiled with code 0).
3. **Comprehensive Backend Test Suite (Plan 01 + Plan 02):**
   - Command: `npm --workspace=backend run test`
   - Outcome: **PASS** (36 tests across 15 suites passed, 0 failures, 0 skipped).
4. **Scoped Dependency Audit:**
   - Command: `npm --workspace=backend audit`, `npm --workspace=frontend audit`
   - Outcome: **PASS** (`xlsx` completely removed from both backend and frontend; no unresolvable critical vulnerabilities in frontend/backend runtime).

---

## 5. Policy Choices Kept Unchanged & Implementation Assumptions

1. **Role Scope for Mandatory Password Change:**
   - Retained confirmed rule: Initial password change is mandatory **strictly for students and teachers**. HODs, campus directors, teaching staff, and superadmins are never forced into mandatory password change.
2. **Persistent Session Expiration:**
   - Normal persistent sessions remain subject to Supabase provider revocation, token rotation, and account deletion. Cookie lifetime does not artificially extend JWT validity beyond provider limits.
3. **teaching_staff Scope:**
   - Preserved Plan 01's roster-only boundary: `teaching_staff` has zero access to credit ledgers, attendance submissions, or course management.
4. **Mobile Monorepo Isolation:**
   - Root-level Expo/React-Native mobile peer dependency conflicts were isolated from web/backend builds and not blindly force-upgraded.

---

## 6. Remaining Downstream Work & Receiving Plans

- **Plan 03 (Schema, Class Model, and Ten Semesters):**
  - Will build on the verified authentication and role-scoping invariants established in Plan 01 and Plan 02 to introduce 10-semester support, class model structures, and schema enhancements.
