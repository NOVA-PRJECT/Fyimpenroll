# Implementation Handoff — Plan 09: Registered-Credit Ledger and Scoped Exports

## 1. Findings Status Summary

| Finding | Priority / Severity | Status | Precise Rationale |
|---|---|---|---|
| **F50** | P2 / Medium | **Completed** | Registered vs certified credits & registration-time snapshot preservation. Refactored `CreditLedgerService` and `CreditLedgerView.tsx` to eliminate false degree certification claims. Labeled totals as registered/allocated credits and requirement comparisons as advisory. Separated totals into explicit **core credits** (slots 1–6) and **additional credits** (slots 7–8 / selections). Preserved registration-time credit snapshots in `student_registrations.selections` so subsequent catalog course edits cannot rewrite historical student totals. Added `advisoryMatrixVersion`, `disclaimer`, and `unresolvedRequirementNote` to the payload. |
| **F51** | P1 / Medium | **Completed** | Kannur University course-code parsing & academic-level derivation. Replaced `courseCode.replace(/\D/g, '')` leading-digit derivation (which misclassified all 64 KU course codes, e.g. `KU03DSCCSE201` classified as `Other` by semester prefix `03`). Implemented `parseKuCourseCode(code, explicitLevel)` decomposing `KU`, semester (`01`–`10`), canonical categories (`MOOC`, `DSC`, `DSE`, `MDC`, `AEC`, etc.), discipline (`CSE`, `MAT`, `ENG`, etc. with aliases like `CSE` ↔ `IT`), and serial number (`101`, `201`, `301`, `401`, `501`). Suffix first digit determines level band (`100s`, `200s`, `300s`, `400s`, `500s`), and unmapped codes return explicit `Unknown` rather than silently inventing levels. |
| **F52** | P2 / Medium | **Completed** | Versioned advisory requirement matrix & unresolved requirement notes. Replaced conflicting hardcoded certification thresholds (139 vs 133 and 197 vs 177) with `ADVISORY_MATRIX_VERSION = 'KU-FYIMP-2024-V1-ADVISORY'`. Marked all degree exit benchmarks as advisory targets. Displayed observed registered credits alongside an explicit `unresolvedRequirementNote` where regulations vary by pathway (e.g. Major/Minor distribution or Honours with Research). Advisory evaluations never assert definitive degree compliance or block active student registrations. |
| **Exports** | P1 / High | **Completed** | Proposed export contract implementation (7 scoped exports). Built `ExportService` and `ExportController` providing CSV, XLSX (via `exceljs`), and JSON formats for: (1) Final Registrations (all 8 papers, core/additional credits, allocation state), (2) Unresolved Allocations, (3) Campus-Class Rosters, (4) Timetables (drafts flagged as `[DRAFT]`), (5) Period Attendance (with denominator/coverage metadata, practicals counted twice), (6) GPS Sign-ins (never exports raw coordinates by default), and (7) Registered-Credit Ledger. Sanitized all user-controlled spreadsheet cells via `sanitizeSpreadsheetValue` against formula injection (`=`, `+`, `-`, `@`, `\t`). |

---

## 2. Changed Files & Migrations

### Modified Files:
- `backend/src/modules/credit-ledger/credit-ledger.constants.ts`:
  - Added `ADVISORY_MATRIX_VERSION`, `ADVISORY_CREDIT_DISCLAIMER`, `UNRESOLVED_REQUIREMENT_NOTE`.
  - Added `parseKuCourseCode`, `DEPARTMENT_ALIASES`, `CANONICAL_CATEGORIES`, `ADVISORY_DEGREE_EXIT_TARGETS`.
- `backend/src/modules/credit-ledger/credit-ledger.service.ts`:
  - Refactored `deriveLevelBand` to use `parseKuCourseCode`.
  - Separated `coreCredits` (slots 1–6) and `additionalCredits` (slots 7–8 / selections).
  - Preserved registration-time credit snapshots from `selections`.
  - Added advisory metadata and honest benchmark status.
- `backend/src/modules/credit-ledger/credit-ledger.module.ts`:
  - Registered `ExportService` and `ExportController`.
- `backend/src/modules/credit-ledger/export.service.ts` *(New File)*:
  - Generates the 7 scoped export formats with role-based scoping, formula sanitization (`sanitizeSpreadsheetValue`), and XLSX/CSV generation.
- `backend/src/modules/credit-ledger/export.controller.ts` *(New File)*:
  - REST controller under `/api/export` handling file downloads (`Content-Disposition: attachment`) and JSON responses.
- `backend/src/modules/hod/hod.service.ts`:
  - Updated `exportStudentsExcel` to export all 8 papers and core/additional/total credits.
- `frontend/src/components/credit-ledger/CreditLedgerView.tsx`:
  - Updated labels to "Registered Credits", rendered advisory notice banner, displayed core/additional breakdown, and added CSV/XLSX export links.
- `backend/test/credit-ledger-exports.test.js` *(New File)*:
  - 14 automated unit tests covering all Plan 09 requirements.

### Migrations Created:
- `supabase/migrations/20261007060000_plan09_credit_ledger_and_scoped_exports.sql`:
  - Additive migration adding optional `academic_level VARCHAR(10)` column on `courses`.
  - Added performance indexes `idx_student_registrations_sem_student` and `idx_period_attendance_export_lookup`.
  - Recorded in `schema_migrations`.

---

## 3. Downstream Contracts & Invariants

1. **Advisory Credit Ledger Contract:**
   - Any service consuming `CreditLedgerService.getCreditLedger` receives `{ totalRegisteredCredits, coreCredits, additionalCredits, advisoryMatrixVersion, disclaimer, categories, levelBands, exitEligibility, registeredCourses }`. It must treat totals as registered academic credits, not certified earned degrees.
2. **KU Course Code Structure (F51):**
   - Course codes follow `KU` + `[Semester: 01-10]` + `[Category: DSC/DSE/etc.]` + `[Discipline: CSE/MAT/etc.]` + `[Serial: 101/201/301/401/501]`. Level band is derived strictly from serial leading digit or explicit `academic_level`, never from semester prefix.
3. **Formula Injection Defense:**
   - All spreadsheet exports sanitize cells starting with `=`, `+`, `-`, `@`, `\t`, `\r` by prefixing with `'`.
4. **Attendance Denominator Consistency:**
   - Period attendance exports reflect distinct conducted sessions with practical blocks counted twice, carrying as-of timestamps and coverage percentages.
5. **GPS Coordinate Privacy:**
   - GPS sign-in exports never include raw latitude/longitude coordinates by default.

---

## 4. Policy Choices Kept Unchanged & Undecided Decisions

1. **Official University Excel Template:**
   - No university-mandated template format was provided; exports provide clean, portable CSV and structured XLSX recommendations.
2. **Examination Subsystem:**
   - The portal remains an academic-assistance tool for course registration and timetable allocation; examination evaluation and degree certification remain outside scope.
3. **Serial-to-Level Convention:**
   - Follows Kannur University FYIMP standard serial numbering (100-series = introductory, 200-series = intermediate, 300-series = advanced, 400-series = honours, 500-series = PG). Non-matching codes are explicitly labeled `Unknown`.

---

## 5. Verification Evidence

- **Automated Backend Tests:**
  - `backend/test/credit-ledger-exports.test.js`: **14 tests passing, 0 failing**.
  - Full suite (`npm --prefix backend run test`): **127 automated tests across 62 test suites**, passing with **0 failures**:
    - Plan 01: 22 tests passing
    - Plan 02: 14 tests passing
    - Plan 03: 12 tests passing
    - Plan 04: 16 tests passing
    - Plan 05: 11 tests passing
    - Plan 06: 14 tests passing
    - Plan 07: 13 tests passing
    - Plan 08: 11 tests passing
    - Plan 09: 14 tests passing
- **Backend Build:** `npm --prefix backend run build` (`nest build`) compiles with 0 errors.
- **Frontend Build:** `npm --prefix frontend run build` (`next build` Next.js 16.4.0 Turbopack) compiles with 0 errors across all 20 routes.

---

## 6. Remaining Downstream Work (Plan 10)

- **Receiving Plan:** **Plan 10: Regression closure, documentation, audit handoff and final verification**.
- **Scope for Plan 10:**
  - Verify screen/export agreement across all operational tabs.
  - Full end-to-end regression validation covering Plans 01–09.
  - Final consolidated handoff documentation.
