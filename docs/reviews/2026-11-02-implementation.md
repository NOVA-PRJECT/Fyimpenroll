# Review implementation disposition

The November review was checked against the current checkout rather than treated as an instruction source. Existing teacher viewing and HOD assignment ownership remain deliberate policy.

| Findings | Disposition |
| --- | --- |
| R01, R15 | Provider-verified recovery token; unified password policy/service; ordinary sessions rejected; separate synchronization retry. |
| R02 | Teaching staff queries start from campus scope, reject foreign departments/missing affiliation, and exclude drafts. |
| R03 | Approved cross-campus/term timetable viewing retained. Sensitive delivery authorization is shared and includes exact campus/year/semester/term. |
| R04 | Verified session cache identity, cross-tab invalidation, private-view fencing, focus/reconnect verification, browser regressions. |
| R05–R08 | Unique absentee IDs, mandatory integer revisions, complete paginated readers, authoritative transactional roster and actor checks, summary constraints and atomic auditing. |
| R09 | Supported dependency fixes, Zod v4 migration, retained exploit regressions, advisory register; 31 → 22 flagged packages, zero high/critical after fixes. |
| R10 | Versioned capability readiness, exact bootstrap and release-bundle checks, complete workflow integration test. |
| R11 | Global lock retained; sampled waits and synthetic PostgreSQL benchmark supplied; partitioning remains a separately measured follow-up. |
| R12 | Atomic deletion manifest, bounded durable cleanup, error-aware retry and operator status. Deletion refuses external shared dependencies. |
| R13 | Shared initial password retained by explicit owner decision. First-login restrictions remain; pre-claim takeover risk is accepted. |
| R14 | Current checkout already blocks superadmin teacher creation. Preserve that restriction; HOD provisioning validates home department and consistently preserves first-login flags. |
| R16 | Secure storage errors propagate; read failure cannot overwrite the offline queue; owner isolation/conflict regressions added. |
| R17 | Export aliases share validation, generator and process/user budgets, with row/cell ceilings. |
| R18 | PostgreSQL queue, separate bounded worker, restart leases/fencing/cancellation, asynchronous allocation UI, bounded solver streams and termination. |
| R19 | Finite server/client ages and inactive retention, visible stale-data checks, native foreground/reconnect refresh. |
| R20 | Dependency revision vectors replace university-wide hashes; read context no longer holds the global lock; input loading checks the revision again before returning. Commit locks and cross-campus occupancy remain. |
| R21 | HOD-only assignments and director scheduling remain; misleading superadmin route permissions removed. |
| R22 | Explicit current-term research-only scheduling outcome, finalized-cohort guards and user messaging; mixed cohorts still need classroom scheduling. |
| R23 | First-party credit views use registered credits; snapshots preferred; earned aliases deprecated; eligibility stays unavailable. |
| R24 | Shared runtime request schemas for password, attendance, settings, registration, allocation and exports; scheduling input limits tightened. |
| R25 | Transactional business audit triggers and command events, verified request attribution, trusted-proxy IP with real parsing. |

See [owner rollout](../../supabase/REVIEW_RELEASE_ROLLOUT.md), [dependency advisory register](../security/dependency-advisory-register-2026-11-02.md), and [lock follow-up](2026-11-02-lock-partitioning.md).

## Operational ownership

| Operation | Owner and scope |
| --- | --- |
| Teacher provisioning and teaching assignments | HOD within their home campus and department; visiting deliveries remain supported. Superadmin teacher creation remains blocked. |
| Allocation runs and lifecycle promotion | Campus director for their campus and current term. Existing manual allocation permissions remain unchanged. |
| Timetable generation, manual drafts, publication and cancellation | Campus director for their campus and current term. No superadmin scheduling override or impersonation is added. |
| Teacher timetable viewing | Existing approved cross-campus and term viewing; this does not grant roster or marking authority. |
| Teaching-staff timetable viewing | Affiliated campus, published entries, with requested department filters narrowed inside that scope. |
| Sensitive class rosters, attendance and exports | Exact delivery authorization; current teacher assignment or applicable department authority, with transactional rechecks on writes. |
| Account deletion and Auth cleanup inspection/retry | Existing superadmin administrative scope; deletion records a durable provider cleanup manifest. |

## Local validation, 2026-11-03

| Check | Result |
| --- | --- |
| Complete regression suite | 162 tests: 161 passed, zero failed, one conditional PostgreSQL test skipped without its database environment. |
| Separate real PostgreSQL suite | All six concurrency scenarios passed on isolated PostgreSQL 18.6, including authorization revocation, competing attendance revisions, promotion versus writes, shared seat limits, visiting-teacher publication and worker claims. The temporary loopback server was stopped afterward. |
| Browser session/cache suite | Five passed in headless Edge: two-tab switching, late previous-account response, logout during refresh, stale visible data and private client navigation. |
| Production builds | NestJS backend and Next.js web passed. Web verification used Next's webpack build mode. |
| Mobile | Type checking and both Android/iOS exports passed with synthetic build configuration. |
| Clean installation and security patches | Lockfile installation in an isolated scratch checkout passed; retained patch exploit regressions passed. |
| SQL packaging and final schema | Generated bundle matches canonical sources; exact bootstrap and bundle restores, readiness failures, final workflow, manual revisions/publication, research semesters and graduation are covered by the passing regression suite. |
| Missing feature upgrade path | Separate owner-run prerequisite bridge tested from lifecycle plus display aggregation, with original and already HOD-restricted assignment policies. Existing premature enrollments remain unchanged; partial installations and unknown policies roll back. |
| Dependency audit | Zero high/critical; 21 moderate and one low flagged packages remain, with exposure and remediation recorded in the advisory register. |
| Lock measurements | Two-campus attendance plus five pairs each for shared allocation, visiting-teacher publication and promotion were measured; the separate proposal states their limitations. |

These results establish local behavior. Staging Supabase Auth/PostgREST/grants, hosted worker restart/cleanup monitoring, physical-device large offline queues and representative production load remain release checks. SQL was not applied to a hosted database, no historical data was repaired, and no deployment was performed.

The code and SQL are local deliverables. Production SQL, email template configuration, deployment, staging Auth/PostgREST checks, physical-device validation, and production measurements require the owner-run rollout. No live repair, affiliation inference, or SQL replay was performed.
