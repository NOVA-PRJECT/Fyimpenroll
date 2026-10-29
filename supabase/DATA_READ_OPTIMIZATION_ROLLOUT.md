# Fetch-once data rollout

Implementation and local verification: 28 October 2026. This change has not been deployed and has not run SQL against the hosted database.

## Owner-run SQL, before deploying the backend

Run **only** [changes/data_read_optimization.sql](changes/data_read_optimization.sql) in the Supabase SQL editor as the project owner. The transaction adds two display aggregation functions and restricts execution to `service_role`:

- `display_enrollment_counts(jsonb)` batches up to 200 delivery keys. A supplied campus counts that delivery; an omitted campus preserves global capacity displays. Repeated slots within a registration count once.
- `display_period_status(jsonb,date)` batches dated attendance totals, enrollment counts and revision tokens for up to 200 slots.

These functions require the already-installed current-term views and attendance-session schema. **Do not rerun `semester_lifecycle.sql`.** Promotion and graduation remain separate operations. No Supabase CLI is required. The baseline bootstrap includes the new file for fresh databases only.

Verify in the SQL editor:

```sql
SELECT
  to_regprocedure('public.display_enrollment_counts(jsonb)') AS enrollment,
  to_regprocedure('public.display_period_status(jsonb,date)') AS period_status;

SELECT
  has_function_privilege('anon', 'public.display_enrollment_counts(jsonb)', 'EXECUTE') AS anon_enrollment,
  has_function_privilege('authenticated', 'public.display_period_status(jsonb,date)', 'EXECUTE') AS authenticated_period,
  has_function_privilege('service_role', 'public.display_enrollment_counts(jsonb)', 'EXECUTE') AS backend_enrollment,
  has_function_privilege('service_role', 'public.display_period_status(jsonb,date)', 'EXECUTE') AS backend_period;
-- Expected: false, false, true, true.

BEGIN;
SET LOCAL ROLE service_role;
SELECT public.display_enrollment_counts('[]'::jsonb) AS counts,
       public.display_period_status('[]'::jsonb, current_date) AS periods;
-- Expected: {}, {}.
ROLLBACK;
```

Then verify a known campus/course/year/semester using a real UUID and compare the result against a direct registration count. Historical rows must remain available through the existing historical APIs; these display helpers use the current-term views deliberately.

## Deployment order and configuration

1. Apply and verify the additive SQL above.
2. Deploy the backend, then web, then the updated mobile app. Existing read JSON bodies remain compatible. The optional `static_unavailable_reason` field distinguishes campus setup restrictions from clock-derived checkpoint status.
3. Use the existing `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Missing Redis configuration or a Redis outage bypasses result caching. Backend authentication, role/scope checks, consent and current-term capture still run before a cached response is used. Cache keys include the verified actor, role, campus, department, semester, term and canonical request filters.
4. The Redis result namespace is isolated by Supabase project URL. It has no freshness TTL; eviction bounds it to 512 serialized entries / 32 MiB, excluding individual entries over 1 MiB. Shared generations fence publication across writes and explicit refreshes. Recovery rotates and removes the previous namespace atomically after an invalidation outage. Committed mutations are never replayed because Redis invalidation failed.
5. Ensure the reverse proxy permits streaming `/api/timetable/progress` responses without buffering. The authenticated stream is scoped to the latest initiated job, campus and current term. It reads Redis, closes on terminal state/disconnect/token expiry (maximum ten minutes), and does not poll the database. The existing job-status endpoint remains available for manual Refresh after disconnects. Existing worker heartbeat writes and stale-worker recovery remain operational.

## User-visible behavior

The shared web and mobile query clients retain datasets throughout in-app navigation. Requests remain at their existing screen/tab/filter entry points: the cache stores only the individual API responses requested there, rather than preloading other tabs or entire dashboard data. First access, a new filter combination, known invalidation and explicit Refresh may request data. Focus, reconnect and elapsed time do not refresh datasets. A full app reload or cache loss can require another initial request. The existing single-endpoint login preload seeds its matching web cache entry; logout/account transitions clear it.

Successful local changes invalidate matching domains. Active consumers reload once through the shared transport; inactive datasets stay invalid until opened. Other users' writes invalidate backend results without reloading this user's open screen. Direct SQL is discovered through each section's **Refresh**, which sends `X-Refresh-Data: 1`, bypasses dependent backend caches and replaces that section's browser result. Manual refresh selects exact URLs with their current filters and calls only the corresponding loaders; it does not broadcast dashboard-wide invalidation. Old in-flight requests cannot overwrite the replacement. A failed refresh retains successful cached data and exposes Retry. Existing section Refresh buttons are retained; inline buttons were added for groups such as Students, Courses and individual rosters. The global top refresh bar has been removed. Shared inline buttons expose the last successful update time in their tooltip; mobile retains its existing pull-to-refresh layout. Save or discard edits to the affected section before refreshing it. Normal Blueprint request cancellation is handled quietly instead of being logged as a console error.

Deadline and campus-checkpoint presentation uses local clocks without network requests. Committed writes still validate current deadlines, attendance revisions, capacity, timetable conflicts and terms transactionally. The manual editor validates on an explicit **Validate changes** action and again on Save/Publish; editing pauses do not trigger preview requests. Allocation uses its POST completion result. Timetable generation reconciles completion once and invalidates affected display results.

## Four implementation stages

1. **Shared caching and duplicate removal:** one web provider/transport and one mobile query policy; scoped Redis result cache; login preload seeding; saved-tab restoration gates; single HOD filter owner; teacher course loads independent of dates; request-local deduplication and verified-settings reuse.
2. **Mutation invalidation and Refresh:** shared dependency definitions in `contracts`, interceptor and database/RPC write hooks, targeted mutation invalidation, section-local Refresh controls with exact URL/filter targeting and Retry, account cleanup, response generation guards, retained successful data and staged-edit protection.
3. **Query batching and manual editor:** additive SQL helpers, delivery seat/count aggregation, weekly teacher input reuse and dated status batching, requested-slot resolution, safe pagination bounds, explicit Validate, and one publication input load with revision/conflict checks preserved.
4. **Progress and verification:** allocation POST completion, authenticated Redis-backed timetable progress stream, one completion reconciliation, retained manual job status Refresh, regression fixtures, production build, mobile type checks, browser checks and this owner-run rollout record.

## Local verification and request counts

Run from the repository root:

```powershell
npm test
npm run build --workspace=frontend -- --webpack
npx tsc --noEmit -p mobile/tsconfig.json
```

The local regression suite passes **120 tests**, including real PGlite execution of aggregation SQL, service-role privileges, restored schema compatibility, attendance revisions, publication conflicts, seat semantics, complete capped pagination, lifecycle history, worker fencing, and separate graduation/promotion behavior. Cache tests exercise concurrent reads/writes, refresh fences, session boundaries, failed refresh retention, exact section/filter targeting (including a cold dataset), request-scoped verified-settings reuse and Redis outage/recovery using a deterministic Redis command model. Dashboard-loading tests cover development effect cleanup/restart, one shared session refresh for concurrent profile/assignment 401s, preserving cached data during an auth-provider outage, and HMR-safe fetch reinstallation. The progress-stream fixture confirms one database job authorization lookup followed by Redis reads and terminal closure.

| Scenario | Previous behavior / fixture | After change |
|---|---|---|
| Three return trips between already-loaded HOD Students and Defaulters tabs | Six dataset requests from mount/tab effects (source-derived baseline) | **Zero** additional dataset requests in browser QA |
| HOD semester filter change | Two fetch paths (source-derived baseline) | **One** request in browser QA |
| Browser focus and online events after initial load | Director/teacher/sign-in refresh paths existed | **Zero** additional dataset requests in browser QA |
| Remote student change while a list remains open | No explicit refresh policy | Remains unchanged; **one** fresh read after Refresh |
| Successful student add on visible list | Separate callback/effect paths | **One** affected list reload in browser QA |
| Enrollment counts for 60 courses | 60 count requests | **One** batched RPC, plus fixed metadata reads |
| Dated status for six teacher periods | 24 per-period reads + four weekly-input reads | **One** status RPC + four weekly-input reads on a cold load; weekly inputs can be reused across dates |
| Unknown API row cap (121 rows, cap 50) | Continuation required | All 121 rows retained; final empty probe retained |

Browser checks ran against the real Next application and a local synthetic API in desktop and narrow Chrome viewports. They included repeated navigation, filter changes, focus/reconnect, external-change simulation, Refresh header propagation and mutation refresh counts, with no page JavaScript errors. The before counts above are source-derived or controlled fixture counts, **not production traffic measurements**. Authentication requests are reported separately from dataset requests.

The final Turbopack browser run also opened teacher and teaching-staff rosters, simulated a remote roster change, and verified that each section's Refresh issued exactly one new roster request with `X-Refresh-Data: 1`, with all other request counts unchanged. The student's existing timetable button produced one new timetable request while the dashboard summary remained at one initial read. Students Refresh left Defaulters and the profile cached. No unopened course dataset was requested. Rapid Blueprint semester changes caused normal cancellations without an AbortError console log or page error. The global refresh region was absent, and the narrow HOD layout was visually checked with Refresh beside the Students actions. The existing development server was left running; browser QA used an isolated source copy under ignored `scratch/`.

The subsequent missing-course investigation found that the Courses effect used `select()` after development cleanup had disposed its loader. The effect now uses a restartable `start()` on setup and known invalidation. Browser verification loaded actual catalogue rows with one initial request, revisited Courses without another request, then fetched changed rows with one explicit Refresh. Mocked initial 401s on profile and assignment reads recovered through session refresh, and assignment course rows rendered successfully. Initial 401 responses can therefore remain visible in DevTools even when their retry succeeds. Fetch-interceptor reinstallation now preserves the original browser fetch through HMR instead of wrapping an earlier interceptor. PWA install-reminder behavior was left unchanged; that reminder was dismissed in the isolated test browser profile.

Not verified locally: native-device rendering, a hosted Redis/Lua integration, reverse-proxy streaming, or live production concurrency/load. Before production acceptance, run the two-client Refresh scenario with real accounts, test account/campus/current-term/historical isolation, force Redis failures in staging, and verify recovery never serves a prior namespace. Measure API request counts, database calls and latency before/after under comparable workloads; no production savings percentage is claimed.

## Rollback

Roll back application releases together if needed. The two additive SQL functions can remain installed; they do not change stored academic data or the lifecycle migration. Do not roll back by rerunning the lifecycle migration. A browser/app reload discards its in-memory dataset cache. Operational cache clearing can rotate the dedicated `fyimp:data:v1:<project-hash>:epoch` namespace; never flush unrelated authentication or worker-progress keys.
