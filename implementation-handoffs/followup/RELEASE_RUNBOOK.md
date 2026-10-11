# Web release and recovery runbook

Updated 11 October 2026. Scope: frontend, backend and database. No production deployment or destructive live operation has been performed. Current remediation evidence is in [FIXES.md](../production-audit/FIXES.md); earlier plan handoffs are historical.

## Local and CI gates

Use Node 24.19.0, npm 11.17.0 and Python 3.12 with requirements.txt.

~~~text
npm ci
python -m pip install -r requirements.txt
npm run typecheck:frontend
npm run test:all
npm run verify:deploy
node scripts/migration-manifest.cjs
~~~

The web gate compiles/tests backend services, invokes the actual OR-Tools solver, executes isolated PostgreSQL migration tests, tests frontend modules, lints and builds both web workspaces. Mobile is not a release gate. verify:deploy builds in a temporary directory outside the checkout, copies no environment/dependency files, removes NODE_PATH, performs provider-style scoped installs and audits the required installed runtime graph. Build-only public Supabase placeholders are used. Reports distinguish extraneous build-tool advisories from required runtime dependencies.

The CI workflow additionally starts a disposable PostgreSQL 16 service and runs production-timetable-transactions.test.js with PRODUCTION_SQL_TEST_URL. Use only a disposable database: this test creates fixture roles/tables. The optional scripts/verify-postgres.cjs accepts POSTGRES_BIN for an already available local runtime and manages its own disposable cluster. On this Windows host Application Control blocked pg_ctl; use the CI PostgreSQL job to establish the separate-connection race result. PGlite does not establish concurrent connections.

On 11 October 2026 the user applied the prepared bundle and supplied receipts through 20261010100000. A read-only database check returned production_readiness = {"ready":true} and zero active allocation/timetable jobs. The earlier missing-migration blocker is resolved. Deploy and validate the current web application; the database probe does not certify browser workflows, concurrency or hosting capacity.

## Migration path

MIGRATIONS.md lists the 41 actual filenames. Compare deployed receipts and schema/FKs first, back up academic records and apply only unapplied files to staging in filename order. Existing deployments must not replay destructive history. The master schema is not a certified fresh bootstrap.

After prerequisites 1–7, plans 8–10 use:

1. 20261010040000_followup_plan08_recoverable_graduation_and_retention.sql, if unapplied.
2. 20261010050000_followup_plan08_durable_graduation_recovery.sql.
3. 20261010060000_followup_plan09_registration_snapshots.sql.
4. 20261010070000_followup_plan10_attendance_rpc_privileges.sql.
5. 20261010080000_production_timetable_transactions.sql.
6. 20261010090000_production_attendance_summary.sql.
7. 20261010100000_production_allocation_fencing_and_clocks.sql.

The timetable and attendance repairs provide corrected timetable job identity, fenced transactions/recovery, publication, attendance table/function ACLs, safe duplicate-index removal, aggregate reporting and readiness. The backend requires them; deploy migration capability before switching application traffic. Stage the forward migration and application together because the draft-commit RPC signature changes.

The allocation repair adds strict claim/token/lease commits, correct resulting seat counts, atomic completion, course-change credit totals and timezone-safe deadlines. The current backend requires fail_allocation_worker and the repaired enrollment RPCs.

Use the user-requested [prepared SQL bundle](../production-audit/APPLY_PENDING_WEB_REPAIRS.sql) with [application steps](../production-audit/APPLY_SQL.md) after validating prerequisites. The exact seven-file bundle was rehearsed against actual table definitions, including rollback and safe replay. The user applied it on 11 October 2026; the subsequent read-only database probe returned ready=true.

Snapshot reconciliation does not invent unknown historical credits. Graduation migrations prepare capability and do not graduate students during installation. Do not delete pending operation/receipt records as a rollback shortcut.

## Hosting and rules

Vercel project root: frontend; include source outside that directory. frontend/vercel.json performs a root-lockfile frontend workspace install/build. Configure BACKEND_URL and public Supabase variables. Verify API rewrites, allowed origin and secure cookies on staging.

Render uses the repository root, Python requirements, scoped backend install/build, runtime prune and backend production start script. Configure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, FRONTEND_URL and shared Redis variables. PYTHON_PATH is optional when Python is already on PATH. The checked-in ingress setting TRUST_PROXY_HOPS=1 must match the actual proxy path; validate req.ip on staging. Never expose the service-role key to the frontend. Confirm the compiled Python solver and constraints.base.json ship with backend/dist.

Repository scheduling JSON is read-only and ships with the codebase. Directors edit structured rules in their dashboard; saves use campus-specific browser localStorage, and rules accompany generation requests. Logout keeps these rules while clearing account data. Reset restores repository defaults. Clearing browser data loses local edits; another browser/device starts from repository defaults. No runtime server rule file or persistent disk is required. The earlier mutable-file storage blocker is superseded by this explicit user choice.

Render's configured free plan may interrupt an in-process solver. Database leases/fencing prevent an interrupted worker from committing stale work. Restart recovery marks expired jobs failed, and the director retries using the browser's rules; automatic resumption is not claimed. Readiness is /api/health/ready, liveness /api/health. Size hosting against a representative staging cohort before release.

## Staging acceptance

- Verify applied schema receipts, every operational RPC overload and effective anon/authenticated/service-role privileges.
- Exercise host-campus teacher delivery from enrollment through roster, marking, timetable and all eight-paper CSV/XLSX/JSON exports through real PostgREST.
- Run two-connection last-seat, timetable claim/publication and attendance-revision races on disposable staging data.
- Test initial password change, SYNC_FAILED recovery, cookie expiry, parallel refresh, logout overlap and temporary provider outage in a browser.
- Generate/publish from the deployed compiled directory, interrupt/restart a worker and verify safe recovery/retry using saved browser rules.
- Preview a synthetic semester-10 cohort; inject provider cleanup failure and verify persisted restriction, retry and recovery after restart. Use no live student identities for failure injection.
- Validate attendance denominator policy, academic year/degree rules and export templates with institutional owners. Measure representative concurrency/memory/latency and rehearse backup restoration.

Failed Auth cleanup retains restricted accounts and saved retry candidates. An idempotent retry completes missing checkpoints without selecting a new cohort. Reverting application code cannot recreate deleted academic records; an actual erroneous graduation requires a separately authorized backup restoration.
