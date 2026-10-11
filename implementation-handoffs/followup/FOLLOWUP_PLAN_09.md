# Follow-up 09: enrollment, credit ledger and exports

Date: 2026-10-10. Local behavior implemented; academic policy and live PostgREST checks remain explicit.

## Findings

| Finding | Local result | Remaining qualification |
|---|---|---|
| R23 | Queries use submitted_at, time_slots relationships, signed_in_date/signed_in_at and explicit faculty ID lookup. | Live PostgREST relationship discovery must be checked after migration. |
| R24 | Statements derive course lists from actual enrollment, filter published host-campus/current-year periods, show NA with no marks, and weight overall percentage by periods. | Cancellation, unmarked, late-enrollment and optional-paper institutional denominator policy is not approved. |
| R25 | Course serial never determines level. Explicit valid catalogue levels are accepted; otherwise Unknown. Unapproved degree judgments/targets are null and UI no longer invents benchmark targets. | Approved academic-level mapping and degree matrix. |
| R26 | Flat slots are authoritative; removed JSON selections never add enrollment. New/changed enrollment snapshots are transactional. Missing old snapshots are disclosed. | Historical credits cannot be reconstructed without an authoritative source. |
| R33 | Required-slot completion comes from the chosen pathway; additional papers cannot satisfy missing required papers. | Missing/ambiguous blueprints report Unknown, not fabricated completion. |

## Contracts

`registrationSlots` and `registrationCompletion` in `backend/src/modules/credit-ledger/enrollment-reporting.ts` provide the reporting enrollment contract. A slot's course ID is authoritative. `selections` stores compatible per-slot snapshots (`course_id`, `slot`, `credits`, `category`, `academic_level`, `snapshotted_at`) and never supplies additional enrollment. Re-enrollment after replacement captures a new snapshot; unchanged courses retain prior snapshots. Legacy missing snapshots are not fabricated during reconciliation. Ledger rows retain semester/year identity, including repeated courses in different registrations.

`20261010060000_followup_plan09_registration_snapshots.sql` adds a BEFORE INSERT/UPDATE trigger covering every registration writer. Its reconciliation update removes stale selections while preserving known snapshots and recording no invented historical values. Back up registrations before applying it. Roll back through a reviewed forward migration; do not restore stale selections as enrollment authority.

Attendance statement denominator is **the student's explicitly marked published dated periods in the current campus academic year**. Numerator uses the same set's present marks. Two practical slots remain two distinct periods. Unmarked periods are excluded, never fabricated as absences. Overall = 100 × sum(present periods) / sum(marked periods); 1/1 plus 0/9 is 10%. NA means no denominator. This operational measure is labeled in the workbook and is not an approved statutory cancellation/late-enrollment policy.

The ledger exposes `creditSource`, `historicalSnapshotsComplete`, `requirementsAvailable: false`, null matrix/degree targets, and Unknown levels. Current catalogue fallback totals remain useful but are explicitly not certified historical totals. CSV/XLSX remain formula-safe; JSON retains the original text.

## Scope and completeness

ExportService scopes before filters. Students see their own registered published term classes; teachers see exact assigned host-campus/year/semester delivery and unrelated course columns are redacted. Visiting teachers do not inherit their home-campus roster. HOD and director scope fail closed without affiliations. Teaching staff remains roster-only. Unresolved allocation reports are administrative (HOD/director/superadmin); teachers use their assigned class roster. GPS exports remain director/superadmin only and omit coordinates. Faculty lookup errors propagate instead of silently reporting Unassigned.

Every operational export and statement query uses ordered complete-set loading. `fetchAllPaginated` advances by actual returned size, so an API cap smaller than the requested page size does not truncate results. An empty page ends traversal; exceeding the bounded safety limit fails visibly. This changes the old mock expectation from three pages to three data pages plus an empty sentinel.

## Verification and consumers

- `backend/test/followup-reporting.test.js`: production services with capped PostgREST transport; parses CSV/XLSX, verifies names/dates, scope, one-paper research completion, removed selections, 1/10 attendance, NA, formula handling and >1,000 rows.
- `backend/test/followup-recoverable-graduation.test.js`: real PostgreSQL trigger test proves a catalogue edit cannot change stored credits and course replacement removes the old snapshot.
- `backend/test/credit-ledger-exports.test.js` and `followup-security-privileges.test.js`: retained regression fixtures updated to current schema and Unknown-level contract.
- `frontend/src/components/credit-ledger/CreditLedgerView.tsx`: policy-pending category/level reporting; no invented regulation target.

These are real production-service/SQL tests, not a live Supabase/PostgREST or institutional-template certification. Approved spreadsheet layouts, credit enforcement and academic matrices remain policy-pending. R04/R36 export consumer tests now pass locally; full production scope/schema verification remains in the release runbook.
