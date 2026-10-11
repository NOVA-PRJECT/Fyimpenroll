# Follow-up Plan 02 Handoff: Password Changes, Session Refresh and Logout

**Date:** 9 October 2026
**Author:** Antigravity Engineering Agent
**Target Plan:** Follow-up Plan 02 (Findings R02, R30, R31, R32)
**Prerequisites:** Follow-up Plan 01 (Database privileges and resource authorization)
**Status:** Completed (with documented GoTrue live revocation behavior notes and downstream UI integration obligations)

---

## 1. Scope & Finding Status Matrix

| Finding | Priority / Severity | Follow-up Status | Primary Owner | Downstream Consumers | Exact Validation Evidence & Details |
|---|---|---|---|---|---|
| **R02** | High | **Completed** | Follow-up 02 | Follow-up 03, Follow-up 10 | Refactored `completePasswordReset`, `syncPasswordStatus`, and `changePassword` in `backend/src/modules/auth/auth.service.ts` and `student.service.ts`: (1) Eliminated client assertion `passwordUpdated: true` bypass. Direct calls without a valid new password throw `BadRequestException`. (2) Established server-trusted `pending_profile_sync` state in `app_metadata`. `syncPasswordStatus` now requires `authUser.app_metadata.pending_profile_sync === true`; calls without prior verified Auth updates are rejected with `400 Bad Request`. (3) Injected profile write failure returns recoverable `{ success: false, code: 'SYNC_FAILED', canRetrySync: true }` without clearing restrictions. Verified in `backend/test/followup-auth-sessions.test.js` (Tests R02-1, R02-2, R02-3, R02-4). |
| **R30** | High | **Completed** | Follow-up 02 | Follow-up 10 | Implemented client-side cookie-compatible refresh coordinator `frontend/src/core/security/refresh-coordinator.ts` with global fetch interceptor mounted via `ApiRefreshInit` in `frontend/src/app/layout.tsx`. Deduplicates concurrent 401 refresh calls into a single in-flight `POST /api/auth/refresh`. Safely retries reads (GET, HEAD, OPTIONS) once with updated cookies; restricts mutation retries to idempotent requests (`Idempotency-Key` or `X-Safe-Retry`). Distinguishes transient provider/backend outages (503 / network errors) from true session expiration (400/401). Enhanced `frontend/middleware.ts` to proactively refresh `/api` requests when `auth_token` is expired and `refresh_token` is present. Tested in `followup-auth-sessions.test.js` (Tests R30-1, R30-2, R30-3). |
| **R31** | Medium | **Completed** | Follow-up 02 | Follow-up 10 | Updated `backend/src/modules/auth/auth.service.ts` (`logout`) to pass the actual access JWT (`jwt`) rather than `userId` UUID to `@supabase/auth-js` `admin.signOut(jwt, 'global')`. Inspected returned `{ error }` and logged genuine revocation failures with `warn`. Recorded logout failure status in audit logs when provider revocation fails instead of silently swallowing errors. Verified in `followup-auth-sessions.test.js` (Tests R31-1, R31-2). |
| **R32** | High | **Completed** | Follow-up 02 | Follow-up 10 | (1) Updated `frontend/middleware.ts` to route both restricted students AND teachers with `must_change_password: true` to a shared authenticated route `/change-password` rather than misrouting teachers to the email recovery confirmation page (`/reset-password/confirm`). (2) Created `frontend/src/app/change-password/page.tsx` operating on ordinary backend HTTP-only cookies without requiring email recovery links, hash tokens, or PKCE exchanges. (3) Fixed `frontend/src/app/dashboard/student/change-password/page.tsx` and shared page to explicitly handle `{ success: false, code: 'SYNC_FAILED' }` responses without treating HTTP 200 as successful completion, rendering a dedicated "Retry Profile Synchronization" action. Verified in Turbopack build and `followup-auth-sessions.test.js`. |

---

## 2. Changed Source Files & Created Artifacts

### Source Files Modified
- `backend/src/modules/auth/auth.service.ts`:
  - Enforced server-trusted `pending_profile_sync` state in `changePassword`, `completePasswordReset`, and `syncPasswordStatus`.
  - Updated `logout` to pass access JWT to `admin.signOut(jwt, 'global')` and inspect returned `{ error }`.
- `backend/src/modules/auth/auth.controller.ts`:
  - Ensured `jwt` is passed to `authService.logout` via `userWithToken` fallback.
- `backend/src/modules/student/student.service.ts`:
  - Aligned student `changePassword` to set `pending_profile_sync: true` and only clear metadata restrictions upon successful database update.
- `frontend/middleware.ts`:
  - Added proactive session refresh for `/api` requests with valid `refresh_token` cookies.
  - Routed restricted teachers and students to `/change-password` and permitted `/change-password` as an allowed restricted path.
- `frontend/src/app/layout.tsx`:
  - Mounted `<ApiRefreshInit />` in root layout for transparent client fetch interception across open dashboards.
- `frontend/src/app/dashboard/student/change-password/page.tsx`:
  - Prevented false-positive redirect on `SYNC_FAILED` and added `handleRetrySync` action.
- `backend/test/accounts-sessions-consent.test.js`:
  - Aligned legacy unit test inputs with R02 verified password update and pending sync contract.

### New Source Files & Tests Created
- `frontend/src/core/security/refresh-coordinator.ts`:
  - Client API refresh coordinator implementing deduplicated refresh, safe read retries, and non-idempotent mutation protection.
- `frontend/src/components/ApiRefreshInit.tsx`:
  - Client component installing the global fetch interceptor on browser window.
- `frontend/src/app/change-password/page.tsx`:
  - Shared institutional authenticated password change page for teachers and students.
- `backend/test/followup-auth-sessions.test.js`:
  - 10 targeted automated acceptance tests covering R02, R30, R31, and R32.

---

## 3. Shared Contracts, Types & State Transitions

### Server-Trusted Password Synchronization Contract
1. **Initial State:** `app_metadata: { must_change_password: true, pending_profile_sync: false }`.
2. **Password Update Succeeded in Auth:** `app_metadata: { must_change_password: true, pending_profile_sync: true }`.
3. **Database Profile Write Failed:** Returns `{ success: false, code: 'SYNC_FAILED', canRetrySync: true }`. Account remains restricted with `pending_profile_sync: true`.
4. **Synchronization Retry (`POST /api/auth/sync-password-status`):**
   - Requires `authUser.app_metadata.pending_profile_sync === true`.
   - On database write success: sets `must_change_password: false, pending_profile_sync: false`.
   - Direct calls without prior verified update are rejected with `400 Bad Request`.

### Supabase Admin SignOut Contract (R31)
- Function call: `admin.signOut(jwt: string, scope: 'global')`.
- Argument: Access JWT token string.
- Error handling: Returned `{ error }` is inspected; if non-null, logged to `ServerLogger` and audit event records `status: 'failure'` with metadata `{ error: error.message }`.

### Client API Refresh & Mutation Safety Contract (R30)
- Deduplication: All concurrent 401 API responses share a single pending `POST /api/auth/refresh` promise.
- Safe Read Retries: GET, HEAD, and OPTIONS requests are automatically retried once after successful refresh.
- Mutation Safety: POST, PUT, PATCH, and DELETE requests are **never** blindly replayed unless explicitly marked idempotent (via `Idempotency-Key` or `X-Safe-Retry` headers).
- Outage Preservation: Transient provider or network errors (500, 502, 503, 504, 429) do not eject the user or clear authentication cookies.

---

## 4. Exact Validation Commands & Outcomes

### 1. Focused Acceptance Test Suite
```bash
node --test backend/test/followup-auth-sessions.test.js
```
- **Outcome:** 10 / 10 tests passed (100%), duration ~1.7s.

### 2. Full Backend Regression Suite
```bash
npm run test --workspace=backend
```
- **Outcome:** 164 / 164 tests passed (100%) across 71 test suites, duration ~16.5s.
- **Failures:** 0.

### 3. Backend Production Build
```bash
npm run build:backend
```
- **Outcome:** Clean NestJS compilation (code 0).

### 4. Frontend Production Build
```bash
npm run build:frontend
```
- **Outcome:** Next.js 16.4.0 Turbopack clean compilation (code 0). All 19 routes generated with full TypeScript verification, including `/change-password`.

---

## 5. Policy Decisions Left Pending & Provider Limits

1. **Supabase GoTrue JWT Revocation Limits:**
   - In Supabase Auth, existing access JWTs remain cryptographically valid until their expiry (default: 3600 seconds) because GoTrue JWTs are stateless.
   - Calling `admin.signOut(jwt, 'global')` revokes all active **refresh tokens** in GoTrue, preventing any future token refresh, while browser cookies are cleared immediately.
2. **Persistent Session Lifetimes:**
   - Refresh token lifetime is governed by Supabase Auth project configuration (default 7 days). Client cookies and refresh coordination support persistent login until explicit logout or provider revocation.

---

## 6. Downstream Checklist for Follow-up Plan 03 & Later Plans

- [ ] **Follow-up Plan 03:** Host-campus classes and teacher identity (R06, R07, R08). Ensure teacher session and course assignment resolution reuses the unified `AuthUser` structure established here and in Plan 01.
- [ ] **Follow-up Plan 07:** Practical attendance copy and concurrency (R03, R28, R29). Connect multi-hour attendance submit/copy with the safe mutation idempotency headers defined in `refresh-coordinator.ts`.
- [ ] **Follow-up Plan 10:** Frontend reliability and final release gate (R35, R36). Consume the shared `/change-password` page and verify that end-to-end browser flows operate seamlessly with cookie-based refresh.
