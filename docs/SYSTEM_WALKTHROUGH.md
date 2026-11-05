# How Fyimpenroll works

Developer's study guide for the code on `main` at `5d05294`. The examples use invented people, courses and numbers. This explains the repository implementation. The version running on a particular campus depends on its deployed application and SQL.

Read sections 1–4 together first. They follow one student from identity to enrollment. Sections 5–8 explain how that enrollment becomes a timetable, a set of attendance records and a historical ledger. Sections 9–11 explain what happens when a device disconnects, two people act at once, or a service restarts. Use the [implementation reference](SYSTEM_REFERENCE.md) to jump from any HTTP operation to its real handler or look up a database field.

## 1. Follow one click through the stack

Imagine Mira selects three electives and presses **Submit**. Five pieces of software have different jobs.

| Piece | What happens to Mira's request |
|---|---|
| Next.js web portal or Expo mobile client | A screen collects the user's input. The web registration form translates paper selections into an API request. Mobile offers a smaller set of screens and shares the backend for the operations it exposes. |
| Web routing and session layer | A browser request to the portal's own `/api/...` path is forwarded to the NestJS API. Same-origin cookies travel with applicable browser requests. The native API client calls the backend origin with a bearer token. |
| NestJS controller and guards | The controller matches the HTTP method and path. Guards verify the person and permitted roles. The handler interprets and validates input. A student cannot make a director operation legal by changing a URL or adding a role to JSON. |
| NestJS service | The service gathers the relevant student, campus settings, semester blueprint and courses. It computes whether those choices are eligible and constructs a command using trusted values. |
| Supabase Auth and PostgreSQL | Auth establishes the account identity. PostgreSQL holds the academic records. A database function performs the related writes together. The result travels back to the screen, which can then display the submitted state. |

```text
Browser form → POST /api/registrations/submit → RegistrationsController
  → authenticated student → RegistrationsService → termOperation
  → run_current_term_operation → submit_student_registration
  → preference row + pending registration row → commit → response
```

Four terms recur throughout this guide. A **controller** is the HTTP entrance. A **service** implements an operation. An **RPC** calls a named database function with arguments. A **transaction** gives several database writes one outcome. If a required check fails, the database rolls the writes back. That guarantee applies within that transaction. An email, an Auth admin call and a SQL write are separate actions unless the implementation explicitly coordinates them.

Study this path in order. [Web registration form](../frontend/src/app/dashboard/student/register/page.tsx) · [Controller](../backend/src/modules/registrations/registrations.controller.ts) · [Service](../backend/src/modules/registrations/registrations.service.ts) · [Term wrapper](../backend/src/core/database/term-operation.ts) · [Submission SQL](../supabase/changes/preferences_before_allocation.sql)

### The identities you need to keep straight

* **Account ID** answers “who signed in?” A student or faculty profile connects that ID to the academic system.
* **Campus and department IDs** answer different questions. A course has a home department. A teacher may deliver a course at another campus. Where a paper belongs, where it is taught, and who may mark it can differ.
* **Academic year and semester** describe the cohort. **Term version** identifies the campus lifecycle instance. A request prepared before promotion can mention a perfectly valid course but carry an obsolete term version.
* **Course ID** identifies a catalogue item. **Delivery** adds campus, academic year, semester and, where applicable, term version. **Timetable entry ID** identifies a scheduled occurrence in the weekly pattern. **Entry ID plus actual date** identifies the class meeting for attendance.
* **Paper slot** means a component in a student's registration, e.g. `slot_2_course_id`. **Time slot** means a day and period, e.g. Tuesday P4. Allocating a paper fills the former. Scheduling a class assigns the latter.

If Mira asks “am I in Tuesday's class?”, a course title alone cannot answer. First find her confirmed course ID, then the matching published delivery, then its day and period. To answer “was I present?”, also select the date and the mark for her student ID. [Student portal queries](../backend/src/modules/student/student-portal.service.ts) · [Delivery authority](../backend/src/core/auth/delivery-authority.ts)

## 2. Auth, consent and the six roles

**Login.** The backend checks attempt limits by IP and normalized email, then asks Supabase Auth to verify the password. A successful login returns a provider user ID and session. The application resolves that ID against its academic profiles, checks password-change and policy-consent status, and determines a destination. A valid provider account with no usable portal profile cannot proceed as an ordinary portal user. The web controller sets HTTP-only access and refresh cookies. The response also includes tokens for clients that establish their own session. A login may preload dashboard data to avoid repeating the first read.

**Subsequent requests.** The web routing layer can direct a user to login, password change, consent, a role dashboard or a service-unavailable screen. The API independently verifies protected requests. An Auth user lookup verifies the token; profile and campus lookups establish current authority. A role hint in trusted application metadata can narrow the lookup. The guard also checks restrictions such as a required password change. The roles decorator is only the first authorization question. A teacher who passes a teacher-only route must still be authorized for the requested class.

**Consent.** The server compares the accepted policy version with its current constant. Accepting writes a dated `consent_records` row and attempts to cache the version in Auth application metadata. A client submitting an obsolete policy version gets an error. This lets a new policy require consent again without creating a new account. [Login service](../backend/src/modules/auth/auth.service.ts) · [Auth guard](../backend/src/core/auth/guards/auth.guard.ts) · [Web routing](../frontend/middleware.ts) · [Consent](../backend/src/modules/consent/consent.service.ts)

| Role | What to explain to someone using that account |
|---|---|
| Student | Can submit their own pathway choices, see confirmed courses, published timetable, attendance and registered credits, and sign in on campus. Their identity comes from the session. |
| Teacher | Sees assigned teaching work. The timetable viewing policy permits cross-campus viewing for assigned courses. Sensitive operations such as marking attendance check the actual delivery. |
| Teaching staff | Has a distinct role for scoped viewing and rosters. Being able to see a schedule gives no right to submit marks. |
| HOD | Manages the home department's catalogue, blueprints, students and teachers. Owns assignment mutations. Has departmental oversight, including registration follow-up and authorized attendance work. |
| Campus director | Controls campus registration settings and deadline, starts allocation and timetable generation, publishes schedules and promotes the campus. Course management and teacher assignment have their own owners. |
| Superadmin | Manages university-level structure, administrative faculty, logs and authorized reports. Some operations deliberately require a specific operational role, such as the director for promotion or the HOD for assignment edits. |

**A concrete permission test.** Suppose a teacher is assigned Chemistry at campus A. A request to mark campus B's Chemistry class includes a real teacher token and a real course ID. The service resolves the requested entry and checks the assignment against its delivery. SQL checks authority again at the write. Without a matching assignment it refuses. This matters if an HOD revokes an assignment while the old teacher still has a roster open. [Authorization policy](../backend/src/core/auth/authorization-policy.ts) · [Attendance SQL](../supabase/changes/review_integrity.sql)

**Changing a password, recovering one, refreshing and logging out are four flows.** An authenticated password change verifies the user's change request and applies the password policy. Recovery starts with an email link containing a one-use token hash. On submission, the backend verifies that token specifically as recovery and takes the account ID from the provider response. Password screening happens before consuming the token. If the password changes but profile synchronization fails, a trusted pending-sync flag permits a separate retry. Refresh exchanges session credentials; the browser coordinates simultaneous refresh requests to avoid racing them. Logout ends the local session, clears account-specific caches and signals other tabs. [Password operations](../backend/src/core/security/account-password.service.ts) · [Recovery page](../frontend/src/app/reset-password/confirm/page.tsx) · [Refresh handling](../frontend/src/core/security/refresh-coordinator.ts)

## 3. Admin, HOD and director setup

Before Mira can choose a course, several people have supplied different inputs.

1. **Admin** creates the campus, departments and authorized faculty accounts. Structural deletion has consequences beyond a table row. For supported admin deletions, SQL checks external dependencies, records the Auth accounts to clean up, and deletes domain records in a transaction. The worker processes that cleanup list. If Mira's department lends a teacher to a course in another department, removing the teacher's home department can be refused. If the Auth provider is temporarily unavailable after a permitted deletion, there is a durable task to retry. [Admin service](../backend/src/modules/admin/admin.service.ts) · [Deletion guards](../supabase/changes/review_workflow_fixes.sql)
2. **HOD** maintains course code, category, credits, prerequisites as guidance, theory/practical contact hours and the semester blueprint. The blueprint is a set of pathways with component rules. The catalogue describes what a course *is*; the blueprint determines which courses a student can choose for a particular component. The HOD also manages students and teachers. Bulk student creation has a limit of 100 rows and reports success or errors per row. It creates the Auth identity and writes a scoped profile; on a profile-write error it attempts to delete the new identity. A successful import of 97 rows and three rejected rows is a possible result. [HOD service](../backend/src/modules/hod/hod.service.ts) · [Course eligibility](../backend/src/core/utils/slotRules.ts)
3. **Director** sets campus registration controls, including the academic year, deadline and credit settings, and configures campus attendance geography and times. An open window permits eligible submissions. Closing it provides a stable point for allocation. Making the deadline earlier does not itself allocate anyone. [Director service](../backend/src/modules/director/director.service.ts)
4. **Assignments** connects a faculty ID to a particular course delivery. The HOD can assign, reassign, remove or batch changes; the backend sends changes through the database mutation routine. Reassignment can affect timetable entries and authority to see or mark a roster, so independent client-side edits to unrelated lists would be unsafe. Assignment history and the set of current assignments serve different views. [Assignment service](../backend/src/modules/assignments/assignments.service.ts) · [Mutation wrapper](../backend/src/core/database/teacher-mutations.ts)

## 4. Registration and allocation, worked by hand

**Registration decides which requests are valid.** The student selects a pathway and ranks choices for its papers. The service resolves the student's current semester and campus, loads the applicable blueprint, checks the window and validates the selections against the catalogue. A pathway supports one to eight components. An elective slot accepts up to three ranked choices. The service rejects invalid ranks, repeated ranks and duplicate choices within a slot, and checks first-choice duplication across papers.

The eligibility predicate depends on the rule. A fixed paper must match the configured course code. A department-restricted paper uses the eligible departments and permitted categories. A pool-restricted paper selects a DSE in the student's department. A global basket selects its configured category; an MDC basket also excludes the student's own department. The semester check applies before the slot-specific predicate. Ranking an ineligible paper third still fails validation. The service computes core credits from fixed and first-choice papers and checks the blueprint's limits, falling back to campus settings and then defaults. Additional papers are accounted for separately. [Slot rules](../backend/src/core/utils/slotRules.ts) · [Registration validation](../backend/src/modules/registrations/registrations.service.ts)

**What the successful submit actually writes.** One row in `registration_preferences` stores Mira's choices and first submission time. A row in `student_registrations` anchors her cohort and pathway with pending metadata, zero enrolled credits and empty confirmed slots. A valid edit updates preferences while preserving the first submission timestamp. Even a fixed paper is pending at this point. A screen can therefore show “submitted” while a class roster correctly contains zero people.

**Allocation decides who receives seats.** The director requests a run for a campus, academic year and semester. The API returns a queued job ID. The worker loads eligible submissions, course data and existing enrollment. Shared courses require counting occupied seats across campuses. Fixed choices are resolved in memory first and seats already occupied by the same enrollment must not be deducted a second time. Electives use three rank-first rounds.

```text
for rank in [1, 2, 3]:
    consider unresolved elective slots that have a choice at this rank
    group eligible candidates by course
    order each group by score descending, first submission ascending, student ID ascending
    consider up to the available seats; recheck duplicates, assign winners, decrement seats
carry unresolved slots into the next round
```

The implemented score is `max(0, student.current_semester − course.semester)`. With ordinary same-semester choices, candidates tie on score, so original submission time matters. The final ID comparison makes exact-time ties deterministic. A rank-2 candidate does not outrank a rank-1 candidate by having submitted earlier. [Allocation loop](../backend/src/modules/allocation/allocation.service.ts)

| Example, equal scores | Rank 1 | Rank 2 | Result |
|---|---|---|---|
| Mira submitted at 09:00 | Design | Media | Receives the one available Design seat in round 1. |
| Ravi submitted at 09:01 | Design | Media | His Design slot stays unresolved after round 1. He receives Media in round 2 if a seat remains after everyone's first choices. |
| Leena submitted at 09:02 | Media | Design | Takes a Media seat in round 1. If that was the last Media seat, Ravi cannot displace her. |

The worker's result is a proposal until SQL commits it. The commit validates the run, its worker token and relevant enrollment constraints, updates confirmed slots, credits and allocation metadata, and records the run outcome. A concurrent allocation elsewhere can consume a shared seat between reading capacity and committing. The database can reject the stale proposal. Once committed, Mira's registration can feed a class roster. Unresolved slots remain identifiable for manual resolution. The manual-allocation and student slot-change routes have distinct permissions and rules. A seat shown as available when a user opened a screen is checked again on write. [Allocation SQL](../supabase/changes/preferences_before_allocation.sql) · [Concurrency tests](../tests/review-postgres.test.cjs)

## 5. Timetable generation, fallback and publication

Allocation answers “who takes the course?” The timetable answers “when can those people and teachers attend it?” The input loader needs actual enrollment, teaching assignments, weekly contact hours, time slots, parallel baskets, applicable rules and existing teacher reservations. A course shared across departments may have a different teaching audience from its owner department.

1. **Request.** The director selects the cohort and submits structured rules. The API checks scope and publication state and queues generation. The worker stores the effective rule set and hash with the job so its choices can be inspected later.
2. **Model.** Python turns contact hours into required sessions. A Boolean decision variable means “place this session at this candidate start.” A two-period practical occupies both periods. For example, P3 followed by P4 crosses lunch, so it is not a valid two-period lab placement. Other candidate starts may be excluded by course-specific windows or existing reservations.
3. **Constraints.** If Mira takes both Design and Statistics, their sessions cannot occupy the same period. Two classes sharing a teacher also conflict. Published commitments at other campuses can rule out a period even if the local grid looks empty. Parallel baskets can require matching occupied periods. The solver also scores preferences such as avoiding extended P6 and spreading theory hours. Hard constraints exclude solutions; a soft penalty makes one feasible solution less desirable than another.
4. **Verification.** The Node worker receives the Python result and independently validates it. A complete valid schedule can be atomically staged as a draft. A full search that is infeasible or inconclusive can lead to a partial search, with unscheduled sessions explicitly recorded. A completed *job* can therefore mean “review draft available.” The director still has to publish a schedule before students use it.
5. **Manual fallback.** Where a generation attempt failed or produced an incomplete draft, the director loads the editor. Its revision represents the scheduling inputs. If an assignment or other relevant input changes after the editor opens, save/publish can fail with a conflict. Preview evaluates a proposed edit. Saving persists it. Strict mode enforces rule checks; the explicit override path records a reason and requires acknowledgement at publication of exceptions or missing hours. The editor does not grant ownership of teacher assignment.
6. **Publication or research-only outcome.** Publication makes the cohort timetable operational, with checks on the committed delivery and occupancy. Published cohorts are protected against ordinary regeneration. A closed, allocated cohort whose selected courses all have verified zero classroom hours can instead finalize as `not_required`. A mixed cohort still needs a timetable. A finalized research cohort has neither invented classes nor attendance marks.

**Test your model.** Two papers each need one weekly period. There are two legal periods and one shared teacher. Placing both papers in P1 violates a hard constraint. Putting one in P1 and one in P2 can work. Now reserve P2 for that teacher at another campus: the available period count still looks like two on the local grid, but the complete problem is infeasible. Adding more solver time cannot make those conditions compatible. [Input loader](../backend/src/modules/timetable/solver/loader.ts) · [Python model](../backend/src/modules/timetable/solver/ortools_solver.py) · [Validator](../backend/src/modules/timetable/solver/validator.ts) · [Job orchestration](../backend/src/modules/timetable/solver/job.ts) · [Manual editor service](../backend/src/modules/timetable/manual-timetable.service.ts) · [Scheduling SQL](../supabase/changes/review_scheduling.sql)

## 6. Period attendance and campus attendance

**Period attendance asks who attended a particular class meeting.** The teacher chooses a scheduled entry and date. The service validates that date against the scheduled weekday and active delivery, checks marking authority, and resolves enrolled students. The UI receives marks and a revision. It submits absent IDs and the expected revision. The server reconstructs the roster and the database checks it again within the transaction. Fabricating a student ID, omitting part of a roster or relying on a revoked assignment cannot legitimately change marks.

Suppose the roster is Mira, Ravi and Leena and the current revision is 0. The teacher submits Ravi as absent. A successful write records the students' marks and the session summary together: two present, one absent, three enrolled. The next edit must use the current revision. If another device still submits revision 0, its edit conflicts. Without this check, a teacher correcting Mira's mark could silently erase a correction made by a colleague. The practical-copy operation adds checks for an eligible adjacent practical of the same delivery, complete source marks and the target revision. A scheduled period with no submitted marks must not turn into an absence for every student. [Period service](../backend/src/modules/period-attendance/period-attendance.service.ts) · [Transactional roster and revision checks](../supabase/changes/review_integrity.sql)

**Campus attendance asks whether the student checked in at their campus.** The student sends latitude, longitude, accuracy and capture time. The backend resolves the campus from the student profile, compares the device capture time with server time, and computes great-circle distance from the campus centre with the Haversine formula. The service rejects a capture over 60 seconds old or more than 10 seconds in the future. Outside the configured radius, the request fails. These checks validate the reported location; GPS is a device-supplied signal.

The server uses India time and campus configuration to classify the sign-in. Before the midday split it is the morning session: at or before the morning cutoff is on time, afterward is late. From the split through day end it is the evening session: at or after the evening cutoff is on time, earlier is early leave. After day end it is closed. A campus roster can derive pending or absent display states from elapsed time and missing sign-ins. Mira can check in at the gate and still be marked absent from Design. Those facts belong in different tables. [Campus attendance service](../backend/src/modules/campus-attendance/campus-attendance.service.ts) · [Time settings](../backend/src/modules/campus-attendance/campus-settings.ts)

## 7. What each dashboard reads and what a report proves

**Student.** The overview composes courses, timetable, period attendance and campus status. The courses view resolves occupied registration slots to catalogue and teacher information. A course without an assigned teacher can still be a confirmed enrollment. Timetable visibility uses published entries. Attendance percentages require conducted/marked periods. For a student with two presents across three recorded periods, the fraction is 2/3; an additional unmarked slot on the calendar does not make it 2/4. [Student portal service](../backend/src/modules/student/student-portal.service.ts)

**Faculty and HOD.** The faculty module provides teaching-course and attendance views. One easy-to-misread endpoint is `GET /api/faculty/defaulters`: it gives the HOD a registration-submission follow-up list. Its calculation loads eligible students, finds current registration records with submission evidence, and compares the two sets. A missing submission here says nothing about that student's period attendance. [Faculty service](../backend/src/modules/faculty/faculty.service.ts)

**Credit ledger.** The ledger walks confirmed slots in registration history. For each occupied slot it prefers the stored course snapshot, so a later catalogue edit need not rewrite the past. If historical snapshot credits are missing, it uses current catalogue data and flags the fallback. It aggregates by course category, level band and department. A four-credit Design enrollment contributes four registered credits. The system has no approved degree-compliance matrix in this implementation. The ledger cannot certify that Mira passed Design or qualified for a degree. Older response fields named `earned` are compatibility aliases. [Ledger calculations](../backend/src/modules/credit-ledger/credit-ledger.service.ts) · [Policy constants](../backend/src/modules/credit-ledger/credit-ledger.constants.ts)

**Exports.** The general export service builds scoped registration, unresolved allocation, roster, timetable, period mark, GPS and ledger reports. For a teacher, export filtering can remove registration slots unrelated to that teacher's deliveries. The APC attendance statement has its own workbook generator. It pages through the cohort, resolves registrations and counted meetings, enforces row/cell limits and shares a concurrency budget across its two route aliases. Exporting a spreadsheet is itself an authorized backend operation. A hidden web column would be insufficient access control. [General export service](../backend/src/modules/credit-ledger/export.service.ts) · [Attendance workbook](../backend/src/modules/period-attendance/attendance-export.service.ts)

## 8. End of term, graduation and deletion

**Promotion** is a campus transaction. The director sends the term version they observed. SQL takes the lifecycle lock, checks the version and the 90-day cooldown, rejects active cohort work, and checks shared-class dependencies. It advances eligible students, increments the campus term version and clears temporary state such as scoped preferences, period attendance and campus sign-ins. Registration history, timetables and teaching history are retained. Active-term views select the rows belonging to today's operational term; historical reporting can read retained base rows.

**Example.** Mira advances from semester 1 to 2. Her semester-1 confirmed credits can still appear in her ledger. An old browser tab trying to write into the concluded term gets a conflict on a term-guarded command. A semester-10 student advances to 11, which marks programme completion for operational purposes. That promotion does not delete the account or certify a degree.

**Graduation deletion** is a distinct command for explicitly selected semester-11 students. The controller accepts a bounded list and checks the actor's scope. SQL validates the batch before deletion; a mixed or ineligible batch can fail as a whole. **Administrative deletion** of a department, campus or supported faculty account uses a different command with dependency checks and a cleanup manifest. Do not generalize one operation's retention or retry guarantees to every delete button. [Admin controller](../backend/src/modules/admin/admin.controller.ts) · [Lifecycle SQL](../supabase/changes/semester_lifecycle.sql) · [Lifecycle test cases](../tests/semester-lifecycle.test.cjs)

## 9. How web, PWA and mobile behave between requests

The web application uses a shared fetch transport and a query cache keyed by session scope, cache epoch and canonical URL. The epoch changes on cache clearing. A late response from a previous account can be rejected instead of filling the new user's screen. Mutations invalidate affected data domains. A manual section refresh can target selected endpoints. The server has its own scoped cache and request-level read deduplication; database writes can invalidate related server domains. Redis-dependent facilities have fallbacks. Caching speeds up repeated reads. Authorization and transactional checks continue to protect writes. [Client cache](../frontend/src/core/data-cache.ts) · [Server cache](../backend/src/core/cache/data-cache.service.ts) · [Database fetch adapter](../backend/src/core/cache/database-fetch.ts)

**The tab-switch behavior you observed** happens here. For an already-mounted protected page, focus, visibility and reconnect events can trigger a session check. While checking, the provider hides the content. If the scope matches, it reveals the existing children and revalidates stale visible domains. If the identity changed, it clears data and reloads the private page. Mutable data has a 60-second age in the web transport; catalogue-only reads have a longer age. One stale query can cause several views sharing a domain to refresh. This is separate from a user manually pressing Refresh. [Data provider](../frontend/src/components/DataProvider.tsx) · [Browser examples](../tests/browser/session-identity.spec.cjs)

The PWA is the web portal with installation and service-worker behavior. Its public offline fallback helps when navigation fails. Authenticated API responses and submissions bypass the service-worker cache. The installed web portal and the Expo native app have separate storage and offline capabilities. [PWA tests](../frontend/tests/pwa-service-worker.test.cjs)

The native app routes students, teachers/teaching staff, HODs and admins/directors to different screen groups. Its API client uses a token, tracks session changes and invalidates related mobile queries after writes. Secure storage holds persistent sensitive data. For offline teacher marking, the app stores an action under its owner's ID with the selected date and expected revision. On reconnect it checks ownership again before posting. Success removes the queued item. A permanent validation, authorization or revision conflict blocks it for review. A transient failure can be retried later. GPS sign-ins require online submission because replaying old coordinates would undermine the timing check. [Mobile routing](../mobile/app/_layout.tsx) · [Auth state](../mobile/src/context/AuthContext.tsx) · [API client](../mobile/src/api/client.ts) · [Offline queue](../mobile/src/lib/offline-queue.ts)

## 10. Jobs, consistency and operations

The free-service configuration runs NestJS and the queue processor in the same backend process when `RUN_REVIEW_WORKER=true`. A request to start allocation returns HTTP 202; that means the request was accepted. PostgreSQL stores the queued work. The worker polls, claims work and later acknowledges the result. PostgreSQL limits expensive work across workers. Separate cleanup polling handles Auth deletions.

```text
queued → running with lease and fence → committed academic result → acknowledged completion
                  │
                  ├─ process disappears → lease expires → eligible retry with a new fence
                  └─ director cancels before commit → old fence loses authority
```

A **lease** is authority that expires unless renewed. A **fence** is a token identifying the current claim. If worker A freezes long enough for B to reclaim its job, A may later wake up still believing it owns the work. The database compares A's old token against the current claim before accepting a result. Heartbeats renew around every 15 seconds; expensive-job leases run 90 seconds with a bounded number of attempts. A cancellation arriving after the academic result committed must preserve the result even when queue acknowledgement is still pending. The database returns a conflict and the director UI refreshes status. [Queue worker](../backend/src/core/jobs/review-worker.ts) · [Claim and lease SQL](../supabase/changes/review_operations.sql) · [Completion and cancellation SQL](../supabase/changes/review_workflow_fixes.sql)

**Why the database is involved in so many decisions.** Two API requests can both read “one seat left.” A browser button can be disabled on both screens and still leave this race. The decisive capacity check and update belong in a serialized transaction. The campus lifecycle path uses a shared PostgreSQL advisory lock for operations that must agree about the current state. This simplifies correctness at the cost of contention between some unrelated writes. Attendance uses a revision to detect competing edits. Manual scheduling uses dependency revisions to detect stale input. The three mechanisms protect different things. [Lock analysis](reviews/2026-11-02-lock-partitioning.md) · [Final database tests](../tests/review-final-schema.test.cjs)

**Security and observability.** The API holds the service-role credential, so a server query may have far more database access than a browser user. Every privileged path must establish actor, scope and allowed operation. Application guards, scoped queries, SQL grants, row-level security and transactional rechecks play complementary roles. API requests have request IDs; rate limits protect selected entry points; business audit triggers record important changes within the write transaction. An HTTP log helps trace a request. A committed audit event can show that the database accepted a change. Those are different kinds of evidence. [API setup](../backend/src/main.ts) · [Rate limiting](../backend/src/core/security/rate-limiter.service.ts) · [Audit logger](../backend/src/core/logging/audit-logger.service.ts) · [Audit and readiness SQL](../supabase/changes/review_readiness.sql)

**Health.** The basic health route reports that the process responds. Readiness separately checks database compatibility, Python/OR-Tools plus rules, and a recent worker heartbeat. HTTP 503 on readiness can coexist with a running HTTP server. A healthy worker heartbeat does not guarantee that a particular cohort is schedulable. A sleeping free service processes queued work once incoming traffic wakes it. [Health controller](../backend/src/modules/health/health.controller.ts) · [Existing deployment guide](PRODUCTION_DEPLOYMENT.md)

## 11. How to investigate any feature yourself

Start with one observed request in the browser Network panel. Record the method, path, status and request ID if present. Avoid copying cookies, bearer tokens or student records into a bug report. Find its handler in the [HTTP index](SYSTEM_REFERENCE.md). Look at the role decorators and parameters, follow the service call, then locate the table query or RPC. For SQL, follow [bootstrap order](../supabase/baseline/bootstrap.psql); a later file can replace an earlier function of the same name. Check the test covering a rejected operation as well as the successful one.

| What you see | First question to answer |
|---|---|
| Login succeeds but the dashboard is inaccessible | Did the backend resolve an academic profile, and are password change and current consent satisfied? |
| A student submitted but is missing from a class roster | Are there confirmed slot IDs for this delivery, or only a preference submission? |
| A teacher sees a course but cannot mark it | Which campus, year, semester, current assignment, date and published entry are being checked? |
| An attendance edit returns 409 | Did another device advance the revision since this form loaded? |
| A timetable job completed but students see no timetable | Is the outcome a review draft, a published timetable, or a finalized zero-contact cohort? |
| Data appears to vanish after promotion | Does this screen read a current-term view, a retained history table, or intentionally cleared temporary data? |
| A job stays queued | Is the service awake, is the worker polling the same database, and is another expensive job holding the slot? |

**A way to practise.** Explain Mira's registration aloud without looking. Then change one fact at a time: the deadline passed; the last seat disappeared; a teacher was reassigned; a second device submitted yesterday's revision; promotion happened while a form was open. For each one, name the actor, the relevant row, the check that rejects or accepts the change, and the screen that should reflect it. When you can do that, you can reason about a new bug even if you did not write the original code.

## 12. Three exercises you can run and explain

From the repository root, with project dependencies installed, run the command below. These particular tests restore an isolated PGlite database from the repository SQL and use synthetic records. They exercise database behavior independently of your hosted portal, email account or GPS device.

```powershell
node --test --test-name-pattern="final bootstrap supports preferences|database attendance rejects duplicate|durable queue permits one expensive worker" tests/review-final-schema.test.cjs
```

1. **Read the full-semester test.** Stop at the assertion immediately after `submit_student_registration`. Predict the value of `slot_1_course_id`, then read the assertion. Follow the same student ID into `apply_course_allocation`, publication, attendance and promotion. At the end, the student's semester has advanced and the prior registration still contains the course. This test calls database commands directly and stages a verified draft; the browser interaction and Python search are other layers.
2. **Read the attendance test.** Consider a client request with the following shape. The IDs here are illustrative. In a real request the slot must exist on the chosen date, and the student must belong to its authoritative roster.

   ```json
   {
     "timetable_slot_id": "00000000-0000-4000-8000-000000000001",
     "attendance_date": "2026-11-02",
     "expected_revision": 0,
     "absent_student_ids": ["00000000-0000-4000-8000-000000000002"]
   }
   ```

   Where is the teacher ID? The API obtains it from the verified session. Where is the present count? The server can derive it from the complete roster and valid absences. Why send revision zero? It asserts that this is a first submission. A second device using the same zero after a successful write can be rejected even if its JSON is well formed. Read `SubmitAttendanceSchema` for structural validation, then `atomic_submit_period_attendance` for the state-dependent checks. [Request contract](../contracts/validation.cjs) · [Database tests](../tests/review-final-schema.test.cjs)
3. **Read the worker test.** Write down the first job ID and fence. After the lease expires, predict which of those values changes on reclaim. The same job gets a new fence. Now predict the result when the first worker tries to finish. The obsolete claim cannot acknowledge the current job. This is how restarting a process can be safe even when the original process may still be alive.

### Questions you can now answer to another developer

**“Why can't we just show everyone who submitted Design on the teacher's roster?”** Some of them ranked Design second, some lost the last seat, and some belong to another delivery. Start from confirmed enrollment for the relevant delivery.

**“Why does the API recheck what the form already validated?”** The form might be old or modified, and another person might have changed the database since it loaded. Input validation checks the shape; authorization checks the actor; the transaction checks the current state. All three answer different questions.

**“Who owns a failed generation?”** The job ID identifies the attempt; the system log and job status describe its outcome; the worker fence controls who may write it. Investigate its inputs, rules and diagnostics before blaming the solver. A missing assignment, an impossible time window and a worker that never claimed the job require different remedies.

**“How can I verify what production actually runs?”** Compare the deployed API and portal commit IDs with this guide's revision. Then use the read-only schema/readiness checks in the deployment guide. A passing local workflow test demonstrates what the checked-out implementation can do; live operation also depends on deployed SQL, provider configuration and real inputs.
