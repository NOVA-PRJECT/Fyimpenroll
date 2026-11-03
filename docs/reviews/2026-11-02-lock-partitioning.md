# Global lock measurements and follow-up design

The review release retains advisory lock `76102622134917`. Attendance authority writers and scheduling dependency writers now acquire it in the same order as their transactional commands. Removing it without replacing those relationships would reopen revocation and publication races.

`review_lock_samples` records waits of at least 5 ms plus a 1% baseline sample, including operation and transaction elapsed time at acquisition. It contains no account identifiers or payloads. Transaction elapsed time here is a partial measurement, not completed transaction duration. Samples roll back with a rejected transaction, so collect complete successful and rejected operation duration at the caller as well.

Run `node scripts/benchmark-review-locks.cjs` only against an explicitly isolated PostgreSQL database named `fyimp_review_test`, with `FYIMP_TEST_DATABASE_ISOLATED=1` and `FYIMP_TEST_DATABASE_URL`. The script resets that test database, creates synthetic campuses, submits 40 revisioned attendance transactions across two streams, then measures five competing pairs each for shared-course allocation, visiting-teacher publication, and promotion versus attendance. Setup is excluded from the measured pairs. It writes durations and sampled waits to `scratch/review-lock-benchmark.json`; CI uploads the artifact.

## Local measurement, 2026-11-03

An isolated PostgreSQL 18.6 server on Windows, bound to loopback, completed all six concurrency scenarios. The small synthetic workloads ran alongside other verification processes; these figures are diagnostic, not production capacity estimates.

| Workload | Samples | p50 ms | p95 ms | Other observation |
| --- | --- | --- | --- | --- |
| Attendance, two unrelated campuses | 40 operations | 9.95 | 44.26 | p99: 57.34 ms |
| Shared-course seat competition | 5 competing pairs | 668.33 | 833.34 | Maximum: 861.68 ms |
| Visiting-teacher publication | 5 competing pairs | 30.80 | 54.62 | Maximum: 1506.42 ms |
| Promotion versus attendance | 5 competing pairs | 25.00 | 45.92 | Maximum: 46.02 ms |

Attendance streams completed in 1524 ms. Fourteen committed lock samples had a sampled p95 wait of 0.022 ms. That sparse, commit-only sample cannot explain total latency or rejected contenders. Five iterations do not establish stable tail percentiles. These results support retaining the global lock while collecting representative staging measurements; they do not justify a concurrency redesign. CI repeats the checks on PostgreSQL 17.

Production-like measurements must include realistic roster sizes, simultaneous campus attendance, allocation, shared-course competition, visiting-teacher publication, and promotion. Compare total operation time with lock waits and query time. PostgreSQL concurrency tests are supplied separately from PGlite integrity tests.

## Proposed replacement, for a separate implementation

Acquire resources in this deterministic order:

1. Campus lifecycle gates, sorted by campus UUID. Promotion/deletion takes the exclusive campus gate; ordinary term operations share it.
2. Cohort gates, sorted by campus, term, academic year, and semester. Attendance and assignment revocation for the delivery share the cohort gate.
3. Shared course capacity locks, sorted by course UUID, for allocation and enrollment changes.
4. Teacher occupancy locks, sorted by teacher UUID, for assignment, substitution, publication, and term transitions affecting visiting teachers.

Discover dependencies from a consistent snapshot, acquire the complete sorted set, and recheck versions before committing. Retry if the dependency set changed. A transaction must never acquire an earlier class of resource after a later class. Audit inserts must remain transaction-local and must not reacquire a university-wide lock in the replacement design.

Do not partition until the real PostgreSQL tests prove capacity, revocation, promotion, cancellation, and cross-campus publication guarantees, and measured waits justify the change. Keep the existing lock as the rollback implementation. This release implements measurement and the dependency revision vector; it does not claim the partitioned design is deployed.
