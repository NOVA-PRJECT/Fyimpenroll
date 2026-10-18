# Teacher pilot: next manual test

Status: the user reports that teacher login, password change, consent, assigned course, 18-student roster and logout/login checks passed. Auth readback confirms a sign-in and a cleared password-change flag. Creation and assignment were previously verified in the database. Both student cohorts have all six papers and 22 credits. See [TEACHER_ASSIGNMENT_VERIFICATION.json](TEACHER_ASSIGNMENT_VERIFICATION.json).

1. Sign in as ECOTT HOD and open **Faculty Assignment → Add Teacher**.
2. Create **TT ECOTT Teacher 01**, email `teacher.ecott.01.mangattt.20261018@example.test`. The requested initial password is recorded in the ignored [pilot credentials file](../../scratch/mangat-replica-2026-10-18/TEACHER_PILOT_CREDENTIALS.md).
3. Select **Semester 2**, assign this teacher to `KU02DSCECO102TT` for **2026-27**, and save the assignment.
4. Sign in as the teacher, complete the first-login/password/consent flow, and verify `KU02DSCECO102TT` for S2 / 2026-27 with **18 students**. This roster includes students from other departments taking the paper as a minor.
5. Test that this teacher cannot access unassigned courses or another department's administration. Record actual results.

Steps 1–4 are complete, including logout/login with the changed password. Step 5 remains pending. Assignment/delivery ID: `b43b0281-7381-41d2-b1cb-43103ca98a5d`. Teacher ID: `cae5274b-7876-4826-bc5a-c8fcaf970d68`.

Bulk staffing was subsequently authorized and completed: 21 teachers cover all 58 enrolled papers, including shared Hindi. The pilot now has three assigned papers totaling 12 weekly contact hours; the original KU02DSCECO102TT assignment and changed password are preserved. See [TEACHER_STAFFING.md](TEACHER_STAFFING.md). Timetable generation and review are next.
