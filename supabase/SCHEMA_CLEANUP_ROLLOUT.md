# Application schema cleanup

This release removes `student_registrations.preferences` and `selected_courses` without creating a replacement preferences snapshot. Current ranked choices remain in `registration_preferences.preferences`; confirmed courses remain in the eight registration course slots. `selections` retains historical course/credit snapshots and is never an enrolment fallback.

## Final schema

- `semester_blueprints.pathways` is the sole blueprint configuration. Existing JSON is preserved; flat-only configurations become the same `legacy-default` pathway before their 18 flat columns are removed.
- `student_registrations.allocation_metadata` is current allocation state. The former preference-table copy becomes `legacy_allocation_metadata_snapshot`. Existing values survive exactly; new submissions leave it null and no application code reads or updates it.
- Allocation/timetable status comes from `system_logs` with explicit `log_type` filters. API mapping preserves the existing allocation status response. The three compatibility views and their write trigger functions are removed.
- Course tags, unused `time_slots` lab fields, redundant graduation ID arrays and `stage_details` are removed. Graduation candidate records and operation summaries remain.
- The unreachable semester-11 graduation trigger and function are removed. Explicit graduation, Auth cleanup and retries remain.
- The separate prerequisite retirement migration removes the old rule engine while preserving the ordered JSON points. Prerequisite answers remain browser-only.

## Release sequence

The compatible JSON prerequisite migration `20261025044031` is already live. Both retirement migrations have been applied to production, as confirmed by the owner and a read-only schema/readiness check on October 25, 2026. Backend/frontend publication is still outstanding. **Do not rerun these files on the cleaned database.** The sequence below is retained for older environments and recovery rehearsal:

1. `20261025044158_retire_legacy_course_prerequisites.sql`
2. `20261025062135_consolidate_application_schema.sql`

Do not run the historical migration directory against production. Do not use the fresh-project bootstrap on the existing project. Keep applied migration history unchanged.

1. Schedule maintenance and pause application writes, including registrations, HOD changes, manual placement, attendance and graduation. Drain allocation/timetable workers and resolve pending graduation operations. The migration fails if active worker or unfinished graduation records remain; investigate rather than deleting those records to bypass the check.
2. Take a project recovery backup as appropriate for the environment. Export application records with a new ignored filename:

   ```powershell
   node --env-file=backend/.env scripts/export-schema-cleanup.cjs scratch/schema-cleanup-release.json
   ```

   The export reads all 27 public application tables twice, refuses intervening changes, refuses an existing filename and verifies its saved JSON. It includes historical preference values, tags and all retained records. Keep this sensitive file outside source control. This application export does not contain Auth credentials, provider configuration, Storage objects or platform secrets.
3. Rehearse the exact export locally:

   ```powershell
   node scripts/rehearse-schema-cleanup.cjs scratch/schema-cleanup-release.json
   ```

   This uses isolated PGlite, restores the old application schema and exported records, and applies both retirement migrations. It never connects to production. The temporary Auth IDs are only local placeholders; this is not an Auth backup or restoration procedure.
4. Deploy the matching backend and frontend with traffic still paused. The new readers work with existing JSON pathways and canonical log rows. Verify that no previous backend instance or background worker remains active, then apply only the two retirement migrations through the production migration workflow. Each migration is transactional; cleanup uses a ten-second lock timeout and a sixty-second statement timeout.
5. Before reopening writes, run:

   ```powershell
   node --env-file=backend/.env scripts/verify-schema-cleanup.cjs scratch/schema-cleanup-release.json
   ```

   This compares every retained table with the export, allowing only the declared removals, metadata rename and blueprint conversion. The migration itself also checks row counts and retained-data fingerprints within its transaction. Confirm `SELECT public.production_readiness();` returns `ready: true` and verify that the retired table, views, functions and columns are absent.
6. Smoke-test HOD blueprint save/reload, student preference submission/editing, registration without a preference row, allocation status, manual placement/course change, reports, timetable status and attendance. Verify supported mobile clients; force web tabs to reload. Reopen traffic only when these checks pass.

## Recovery and provisioning

A failed migration rolls back its own changes; the preceding prerequisite retirement remains applied if it succeeded separately. Keep the matching application release running while investigating. A successful cleanup removes historical column values from the live database, so reverting to an old application requires restoring the corresponding schema/functions and removed values from the verified export or project recovery backup first. Do not deploy the old backend against the retired schema. If writes have resumed, reconcile new records before any restoration; never overwrite the whole database with an older export.

For fresh projects, `baseline/bootstrap.psql` applies the historical snapshot, reference periods, teacher changes, compatible prerequisite field, prerequisite retirement and schema cleanup in order. Existing historical snapshot/migration files stay unchanged. Run `npm test`, `npm run build:frontend`, and mobile typecheck/export for release verification.

## Verification performed during implementation

The ignored backup `scratch/schema-cleanup-before-2026-10-25.json` contains 27 tables, 191 registrations and 127 courses. Rehearsal retained every assigned course, registration credit total and course snapshot, preserved all 127 prerequisite lists, and passed readiness. This is a development-time rehearsal; repeat the export and rehearsal at cutover because live data may change.
