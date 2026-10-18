# Completed test-campus cleanup

**COMPLETE_VERIFIED** at 2026-10-18T15:42:23.029513+00:00.

Removed 921 reviewed public rows and 151 linked Auth users under MANGATTT. No selected users, sessions, refresh tokens, identities or MFA factors remain. All 27 preserved public-table fingerprints, 258 other Auth accounts and the real shared Hindi course are unchanged. The published timetable guard is enabled and unchanged.

The user explicitly instructed deletion without a full backup. No full backup or restore test was performed. Historical fixture snapshots remain under ignored scratch; they are not a full recovery backup.

- [CLEANUP_VERIFICATION.json](CLEANUP_VERIFICATION.json): independent final readback.
- [PUBLIC_DELETION_REPORT.json](PUBLIC_DELETION_REPORT.json) and [AUTH_DELETION_REPORT.json](AUTH_DELETION_REPORT.json): actual counts.
- [EXECUTION_AUTHORIZATION.json](EXECUTION_AUTHORIZATION.json): user instruction.
- [CLEANUP_MANIFEST.json](CLEANUP_MANIFEST.json): reviewed IDs, marked executed.
- [TEST_RESULTS.json](TEST_RESULTS.json): historical rehearsal evidence; S2 timetable was unresolved.

All deleted test credentials are invalid. Verify saved evidence offline with verify-package.cjs.
