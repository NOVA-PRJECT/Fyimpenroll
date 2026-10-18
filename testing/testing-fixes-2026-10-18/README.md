# Testing fixes — implementation and verification

The approved staff, logout, Courses/Blueprint and History changes are implemented. The production test campus remains deleted.

## Behaviour

- Database unique indexes enforce one HOD per department and one director/teaching-staff account per campus. API create/edit checks return 409 for occupied roles, exclude the edited account, and validate campus/department ownership. A composite foreign key also protects ownership during concurrent changes.
- Superadmin has Directors, HODs, Teaching Staff and Teachers groups. Teachers have no mutation controls; the administrative API rejects teacher mutations and conversion. HOD teacher management remains available. Faculty editing uses the department ID.
- One shared logout dialog covers all dashboard roles, registration, consent and password change. Cancel sends no request. Busy state blocks dismissal and duplicate submission. Failure offers Retry/Close. Provider requests have a three-second budget; audit uses the remaining five-second handler budget. Browser timeout stays twelve seconds. Refresh/poll responses are fenced during logout, and a cookie fence prevents delayed credentials from authorizing or refreshing a signed-out browser.
- Courses loads its own catalogue, independently of blueprint availability. Each tab retains its own semester filter. Add/Edit has Semester 1–10 selection. A database transaction rejects referenced-course moves with reference types and locks against reference creation. Category-only baskets do not block moves. Prerequisites must precede the destination semester; the course code is unchanged.
- History retains department ID `e814d190-e1c2-4731-b2ec-d97d5dc897e0`, four course IDs, two blueprint IDs and HOD ID `d16aa6e6-bbdb-4156-81f1-31df5815a7db`. Its campus is now KUC Mangattuparamba (`5b5289d5-17eb-43ba-832e-19883e9eaada`). The correction compared complete course/blueprint/HOD/Auth payloads inside its transaction and would roll back on unexpected dependencies or changed data.

## Checks completed

| Check | Result |
| --- | --- |
| Backend testing-fixes suite | 14 passed, including real local HTTP requests and isolated PostgreSQL |
| Frontend logout/middleware suites | 16 passed |
| Existing blueprint regressions | 32 passed |
| Existing publication regressions | 8 passed |
| Existing scheduling-rules regressions | 8 passed |
| Backend production build | Passed |
| Frontend production build and TypeScript | Passed |
| Browser UI | Desktop and 390px mobile; light/dark; Cancel, busy, error, Escape, focus; independent filters; course move destination |
| Live role/index probes | All three occupied role limits rejected duplicate inserts; transaction rolled back |
| Live referenced-course probe | Guarded RPC rejected History course move; course payload unchanged; transaction rolled back |
| Live global logout | Two sessions revoked; handler 578.4 ms |
| Live invalid-access refresh fallback | Both sessions revoked; handler 409.3 ms |
| Live cookie fence | Refresh rejected with 401 and no credentials issued |
| Temporary Auth fixture | Deleted and absence verified; no campus/faculty/student fixture created |
| History ownership and counts | Correct campus; 4 courses, 2 blueprints, same HOD; zero faculty campus mismatches |

Concurrency tests submit competing operations and test both write orders in isolated PostgreSQL. The SQL also uses shared transaction advisory locks for reference writes and an exclusive lock before guarded course updates. These checks cover correctness; they are not a campus-scale load benchmark.

The security advisor has no new findings. Existing project findings remain outside this change: [RLS tables without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), and existing [performance findings](https://supabase.com/docs/guides/database/database-linter). The new faculty campus foreign key has a covering index.

## Reproduce locally

Run from the repository root after `npm ci`:

```powershell
npm run test:testing-fixes --workspace backend
npm run test:testing-fixes --workspace frontend
npm run test:blueprints --workspace backend
npm run test:timetable --workspace backend
npm run test:timetable-rules --workspace backend
npm run build --workspace backend
npm run build --workspace frontend
node testing/testing-fixes-2026-10-18/ui-preview.cjs
```

Open `http://127.0.0.1:4182` or `/mobile`. The preview renders the actual components with mock APIs, simplified icons and no live database access. Its first logout request deliberately fails; Retry navigates to a local signed-out fixture. The blueprint API deliberately fails until toggled.

`verify-live-logout.cjs` is a **manual production smoke test** using credentials from process.env. It creates one temporary Auth-only fixture, verifies global revocation/fallback/cookies, and deletes that exact fixture in `finally`. Do not run it as part of unattended unit tests. `LIVE_LOGOUT_VERIFICATION.json` records its completed run without tokens or passwords.

`live-integrity-probes.sql` asserts live database restrictions using rejected writes inside an explicitly rolled-back transaction. It creates no Auth account and persists no data.

## Rollout

Applied migrations in order:

1. `20261018164035_testing_fixes_integrity.sql`
2. `20261018164802_correct_history_campus.sql`
3. `20261018171113_index_faculty_campus_reference.sql`

Backend commits `b44812b` and `507a1ba` were pushed first. The new backend response/timing contract and real Auth revocation were verified before the frontend release. Final frontend deployment details are recorded in `ROLLOUT.json`.
