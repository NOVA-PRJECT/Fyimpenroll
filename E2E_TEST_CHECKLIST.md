# Even-Semester Campus Rollout: End-to-End Test Checklist

Use this runbook in a staging environment containing no real student data. It assumes one campus, six departments, and both Semester 2 and Semester 4 are active.

## 0. Test design and fixed population

Use exactly six departments, labelled D01–D06 in the test data. Use 20 students per department as the baseline (120 students total):

| Department | Semester 2 | Semester 4 | Total |
|---|---:|---:|---:|
| D01 | 10 | 10 | 20 |
| D02 | 10 | 10 | 20 |
| D03 | 10 | 10 | 20 |
| D04 | 10 | 10 | 20 |
| D05 | 10 | 10 | 20 |
| D06 | 10 | 10 | 20 |
| **Total** | **60** | **60** | **120** |

Run a second pass with one department at 15 students and one at 28 students. Confirm that every count, export, roster, and allocation still works at both limits. The allowed population range is 90–168 students; do not test only the happy-path count.

Create these student personas in each semester:

- normal registration;
- first-choice allocation;
- lower-ranked fallback allocation;
- prerequisite failure;
- missing or incomplete academic profile;
- no submission before deadline;
- manual-allocation candidate;
- course-change candidate;
- shared-course/MDC candidate;
- duplicate-submit/retry candidate;
- invalid-password/forced-password-change candidate;
- attendance edge-case candidate.

Create at least one course with a deliberately small seat limit, one shared across departments, one with prerequisites, one with three valid preferences, and one with no valid preference. Use real production-like blueprint structure for both semesters, including every configured slot rule and course category used by the campus.

## 1. Environment and release gate

- [ ] Create an isolated staging project/database and confirm production credentials are not present.
- [ ] Deploy the exact release candidate to backend, frontend, mobile build, and database.
- [ ] Apply migrations in order; record migration output and schema version.
- [ ] Confirm health endpoint, frontend load, API base URL, Supabase project, storage, email/password reset, rate limiting, and background job dependencies.
- [ ] Confirm server time zone, database time zone, and campus time zone are identical to the agreed operational time zone.
- [ ] Take a clean database snapshot and label it `E2E-BASELINE`.
- [ ] Confirm logs and audit logs are retained and searchable by request, user, campus, semester, and timestamp.
- [ ] Confirm backups can be restored into a second staging database before testing begins.
- [ ] Record release commit, migration list, environment variables (names only), browser versions, mobile build, and test operator names.

**Gate:** no production data, no missing migration, no unresolved startup error, and a verified restore point.

## 2. Campus, department, staff, and course setup

### Superadmin/admin

- [ ] Create one campus with unique name/code and complete attendance/geofence settings.
- [ ] Verify duplicate campus code/name is rejected with a useful error.
- [ ] Create D01–D06; verify unique codes, edit, list, and delete protections.
- [ ] Create campus director, six HODs, teachers, teaching staff, and one superadmin.
- [ ] Assign each HOD to exactly one department and verify cross-department access is denied.
- [ ] Assign staff to the test campus and verify another campus cannot be accessed.
- [ ] Import/create the 120 students in batches no larger than the supported limit.
- [ ] Verify invalid rows, duplicate identifiers, missing fields, invalid department, invalid semester, and weak default password are rejected without partial corruption.
- [ ] Export the student list and reconcile it with the input fixture.

### Director

- [ ] Set academic year, registration deadline, minimum credits, maximum credits, and campus attendance settings.
- [ ] Verify settings survive logout/login and apply to both semesters.
- [ ] Test deadline just before, exactly at, and just after the configured time.
- [ ] Verify director can operate only on the assigned campus.

### HOD for every department

- [ ] Configure semester 2 blueprint for each department.
- [ ] Configure semester 4 blueprint for each department.
- [ ] Include fixed/core slots and selectable slots, including DSC/DSE/DSS, MDC, AEC, SEC, VAC, MOOC, INT, FWD, RPH, and CIP wherever applicable.
- [ ] Verify pathway slot numbers, names, rules, credits, and eligible course lists.
- [ ] Create/edit/delete courses and verify semester, category, department, credits, seat limit, tags, and prerequisites.
- [ ] Verify another department’s HOD cannot mutate the blueprint, courses, teachers, or students.
- [ ] Verify catalog-readiness warnings identify missing configuration before registration opens.
- [ ] Configure at least one invalid blueprint in a disposable test record and confirm it cannot be used for registration.

**Gate:** each department has a valid semester 2 and semester 4 blueprint, and the readiness view reports no blocking defects.

## 3. Academic transition and student onboarding

- [ ] Seed a representative prior state in semesters 1 and 3 for students who will become semesters 2 and 4.
- [ ] Verify student profile has the correct campus, department, name, identifier, and current semester.
- [ ] Test first login, consent, password change, logout, session refresh, password reset, expired reset link, and invalid credentials.
- [ ] Run promotion once; reconcile every promoted student and every retained historical record.
- [ ] Repeat promotion with the same request and idempotency key; confirm no duplicate promotion or duplicate history.
- [ ] Interrupt/retry promotion; confirm it is resumable or safely rolled back according to the product contract.
- [ ] Verify a graduated/concluded student cannot appear in active semester registration.
- [ ] Verify semester 2 students cannot access semester 4 registration and vice versa.
- [ ] Verify students with incomplete campus/department/semester data receive a clear blocking error.

## 4. Registration flow: execute for all six departments and both semesters

For each department D01–D06 and each semester 2 and 4:

- [ ] Student opens the registration page and sees only the current semester’s blueprint and eligible courses.
- [ ] Verify fixed course slots are displayed and cannot be changed.
- [ ] Select valid preferences for every compulsory selectable slot.
- [ ] Use one, two, and three ranked preferences where allowed.
- [ ] Verify course cards show correct code, title, category, credits, department, seat information, and prerequisite state.
- [ ] Verify a student can see eligible minor/MDC choices but cannot select an excluded department course when the rule forbids it.
- [ ] Submit a valid registration and capture the confirmation/audit event.
- [ ] Refresh, log out, log in, and confirm saved choices are unchanged.
- [ ] Edit before the deadline and verify only the intended slot changes.
- [ ] Submit the same payload twice and double-click the submit button; confirm one logical registration and no duplicate seat consumption.
- [ ] Retry after a network interruption; confirm the final state is consistent.
- [ ] Attempt wrong semester, wrong pathway, unknown course ID, course from another department, wrong category, duplicate course, duplicate rank, rank 0, rank 4, more than three preferences, missing compulsory slot, negative credits, and over-credit selections. Each must be rejected without changing the saved valid state.
- [ ] Attempt registration after deadline and after allocation publication; confirm the correct block message.
- [ ] Attempt registration as a teacher, HOD, director, or unauthenticated user; confirm authorization and authentication enforcement.
- [ ] Verify two students cannot consume the same global seat beyond the configured limit.

Record for every submitted student: student ID, department, semester, pathway, submitted choices, timestamp, response, and audit event ID.

## 5. Registration concurrency and seat integrity

- [ ] Choose a course with one remaining seat.
- [ ] Submit simultaneously from at least five students across different departments.
- [ ] Confirm exactly one winner, deterministic conflict handling, correct losers/fallback behavior, and no negative or inflated remaining-seat count.
- [ ] Repeat with retries, timeouts, and browser refreshes.
- [ ] Compare registration rows, enrollment rows, seat ledger, credit ledger, and audit log after every run.
- [ ] Verify a failed transaction leaves no partial slot, preference, seat, or ledger record.
- [ ] Verify an abandoned draft does not reserve a seat unless the product explicitly defines that behavior.

## 6. Allocation and exception handling

Run allocation independently for Semester 2 and Semester 4, then run a combined campus reconciliation.

- [ ] Close registration and verify students can no longer submit or edit.
- [ ] Confirm allocation is blocked when catalog or blueprint readiness is incomplete.
- [ ] Start one allocation run per semester and record run ID, operator, and timestamp.
- [ ] Verify duplicate start requests do not create competing runs.
- [ ] Confirm allocation honours fixed slots, rank order, prerequisites, department rules, pathway rules, global baskets, seat limits, and credits.
- [ ] Verify popular-course oversubscription and fallback allocation.
- [ ] Verify unresolved students are listed with a reason and are available for authorized manual allocation.
- [ ] Manually allocate one valid unresolved student and reject one invalid manual allocation.
- [ ] Verify manual allocation cannot exceed seats, bypass prerequisites, cross a semester, or cross an unauthorized campus/department.
- [ ] Verify remaining-seats and unresolved-student views agree with the allocation result.
- [ ] Publish/complete allocation and confirm post-allocation preference and course-change restrictions.
- [ ] Re-run or retry after a simulated failure; confirm idempotency and no duplicate enrollment.
- [ ] Verify student dashboards, HOD views, exports, credit ledger, and rosters all show the same final courses.

**Allocation reconciliation formula:** submitted students = allocated students + unresolved students + explicitly rejected students; every selected course count must equal its enrollment rows and seat ledger.

## 7. Course changes after allocation

- [ ] Change an eligible selectable course while the change window is open.
- [ ] Verify new course eligibility, semester, category, slot, prerequisite, duplicate-course, credit, and seat checks.
- [ ] Confirm old seat is released exactly once and new seat is consumed exactly once.
- [ ] Verify credit ledger and student timetable update atomically.
- [ ] Attempt to change a fixed/core slot, a full course, a course in another semester, a duplicate course, and a course with unmet prerequisite.
- [ ] Attempt two simultaneous changes for the same student and confirm one consistent final state.
- [ ] Attempt changes after the window closes or timetable/attendance state forbids them.
- [ ] Verify HOD/manual change permissions and audit details.

## 8. Teacher assignment and timetable

- [ ] Assign teachers to every allocated course, including cross-department/shared courses.
- [ ] Batch-assign, reassign, and remove assignments; verify authorization and audit history.
- [ ] Attempt duplicate assignment, unauthorized teacher, nonexistent course, and cross-campus assignment.
- [ ] Generate a timetable separately for semester 2 and semester 4.
- [ ] Verify no teacher, student cohort, room, or time clash.
- [ ] Verify all allocated courses have timetable coverage and all timetable entries map to real courses and teachers.
- [ ] Test solver failure, invalid constraint, missing teacher, missing room, and retry behavior.
- [ ] Review the draft timetable, change a teacher where permitted, and publish it.
- [ ] Verify unpublished drafts are invisible to students and published entries are visible to the correct audience only.
- [ ] Verify republishing is idempotent and does not duplicate entries.
- [ ] Verify students see only their own campus/department/semester schedule; teachers see only their teaching schedule.

## 9. Attendance and campus operations

- [ ] Configure geofence, sign-in window, grace period, and attendance policy.
- [ ] Student signs in inside the geofence during the valid window.
- [ ] Attempt outside geofence, before window, after window, duplicate sign-in, missing location, denied location permission, stale location, device clock mismatch, and expired session.
- [ ] Verify attendance status and campus roster for students from all six departments and both semesters.
- [ ] Teacher views current schedule and roster for each assigned course.
- [ ] Submit present, absent, late, and invalid attendance payloads as allowed by the product.
- [ ] Repeat submit, refresh, retry after network failure, and copy practical attendance to the next period.
- [ ] Confirm only authorized teacher/HOD can mark or correct attendance and every correction is audited.
- [ ] Verify students cannot edit attendance or view another student’s attendance.
- [ ] Export attendance statement and reconcile totals with stored period records.
- [ ] Verify attendance is attached to the right academic year, semester, course, period, and student.

## 10. Notices, credit ledger, exports, and reporting

- [ ] HOD creates a notice for the intended audience; verify students/teachers see it and other audiences do not.
- [ ] Test empty notice, oversized notice, invalid date, duplicate submission, and unauthorized creation.
- [ ] Student checks credit ledger after initial allocation and after a course change.
- [ ] Verify ledger totals, categories, semester, earned/registered credits, and historical entries.
- [ ] Compare dashboard, ledger endpoint, database view, CSV/Excel export, and PDF/report output for the same student.
- [ ] Export students, allocation, attendance, timetable, and ledger for each department and each semester.
- [ ] Verify empty export, maximum population export, special characters, long names, date/time format, and column ordering.
- [ ] Verify exports never include another campus, department, semester, or student’s private data.

## 11. Security and authorization matrix

Test every endpoint and relevant UI action as unauthenticated, student, teacher, teaching staff, HOD, campus director, and superadmin.

- [ ] Authentication is required for protected routes.
- [ ] Role restrictions match the intended matrix.
- [ ] Campus scoping prevents cross-campus reads and writes.
- [ ] HOD scoping prevents cross-department reads and writes.
- [ ] Student scoping prevents access to another student’s ID, registration, ledger, timetable, or attendance by changing URL/query/body IDs.
- [ ] Tampered semester, campus, department, pathway, course, and student IDs are rejected server-side.
- [ ] Sessions refresh correctly; logout invalidates access as designed.
- [ ] Rate limits and lockouts behave correctly for repeated login, reset, and mutation attempts.
- [ ] Error responses do not reveal secrets, tokens, SQL, internal paths, or unrelated records.
- [ ] Audit events exist for authentication, configuration, registration, allocation, manual changes, teacher changes, attendance corrections, exports, and administrative actions.

## 12. Reliability, performance, and recovery

- [ ] Measure baseline page/API latency with one user.
- [ ] Load test login, course browsing, registration submission, seat availability, allocation status, and dashboard endpoints at expected peak concurrency.
- [ ] Repeat above expected peak and record error rate, p95/p99 latency, CPU, memory, database connections, and queue/job time.
- [ ] Test simultaneous registration across all six departments and both semesters.
- [ ] Kill/restart backend during registration, allocation, timetable generation, and attendance submission; verify recovery contract.
- [ ] Simulate database/API timeout and client retry; confirm no duplicate mutation.
- [ ] Restore the `E2E-BASELINE` snapshot into a clean database and confirm the application starts and data reconciles.
- [ ] Rehearse rollback to the previous release and forward migration recovery in staging.

## 13. Evidence and defect handling

For every case capture: case ID, role, department, semester, student/course IDs, preconditions, exact steps, expected result, actual result, timestamp, screenshot or response body, audit event ID, database reconciliation query/result, and pass/fail.

Use severity consistently:

- **Blocker:** data loss/corruption, cross-campus or cross-student exposure, overbooking, duplicate enrollment, broken login, or impossible rollout-critical flow.
- **Critical:** registration, allocation, timetable, attendance, promotion, or ledger cannot complete for a substantial population.
- **Major:** important role flow or report is wrong but a safe workaround exists.
- **Minor:** cosmetic, wording, or low-impact usability issue.

Every defect must have a reproducible fixture, expected behavior, actual behavior, severity, owner, fix version, retest result, and regression result.

## 14. Execution order

1. Freeze the release candidate and take `E2E-BASELINE`.
2. Execute environment, migration, backup, and health checks.
3. Seed campus, six departments, staff, courses, blueprints, and students.
4. Run promotion and onboarding checks.
5. Run the complete semester 2 journey.
6. Reset only the required test state and run the complete semester 4 journey.
7. Run both semesters concurrently for registration, allocation, timetable, attendance, and reporting.
8. Run negative, authorization, concurrency, recovery, and load suites.
9. Fix defects, restore a clean snapshot, and repeat all blocker/critical cases plus the complete happy path.
10. Produce a signed test report and go/no-go decision.

## 15. Go/no-go gate

Go only when all of the following are true:

- [ ] All six departments pass at 15–28 students each.
- [ ] Semester 2 and Semester 4 complete the full flow independently and concurrently.
- [ ] No open blocker or critical defect exists.
- [ ] No unauthorized access or data leakage is observed.
- [ ] Enrollment, seat, credit, attendance, timetable, and export reconciliations are exact.
- [ ] Peak-load and recovery targets pass.
- [ ] Backup restore and rollback are proven.
- [ ] A clean rerun after fixes passes.
- [ ] Named business owner, technical owner, and test lead sign the release report.

Do not roll out if any gate is marked pending. Record the reason, owner, mitigation, and new decision date.
