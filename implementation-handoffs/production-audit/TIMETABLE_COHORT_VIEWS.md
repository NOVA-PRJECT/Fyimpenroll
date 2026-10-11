# Department cohort timetable visibility

The completed 2026-27 Semester 1 production draft contains all 18 registered courses and all 50 required course-period entries. A read-only comparison against the 126 registrations and current catalogue found no missing contact hours and no independent validator violations. Mathematics and Statistics minors were saved correctly but hidden by department ownership filters.

The director API now derives course audiences from all eight registration slots for the exact campus, academic year and semester. It returns only department IDs and registered-student counts; student identities are not included in the timetable response. The department list contains only cohorts with registered students. Course ownership remains unchanged, so a Statistics paper can appear in IT's cohort timetable while retaining Statistics as its teaching department.

The director grid, unscheduled-session filters, Excel sheets, PDF grids and export selectors use the same enrollment audience. Campus category options retain their shared display. Excel and PDF no longer reconstruct empty department cohorts from course ownership. Empty registration results are authoritative; provider failures produce a retryable service error. Registration and student reads are paginated and student ID lookups are bounded; they avoid ambiguous PostgREST relationship embeddings on legacy databases. Teacher assignment views, HOD course-management authorization and students' published-only access retain their existing restrictions.

Read-only execution of the changed backend and frontend filter against the existing production draft produced:

| Student department | Registered students | Previously visible slots | Corrected occupied slots |
| --- | ---: | ---: | ---: |
| Information Technology | 27 | 14 | 22 |
| Mathematical Science | 13 | 12 | 22 |
| Physical Education & Sports | 40 | 12 | 30 |
| School Of Behavioural Sciences | 33 | 10 | 30 |
| Department of Economics | 13 | 12 | 26 |

Statistics, Environmental Studies, and Wood Science have no home-department students in this cohort and therefore have no cohort tabs or export sheets. Their registered papers remain scheduled and appear for the departments whose students take them. Occupied-slot counts describe the union of each department's students' choices; they do not imply every individual student attends every option. A cohort needing 22 distinct periods can legitimately have eight blank weekly periods.

No migration, regeneration, catalogue correction or production record update is required for this display fix. After deployment, refresh the director timetable page to load the saved draft with its enrollment audience. Do not delete Statistics courses merely to remove its empty cohort tab.

Checks cover both minors taught elsewhere, slots 7 and 8, empty departments and terms, campus isolation, private enrollment identities, incomplete review entries and remaining sessions, pagination beyond 1,000 registrations, failed enrollment reads, HOD restrictions and student draft isolation. Frontend type checking, all 26 frontend tests, lint and production build passed. The changed backend was also run read-only against the existing live draft to confirm the counts above.

Backend compilation and the full sequential backend suite passed: 294 tests passed, with the separate real-PostgreSQL concurrency check skipped locally and covered by CI.
