# E2E Test Campus Package

This folder is the complete synthetic campus package for end-to-end testing of the even-semester release.

## Safety

All names, identifiers, email addresses, and passwords in this folder are fake staging values. Do not use them in production. Change the passwords before sharing the staging environment outside the test team.

## Test campus

- Campus: Northstar Test Campus (`NSTC`)
- Academic year: `2026-27`
- Semesters under test: `2` and `4`
- Departments: six (`D01`–`D06`)
- Baseline fixture students: 95 (D01 has 20; D02–D06 have 15 each, split across Semesters 2 and 4)
- Scale pass: add students until every department is between 15 and 28; repeat with one department at 28
- Allowed total range: 90–168 students

## File map

- `E2E_TEST_CHECKLIST.md`: full execution checklist and release gates.
- `TEST_CREDENTIALS.md`: synthetic login accounts and password handling rules.
- `CAMPUS_PROFILE.md`: campus settings and setup values.
- `departments.csv`: six departments.
- `staff.csv`: director, HODs, teachers, teaching staff, and superadmin.
- `students.csv`: synthetic students and test personas; extend using the documented ID pattern for the 120-student pass.
- `courses.csv`: course fixture fields and seed examples.
- `blueprints.csv`: semester/pathway/slot configuration fixture.
- `registration-settings.csv`: registration and credit settings.
- `TEST_CASES.md`: numbered manual and automated test cases.
- `EXPECTED_RESULTS.md`: reconciliation rules and pass criteria.
- `EXECUTION_LOG.csv`: tester evidence log template.
- `DEFECT_LOG.csv`: defect tracking template.

## Recommended use

1. Create a clean staging database and record its snapshot ID.
2. Load the campus, departments, staff, students, courses, settings, and blueprints.
3. Replace password values with generated staging secrets and store them in the approved secret manager.
4. Execute `E2E_TEST_CHECKLIST.md` in order.
5. Record every case in `EXECUTION_LOG.csv`; record failures in `DEFECT_LOG.csv`.
6. Reconcile against `EXPECTED_RESULTS.md` before making the rollout decision.
