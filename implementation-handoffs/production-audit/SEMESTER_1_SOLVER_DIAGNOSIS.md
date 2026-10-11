# Semester 1 solver failure diagnosis — 2026-10-11

For academic year 2026-27, Semester 1, the latest failed generation job lasted approximately 310 seconds. It used the shipped rules. Read-only diagnosis loaded 126 registrations, 18 courses, five departments and three parallel baskets. Real student and teacher identifiers stayed in memory; the local solver reproduction used anonymized identifiers. No production registrations, course hours, rules or timetable entries were changed.

## Confirmed capacity contradiction

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
- No schema migration, frontend or mobile changes are required.

Backend build passed. The full backend suite with local file concurrency limited to two passed 254 tests; one separate-connection PostgreSQL test was skipped locally. An existing Friday-P6 test failed once in the initial fully parallel run, passed in isolation, and passed in the full bounded rerun. CI supplies PostgreSQL and checks the default test concurrency and clean deployment builds.

## Runtime readiness recovery

After Render restarted for the capacity-check release, public readiness returned database=true and solverAndRules=false. The supplied logs showed successful Nest startup but no Python or rule-loading error. The previous health controller discarded the exception from its synchronous ten-second startup import check and permanently cached failure. The exact Render failure cause remains unconfirmed from those logs.

Readiness now checks Python asynchronously with a thirty-second timeout, checks the database concurrently, logs a failed import or invalid rules, and retries failures after the existing fifteen-second readiness cache expires. Concurrent callers share one probe. A successful Python/rules check remains cached for the process lifetime. Missing dependencies, invalid rules and database failures still return HTTP 503; errors are logged rather than exposed in the public response.

The backend build and three targeted recovery tests passed. A real local Python import and rule check returned ready in 2.046 seconds. The complete backend suite passed 257 tests with one PostgreSQL integration test skipped locally. Deployment readiness and CI must be checked after pushing this follow-up.
