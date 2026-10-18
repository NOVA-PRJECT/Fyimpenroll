# Next test phase — first login and course registration

The completed upload was verified against all six CSVs on 18 October 2026. There are **120 students and 120 linked, email-confirmed Auth accounts**, with no missing rows, unexpected rows, duplicate CAP numbers/emails, ownership errors or mismatched academic details. The initial check caught the upload in progress; the final refreshed comparison includes all twenty SBSTT students.

| Department | S2 | S4 | Total |
|---|---:|---:|---:|
| ECOTT | 10 | 10 | 20 |
| EVSTT | 10 | 10 | 20 |
| ITTT | 10 | 10 | 20 |
| MATTT | 10 | 10 | 20 |
| PESTT | 10 | 10 | 20 |
| SBSTT | 10 | 10 | 20 |
| Total | 60 | 60 | 120 |

Historical upload-stage snapshot: all 120 students had matching password-change flags in Auth and their profiles, required a first-login password change, and none had signed in at that verification time. The test campus then had 61 courses and twelve blueprints. Every uploaded student had the correct semester blueprint. There were no preference submissions, registration records, allocation runs or timetable entries at that stage. Current progress is recorded in sections 4–6 and LIVE_STATUS.json.

At the upload-stage check, the registration deadline was null and submissions were closed. Verification in that phase was read-only. The user subsequently tested login and registration, and closed registration before allocation.

## 1. Test first login with twelve pilot students

Start with one S2 and one S4 student from each department, using row 1 and row 11 of each department CSV. Their email endings are:

| Department | S2 pilot email | S4 pilot email |
|---|---|---|
| ECOTT | `student.ecott.s2.001.mangattt.20261018@example.test` | `student.ecott.s4.001.mangattt.20261018@example.test` |
| EVSTT | `student.evstt.s2.001.mangattt.20261018@example.test` | `student.evstt.s4.001.mangattt.20261018@example.test` |
| ITTT | `student.ittt.s2.001.mangattt.20261018@example.test` | `student.ittt.s4.001.mangattt.20261018@example.test` |
| MATTT | `student.mattt.s2.001.mangattt.20261018@example.test` | `student.mattt.s4.001.mangattt.20261018@example.test` |
| PESTT | `student.pestt.s2.001.mangattt.20261018@example.test` | `student.pestt.s4.001.mangattt.20261018@example.test` |
| SBSTT | `student.sbstt.s2.001.mangattt.20261018@example.test` | `student.sbstt.s4.001.mangattt.20261018@example.test` |

- [ ] Sign in using the batch password entered during upload. The prepared guide used `Password123!`.
- [ ] Complete the required terms/privacy acceptance and first-login password change through the application.
- [ ] Verify the displayed student name, MANGATTT campus, department and semester.
- [ ] Verify that normal portal operations remain blocked until the required password/consent steps are complete.
- [ ] Log out and back in with the new password; check that the password-change prompt no longer repeats.
- [ ] Record changed test passwords locally so later tests use the current credentials.

## 2. Check the closed window, then open test registration

- [ ] After completing the login gates for a pilot, confirm that submitting course preferences while the deadline is still null is blocked as a closed registration window.
- [ ] Sign in as `director.mangattt.20261018@example.test` and open Registration Settings for **MANGATTT**.
- [ ] Keep the registration academic year **2026-27** for both semesters. S4 students' admission year remains 2025-26; it is a different field.
- [ ] Set a future test deadline and save. Keep the copied campus credit settings at 18–26; each saved blueprint has its own limits and the prepared six-paper combinations total 22 credits.
- [ ] Refresh a pilot student session and verify the registration window is open.

The director's current initial staff password is in the local staff credentials file. This checklist does not change the deadline automatically.

## 3. Complete pilot registrations and rejection checks

Use the actual course choices in [ACADEMIC_VALIDATION_REPORT.json](ACADEMIC_VALIDATION_REPORT.json) as a reference. Each pathway includes a sample six-paper registration and course codes. Prefer the copied TT options where available; shared language AEC options retain the approved global-catalogue behavior.

- [ ] For each S2 pilot, verify two fixed majors, two minors from different test departments, an MDC and an AEC matching the blueprint. The total should be 22 credits.
- [ ] For each S4 pilot, verify four fixed majors, SEC and VAC. The total should be 22 credits.
- [ ] Check that fixed majors resolve to the intended TT courses and cannot be replaced with another semester's paper.
- [ ] Enter ranked choices for elective components, up to the supported three choices per component.
- [ ] Submit all twelve pilots. Refresh and log back in to confirm that selections/ranks persist.
- [ ] Edit a pilot's preference order and resubmit. Verify that it updates the existing submission, preserves the original first-submission timestamp, and creates no duplicate registration/preference row.
- [ ] Test missing compulsory choices, duplicate course choices, invalid rankings, more than three preferences and wrong-semester courses. Record the rejection message or any defect.
- [ ] Test the requirement that the two S2 minor suppliers differ. Record the actual result; copying the source EXCLUDE_DEPT slots alone does not establish that this requirement is enforced.
- [ ] Confirm that another department's HOD cannot edit this student's academic record and a student cannot open director/HOD operations.

Registration checks blueprint eligibility; course prerequisites are evaluated during allocation. Include an S2 pilot that ranks Malayalam AEC first and Hindi second: submission should succeed for ITTT, and allocation should skip Malayalam because its prerequisite allows only HIN/MAL, then consider Hindi at rank 2. Also test an unmet prerequisite without a fallback, which should submit successfully and remain unallocated for that slot. Global baskets and EXCLUDE_DEPT remain shared across campuses as previously approved.

## 4. Expand the rehearsal to all 120 students

- The user tested initial login, submission, editing/resubmission and the HOD defaulter list manually, then authorized automated registration of the remaining test students. See [REGISTRATION_SEED.md](REGISTRATION_SEED.md) and [REGISTRATION_SEED_REPORT.json](REGISTRATION_SEED_REPORT.json) for execution/verification status. This seeds the backend registration workflow; remaining first-login/password/consent flows are not asserted to have been tested by the script.
- [x] The seed report verifies all 120 submissions: 60 S2 and 60 S4, with the original manual submission unchanged. Review its varied rankings and the deliberate no-fallback Malayalam AEC scenario.
- [ ] Use each HOD's student/defaulter views to verify the expected ten students per semester and track missing submissions.
- [x] Before allocation, reconciled 60 S2 and 60 S4 student submissions; no students were withheld. One ECOTT S2 submission intentionally has an unmet AEC prerequisite without a fallback.
- [ ] Plan any capacity stress scenario using test-owned courses before running allocation. Existing real-course capacities and enrolments are shared and should remain intact.

## 5. Close registration and test allocation

- [x] After submission checks, the user set a non-null past test deadline and S2 allocation completed.
- [ ] Confirm that a student cannot submit new/revised preferences after the deadline.
- [x] Ran **2026-27 / Semester 2**: 60 students, 59 fully allocated, one planned partial AEC, zero unallocated. See [ALLOCATION_S2_VERIFICATION.json](ALLOCATION_S2_VERIFICATION.json).
- [x] Ran **2026-27 / Semester 4**: all 60 fully allocated, 22 credits each, zero partial/unallocated. Saved fixed majors, SEC/VAC categories, submitted elective choices, semester and capacities pass readback checks. See [ALLOCATION_S4_VERIFICATION.json](ALLOCATION_S4_VERIFICATION.json).
- [x] Reconciled each run's status and totals: S2 is 59 fully allocated + one partial; S4 is 60 fully allocated. Each cohort totals 60.
- [ ] Verify only MANGATTT students are included, prerequisites and capacities are respected, and fixed TT majors are retained.
- [x] User completed and verified HOD manual resolution. ECOTT S2 010 now has `KU02AECHIN103TT` in AEC, 22 credits and HOD allocation metadata. Final saved totals are 60 complete S2 + 60 complete S4; see [MANUAL_ALLOCATION_VERIFICATION.json](MANUAL_ALLOCATION_VERIFICATION.json).

The deliberately partial S2 case is now resolved through the user's HOD flow using the approved test-owned Hindi AEC. All 120 students have six assigned papers and 22 credits. The automatic S2 run's original 59-full/one-partial summary remains historical; current registration rows are authoritative after the manual change. [ALLOCATION_TEST_FINDINGS.md](ALLOCATION_TEST_FINDINGS.md) records the picker issue, fix and checks.
- [ ] Compare final student registrations, HOD views and exports against the expected six-paper/22-credit combinations, allowing documented capacity failures until resolved.

## 6. Continue to timetable and attendance afterward

Registration and both allocation cohorts are verified. The first teacher pilot passed by user confirmation. The requested bulk teacher setup is now complete: 21 teachers cover all 58 enrolled courses (25 S2 and 33 S4), with all service rosters and timetable-loader mappings verified. Timetable entries remain zero. See [TEACHER_STAFFING.md](TEACHER_STAFFING.md).

- [x] User created `teacher.ecott.01.mangattt.20261018@example.test` through the ECOTT HOD flow and assigned `KU02DSCECO102TT`, S2 / 2026-27. Database readback confirms both records; see [TEACHER_ASSIGNMENT_VERIFICATION.json](TEACHER_ASSIGNMENT_VERIFICATION.json).
- [x] User confirmed pilot teacher login, first-login password change, consent, assigned course and logout/login passed.
- [x] User confirmed the assigned course roster contains **18 students**, including minors from other departments.
- [ ] Check that the teacher cannot access unassigned courses or HOD administration.

- [x] Created the authorized 20 additional teacher Auth/profile pairs in test departments; preserved the pilot and its password.
- [x] All 58 enrolled papers have intended test-campus teacher coverage, including Statistics and shared Hindi. Course rosters and timetable loader teacher mappings pass readback.
- [ ] New teachers complete first-login password change and policy acceptance when their UI workflows are tested; the fixture script does not assert these are passed.
- [ ] Deploy the locally verified semester/category rules editor fix, then configure the required S2/S4 category windows. See [TIMETABLE_RULE_EDITOR_FIX.md](TIMETABLE_RULE_EDITOR_FIX.md).
- [ ] As test campus director, review scheduling rules and generate S2 for 2026-27. Review unscheduled sessions, student/teacher clashes and practical blocks before publication.
- [ ] Publish the verified S2 draft, then generate/review S4 with shared-teacher reservations accounted for. Verify published student/teacher views for both cohorts.
- [ ] Test post-publication locks, geofence/time rules, attendance marking and reports.

[STAFFING_READINESS.md](STAFFING_READINESS.md) records the historical gap before staffing. The current setup and evidence are in [TEACHER_STAFFING.md](TEACHER_STAFFING.md).

Record observed results and defects as the UI tests run. A configuration/database verification is not an end-to-end pass for these remaining flows.
