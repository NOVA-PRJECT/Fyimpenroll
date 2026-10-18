# Cleanup review — MANGATTT

**CURRENT STATUS: CLEANUP COMPLETE AND VERIFIED** at 2026-10-18T15:42:23.029513+00:00. User explicitly authorized deletion without a full backup. All 921 selected public rows and 151 linked Auth users are removed, with other data preserved. See [CLEANUP_VERIFICATION.json](CLEANUP_VERIFICATION.json) and [EXECUTION_AUTHORIZATION.json](EXECUTION_AUTHORIZATION.json). Everything below is the historical preparation/review record; its earlier backup/approval blocks were superseded by that user instruction.


**Prepared only. Nothing has been deleted or changed in production.** The user authorized cleanup preparation, not deletion. A recoverable backup and a separate deletion confirmation are required before execution.

Inventory: 2026-10-18T15:08:36.633277+00:00 (20:38 IST on 18 October 2026). Project `lhnjlwtdphugjaluzrsp`; campus `b72074e2-468e-4218-afb6-0f08f14cfe8f`, **Test KUC Mangattuparamba TT / MANGATTT**.

## Exact proposed scope

| Records | Count |
|---|---:|
| Campus / settings / departments | 1 / 1 / 8 |
| Test-owned courses / blueprints | 62 / 12 |
| Students / faculty profiles | 120 / 31 |
| Registrations / preferences | 120 / 120 |
| Teacher course assignments | 58 |
| Published S4 timetable periods | 110 |
| Attendance marks / attendance sessions | 30 / 3 |
| Consent records | 13 |
| Test-owned system/audit/job log rows | 232 |
| **Public-table rows total** | **921** |
| **Auth users, separately** | **151** |

Auth scope: 120 students, 21 teachers, eight HODs, one director and one teaching-staff account. All 151 IDs have both a test-campus profile and matching server-owned Auth campus metadata and the exact fixture email namespace. There are no orphan accounts with these fixture markers. Three Auth sessions, four refresh-token rows and 151 identities currently belong to these accounts; these are dependencies, not extra user accounts. Session/refresh counts may change.

[CLEANUP_MANIFEST.json](CLEANUP_MANIFEST.json) lists every selected public primary key and every Auth ID/email. Zero-count tables are included to make scope explicit. Ownership is based on the exact campus/departments/student IDs and dependent records. A suffix match alone never selects a record.

## Records to preserve

- All four other campuses, 13 other departments, 240 other students, 17 other faculty and **258 other Auth users**.
- All 127 non-test-owned courses, 25 other blueprints, three other teacher assignments, 121 other timetable periods and 190 other registrations.
- **KU02AECHIN103**, ID `998462b9-bfb7-470e-bed1-319c1fe182de`, and its owner campus. Fifty-nine test students use it; one test-campus teaching assignment delivers it. Remove only those selected test references, not the course or its real enrolments/deliveries.
- All 30 global time slots, all schema migration rows, functions, policies and permanent configuration.
- No Storage objects currently exist; do not delete buckets or assume a later upload is test-owned.

Formal foreign-key and embedded UUID/course-code scans found **zero preserved rows pointing to selected test records**. Recheck immediately before any execution. Non-test preservation counts/fingerprints are recorded in the manifest without exporting their row contents.

## Proposed execution sequence after approval

1. Confirm an independently recoverable database backup or PITR point covering the completed rehearsal. Record its completion time/range in BACKUP_STATUS.json. The local fixture snapshot cannot restore the full database or Auth passwords.
2. Stop using all test accounts and stop fixture automation. Re-run the three read-only SQL checks. Confirm exact campus identity, all primary keys/counts/fingerprints, no active test jobs, no outside references and no newly created test records. Any drift requires a refreshed review.
3. Obtain explicit approval for **921 public rows and 151 Auth users**, updated to the final recheck if necessary.
4. Prepare the public-data transaction from the approved ID manifest, with exact-row assertions, appropriate relation locks and before/after fingerprints for every preserved public table. Abort/roll back if a selected row changed or any preserved row changes.
5. Handle the published timetable guard in that same transaction: it currently rejects deleting any published entry, including a cascade from campus deletion. A reviewed maintenance operation must hold an exclusive timetable-table lock, suspend only the named published-entry trigger, delete only the 110 approved timetable IDs, and restore that trigger before commit. No other session can write the timetable during the lock. Do not disable all triggers, alter the guard function, or unpublish real timetables.
6. Delete explicit child IDs before parents: attendance/unlocks and campus sign-ins; registration preferences and registrations; timetable conflicts and entries; teacher assignments and notices; course prerequisites and blueprints; courses; consent and selected log rows; promotion/graduation/retirement dependents; students and faculty; settings, departments and the campus. Delete timetable entries before assignments so assignment-deletion triggers have no test timetable rows left to modify. Verify every selected count and all preserved fingerprints before commit.
7. Once public cleanup succeeds and protected handlers reject the missing test profiles, remove exactly the approved 151 users through the **Supabase Auth Admin API**. Check IDs/metadata again before each operation, use a resumable checkpoint and verify session/identity cleanup. Never delete Auth by a wildcard email search. Auth API deletion is separate from the database transaction; do not claim it is one atomic rollback.
8. Read back zero remaining selected public/Auth records, unchanged non-test fingerprints, unchanged global time slots and the published guard re-enabled. Check sign-in rejection for removed test users and access for a real authorized account. Archive the execution report alongside this package.

No destructive executor has been created or run in this preparation phase. The maintenance transaction and resumable Auth executor must be reviewed against the approved, refreshed manifest before use.

## Saved evidence and limitations

- User confirms no managed backup on the free tier. Use [MANUAL_BACKUP.md](MANUAL_BACKUP.md) for a manual backup; its script is prepared but cannot run until the missing local tools and database connection are available.

- [TEST_RESULTS.json](TEST_RESULTS.json): independent counts, user-reported UI passes, open S2 issue and deployment limitation.
- [BACKUP_STATUS.json](BACKUP_STATUS.json): **backup unverified; deletion blocked**.
- [ROLLOUT_CHECKLIST.md](ROLLOUT_CHECKLIST.md): final deployment, recovery and smoke checks.
- Private fixture data and schema/trigger snapshots: `scratch/mangat-replica-2026-10-18/cleanup/`, ignored by Git. No password hashes or session/refresh tokens were exported.
- Run `node testing/mangat-replica-2026-10-18/cleanup/verify-package.cjs` to check the local package.
