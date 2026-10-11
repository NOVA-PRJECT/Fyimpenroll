# Applying the prepared web database repairs

Prepared 11 October 2026 for the existing FYIMP schema. Scope: web frontend, backend and database. Mobile is outside this release. No live migration was applied by Codex.

## File to run

Run the entire [APPLY_PENDING_WEB_REPAIRS.sql](APPLY_PENDING_WEB_REPAIRS.sql) file in Supabase SQL Editor as the database owner. Test it on a staging copy of the current database first. Do not run MASTER_SCHEMA_UPSERT.sql or replay historical migrations against production.

This bundle includes seven forward repairs, from 20261010040000 through 20261010100000. It skips files with their exact public migration receipt, uses one transaction and stops on missing prerequisites or active allocation/timetable jobs. [SQL_BUNDLE_MANIFEST.json](SQL_BUNDLE_MANIFEST.json) records the SHA-256 of each source migration. Regenerate with `node scripts/build-production-sql.cjs` if those sources change.

## Steps

1. Back up the existing academic database and confirm you can restore it. Review the migration inventory and staging acceptance in the [release runbook](../followup/RELEASE_RUNBOOK.md).
2. Allow running allocation and timetable jobs to complete or recover. Pause new submissions/generation during the rollout. Use a maintenance window for migration and backend switching.
3. Paste and run the entire bundle on staging. A prerequisite error means stop and reconcile the earlier migration/function definitions; do not remove the guard. Receipt absence alone does not establish that older, non-self-recording migrations are missing.
4. Confirm the final query returns `{"ready":true}` and shows all seven migration receipts. Verify browser/service permissions and the staging workflows below.
5. Apply the same reviewed bundle to production, then deploy the current backend and frontend together during the maintenance window. The backend requires the repaired RPCs, including the six-argument draft commit and fail_allocation_worker. Verify `/api/health/ready` returns success and repeat a small browser smoke test.

If SQL Editor reports an error, the transaction must not be committed. End any remaining failed transaction with `ROLLBACK;`, investigate the error, and rerun the complete bundle after correcting the prerequisite. Do not commit a partial selection from this file. Statement/lock timeouts fail the run; a large database may need a separately reviewed timeout adjustment after measuring on staging.

## Data effects to review

The graduation repairs install recovery tables/functions and adjust academic foreign keys to cascade during a later explicitly requested graduation; installation itself does not graduate or delete students. The snapshot repair reconciles existing registration JSON from flat enrolled course slots and preserves known snapshot values. Review this reconciliation on a restored staging copy before production. Later enrollment changes use these snapshots for credit reporting.

Other repairs correct operational permissions, timetable transactions, attendance aggregation, redundant indexes, allocation claims/capacity and timestamp comparisons. An allocation failure handler cannot overwrite an already completed run. Unrecognized or unavailable semester blueprint rules block enrollment changes.

## What has been verified

The exact bundle was executed using PostgreSQL through PGlite with the repository's actual base table definitions and preceding plan/follow-up migrations. Tests verify all seven receipts, readiness, a synthetic failure rolling back every pending repair, safe replay without changing academic records, non-UTC deadline comparisons, stale/expired token rejection, retained fixed-seat capacity, atomic allocation completion, credit totals and idempotent course changes. Separate timetable SQL tests cover ACLs, publication, draft fencing and aggregate reporting.

These are local SQL rehearsals. They do not certify your live Supabase installation, real PostgREST relationships, multiple simultaneous database connections, cookies or hosting capacity. Before production, complete staging checks for last-seat and attendance races, generation/restart/retry, visiting teachers, exports, authentication and backup restoration. The CI PostgreSQL service provides the separate-connection timetable gate; it has not been run remotely in this session.

Timetable rule JSON ships read-only with the code. Directors edit dashboard rules in browser localStorage and send them with generation requests. Their edits never overwrite the server JSON.

## Recovery for the active-job preflight error

A read-only inspection on 11 October found one blocking timetable job, last updated on 3 September 2026. Pause new generation and run the whole [RECOVER_ABANDONED_TIMETABLE_JOB.sql](RECOVER_ABANDONED_TIMETABLE_JOB.sql) file. It changes only that exact running job to failed if its last-update timestamp still matches the inspected value and is older than 30 minutes. It does not delete timetable entries or academic records. Refreshed/completed jobs and other job IDs are unchanged.

The final query must return no active jobs. Then rerun the whole APPLY_PENDING_WEB_REPAIRS.sql bundle without removing its guard. If any active rows remain, let those jobs finish or inspect them separately; this recovery script must not be broadened to cancel every queued/running job. After deployment, retry the abandoned generation from the director dashboard.

The targeted recovery SQL passed a PostgreSQL/PGlite regression proving that only the abandoned ID changes and that recent or completed jobs are preserved. It was prepared for the user to apply; Codex made no live database update.
