# S2 timetable diagnosis — 37 scheduling rows

Status: **historical diagnosis before the authorized MDC-hour update**. This investigation was read-only. The user subsequently requested all test MDC contact hours be changed to two hours; that update is applied and verified in [MDC_2H_UPDATE.md](MDC_2H_UPDATE.md). The seven-course bound below is now 29 periods, and all MDC totals now match. A fresh timetable run is pending.

Latest checked MANGATTT / 2026-27 / S2 job: `5df0989e-be87-4ef5-865a-6ea0d4093057`. Source evidence is saved in [TIMETABLE_S2_DIAGNOSIS.json](TIMETABLE_S2_DIAGNOSIS.json).

| Check | Result |
|---|---:|
| Enrolled S2 courses | 25 |
| Required S2 course periods | 94 |
| Placed review-draft periods | 51 |
| Unscheduled session rows | 37 |
| Distinct courses affected | 17 |
| Unscheduled periods | 43 |
| S2/S4 enrolled courses with exactly one teacher assignment | 58 / 58 |
| Publishable timetable entries | 0 |

The 37 rows represent sessions, including two-period practical sessions. They are not 37 distinct courses or missing teacher assignments. The job completed its review-draft calculation; publication remains blocked.

## Proven capacity conflict

These seven courses share students pairwise. The database confirms all 21 course pairs overlap, with at least one shared student per pair. All their periods must therefore occur at different times.

| Course | Weekly contact periods |
|---|---:|
| `KU02AECHIN103` | 3 |
| `KU02DCSSTA103TT` | 4 |
| `KU02DSCMAT10 1TT` | 4 |
| `KU02DSCMAT10 2TT` | 4 |
| `KU02MDCSTA201TT` | 4 |
| `KU2DSCCSE102TT` | 6 |
| `KU2DSCCSE103TT` | 6 |
| Total | 31 |

The timetable offers five days × six periods = **30** weekly slots. This course set requires **31**. No increase in solver search time or teacher count can make that course combination fit into 30 slots.

Individual S2 students currently have 18–27 contact hours and 22 credits. The 31-period bound is caused by overlapping combinations across different students; it is not an individual student's credit total.

## Incompatible MDC parallel block

The enrolled MDC set contains six 3-contact-hour courses and two 4-contact-hour courses: `KU02MDCSTA201TT` and `KU2MDCCSE201TT` each have 2 theory + 2 practical hours.

The current campus-paper grouping requires corresponding MDC papers to occupy identical periods. Exact hours of 3 and 4 cannot both be satisfied by identical occupancy. This is an additional blocker even if the course-overlap capacity conflict is corrected.

## Next correction

The registration seed varied minor/MDC choices to exercise allocation and fallback paths. Its successful blueprint/credit/allocation checks did not establish timetable feasibility.

Prepare and verify a schedulable test-registration plan with consistent minor combinations and a compatible MDC offering set, then apply only the agreed test-campus changes before regeneration. Prefer retaining the copied course catalogue metadata and the established timetable rules; do not arbitrarily reduce hours, expand the week or relax clash/parallel rules to force a pass. Any intended curriculum policy change needs an explicit decision.

The current student records, preferences, course hours, teacher assignments, rules and latest draft were left intact during this investigation.

## Local display correction

The director screen now distinguishes unscheduled sessions, affected courses and periods, and displays the existing solver diagnostics under “Why this draft is incomplete”. This is a local frontend change pending deployment. It does not resolve the underlying schedule inputs.
