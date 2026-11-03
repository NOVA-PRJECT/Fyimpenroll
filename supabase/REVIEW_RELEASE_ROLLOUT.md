# November review release

This release changes authentication recovery, attendance RPC contracts, scheduling execution, and readiness. SQL and application releases must be coordinated. Nothing in this work applies SQL or repairs production records automatically.

## Prerequisites and owner-run SQL

1. Verify a recoverable database backup and rehearse the release on staging. Pause writes during the coordinated cutover.
2. Run `changes/review_preflight.sql` in the SQL editor. Review inconsistent attendance summaries and teachers missing departments. Those rows are not automatically repaired. Supply correct departments from institutional records; do not guess. Reconcile attendance only from trustworthy persisted evidence.
3. Confirm the existing manual timetable, data-read optimization, and preference-before-allocation releases are installed. Their existing rollout documents describe prerequisites. Apply only missing feature releases. **Do not rerun `semester_lifecycle.sql`** or the fresh-project baseline on production. Pending-allocation repair requires a separately scoped owner decision.
4. For a first installation, run **`changes/review_release.sql`** once. It bundles the review scripts into one transaction and rejects replay. If the November review release is already installed, run **`changes/review_workflow_fixes.sql`** by itself to upgrade the department deletion, cancellation, and worker completion routines. The upgrade changes future operations only.
5. Verify:

```sql
SELECT public.application_schema_compatibility();
SELECT public.production_readiness();
SELECT conname, convalidated FROM pg_constraint
WHERE conname IN ('review_attendance_totals','review_teacher_department','review_credit_range');
```

Expect schema version 1, no missing capabilities, and database readiness true. Existing constraint validation remains a separate owner action after the preflight issues are resolved; do not mistake `NOT VALID` for a repair.

The canonical review scripts are `review_integrity.sql`, `review_operations.sql`, `review_scheduling.sql`, `review_workflow_fixes.sql`, and `review_readiness.sql`. Regenerate the bundle with `node scripts/build-review-release.cjs`. CI checks it. Fresh projects use the updated baseline bootstrap, which restores the complete feature sequence and these scripts.

### If the bundle reports a missing prerequisite

Run `changes/review_prerequisites.sql` separately. It returns four rows with `installed`, the exact signature, and the feature's `owner_sql`. Share those rows before choosing a remediation for a partially installed feature. `review_release_installed = false` is normal before the first successful review release; `lifecycle_installed` should be true. Do not install the baseline or rerun lifecycle SQL to satisfy a missing feature routine. The prerequisite guard runs before review changes and an error rolls back the complete bundle.

If a feature is wholly absent, its existing owner-run file is the candidate release. If only one routine from a feature is missing, inspect the partial installation before replaying that file. Manual timetable SQL includes non-replayable creation statements, and the preference release changes future registration/allocation behavior; neither should be applied blindly. These files do not call the pending-registration repair routine automatically. After installing the verified missing feature on staging and then through the owner's production procedure, rerun the diagnostic and the review preflight before retrying `review_release.sql`.

For the reported state where **both manual timetable and preference-before-allocation are missing, and lifecycle plus display aggregation are present**, use `changes/review_missing_prerequisites.sql` once before the review bundle. It packages only those two missing releases in one transaction, accepts the known original or already HOD-restricted teacher-assignment routine, and stops on partial/manual or preference installations and unknown teacher-policy definitions. It changes future command behavior without updating historical registrations or calling the repair function. Existing premature enrollments remain for separately scoped owner review. Its final verification should show four `installed = true` rows. Then run `review_preflight.sql` and `review_release.sql`. Do not separately replay either packaged feature, display aggregation, or lifecycle SQL. Regenerate/check this bridge with `node scripts/build-review-prerequisites.cjs [--check]`; historical feature files are unchanged.

## Recovery email and application cutover

Set the Supabase recovery email template to `templates/recovery.html`, with the project Site URL pointing to the public portal. The email goes to `/reset-password/confirm?token_hash=...`. The page does not exchange or consume the token on visit; the backend verifies `type: recovery` when the user submits a password. Previously issued implicit/PKCE links without the token hash must be replaced by requesting a new email.

An ordinary login bearer token is no longer sufficient for `/api/auth/complete-password-reset`. Its body is `{ newPassword, token_hash }`; the account comes from provider verification. A partial profile synchronization returns explicit recovery-session credentials for the separate retry endpoint. These credentials must never be logged or stored in application data caches. Both authenticated password-change URLs use the same policy; optional confirmation must match.

Deploy the backend and web together and rebuild mobile. Numeric attendance revisions are mandatory: zero for first submission, current revision for correction. Practical-copy revision aliases remain supported when they agree. Old queued actions missing a usable revision require user review; they must not silently overwrite newer marks.

## Free API deployment

Deploy the single Free Web Service in `render.yaml` with `RUN_REVIEW_WORKER=true`. Start it with `npm run start:prod --workspace=backend`. The API starts the allocation, timetable and account-cleanup loops and renews their PostgreSQL leases. Use the [free-tier deployment guide](../docs/PRODUCTION_DEPLOYMENT.md) for settings, health checks and mobile distribution.

The API readiness endpoint checks compatible SQL, the solver and a worker heartbeat within sixty seconds. A sleeping web service processes queued work when incoming traffic wakes it. An interrupted job can be reclaimed after its ninety-second lease expires, subject to the three-attempt limit. Check the recorded outcome before retrying a failed job.

Allocation now returns HTTP 202 with `runId` and queued status. Directors follow the existing allocation status endpoint; both queued and running states block duplicate action buttons. Timetable generation keeps its job identifier and progress interface. Directors can cancel their own campus jobs.

## Operations and verification

- Account deletion commits the complete Auth cleanup manifest with domain deletion. Shared external course/teacher dependencies and active work block the transaction. Cleanup revokes remaining Auth sessions and deletes up to five accounts concurrently; returned provider errors and thrown failures are recorded. Retries use backoff, stop after eight failures, and can be restarted by superadmin. The UI displays completion/pending/failure counts and retry controls. `GET /api/admin/auth-cleanup?requestId=...` retrieves durable status.
- Browser identity is verified before private cache reuse and after focus/reconnect. Cross-tab transition messages carry only random nonces. Mutable data has a sixty-second cache age, catalogue data ten minutes, and inactive client data thirty minutes. Client cache reuse honors server update timestamps. Mobile refetches stale data on foreground/reconnect.
- Both attendance export URLs use two concurrent exports per API process and one per user. `EXPORT_MAX_ROWS` defaults to 10000 and `EXPORT_MAX_CELLS` to 500000. Narrow oversized reports rather than truncating them.
- Critical domain audit events are inserted by transaction-local triggers. HTTP actor attribution is supplied from the verified backend request context, never from client claims. Direct database changes without a portal actor are explicitly identified as database operations. Attendance and deletion commands also write their specific audit events transactionally.
- Zero-contact allocated cohorts finalize as `not_required`, with no fake classroom periods or attendance. Registration/allocation/scheduling are locked for that cohort until lifecycle advances the term. Degree eligibility remains unavailable; numeric `earned` fields are deprecated compatibility aliases for registered credits for one release.
- The global write lock remains. See `docs/reviews/2026-11-02-lock-partitioning.md` for measurements and the separate partitioning proposal. Retain only the lock samples required by the institution's operational retention policy.

Before opening writes, verify real recovery email delivery, a two-tab account transition, initial marking/correction/conflict, a queued allocation, worker restart, cleanup failure/retry, and research-only status on staging. Monitor readiness, oldest queued work, expired leases, cleanup failures, audit-storage errors, and lock wait samples. A migration rollback is not accomplished by replaying old lifecycle files: use the verified backup and a compatible application release. Do not deploy an old application that restores the insecure recovery contract.

Local builds, mock-provider HTTP checks, PGlite integrity checks, and browser fixtures do not replace staging Supabase Auth/PostgREST/grants tests or physical-device queue storage testing. All six real PostgreSQL concurrency scenarios passed on an isolated local PostgreSQL 18.6 server, which was stopped after testing. Synthetic measurements cover attendance, shared-course allocation, visiting-teacher publication, and lifecycle promotion; see the lock follow-up for results and limitations. CI repeats these checks on PostgreSQL 17.
