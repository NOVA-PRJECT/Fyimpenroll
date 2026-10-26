Semester lifecycle release and recovery

This branch implements separate promotion and graduation actions. Promotion moves students in semesters 1–10 forward by one semester, leaves existing semester-11 students unchanged, clears temporary preferences/attendance/sign-ins, and preserves registrations, timetable entries and teacher course assignments. The separate graduation screen previews semester-11 students and deletes explicitly selected accounts in one database transaction. Registration/credit history survives until that student's explicit account deletion; institutional timetables and teaching assignments survive graduation.

Release status on 26 October 2026: the owner confirmed applying `changes/semester_lifecycle.sql` to the connected production project. A subsequent read-only check returned `production_readiness() = {"ready": true}`, 20 public application tables and all four current-term views. This confirms schema readiness; it does not establish retained-record equality, hosted concurrency tests or application deployment. The matching application changes are merged into local `main` but have not yet been pushed or deployed. Do not rerun the migration on this project; continue with post-migration verification and deployment below.

The owner-run SQL file is integrated into the fresh-project bootstrap and isolated lifecycle tests. For another existing project, the owner runs the complete file once in the Supabase SQL Editor with the `postgres` role during the coordinated release below. No Supabase CLI installation or CLI migration registration is required for this execution workflow. The assistant provides SQL files for migrations and other substantial database changes and leaves their execution to the owner. Do not replay historical migrations or bootstrap an existing project.

The migration drops six tables: `period_unlock_requests`, `department_notices`, `retired_cohorts`, `graduation_operations`, `graduation_candidates` and `promotion_receipts`. It refuses queued/running allocation or timetable workers and unfinished staged graduations. Resolve pending graduation work first, including account-only remnants whose student rows were already deleted. It does not automatically promote or delete any students.

No additional tracking table is introduced. `campus_settings.term_version` and `term_started_at` identify the current campus term. Registrations, timetable entries, teacher assignments and worker logs receive a term version. Four backend-only, security-invoker `current_*` views expose current records; the underlying tables retain history. Publication, scheduling, seat counts and worker commits read these views. Ledger/history readers use the retained base tables and match the appropriate term version.

All lifecycle writers acquire the existing teacher-schedule advisory lock before row/cohort locks. The promotion function checks the expected term version and the existing 90-day timestamp guard while holding that lock. Clients must refresh settings after an unknown network outcome; the removed receipt table no longer reproduces the original response. The director settings API exposes the current version. AuthGuard captures it at request start and transactional write requests recheck it through `run_current_term_operation`.

Registration-window settings and HOD student creation/import/edit operations also use that checked transaction entry point. Student edits include the original semester as an additional compare-and-swap condition, preventing an old form from resetting a recently promoted student. Auth-account creation remains a separate provider operation; a rejected student insert uses the existing compensating account deletion. Graduation deletion itself contains no provider API calls.

The first installed version is 0; existing records are backfilled without changing their academic values. Review any pre-existing schedules or assignments from multiple term instances within the same academic year/semester before rollout. Such ambiguous legacy data cannot be classified automatically from the old schema. Ordinary future promotions advance the version, so later instances remain distinct. Keep the current configured academic year during promotion; the director explicitly changes it when the academic year advances. Registration closes after promotion and must be configured again for the incoming term.

Shared active classes deliberately block a single-campus promotion when deleting attendance would affect an active class at another campus. This release does not provide a coordinated multi-campus promotion button. Settle that shared teaching dependency before promotion; never bypass the guard by deleting retained schedules or registrations. Conflict diagnostics lack a campus identity and are conservatively retained rather than deleted using an unsafe global scope.

The complete release sequence below also documents the prerequisites for other projects. For the connected production project, SQL application is complete; do not repeat the pre-migration export or migration steps. Continue with the matching application deployment and post-migration checks. Retained-record comparison requires an actual export taken before migration; the synthetic test fixture is not a production backup. Keep writes paused during the schema/application cutover.

1. Review the owner-run SQL file, reconcile unfinished graduation records, drain workers and ensure no old backend instance remains active during the schema switch.
2. Take an independently secured project recovery backup including Auth and any relevant Storage data. The application JSON export below does not contain login credentials, identities, provider settings, Storage files or project secrets.
3. Export the existing cleaned application schema's 26 tables to a new ignored filename:

   ```powershell
   node --env-file=backend/.env scripts/export-lifecycle.cjs scratch/lifecycle-before.json before
   ```

4. Rehearse the exact export against isolated PGlite:

   ```powershell
   node scripts/rehearse-lifecycle.cjs scratch/lifecycle-before.json
   ```

   Rehearsal restores the old schema and application rows, creates synthetic Auth placeholders, applies the change, checks backend-only readiness and compares every retained table. It is neither a backup restoration procedure for Auth nor a hosted Auth integration test.

5. In staging, verify the production Auth foreign keys and transaction privileges with synthetic accounts, test concurrent promotion/graduation from separate PostgreSQL connections, and test Storage-owned account rejection. The connected production project's metadata was checked read-only: student/profile/session/identity cascades are present, there are no custom Auth-user triggers, both Storage owner columns exist, and the `postgres` role can delete Auth users. No hosted accounts were deleted during verification.
6. The owner runs the complete `changes/semester_lifecycle.sql` file once in the Supabase SQL Editor as `postgres`, then deploys the matching backend and web/mobile changes within the paused-write release. Remove notices screens and refresh or upgrade existing clients. Do not run live semester promotion or graduation just to smoke-test the release.
7. Before reopening writes, compare retained records with the export:

   ```powershell
   node --env-file=backend/.env scripts/verify-lifecycle.cjs scratch/lifecycle-before.json
   ```

   Verification is read-only and expects no business writes since the export. It allows the new term columns but requires all retained application records to match. `production_readiness()` must return `ready: true`.
8. Smoke-test settings, candidate preview, ordinary registration, historical credit ledgers and assignment/timetable exports. Use staging for destructive-action and rollback checks. Reopen production writes only after the coordinated release is verified.

Verification commands are `npm test`, `npm run build --workspace=frontend -- --webpack`, `npm run typecheck --workspace=mobile` and `npm run build --workspace=mobile`. The frontend is now pinned to Next.js 16.4.3, the latest stable release verified on 26 October 2026, with matching compiler/environment packages and Sharp 0.35.5. The webpack production build passes without the earlier Next.js security advisory, and all 69 regression tests pass. No security checks were disabled. The earlier 16.4.0 Turbopack build stalled on this Windows host, so the explicit webpack command was used for production-build verification. Android/iOS exports and mobile typechecking also passed during lifecycle implementation. Other dependency advisories remain in the workspace audit and are separate from the resolved Next.js upgrade. See the [16.4.3 release](https://github.com/vercel/next.js/releases/tag/v16.4.3) and [October security update](https://nextjs.org/blog/nextjs-security-update-october-14-2026).

If the SQL migration fails, its transaction rolls back. If a later application deployment fails after the migration succeeds, do not run the old application against the removed tables or routines. Restore the matching schema and removed records from the verified recovery backup before reverting the application, and reconcile any writes since cutover. The new promotion and graduation transactions each roll back their own failed batch; a response timeout requires refreshing authoritative state before retrying.
