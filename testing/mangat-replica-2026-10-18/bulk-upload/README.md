# Student bulk upload — MANGATTT

Six CSVs contain **120 synthetic test students**: 20 per department, with ten in Semester 2 and ten in Semester 4. The user uploaded all six files, and the final database comparison verified every row and all 120 confirmed Auth/profile pairs. See [the verification report](../STUDENT_UPLOAD_VERIFICATION.json) and [the next test steps](../NEXT_STEPS.md). The upload steps below remain as a reference; the current cohort is already present.

## Exact header contract

Every CSV starts with this exact, case-sensitive line:

```csv
full_name,cap_application_number,academic_year_joined,current_semester,email
```

The frontend checks these five lowercase names with underscores. The files contain only these columns, with no title row, index column, comments, blank records or password field. They use commas, UTF-8 without BOM and CRLF line endings.

| Column | Prepared value |
|---|---|
| `full_name` | A synthetic name prefixed with `TT`, the department code and semester. |
| `cap_application_number` | A unique value such as `TTMANGAT20261018-ECOTT-S2-001`. |
| `academic_year_joined` | `2026-27` for 2026-admission S2 students; `2025-26` for 2025-admission S4 students. |
| `current_semester` | `2` or `4`. |
| `email` | A unique synthetic login under `example.test`. |

**Campus and department are assigned from the logged-in HOD.** The upload reads them from that HOD's authenticated session. Use the matching test HOD below so all records belong to the intended department under MANGATTT.

## File and HOD mapping

| Department | CSV | Upload while logged in as | S2 | S4 | Total |
|---|---|---|---:|---:|---:|
| Economics — ECOTT | [ECOTT](ECOTT_students_S2_S4.csv) | `hod.ecott.mangattt.20261018@example.test` | 10 | 10 | 20 |
| Environmental Studies — EVSTT | [EVSTT](EVSTT_students_S2_S4.csv) | `hod.evstt.mangattt.20261018@example.test` | 10 | 10 | 20 |
| Information Technology — ITTT | [ITTT](ITTT_students_S2_S4.csv) | `hod.ittt.mangattt.20261018@example.test` | 10 | 10 | 20 |
| Mathematical Science — MATTT | [MATTT](MATTT_students_S2_S4.csv) | `hod.mattt.mangattt.20261018@example.test` | 10 | 10 | 20 |
| Physical Education and Sports — PESTT | [PESTT](PESTT_students_S2_S4.csv) | `hod.pestt.mangattt.20261018@example.test` | 10 | 10 | 20 |
| Behavioural Sciences — SBSTT | [SBSTT](SBSTT_students_S2_S4.csv) | `hod.sbstt.mangattt.20261018@example.test` | 10 | 10 | 20 |

Statistics and Wood Science are excluded because they have no saved S2/S4 programme blueprints in the replicated source.

## Upload steps

1. Log in as the matching test HOD using the initial staff password `Password123!`.
2. Confirm the HOD belongs to **Test KUC Mangattuparamba TT / MANGATTT** and the intended test department.
3. Open **Bulk Upload** and select that department's CSV.
4. Enter **`Password123!`** in **Batch Default Password**. This value is entered in the form, separately from the CSV.
5. Upload the file and check the per-row results. A first successful upload should have 20 successful rows and no errors.
6. Open the Students tab and check both semester filters: ten students in S2, ten in S4, all with the matching `TT` department name and CAP prefix.
7. Log out and repeat for the other five HODs. Keep each department in its own upload.
8. For the student rehearsal, use an email from the uploaded file and initial password `Password123!`. The bulk upload sets `must_change_password: true`, so complete the password change on first login and record the new test password locally.

Each file has 20 rows, within the backend's actual maximum of 100 per request. The final expected campus total after all six successful uploads is 120 students: 60 in S2 and 60 in S4.

## Verification performed

The files were authored as raw tables and all six previews were visually checked. An independent Python CSV reader then verified the exact application headers, five fields per row, 20 rows per file, admission-year/semester pairing, names and department markers, global CAP/email uniqueness, line endings and file hashes. A read-only live database check found zero existing matches for these CAP numbers or synthetic student emails, and zero existing students in the test campus at check time. See `BULK_UPLOAD_VALIDATION.json` for the recorded results.

The CSVs contain the baseline data for the six departments. Their normal HOD uploads are now complete and verified; the initial CSV preparation itself made no student/Auth writes.

## Existing upload-summary issue found during code review

The current frontend reads `inserted_count` and `error_count` from the response. The current backend bulk-upload method returns `{ success: true, results }` without those count fields. If this code is deployed, summary totals can show `undefined` even when individual rows succeeded. Verify the per-row results and Students tab as described above. This CSV preparation did not modify that application code.

Header/form rules were checked against `frontend/src/app/dashboard/hod/page.tsx`; request limits and field handling were checked against `backend/src/modules/hod/hod.controller.ts` and `backend/src/modules/hod/hod.service.ts`.
