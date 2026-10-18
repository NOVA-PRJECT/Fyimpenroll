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

Current state: all 120 students have matching password-change flags in Auth and their profiles, all require a first-login password change, and none had signed in at verification time. The test campus has 61 courses and twelve blueprints. Every uploaded student has the correct semester blueprint. There are no preference submissions, registration records, allocation runs or timetable entries for the test campus. Teachers are still deferred.

**The registration deadline is null, so submissions are currently closed.** Verification in this phase was read-only; passwords have not been tested by logging in and no registrations were submitted.

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

- [ ] Complete first-login/password/consent flows and valid submissions for the remaining 108 students.
- [ ] Vary elective preference rankings so allocation has useful first-, second- and third-choice cases to process.
- [ ] Use each HOD's student/defaulter views to verify the expected ten students per semester and track missing submissions.
- [ ] Before allocation, reconcile 60 S2 and 60 S4 student submissions. Keep records of any deliberately withheld negative-test submissions.
- [ ] Plan any capacity stress scenario using test-owned courses before running allocation. Existing real-course capacities and enrolments are shared and should remain intact.

## 5. Close registration and test allocation

- [ ] After the submission checks, set the test deadline to a real timestamp in the past. Keep a non-null expired deadline: the allocation guard does not treat a null deadline as ready for allocation.
- [ ] Confirm that a student cannot submit new/revised preferences after the deadline.
- [ ] As the test director, run allocation for **2026-27 / Semester 2**, then separately for **2026-27 / Semester 4**.
- [ ] Check each run's status and totals. With all students included, fully allocated + partially allocated + unallocated must equal 60 per semester.
- [ ] Verify only MANGATTT students are included, prerequisites and capacities are respected, and fixed TT majors are retained.
- [ ] Review unresolved students and remaining seats as the appropriate HOD; use the normal manual-resolution flow where required.
- [ ] Compare final student registrations, HOD views and exports against the expected six-paper/22-credit combinations, allowing documented capacity failures until resolved.

## 6. Continue to timetable and attendance afterward

Once registration/allocation are verified, prepare the teacher/class/course assignments needed for timetable generation. Teacher creation was deferred by the user and has not been performed. The later rehearsal should cover generation, conflicts, publication, student timetable visibility, post-publication registration locks, geofence/time rules, attendance marking and reports.

Record observed results and defects as the UI tests run. A configuration/database verification is not an end-to-end pass for these remaining flows.
