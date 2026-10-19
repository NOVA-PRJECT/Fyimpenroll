# Bulk student upload counts

Fixed 19 October 2026.

The API returned `{ success, results }`, while the HOD page rendered missing `inserted_count` and `error_count` fields. React displayed blank values, and the success notification could contain an undefined count.

- API responses now include both numeric counts, derived from per-row success/error outcomes. Existing fields remain compatible.
- The page independently derives both totals from row outcomes, so the fix also works with older backend responses and cannot display stale aggregate totals.
- Zero is rendered explicitly. All-failed and mixed uploads show the number created and failed, preserve row-error details, and avoid a misleading success message.
- Invalid/unconfirmed responses instruct the HOD to check the student list before retrying. The UI's limit now matches the existing API limit of 100 rows.

## Verification

12 focused tests and 48 related regression tests passed. Backend build and final frontend production build/type checks passed.

Coverage includes all-success, all-failed, mixed and empty results; zero values; legacy responses without totals; inconsistent aggregate totals; incomplete responses; row validation; failed student inserts with existing Auth cleanup; and rendering the actual result-card component.

The browser file-upload permission was declined. That upload was not retried or bypassed. Instead, a separate **read-only** page rendered the real result-card component with in-memory dummy outcomes. It contained no file input, upload request or account creation. Verified displays:

- All failed: Created **0**, Errors **2**, with both duplicate-email details.
- All successful: Created **2**, Errors **0**.
- Mixed: Created **1**, Errors **1**.

See `all-failed-counts.jpg`. No production accounts or students were created for verification. No schema change was needed.
