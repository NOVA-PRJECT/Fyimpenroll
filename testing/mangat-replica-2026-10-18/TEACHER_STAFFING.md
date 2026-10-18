# Teacher Auth accounts and course assignments

Status: **created, assigned and verified** on 18 October 2026 for MANGATTT / 2026-27 / semesters 2 and 4.

- Created 20 new teacher Auth accounts and matching faculty profiles; preserved the existing pilot account and its changed password.
- There are now 21 teachers. All 58 enrolled papers have a teacher delivery: 25 S2 and 33 S4. The 57 new assignment rows are scoped only to MANGATTT.
- Each teacher has at most 12 weekly course contact hours. Papers linked by mandatory parallel groups use different teachers. This does not establish that the full timetable is feasible; generation and review are next.
- All teachers belong to test departments. Shared Hindi KU02AECHIN103 uses test ECOTT teacher 03 and a MANGATTT delivery; the real course ownership and real-campus assignments are unchanged.
- New accounts use the requested initial password, require a first-login password change, and have not been marked as having accepted policy terms. Their login/consent UI flows remain pending. The pilot login was already tested by the user.

| Department | Teachers |
|---|---:|
| ECOTT | 6 |
| EVSTT | 1 |
| ITTT | 4 |
| MATTT | 3 |
| PESTT | 2 |
| SBSTT | 3 |
| STATT | 2 |
| SWTTT | 0 |
| Total | 21 |

Statistics supplies enrolled papers despite having no uploaded students. SWTTT has no enrolled papers. The five unused test catalogue courses are outside this staffing scope.

Credentials and each teacher's course list are in the ignored local [TEACHER_CREDENTIALS.md](../../scratch/mangat-replica-2026-10-18/TEACHER_CREDENTIALS.md). IDs and the recoverable creation state are in [teacher-creation-state.json](../../scratch/mangat-replica-2026-10-18/teacher-creation-state.json). These files contain no server key.

## Verification

[TEACHER_STAFFING_VERIFICATION.json](TEACHER_STAFFING_VERIFICATION.json) records Auth/profile ownership checks, all 58 course roster counts through the current FacultyService, and teacher mappings in the current timetable loader for both semesters. These are service readback checks of administrative fixtures, not HTTP/login tests for the new teachers.

[TEACHER_STAFFING_INVARIANTS.json](TEACHER_STAFFING_INVARIANTS.json) independently confirms that existing users, assignments, registrations/preferences, courses, blueprints, campus settings and timetable entries were unchanged. Six local tests cover parallel-paper separation, workload splitting, the shared Hindi exception and protection against foreign Auth/profile collisions.

The reproducible script is [create-teachers.cjs](create-teachers.cjs). It reads the secret from the existing server environment, checks the exact project/campus and saved plan hash, refuses collisions and changed academic data, checkpoints each Auth/profile request, and inserts missing planned assignments without overwriting existing rows. Reruns preserve existing passwords. No students or campus configuration are modified.

Before timetable generation, a read-only recheck is available:

```powershell
node --env-file=backend/.env testing/mangat-replica-2026-10-18/create-teachers.cjs --verify
```

The script stops if timetable entries already exist. Do not regenerate the staffing plan to work around that guard.

## Next manual test

As the test campus director, open Timetable for 2026-27, review structured scheduling rules, and generate the S2 draft. Check generation status, teacher and student conflicts, practical blocks and unscheduled sessions. Review publication readiness before publishing. Generate/review S4 with the other semester's published teacher reservations included, then check both published student and teacher views. Attendance testing follows.
