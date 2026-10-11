# Follow-up Plan 10: clean builds and release gates

Prepared 2026-10-10. Plans 8–10 implementation and available local verification are delivered. **Production readiness is not certified:** durable JSON storage, target-database integration, browser/provider checks and named institutional policies remain open. No production migration, deployment or live student deletion was performed.

## Owned findings

| Finding | Status | Evidence |
|---|---|---|
| R34 | Completed locally; live provider build unverified | Reproduced hoisted Next/React resolution failure after installing the workspace. Root exact React/ReactDOM 19.2.3 dev dependencies and regenerated lockfile make React resolvable from hoisted Next; mobile remains a workspace. Fresh installation and root/frontend builds passed without NODE_PATH. |
| R35 | Local gate repaired; partial release certification | `test:all` includes backend production-service/SQL/solver tests, frontend actual-module tests, lint and both builds. Illustrative cross-plan business copies replaced by actual imports. Actual migration inventory, recovery runbook and R01–R36 evidence matrix distinguish mock/static proofs from real SQL, solver and deployment evidence. |

## Validation environment and results

Windows PowerShell; Node 24.19.0, npm 11.17.0, Python 3.12, OR-Tools 9.11.4210. Root `.nvmrc`, `engines`, `packageManager` and Render Node version agree. Deployment availability is still to be verified by the operator.

| Command | Observed result |
|---|---|
| `npm ci` | Successful workspace installation after lockfile repair; no workspace removed. |
| `npm run test:all` | Passed: 224 backend tests, 5 frontend tests, lint with zero errors, backend build and frontend production build. Actual solver tests ran; no skipped backend tests. |
| `npm run lint --workspace=frontend -- --fix` | Passed: 0 errors, 40 warnings after removing redundant local suppressions. Remaining warnings are recorded in `lint-final.log`; no global rule disabled. |
| `npm run build --workspace=backend` followed by `node --test backend/test/followup-recoverable-graduation.test.js backend/test/followup-reporting.test.js` | Passed after the final migration/UI reporting changes: 14 tests, zero failures/skips. Includes effective draft/attendance RPC ACL checks and actual PostgreSQL graduation/snapshot operations. |
| `npm run verify:clean` | Passed. Fresh isolated folder, no reused node_modules/.env files, NODE_PATH removed; npm ci followed by root build and frontend-directory build. After Next warned about discovering the parent lockfile, explicit Turbopack/output-tracing roots were added. Both build entry points were rerun successfully in that freshly installed copy with the final config and ledger component, without NODE_PATH. |
| `node scripts/migration-manifest.cjs` | 38 actual migration filenames recorded in MIGRATIONS.md. Historical prerequisites are an inventory, not a certified empty-database bootstrap instruction. |

Local logs are ignored artifacts: `release-validation.log`, `lint-final.log`, `backend/test-final-focused.log`, `clean-build-validation.log`, `clean-root-final.log`, `clean-frontend-final.log`. The last two record the final isolated root/frontend builds with explicit workspace roots. Counts differ from old handoffs because illustrative tests were replaced; count alone is not acceptance evidence.

## Test boundaries

- **Real production services, mocked external transport:** auth/password sync, authorization, enrollment/allocation, delivery scopes, attendance revision responses, and exports. Reporting fixtures deliberately cap responses, and parse actual CSV/JSON/XLSX output. These tests do not claim PostgREST schema or transactional concurrency certification.
- **Actual PostgreSQL execution:** PGlite loads actual lifecycle, graduation and snapshot migrations against a synthetic FK graph; exercises production AdminService RPC calls, immutable candidates, promotion receipts, DB-first cleanup, retries after Auth/checkpoint failures, and trigger preservation/removal of snapshots. Auth calls are simulated. Actual draft/attendance function bodies are installed for effective-grant checks; their full table operations are not exercised by that ACL test.
- **Actual solver and file storage:** inherited solver tests invoke the compiled Python asset using OR-Tools, check AEC/VAC/JSON/odd-practical behavior through the independent validator and verify local JSON override persistence/restart.
- **Actual frontend modules:** refresh coordinator tests cover shared refresh, Request POST handling, provider outage and logout overlap; date helpers cover timezone/day boundaries. These are module tests, not browser end-to-end tests.
- **Not run:** live Supabase Auth/PostgREST, full historical database bootstrap, separate PostgreSQL connection races, real browser initial teacher/password/cookie flows, deployed worker crash/fencing, Vercel/Render provider builds and durable disk restoration. `RELEASE_RUNBOOK.md` gives the staging acceptance checklist.

## Source/configuration and integration repairs

- Root/front-end package manifests, root lockfile, `.nvmrc`; `scripts/verify-clean-build.cjs`; `scripts/migration-manifest.cjs`; `frontend/next.config.ts` with explicit workspace roots; `frontend/vercel.json`; `render.yaml`.
- Targeted frontend typing, hook/dataflow and JSX fixes retain ESLint enforcement. `useCurrentTime` updates deadline/cooldown clocks. Scoped suppressions remain only for documented external state bootstrap patterns where needed.
- Refresh coordination now respects a Request object's method and headers and prevents an in-flight refresh from replaying after logout. Tests import the actual coordinator.
- The final integration review repaired backend-only RPC exposure using `20261010070000_followup_plan10_attendance_rpc_privileges.sql`: `atomic_replace_timetable_draft(uuid,text,integer,jsonb,uuid)`, `atomic_submit_period_attendance(uuid,date,uuid,uuid[],uuid[],uuid,integer)` and `atomic_copy_practical_attendance(uuid,uuid,date,uuid,integer)` revoke PUBLIC/anon/authenticated and grant service_role. Backend resource checks remain authoritative.
- Plan 8's durable graduation/promotion state and Plan 9's snapshots/scoped reporting are documented in their individual handoffs. Existing handoffs 1–7 are retained; their broader completion claims are qualified by `FINAL_FINDINGS_MATRIX.md`.

## Migration and deployment contract

After installed follow-ups 1–7, review and apply only unapplied migrations in this order: `20261010040000_followup_plan08_recoverable_graduation_and_retention.sql`, `20261010050000_followup_plan08_durable_graduation_recovery.sql`, `20261010060000_followup_plan09_registration_snapshots.sql`, `20261010070000_followup_plan10_attendance_rpc_privileges.sql`. The 500 migration is a required forward repair of the initial 400 draft, including its RPC permissions. Inspect deployed schema/FKs and back up registration history before reconciliation. Never blindly replay destructive historical migrations.

Vercel root `frontend` installs at the workspace root and builds `build:frontend`; include files outside the project root. Render builds from repository root and starts the backend workspace with Python/JSON compiled assets. Required variables and recovery procedure are in `RELEASE_RUNBOOK.md`.

The retained Render free plan has no durable JSON filesystem. A paid plan/provider/storage choice was not made silently. The operator must configure persistent storage at `TIMETABLE_CONSTRAINTS_DIR`, backup/restore, and restart verification before release. This is an essential deployment dependency for R20.

## Remaining owners

1. Release operator: approved migration path, full database integration/races, live scope/grants, browser/provider flows, deployed solver/worker checks and durable JSON storage.
2. Institution: academic level mapping and degree matrix, attendance denominators/term dates/makeup handling, GPS retention, export-before-deletion and final export templates. The implementation discloses unknown history/policy and does not invent degree eligibility.
3. Reviewer: use `FINAL_FINDINGS_MATRIX.md` for all 36 findings, and distinguish locally completed defects from explicitly partial integration evidence. Do not translate a green local gate into a production-ready claim.
