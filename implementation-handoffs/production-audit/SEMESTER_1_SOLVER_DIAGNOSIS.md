# Semester 1 solver failure diagnosis — 2026-10-11

**Historical diagnosis:** The catalogue has changed since this report. See [catalogue hours and review drafts](TIMETABLE_REVIEW_DRAFTS.md) for the current behavior and refreshed feasible cohort. Fixed MDC hour checks are removed; the earlier 32-period conflict does not describe the latest data.

For academic year 2026-27, Semester 1, the latest failed generation job lasted approximately 310 seconds. It used the shipped rules. Read-only diagnosis loaded 126 registrations, 18 courses, five departments and three parallel baskets. Real student and teacher identifiers stayed in memory; the local solver reproduction used anonymized identifiers. No production registrations, course hours, rules or timetable entries were changed.

**Academic clarification:** Both AEC papers are common campus sessions. KU01AECENG101 must occupy Tuesday 13:30-16:30 and KU01AECENG102 Wednesday 13:30-16:30. Both already have all 126 students in one course node each; neither was multiplied by department in the capacity calculation. The shipped rule previously allowed either afternoon without fixing the paper order. The solver and independent validator now enforce the confirmed order, including when a browser supplies older saved rules.

Semester 1 MDC courses have **3 theory hours and zero practical hours**, confirmed by the user. The catalogue initially had 2 theory + 2 practical hours for KU01MDCCSE101, KU01MDCPSY101 and KU01MDCSTA101. The guarded, idempotent [catalogue correction SQL](correct_semester_1_mdc_hours.sql) was prepared for manual application. A subsequent read-only production check confirmed all eight MDC courses now have 3+0 hours. This agent did not apply the SQL or modify production records. The backend rejects contradictory MDC catalogue hours rather than silently scheduling or discarding practicals.

With all MDC courses corrected locally to 3+0, the anonymized cohort still has a pairwise-conflicting group requiring **32 periods against 30 available**. In the nine-course group below, changing KU01MDCPSY101 from 4 total periods to 3 reduces the total from 33 to 32. Fixed shared AEC afternoons do not remove those six hours from the students' schedules. At least two extra periods are necessary if the remaining memberships and contact hours are correct; this is not proof that adding two periods would satisfy every other constraint. Review the remaining DSC course memberships and hours before changing timetable capacity.

The confirmed-rule backend build passed, followed by the complete backend suite: 265 passed, zero failed, one separate-connection PostgreSQL test skipped locally. Added tests cover fixed shared AEC sessions, stale browser rules, impossible slot domains, MDC catalogue rejection and valid theory-only sessions, and actual execution/rollback of the correction SQL in a disposable PostgreSQL engine. The former flexible-AEC spread fixture now uses an option without a fixed paper day; the confirmed common papers have explicit fixed-day coverage.

## Mandatory campus paper synchronization

MDC, SEC, VAC and AEC groups are now built by the corresponding paper's ordinal within its category in each registration, independent of department and absolute registration-column numbering. A course used in inconsistent paper positions is rejected. Common paper options with unequal total contact hours or overlapping enrollments are rejected rather than partitioned into separate time blocks. AEC paper 1 and paper 2 remain distinct. Department-specific elective basket detection is retained.

Python reconstructs mandatory campus groups from course paper identities even if supplied groups are missing or split. It equates complete period occupancy for every course in a group, including periods absent from either course's allowed domain. Equal-duration options with different theory/practical structures can synchronize; incompatible windows are infeasible. The independent validator always rebuilds campus groups, including when other department groups are present. Director department views, Excel sheets and PDF printouts include common campus paper options instead of hiding them under the course owner's department.

The refreshed production cohort has 126 registrations, eight MDC paper-1 options and one course each for AEC papers 1 and 2. Its paper identities passed strict validation. The anonymized reproduction using the corrected live hours and strict groups still rejects the proven 32-period conflict before search against 30 available periods. No timetable was generated or published in production.

Verification: backend build and full backend regression suite passed (274 passed, zero failed, one PostgreSQL concurrency test skipped locally); frontend type checking, 24 tests, lint and production build passed. New coverage includes cross-department synchronization for all four categories, ambiguous registration positions, uneven contact hours, overlapping enrollments, missing/split caller groups, independent validation with unrelated department groups, disjoint and partially shared windows, mixed theory/lab session structures, and common-paper visibility in department views/exports.

## Initial capacity contradiction using the stored catalogue hours

The following nine courses require 33 weekly periods. Every pair shares at least one student, verified against the live cohort. Therefore no pair can run at the same time, even though no individual student necessarily takes all nine courses. The shipped timetable provides only 30 periods (five days, six periods per day).

| Course | Theory | Practical | Total periods |
| --- | ---: | ---: | ---: |
| KU01DSCCSE101 | 2 | 4 | 6 |
| KU01DSCSTA101 | 3 | 2 | 5 |
| KU01MDCPSY101 | 2 | 2 | 4 |
| KU01AECENG101 | 3 | 0 | 3 |
| KU01AECENG102 | 3 | 0 | 3 |
| KU01DSCECO101 | 4 | 0 | 4 |
| KU01DSCPSY101 | 2 | 0 | 2 |
| KU01DSCEVS101 | 2 | 0 | 2 |
| KU01DSCPES101 | 4 | 0 | 4 |
| **Total** | **25** | **8** | **33** |

The largest individual student load was 25 periods. Checking only individual loads misses this pairwise conflict. A longer timeout, faster CPU or different soft preferences cannot fit this group into 30 periods. At least three additional periods are necessary for this group if these enrollments and contact hours are correct; that alone does not establish feasibility under all other constraints.

The appropriate academic review is to verify the listed contact hours and DSC/MDC course memberships. Correct only confirmed data errors, or obtain approval for a timetable-capacity change and update the solver, validator and slot configuration together. Do not remove student-overlap protection or save incomplete schedules to make generation succeed.

## Backend change

A bounded greedy conflict-group check now rejects a proven capacity shortage before starting CP-SAT search. It respects allowed campus periods and does not sum courses that can overlap. The check is sufficient rather than exhaustive: missing a conflict leaves the normal solver in charge, while every rejection supplies a concrete proof. It preserves all hard scheduling rules and publication validation.

The job retains solver statistics on failure and distinguishes an unresolved timeout from proven infeasibility. The local five-minute limit changes in job.ts, ortools-runner.ts and ortools_solver.py are retained consistently; the previous pushed commit used 30 seconds. Changing that limit does not resolve this cohort's capacity contradiction.

## Reproduction and verification

- Before: the anonymized cohort returned UNKNOWN after 30.073 seconds of search, with 178,917 branches and 33,773 conflicts.
- After: the same cohort returned INFEASIBLE before search, with a sufficient conflicting group requiring 31 periods against 30 available. This smaller group and the nine-course 33-period group above independently prove the shortage. The check returns the first sufficient contradiction, not the maximum conflicting group.
- Regression coverage: pairwise overload despite valid individual loads; independent courses totaling more than 30 periods; campus-domain restrictions and an exactly-at-capacity feasible case; existing teacher, laboratory, category-window and publication checks.
- The original capacity-check change required no schema migration, frontend or mobile changes. The subsequent synchronization release also updates director timetable views and exports; no schema migration or mobile changes are included.

Backend build passed. The full backend suite with local file concurrency limited to two passed 254 tests; one separate-connection PostgreSQL test was skipped locally. An existing Friday-P6 test failed once in the initial fully parallel run, passed in isolation, and passed in the full bounded rerun. CI supplies PostgreSQL and checks the default test concurrency and clean deployment builds.

## Runtime readiness recovery

After Render restarted for the capacity-check release, public readiness returned database=true and solverAndRules=false. The supplied logs showed successful Nest startup but no Python or rule-loading error. The previous health controller discarded the exception from its synchronous ten-second startup import check and permanently cached failure. The exact Render failure cause remains unconfirmed from those logs.

Readiness now checks Python asynchronously with a thirty-second timeout, checks the database concurrently, logs a failed import or invalid rules, and retries failures after the existing fifteen-second readiness cache expires. Concurrent callers share one probe. A successful Python/rules check remains cached for the process lifetime. Missing dependencies, invalid rules and database failures still return HTTP 503; errors are logged rather than exposed in the public response.

The backend build and three targeted recovery tests passed. A real local Python import and rule check returned ready in 2.046 seconds. The complete backend suite passed 257 tests with one PostgreSQL integration test skipped locally. Commit 00b9c9c passed production CI; Render restarted and two subsequent public readiness checks returned HTTP 200 with database=true and solverAndRules=true.
