# Data fetching and database read audit

27 October 2026 · workspace revision `48377f3`

Historical baseline audit. Implementation followed on 28 October; see [the implementation, rollout and verification record](../supabase/DATA_READ_OPTIMIZATION_ROLLOUT.md). The findings below describe the code before that implementation.

## Result and scope

Repeated database access is a codebase-wide issue. The web application has no shared data-query cache with freshness rules. Many screens fetch on every mount or tab selection, several handlers issue duplicate requests, and some backend endpoints fan out into queries per course or period. Existing session-storage snapshots mostly reduce loading flashes; they do not suppress background requests.

This is a source audit, with isolated execution of the pagination helper. It is not a production traffic measurement. No production queries, migrations, application behavior changes, commits, or deployments were performed. This report is the delivered change. Temporary inventory and verification scripts are under ignored `scratch/`.

The inventory parsed 254 TypeScript/TSX source files across backend, web, and mobile. It found 110 HTTP route declarations, including 59 GET routes, and 274 Supabase table-builder calls plus 22 RPC call sites in the backend. These include reads, writes, branches, workers, and helpers: they are **not queries per page, executed SQL counts, or evidence of production load**. Contracts, PWA worker behavior, database lifecycle views/RPCs, deployment configuration, and relevant tests were also inspected. The GET coverage appendix lists every inventoried read route. The read-only manual-preview POST was assessed separately.

## Main findings, in implementation priority order

### 1. Duplicate HOD filter requests — high priority

`frontend/src/app/dashboard/hod/page.tsx:261–268` fetches on changes to `activeTab`, `defaulterSemester`, or `studentSemester`. The Students selector at `:793–797` also calls `fetchStudents(nextSem)` directly. The Defaulters selector at `:980–985` similarly calls `handleFetch(nextVal)` directly.

Changing either filter therefore schedules the same read from two places. There is no shared in-flight request to combine them. The effect also depends on both filters, even when only one is relevant to the active tab. Tab restoration can start a default-tab read before the restored tab takes effect.

**Change:** one owner for each query, keyed by the active screen and its relevant filters; update selector state only. Combine concurrent identical requests and ignore responses for obsolete keys. Verify the initial tab-restoration path too.

### 2. HOD and superadmin tab navigation repeatedly reloads unchanged data — high priority

HOD Defaulters and Students reload whenever revisited (`hod/page.tsx:261`). Courses, Blueprint, Faculty Assignment, attendance, and Manual Allocation components mount conditionally (`:963`, `:1084`), so their mount effects run again after tab changes.

The Courses tab has a per-component semester cache, but `createSemesterCatalogue.select()` always calls the loader, and `dispose()` clears the cache (`frontend/src/core/semester-catalogue.ts:13–47`). It preserves rows while refreshing rather than avoiding a read, and it does not survive tab unmounting. Blueprint loads a blueprint, department list, and global semester catalogue (`BlueprintTab.tsx:194–207`, `:280–293`).

Superadmin is particularly clear: `frontend/src/app/dashboard/superadmin/page.tsx:154–160` reloads campuses for Campuses, campuses and departments for Departments, and all three shared lists for Faculty. Each request has its own authentication overhead. The existing row state is not consulted to decide freshness.

**Change:** a shared web query cache above the role pages, with explicit freshness and mutation invalidation. A repeat visit to fresh data should issue no API request. Preserve unsaved forms independently of fetched query data.

### 3. Director and student snapshot caches do not reduce routine backend reads — high priority

Director settings are loaded from session storage and then fetched unconditionally on mount. Every browser focus triggers another fetch, with no freshness gate or in-flight deduplication (`frontend/src/app/dashboard/director/page.tsx:94–152`). The separate timetable page loads the same settings again (`director/timetable/page.tsx:293–315`). Attendance settings and graduation candidates remount and reload when their director tabs are revisited (`director/page.tsx:460`, `:671`).

The student summary follows the same snapshot-then-always-refresh pattern (`frontend/src/app/dashboard/student/page.tsx:57–118`). Returning to the student timetable tab runs its fetch again (`student/StudentDashboardClient.tsx:105–127`). Credit ledgers remount, append a timestamp, and disable HTTP caching (`frontend/src/components/credit-ledger/CreditLedgerView.tsx:94–133`).

**Change:** attach identity, fetched time, and a freshness policy to cached UI data. Share settings between director screens. Revalidate after expiry, a relevant mutation, an explicit Refresh, or an appropriate reconnect/focus event. Focus alone should not discard a still-fresh result.

### 4. Teacher timetable polling calls an expensive combined endpoint — high priority

`frontend/src/app/dashboard/teacher/page.tsx:334–349` loads courses and the schedule when `scheduleDate` changes, then adds another schedule fetch on timetable-tab entry, focus, visibility change, and every 30 seconds while visible. A date change while on Timetable can invoke the schedule loader from both effects. Changing the date also reloads the assigned course list even though the list is not date-dependent.

`backend/src/modules/period-attendance/period-attendance.service.ts:411–578` returns both a weekly timetable and dated attendance status. It reads the teacher, assignments, and weekly entries, then, for every period on that day, calls `getEnrolledRoster()` and queries marks and session revision separately. `getEnrolledRoster()` reads registrations and student profiles (`:580–632`), although the schedule uses only the resulting roster length. Consecutive periods of the same course can repeat the same roster read.

**Illustrative request count derived from source:** with six dated periods, nonempty rosters, fewer than 1,000 weekly entries, a faculty-role metadata fast path, and current consent metadata, one refresh entails approximately 30 Data API requests: two guard reads, teacher and assignments reads, two timetable-page reads, and four reads per period. There is also an Auth `getUser` call. This is not a measured production count; empty results, errors, larger data, and other branches change it.

**Change:** separate weekly timetable data from dated status; cache the weekly data longer. Batch marks and session revisions across slot IDs, and obtain enrollment totals per distinct delivery rather than loading student names for a count. Deduplicate same-delivery work within the request. Preserve visiting-faculty delivery scope and substitution rules. Refresh dated status after attendance writes and on a bounded live interval only where needed.

### 5. Shared pagination adds avoidable empty-page requests — high priority

`backend/src/core/database/pagination.util.ts:24–63` stops only when a page is empty. After a short final page, it requests another range to discover the empty page. `fetchByIdChunks()` uses this helper for every 100-ID chunk (`:67–74`). This behavior affects numerous readers and exports.

Isolated execution of the actual TypeScript helper, using an ES2022 transpilation and a mock query builder, confirmed:

| Matching rows | Current requests |
| ---: | ---: |
| 0 | 1 |
| 1 | 2 |
| 100 | 2 |
| 999 | 2 |
| 1,000 | 2 |
| 1,001 | 3 |
| 2,000 | 3 |

A 150-ID lookup returning one row per ID made four requests across two chunks. The final isolated harness passed all eight scenarios and returned all expected rows.

**Change:** stop on a provably final page. A simple short-page check is safe only if the requested page size is at or below the actual Data API row cap; otherwise a lower configured cap can look like an end-of-results page. Keep complete-cohort guarantees, deterministic ordering, and result-size limits. Test exact-page boundaries, lower server caps, multiple rows per requested ID, and error propagation before changing this shared helper.

### 6. Faculty course lists run one enrollment-count query per course — high priority

`backend/src/modules/faculty/faculty.service.ts:18–91` reloads metadata and then loops over every course or delivery, issuing an exact registration-count query at `:70–79`. Teachers and teaching staff use this endpoint; it is also part of their login preload.

**Change:** return enrollment totals in a batch keyed by course, host campus, academic year, semester, and term. Reuse the existing aggregation approach where compatible, or prepare an owner-run SQL function if the delivery-scoped aggregation needs one. Do not replace per-delivery counts with an accidentally global count. Split relatively stable course metadata from faster-changing enrollment totals.

### 7. Manual timetable previews reload scheduling inputs after editing pauses — high priority

The manual editor sends `/api/timetable/manual/preview` after a 350 ms debounce when entries, mode, or reason change (`frontend/src/app/dashboard/director/timetable/ManualTimetableEditor.tsx:70–92`). Its effect can also preview unchanged initial state after loading.

`ManualTimetableService.preview()` calls `candidate()`, which invokes `load()`: a context RPC followed by the full generation-input loader (`backend/src/modules/timetable/manual-timetable.service.ts:18–85`). The loader reads registrations, student departments, course data, assignments, time slots, and other timetable reservations. Aborting a browser request does not establish that all server database work has stopped. `publish()` also invokes `load()` and then `candidate()`, loading inputs twice (`:104–109`).

**Change:** avoid previewing an unchanged loaded draft; run immediate placement feedback against the already loaded input where appropriate. Server previews can reuse inputs only when tied to a trustworthy revision covering every scheduling dependency. Keep authoritative revision and conflict checks on save/publish, including cross-campus teacher reservations. Reuse the loaded context during publication where its consistency contract allows it.

### 8. Protected requests repeatedly read account and campus context — foundational

`backend/src/core/auth/guards/auth.guard.ts:36` calls Supabase Auth `getUser(token)` for each protected request. The common HOD/director/teacher fast path also reads `faculty` (`:86`), then `campus_settings.term_version` (`:163`). Students similarly read their account and term; superadmins generally read their admin record. Metadata-missing and consent-fallback paths can add reads. Current consent metadata already avoids the consent-table read (`backend/src/core/auth/consent-status.ts:7–13`).

Several handlers then reload overlapping context. Director settings reads faculty, campus, and settings again (`director/director.service.ts:40–63`). Student and registration services similarly reread account/settings information. A common director-settings GET therefore has five Data API reads before optional consent fallback, plus an Auth request.

Frontend middleware performs a session check on protected route navigation (`frontend/middleware.ts:11–19`), while API routes bypass that middleware (`:137–140`) and use backend guards. Thus this is not a middleware session check on every API request.

**Change:** first avoid unnecessary browser requests and reuse already verified data within a request. Cache display data behind authentication separately. A service-result cache placed after the current guard still pays the guard reads; it does not make that request database-free. Any later cross-request auth-context optimization needs an explicit permission-change/revocation design. Preserve account existence, role changes, consent enforcement, password restrictions, and the fresh term captured for transactional writes. Do not use a long-lived display cache as authorization.

### 9. Registration and allocation endpoints mix stable catalogues with live state — high priority

`RegistrationsService.getBlueprint()` combines student preferences and registration, campus settings, blueprints, department maps, resolved course options, allocation status, and seat availability (`registrations.service.ts:211–552`). Slot resolution can query courses independently for each nonfixed slot (`:95–198`). `getAvailableSeats()` resolves an entire pathway before selecting one requested slot (`:1129–1154`). `getMyRegistration()` simply invokes the full blueprint path (`:551`).

After allocation, blueprint loading also reads campus-semester registration slot rows to derive seat totals (`:444–470`). HOD `getRemainingSeats()` loads registrations across campuses to calculate global capacity in JavaScript (`allocation.service.ts:963–983`), and the Manual Allocation screen initially calls both unresolved and remaining-seat endpoints, repeating settings/context work.

**Change:** cache department maps, blueprint structure, and course candidates independently of preferences, seat counts, and allocation state. Resolve only the requested slot when possible. Batch candidate queries, and aggregate capacity in the database rather than transferring the full registration population. Preserve global/shared-course capacity semantics; scoping every count to the local campus would change behavior. Treat availability as advisory and revalidate capacity/eligibility inside the existing transactional write.

### 10. Polling and invalidation policies need consistent limits — medium priority

- Student web campus status polls every 30 seconds while mounted, including a timer with no visibility check, plus focus/online refresh (`student/CampusSignInCard.tsx:43–58`). Status currently reloads the student with campus metadata and today's sign-ins (`campus-attendance.service.ts:253–305`). The UI response also contains time-dependent sign-in eligibility.
- Mobile already has a shared TanStack Query client with five-minute freshness, 24-hour in-memory retention, and account-scoped keys (`mobile/src/lib/query-client.ts:7–68`). It is materially better at repeat-navigation caching than the web. Campus status nevertheless explicitly polls every 30 seconds (`mobile/app/(student)/attendance.tsx:40–45`). Retention is in-memory, not durable offline persistence.
- Mobile queue synchronization invalidates every query after sync, even without demonstrating that an action was submitted (`mobile/src/context/OfflineQueueContext.tsx:43–56`). Network-state notifications can cause unrelated reads. Invalidate only affected domains after actual successful writes.
- Timetable generation polls every 1.5 seconds while queued/running; allocation polls every two seconds while running. These stop after completion, which should be retained (`director/timetable/page.tsx:334–384`, `director/page.tsx:163–191`). Neither loop explicitly pauses for a hidden document or prevents interval overlap.
- Timetable workers write progress to Redis (`solver/job.ts:43–65`), but the status endpoint reads `current_system_logs` (`timetable.service.ts:495–522`). Do not simply use the existing Redis key: it lacks term version and the database read currently prevents concluded-term jobs from reappearing.

**Change:** deduplicate live reads, pause when hidden/offline, prevent overlapping requests, and back off on repeated failures. Split static campus configuration from time-sensitive attendance state. Recompute time-derived UI state at relevant IST boundaries. A very short server status cache can combine simultaneous viewers; any Redis status key must include the active term and retain authoritative terminal-state/recovery behavior.

### 11. Timetable and student readers repeatedly rebuild the same projections — medium priority

Director timetable entries can read publication state, departments, the enrollment audience, and manual/review job metadata before returning a draft or published timetable (`backend/src/modules/timetable/timetable.service.ts:71–174`). `loadTimetableAudience()` separately loads registrations and student departments (`timetable-audience.ts:8–17`). Non-director paths can load campus departments at `timetable.service.ts:79` and again at `:196`. A saved manual editor also reloads generation registrations plus the audience registrations. These are opportunities for request-scoped reuse before shared caching.

Every mobile student courses, attendance, timetable, and overview reader resolves student/settings/registration context again (`backend/src/modules/student/student-portal.service.ts:17–44`). Course detail builds the entire enrolled-course list before selecting one (`:71–74`). Student overview already reuses one context internally, which should be preserved; its campus-status composition nevertheless reads the student again. Credit-ledger rebuilding reads all of that student's retained registrations plus course metadata on each request (`credit-ledger.service.ts:26–53`).

**Change:** share verified context and loaded dependencies within each request, then add scoped reuse for repeated views. Cache stable timetable and history projections separately from current attendance and eligibility. Preserve per-student registration snapshots and historical term identity. Ordinary current-term views still execute their underlying SQL: evaluate their actual query plans before changing function/view structure or adding indexes.

## Existing mechanisms worth retaining

| Mechanism | What it already does | Limitation |
| --- | --- | --- |
| Login dashboard preload | `DashboardEntryService` supplies the first screen payload; `useDashboardEntryFetch` consumes it once. | A one-time handoff, not a reusable freshness cache. |
| Director/student session snapshots | Avoid some blank/loading transitions. | Always revalidate; keys have no built-in fetched-time policy. |
| Courses semester loader | Keeps previous rows, aborts obsolete requests, guards delayed responses. | Always loads on selection and clears on unmount. |
| Mobile query client | Reuses fresh query data across screens; clears queries on logout. | Selected polling and broad invalidation still cause repeat reads. |
| Auth refresh coordinator | Combines simultaneous token rotations and controls retry behavior. | Does not combine ordinary dashboard GETs. |
| Readiness check | `health.controller.ts:18–26` combines in-flight checks and caches for 15 seconds. | Correctly specialized; not an application-data cache. |
| Current-term views | Enforce lifecycle filtering in `supabase/changes/semester_lifecycle.sql:31–42`. | Ordinary views, not stored result caches. |
| Transactional mutation RPCs | Preserve attendance revisions, seat capacity, lifecycle locks, and assignment constraints. | These checks remain authoritative even with cached reads. |
| Service worker | Explicitly bypasses `/api/` in `frontend/public/sw.js:38`. | Not a dashboard cache; do not turn it into a persistent private-data cache. |

Global backend response headers disable HTTP storage (`backend/src/main.ts:35–40`). Those headers do not prevent an authenticated service from reusing an internal result, or the browser application from reusing its own in-memory query data. Removing the headers by itself is not the proposed fix.

`useCurrentTime()` and UI countdown timers change local state; they do not fetch the database. Worker recovery, audit delivery, login/password operations, and deliberate report exports are separate workloads. Do not label every timer or every repeated validation query as waste.

## Recommended cache policy

These are proposed initial values, not implemented settings or measured optimal values. Same-browser writes should update or invalidate affected data immediately; TTL bounds staleness from other users, direct administrative changes, and missed invalidations.

| Data | Browser freshness | Backend result reuse | Refresh/invalidation |
| --- | --- | --- | --- |
| Campuses, department maps, course metadata, blueprints | 5–15 min | 5–15 min, scope-specific | Matching CRUD; broader catalogue invalidation for cross-campus/global options. |
| Director display settings, campus attendance configuration | 30–60 sec | 30–60 sec | Settings saves, campus edits, promotion; derive deadline state from time. |
| Student and faculty lists, stable class rosters | 1–5 min | 30–120 sec | Account changes, registration/allocation changes, assignment changes, promotion/graduation. |
| Published timetable / stable weekly schedule | 5–15 min | 1–5 min | Publish, teacher substitution, assignment changes, term changes. Drafts need revisions and shorter reuse. |
| Defaulters, enrollment totals, unresolved allocations | 15–30 sec | 5–15 sec if needed | Registration submit/change, allocation, student edits, promotion. |
| Student summary and credit ledger | 1–5 min for stable parts | 30–60 sec for personalized assembled result | Registration/allocation/course changes, promotion/graduation; separate window state. |
| Seat availability, live attendance, dated revisions | Short or explicit fresh read at interaction | None or carefully bounded seconds for read-only display | Successful writes; fresh validation at submit/sign-in/save. |
| Running job status | Live, only while needed | 1–2 sec with term-aware keys | Worker progress/completion/failure, new jobs, promotion. |
| Session/authorization and write decisions | Separate security policy | Do not put into the display-result cache | Preserve current verification and transactional checks. |
| Exports | Explicit user action | Initially fresh; reuse static reference data internally | Keep scope, completion, history, and report correctness. |

Use a single browser query client, preferably the same TanStack Query model already used by mobile. Set per-domain freshness explicitly: its defaults otherwise treat cached results as stale, and periodic polling runs independently of freshness. See the official [freshness/defaults documentation](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults) and [targeted invalidation documentation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation).

On the backend, introduce an explicit bounded result-cache service for selected readers. It should combine concurrent identical loads, expire and evict entries, avoid caching failures, and prevent an old in-flight load from repopulating a key after invalidation. A bounded process cache can help the configured single-process deployment, but it is lost on restart and does not coordinate instances. Shared Redis requires shared invalidation/versioning; existing Redis dependencies alone do not supply that behavior. An outage fallback must not return data beyond the promised freshness/scope contract.

Keys must include every response dependency: service/environment namespace, role and actor where personalized, campus, department, academic year, semester, term version, date, delivery/course/student, filters, and catalogue scope as applicable. Do not cache a fully assembled teacher/student/HOD response under campus alone. Preserve current visiting-teacher visibility and history access.

The browser cache must survive component unmounts but be cleared on login/account transition/logout and definitive session rejection. Keep current refresh-race and BFCache protections. Clear sensitive views on session rejection; a cached result never grants access to a write or bypasses a server guard. Avoid indiscriminate persistence of student records, location data, or attendance in local storage.

## Mutation invalidation map

| Successful mutation | Data to update or invalidate |
| --- | --- |
| Campus create/edit/delete | Campus lists/settings, departments/faculty projections, setup state and affected dashboards. Cascades require broader invalidation. |
| Department CRUD | Department maps, faculty/course projections, blueprint options/readiness, affected rosters/timetables. |
| Faculty/teacher create/edit/delete | Faculty lists/profiles, assignments, class/schedule permissions and names, affected timetable and roster projections. |
| Course create/edit/delete | Own/global catalogues, blueprint options/readiness, student course/registration projections and affected credit displays. Preserve registration snapshots. |
| Blueprint save | Department-semester blueprint/readiness, pathway candidates, registration display/eligibility. |
| Student add/edit/remove/bulk upload | Relevant lists, defaulters, roster/enrollment projections, personalized summaries/ledgers and affected allocation data. |
| Registration submit/slot change | Student registration and summary/ledger, defaulters, per-delivery/global counts, seats, unresolved allocations, rosters and timetable audiences. |
| Algorithm/manual allocation or failed-run clearing | Status, unresolved/seat/count data, affected student registrations, summaries/ledgers, audiences and rosters. |
| Assignment/reassignment/removal/substitution | Assignments, per-teacher schedules/authority, student course teacher names, timetable projections and affected class rosters. Include other host campuses for visiting faculty. |
| Period attendance submit/copy | Affected dated marks/revisions, teacher daily status, HOD attendance views, student attendance totals/overview. |
| Campus sign-in | Student status/overview and campus/department roster for the IST date. |
| Director registration settings | Display settings, window state, registration candidates/summary and generation eligibility; write-time decisions still use current state. |
| Attendance/geofence settings | Campus attendance configuration/status/rosters and setup projections. |
| Timetable save/publish/generate | Draft revision/status, timetable views and schedules across affected roles/campuses; publication-related state. |
| Promotion | All current-term data for the campus, affected student profiles/summaries and any cross-campus schedule dependencies. History remains accessible under historical keys. |
| Graduation deletion | Deleted students' data plus lists/counts, roster/history projections and permissions affected by the deletions. This remains separate from promotion. |
| Login/logout/password/consent/account role changes | Clear/revalidate relevant session/account data and browser query state; preserve verified permissions. |

Invalidate only after a confirmed commit. For an ambiguous write result, force a fresh read before retrying or displaying success. Background worker writes and cascaded/RPC mutations must participate, not just controller CRUD methods. TTL remains necessary for changes outside the application unless those are incorporated into a reliable invalidation mechanism.

## Delivery sequence and acceptance criteria

1. **Remove direct duplicates:** HOD filter handlers, date-independent teacher course fetches, redundant teacher schedule effects, and initial unnecessary manual previews. Correct pagination only with full-row guarantees verified.
2. **Add the shared web query layer:** start with HOD, superadmin, director settings, and student summary/timetable/ledger. Wire mutation invalidation and session clearing in the same delivery. Prime it with the existing login preload.
3. **Batch the expensive endpoints:** faculty counts, teacher dated status, registration candidates/seat aggregation, and repeated manual scheduling inputs. Request-level deduplication can help before introducing shared caching.
4. **Add selected server caches:** reference/catalogue data first, then short result reuse for expensive scoped reads. Keep auth and mutations outside generic display caching. Establish shared behavior before multiple instances.
5. **Tune live refreshes:** visibility/online checks, one request in flight, backoff, time boundaries, and targeted mobile invalidation.
6. **Measure:** route requests, Data API/Auth calls per request, cache hits/misses, load duration, and p50/p95 endpoint latency. Do not log JWTs, raw cache payloads, student details, or location coordinates. Inspect real query plans before adding indexes; the existing schema already includes lifecycle indexes. See [Supabase query optimization](https://supabase.com/docs/guides/database/query-optimization).

Required verification for implementation:

- Returning to an unchanged fresh tab causes zero API requests for its data, including after component remount.
- Changing one filter causes one request per uncached key; simultaneous consumers share it; slow previous results cannot overwrite a new selection.
- Expiry causes at most one revalidation; explicit Refresh bypasses browser and selected server result caches after in-flight older responses are fenced out.
- Successful mutations invalidate the dependency map; failed mutations do not populate success data. Concurrent mutation/read tests prevent stale cache resurrection.
- Switching account, role, campus, semester, year, delivery, or term cannot reuse an incompatible result. Visiting-faculty and historical access retain their current scope.
- Permission revocation, deleted accounts, consent/password restrictions, and logout races remain enforced. A server cache hit never skips the guard.
- Promotion clears current-term results while keeping history; graduation stays independent and removes deleted-account projections.
- Attendance revisions, live seat capacity, manual timetable revisions, deadline closure, and IST date/window boundaries remain correct.
- Hidden/offline screens stop unnecessary polling; retries do not overlap or loop on permission errors.
- Counted requests fall for the identified navigation/polling paths. Production reduction percentages require actual before/after measurements.

Substantial SQL work should be delivered as an owner-run file with verification instructions, consistent with this repository's lifecycle rollout workflow. No existing lifecycle migration should be rerun for this audit.

## GET route coverage

All entries below include guard overhead unless public health routes. Policies refer to the proposed display/read policy above, not current implemented caching. Controller references identify the inventoried handler; service findings above describe the expensive paths.

| Route | Recommended handling | Controller |
| --- | --- | --- |
| `/api/admin/campuses` | Reference cache; invalidate campus CRUD. | `backend/src/modules/admin/admin.controller.ts:67` |
| `/api/admin/departments` | Reference cache; invalidate department/campus CRUD. | `backend/src/modules/admin/admin.controller.ts:104` |
| `/api/admin/faculty-list` | Scoped list cache; invalidate account/department/campus changes. | `backend/src/modules/admin/admin.controller.ts:147` |
| `/api/admin/campus/graduation-candidates` | Short candidate cache; confirm fresh eligibility on deletion. | `backend/src/modules/admin/admin.controller.ts:226` |
| `/api/admin/logs` | Short filtered result reuse; preserve pagination and current audit reporting. | `backend/src/modules/admin/admin.controller.ts:232` |
| `/api/allocation/status` | Term-aware 1–2 sec running-status reuse; stop idle polling. | `backend/src/modules/allocation/allocation.controller.ts:34` |
| `/api/allocation/unresolved` | Short cache; invalidate registration/allocation/student changes. | `backend/src/modules/allocation/allocation.controller.ts:56` |
| `/api/allocation/remaining-seats` | Short advisory availability; batch capacity aggregation; fresh write validation. | `backend/src/modules/allocation/allocation.controller.ts:66` |
| `/api/assignments/history` | Scoped historical cache; invalidate affected assignment/lifecycle changes. | `backend/src/modules/assignments/assignments.controller.ts:29` |
| `/api/assignments/courses` | Reference/assignment cache; invalidate course, faculty, and assignment changes. | `backend/src/modules/assignments/assignments.controller.ts:38` |
| `/api/auth/session` | Fresh security verification; reuse verified context within the request. | `backend/src/modules/auth/auth.controller.ts:101` |
| `/api/auth/profile` | Cache display profile by account; keep session/permission checks fresh. | `backend/src/modules/auth/auth.controller.ts:182` |
| `/api/attendance/campus/status/:studentId` | Split static configuration from dated/time-sensitive status. | `backend/src/modules/campus-attendance/campus-attendance.controller.ts:65` |
| `/api/attendance/campus/roster` | Short dated roster cache; invalidate sign-ins, student/config/term changes. | `backend/src/modules/campus-attendance/campus-attendance.controller.ts:78` |
| `/api/consent/status` | Security state; preserve policy-version verification. | `backend/src/modules/consent/consent.controller.ts:24` |
| `/api/credit-ledger/me` | Account/term-aware ledger cache; invalidate registration, catalogue, and lifecycle changes. | `backend/src/modules/credit-ledger/credit-ledger.controller.ts:22` |
| `/api/credit-ledger/:studentId` | Actor-authorized target ledger cache; preserve teacher-specific projection. | `backend/src/modules/credit-ledger/credit-ledger.controller.ts:32` |
| `/api/export/registrations` | Explicit fresh report; reuse reference data internally; preserve export scope and complete cohorts. | `backend/src/modules/credit-ledger/export.controller.ts:35` |
| `/api/export/unresolved-allocations` | Explicit fresh report; reuse reference data internally; preserve export scope and complete cohorts. | `backend/src/modules/credit-ledger/export.controller.ts:60` |
| `/api/export/class-roster` | Explicit fresh report; reuse reference data internally; preserve export scope and complete cohorts. | `backend/src/modules/credit-ledger/export.controller.ts:81` |
| `/api/export/timetable` | Explicit fresh report; reuse reference data internally; preserve export scope and complete cohorts. | `backend/src/modules/credit-ledger/export.controller.ts:104` |
| `/api/export/period-attendance` | Explicit fresh report; reuse reference data internally; preserve export scope and complete cohorts. | `backend/src/modules/credit-ledger/export.controller.ts:129` |
| `/api/export/gps-signins` | Explicit fresh report; reuse reference data internally; preserve export scope and complete cohorts. | `backend/src/modules/credit-ledger/export.controller.ts:156` |
| `/api/export/credit-ledger/:studentId` | Explicit fresh report; reuse reference data internally; preserve export scope and complete cohorts. | `backend/src/modules/credit-ledger/export.controller.ts:181` |
| `/api/director/attendance-settings` | Campus configuration cache; invalidate save/campus changes. | `backend/src/modules/director/director.controller.ts:22` |
| `/api/director/settings` | Shared director display cache; reuse guard context; derive deadline from clock. | `backend/src/modules/director/director.controller.ts:33` |
| `/api/faculty/courses` | Split metadata from counts; batch per-delivery enrollment totals. | `backend/src/modules/faculty/faculty.controller.ts:20` |
| `/api/faculty/attendance` | Delivery-aware roster cache; invalidate enrollment and assignment changes. | `backend/src/modules/faculty/faculty.controller.ts:25` |
| `/api/faculty/defaulters` | Short department/filter cache; invalidate submission/student/lifecycle changes. | `backend/src/modules/faculty/faculty.controller.ts:30` |
| `/api/health` | No database read. | `backend/src/modules/health/health.controller.ts:15` |
| `/api/health/ready` | Existing 15 sec result cache and in-flight deduplication. | `backend/src/modules/health/health.controller.ts:18` |
| `/api/hod/catalog-readiness` | Department reference cache; invalidate blueprint/course changes. | `backend/src/modules/hod/hod.controller.ts:111` |
| `/api/hod/blueprint` | Department/semester cache; invalidate blueprint changes. | `backend/src/modules/hod/hod.controller.ts:117` |
| `/api/hod/courses` | Scope/filter-aware catalogue cache; invalidate course/department changes. | `backend/src/modules/hod/hod.controller.ts:143` |
| `/api/hod/departments` | Campus department cache; invalidate department/campus changes. | `backend/src/modules/hod/hod.controller.ts:184` |
| `/api/hod/students` | Department/filter list cache; invalidate student/lifecycle changes. | `backend/src/modules/hod/hod.controller.ts:190` |
| `/api/hod/export-students-excel` | Delegates to final-registration JSON export; explicit fresh export with shared reference data. | `backend/src/modules/hod/hod.controller.ts:238` |
| `/api/hod/teachers` | Department faculty cache; invalidate teacher changes. | `backend/src/modules/hod/hod.controller.ts:244` |
| `/api/attendance/export/statement` | Explicit fresh report; reuse reference data internally; preserve export scope and complete cohorts. | `backend/src/modules/period-attendance/attendance-export.controller.ts:21` |
| `/api/attendance/period/current` | Time-sensitive display; batch repeated roster/marks reads; boundary-aware refresh. | `backend/src/modules/period-attendance/period-attendance.controller.ts:33` |
| `/api/attendance/period/teacher-schedule` | Split cached weekly schedule from batched dated attendance status. | `backend/src/modules/period-attendance/period-attendance.controller.ts:39` |
| `/api/attendance/period/slot-marks` | Fresh editor revision on open/save; optional short display reuse only. | `backend/src/modules/period-attendance/period-attendance.controller.ts:48` |
| `/api/attendance/period/roster` | Split stable enrollment roster from dated marks/revisions. | `backend/src/modules/period-attendance/period-attendance.controller.ts:104` |
| `/api/attendance/period/slots` | Split stable slots from dated marking status; short display reuse. | `backend/src/modules/period-attendance/period-attendance.controller.ts:117` |
| `/api/attendance/period/export/statement` | Explicit fresh report; reuse reference data internally; preserve export scope and complete cohorts. | `backend/src/modules/period-attendance/period-attendance.controller.ts:133` |
| `/api/registrations/blueprint` | Split cached blueprint/catalogue from personal preferences and live seats. | `backend/src/modules/registrations/registrations.controller.ts:24` |
| `/api/registrations/my` | Currently calls full blueprint path; narrow personal state reader or reuse keyed result. | `backend/src/modules/registrations/registrations.controller.ts:29` |
| `/api/registrations/pathway-slots` | Cache department/semester/pathway candidates; invalidate catalogue/blueprint. | `backend/src/modules/registrations/registrations.controller.ts:34` |
| `/api/registrations/available-seats` | Resolve requested slot only; cache candidates separately; fresh transactional capacity. | `backend/src/modules/registrations/registrations.controller.ts:58` |
| `/api/student/overview` | Compose reused context/schedule with short attendance/status data. | `backend/src/modules/student/student.controller.ts:48` |
| `/api/student/courses` | Account/semester/term cache; invalidate registration, catalogue, assignments. | `backend/src/modules/student/student.controller.ts:53` |
| `/api/student/courses/:id` | Reuse enrolled-course context; avoid rebuilding all course details for one item. | `backend/src/modules/student/student.controller.ts:58` |
| `/api/student/attendance` | Short dated/term result cache; invalidate marks and enrollment changes. | `backend/src/modules/student/student.controller.ts:63` |
| `/api/student/timetable` | Scoped published schedule cache; invalidate publication/substitution/enrollment. | `backend/src/modules/student/student.controller.ts:68` |
| `/api/student/dashboard-summary` | Cache stable personal summary; split clock-derived registration-window state. | `backend/src/modules/student/student.controller.ts:73` |
| `/api/timetable/manual` | Revision-bound editor context; share stable inputs with preview when revision permits. | `backend/src/modules/timetable/timetable.controller.ts:29` |
| `/api/timetable/constraints` | Handler reads repository rules, not DB; guard still queries DB. Cache parsed rules. | `backend/src/modules/timetable/timetable.controller.ts:62` |
| `/api/timetable/entries` | Role/audience/term-aware timetable cache; invalidate draft/publication/enrollment changes. | `backend/src/modules/timetable/timetable.controller.ts:94` |
| `/api/timetable/job-status` | Term-aware short status cache; existing Redis payload cannot be used unchanged. | `backend/src/modules/timetable/timetable.controller.ts:120` |

The manual-preview POST is a computational read and is included in finding 7 despite not appearing in the GET inventory. Other mutations, worker progress/recovery, audit writes, and authentication were reviewed for their dependency and freshness requirements rather than treated as interchangeable cacheable requests.
