# Web production remediation

Updated 11 October 2026. Scope: Next.js frontend, NestJS backend and Supabase database migrations. Mobile is retained in the repository but is outside this release and its checks. The original REVIEW.md is a historical baseline.

The audited web defects have been repaired locally. This is ready for staging validation, not a certification of the live production installation. No live migration, deployment or academic data deletion was performed.

## Audit findings

| Finding | Result |
|---|---|
| PA01 dependencies | Next/eslint-config-next aligned at 16.4.0; compatible backend/web updates locked; ExcelJS uses UUID 11.1.1. Scoped, isolated builds verify the installed runtime graph and query current npm advisories. Mobile dependency advisories are outside this web release. |
| PA02 publication | Publication, active-job checks, conflicts, verified draft fingerprint and state change are one transaction sharing the generation cohort lock. A global publication lock also guards published visiting-teacher occupancy. Query failures cannot authorize publication. |
| PA03 worker fencing | A commit requires the existing running claim, exact cohort/token and live lease. Draft replacement and successful completion are atomic. Startup/periodic recovery marks interrupted jobs retryable; it does not silently restart work with unknown browser rules. |
| PA04 delivery identity | Teacher cards and roster requests use an exact assignment delivery, host campus, academic year and semester. Historic assignments cannot authorize the current roster. |
| PA05 persistence | Superseded by the user's decision: repository JSON ships read-only; director edits are stored in campus browser localStorage and submitted with generation requests. No writable server rule file or persistent disk is needed for rules. Database job state and leases retain recovery information. |
| PA06 complete data | Complete-cohort operations traverse capped PostgREST pages until empty, use stable ordering, and chunk UUID filters. Repaired faculty/HOD/GPS/allocation/solver/export loaders include student mappings and teacher reservations. Exact counts use database count queries. Reporting limits fail explicitly rather than returning partial exports. |
| PA07 eight papers | The live HOD download uses the scoped canonical backend export, including all eight papers and snapshot credits. The unused six-paper frontend helper was removed. |
| PA08 provider outages | Invalid credentials remain 401; retryable provider failures return 503. Bounded provider/middleware calls preserve cookies during outages. |
| PA09 refresh cache | Refresh keys are hashed; caches and in-flight work are bounded and pruned. Logout invalidates user results and fences overlapping refreshes, including slow work beyond normal tombstone retention. |
| PA10 rule corruption | Invalid/missing repository documents fail closed. Browser rule requests are validated as structured rules. The editor prevents invalid empty windows and does not write server files. |
| PA11–PA12 mobile | Outside the user's current web release scope. Earlier mobile edits are preserved; no mobile release is claimed. |
| PA13 limiting | Proxy-aware request IP with explicit ingress hop configuration; bounded per-process fallback during Redis absence/outage; shared password/recovery endpoints use sensitive limits. Configure shared Redis before horizontal scaling. |
| PA14 browser table access | Forward migration removes browser grants on attendance session metadata and retired cohort operations. Operational timetable/aggregation functions are explicitly service-only; actual SQL tests verify both denial and service grants. Live grants still need verification after migration. |

## Smaller optimizations

1. Extracted the structured timetable rule editor and student course select from large pages. No broad architecture rewrite was introduced.
2. Shared stable roles/delivery/eight-slot contracts and reused canonical export/password recovery paths.
3. Lazy HOD tabs and timetable ExcelJS; no measured bundle-size or latency savings claimed.
4. GPS roster merge indexes records once with a Map.
5. Exports filter scope early, cap output at 20,000 rows and allow two concurrent exports per process. Attendance totals aggregate in SQL; the regression covers 100,005 marks.
6. Removed two redundant nonunique indexes only when their catalogue definitions match retained named UNIQUE constraints.
7. Removed inactive AI generation/prompt modules, old logging fallback and unsafe direct-write job fallbacks. Applied migration history is retained.
8. Minute time refreshes, deadline wake-up and tab-resume refresh avoid one-second page rerenders while preserving deadline decisions. Backend transactions remain authoritative.
9. Provider installs/builds select backend or frontend workspaces; backend runtime prunes dev dependencies and excludes Expo. The lockfile and mobile workspace are retained.
10. Reviewed lint dependencies/unused state, added cached single-flight dependency readiness, request IDs and a web-only CI gate with disposable PostgreSQL.

## Verification

Final local gates completed successfully:

| Check | Result / local log |
|---|---|
| Full backend suite | 241 passed, 0 failed, 1 separate-connection test skipped; web-release-final.log |
| Frontend modules | 7 passed in 3 files; web-release-final.log |
| Final lint | 0 errors, 0 warnings; web-release-final.log |
| Frontend type check | Passed; frontend-types-final.log |
| Backend and Next production builds | Passed; web-release-final.log |
| SQL/ACL and full migration bundle | 11 passed across both SQL suites (included in full backend count); 1 separate-connection test skipped; web-release-final.log and migration-sequence-tests.log |
| Scoped clean backend/frontend deployment builds | Passed outside repository, no NODE_PATH; clean-deployment-final.log |
| Required installed runtime advisories | Backend: none in 295 package paths; frontend: none in 282 paths, with braces/micromatch explicitly excluded as extraneous |
| Diff whitespace check | Passed |

Logs are local evidence, not committed provider configuration or live certification.

- Actual migration tests use PostgreSQL through PGlite: expired/missing/completed worker rejection, insertion rollback, atomic publication preconditions, verified-draft edits, visiting-teacher occupancy, role privileges, retained uniqueness and 100,005 attendance records.
- Auth recovery tests exercise returned/thrown provider failures, logout/cache overlap, unavailable Redis and password metadata synchronization failure.
- Frontend tests cover refresh coordination, dates and session navigation preserving browser rules.
- The separate-connection PostgreSQL race is configured in .github/workflows/production-checks.yml. Local Windows Application Control blocked pg_ctl.exe from the disposable test runtime. No protection was bypassed and no server/service was installed.
- Clean deployment copies live outside the repository, receive no .env or node_modules, and build with NODE_PATH removed. Builds do not certify real provider cookies, PostgREST relationships or migration application.

The clean backend runtime has no reported dependency advisories. The frontend required runtime graph also has none. npm's frontend report includes high-severity braces/micromatch entries which npm ls marks extraneous build tools; the runtime audit explicitly reports these exclusions rather than presenting a zero all-workspace audit. The published braces advisory has no patched release, so no destructive automatic downgrade was used. Reassess build-tool exposure and updates when a compatible patch is published. References: [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [UUID advisory](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq).

## Pre-rollout database observation (historical)

A read-only check of the configured Supabase database on 11 October returned HTTP 404 / PGRST202 for production_readiness. Its schema_migrations table was readable, but did not contain receipts for either 20261010080000_production_timetable_transactions or 20261010090000_production_attendance_summary. The six self-recording follow-up files from 20261010040000 through 20261010090000 have no matching receipts. Earlier follow-ups 03, 06 and 07 do have receipts. Follow-ups 01, 04 and 05 do not write public receipts themselves, so their absence alone cannot prove those migrations were not applied; reconcile their live definitions separately.

The new 20261010100000 repair is also pending; it has not been applied live. This establishes a current database release blocker. No rows, schema or privileges were changed during verification; no credentials or student data were printed. Apply the reviewed prerequisite path on staging and validate before any production rollout. An absent receipt is not permission to replay a destructive historical file.

## Required release evidence

Apply only unapplied migrations to staging using the ordered inventory and reviewed schema prerequisites. In particular, the new 20261010080000, 20261010090000 and 20261010100000 repairs must be present for the backend readiness probe. Verify live service/browser grants, real PostgREST exports, authentication/cookies, generation/restart/retry and the PostgreSQL concurrency CI job. Also exercise last-seat and attendance-revision races on the actual staging schema, plus a restore rehearsal for academic data. Earlier plan tests do not establish those live acceptance results.

The repository's historical migrations are not a certified empty-database bootstrap; some are destructive. Do not replay history against production. See [release runbook](../followup/RELEASE_RUNBOOK.md) and [migration inventory](../followup/MIGRATIONS.md).

## Final schema integration repairs and SQL handoff

The backend now queries the actual semester_blueprints table for enrollment rules and completion exports. Missing rules, provider failures or an ambiguous pathway fail closed. Integrated schema-contract tests cover every literal backend table reference against the actual repository table definitions after the migration sequence.

Forward migration 20261010100000 repairs allocation claim/commit fencing, retained fixed-seat capacity, atomic completion and snapshot-backed credit totals. Failed workers use a token-checked transition and cannot overwrite completed runs. It corrects UTC-without-timezone comparisons and the course-change composite-row declaration, and restores credit-total recalculation overridden by an earlier migration.

At the user's request, [APPLY_PENDING_WEB_REPAIRS.sql](APPLY_PENDING_WEB_REPAIRS.sql) is prepared for the user to apply. Follow [APPLY_SQL.md](APPLY_SQL.md). Seven pending repairs run in one guarded transaction; exact existing receipts skip applied files. The script rejects missing prerequisites and active jobs and requests PostgREST schema reload. No live database write was made.

Five integrated PostgreSQL/PGlite tests passed in migration-sequence-tests.log: prerequisite composition, backend table contract, Asia/Kolkata clock comparisons, allocation/credit invariants and exact-bundle replay. The setup also injects a failure after all repairs and verifies full rollback before running the actual bundle. SQL_BUNDLE_MANIFEST.json records source hashes. The inventory contains 41 migrations. Multiple-connection staging acceptance remains required.


## Database rollout confirmed on 11 October 2026

The user applied the prepared repair bundle and supplied receipts through 20261010100000. A subsequent read-only check of the configured Supabase database returned production_readiness = {"ready":true} and zero queued/running allocation or timetable jobs. The earlier missing-RPC/receipt blocker is resolved. Codex did not apply migrations or change live records.

This confirms the database readiness function's checks, not a full production certification. Deploy the current web backend/frontend and verify health, browser authentication, registration, generation/publication and exports. Staging concurrency, representative load and restoration acceptance remain as described in the release runbook.

## Web-only commit verification

The release index excludes mobile files and mobile-only root script additions; its lockfile is reconciled against the committed mobile manifest. The exact index was exported to an isolated directory without production environment files and installed with npm ci. The full backend suite includes the targeted abandoned-job recovery test.

Initial cold runs encountered solver process timeouts and resource contention while parallel clean builds were running. The complete backend suite passed with numerical-library threads bounded to one; solver time limits, worker settings and assertions were unchanged. CI uses the same OPENBLAS_NUM_THREADS/OMP_NUM_THREADS environment. Local logs retain both initial failures and the final checks.
