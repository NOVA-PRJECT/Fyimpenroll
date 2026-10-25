# Plain-English prerequisite release

Courses now store an ordered `prerequisites` JSON array. HODs configure up to 20 points, each 1–500 characters. Student answers are temporary browser guidance; neither registration requests nor allocation store or evaluate them. Fixed papers and manual placement show the points as information.

Selecting a course with prerequisites immediately opens that course's confirmation modal, including when it was previously accepted. Before overall submission, a separate review modal groups all prerequisite points by course across every ranked choice and fixed paper. Students can return to edit their choices or confirm the final submission; opening or cancelling the review sends no registration request.

## Existing production database

**Status, October 25, 2026:** prerequisite retirement and the broader schema cleanup are applied. The old prerequisite table and UUID column are removed; JSON prerequisite points remain. Publish the matching application code. The cutover steps below document the procedure for older environments; do not rerun applied retirement migrations.

The compatible first stage, `20261025044031_plain_course_prerequisites.sql`, is applied to production. It adds and validates the JSON list while preserving the legacy table, column and RPCs. On 2026-10-25, all 38 Semester 4 courses received 101 practical knowledge/skill points at the user's request. These are drafts, not official university prerequisite statements; see `scripts/data/semester-4-prerequisites.json`.

Release the backend, frontend and remaining retirement migration together during a registration/allocation maintenance window. An old backend references the table and column that retirement removes. Do not apply retirement while that backend is serving requests. Existing JSON lists must be preserved.

1. Pause registration edits, course edits, student course changes, manual placement and allocation runs. Wait for in-flight jobs to finish.
2. Export and verify the legacy configuration with backend credentials:

   ```powershell
   node --env-file=backend/.env scripts/export-legacy-prerequisites.cjs scratch/prerequisites-before-release.json
   ```

   Use a new filename: the script refuses to overwrite a backup and verifies its saved JSON. Keep the output outside source control. Repeat at cutover even if a development-time backup already exists.
3. Back up current JSON prerequisite lists as well as the legacy export. For an environment that has not retired the old engine, apply the migration `20261025044158_retire_legacy_course_prerequisites.sql` through the established production migration workflow. It preserves the configured JSON lists, replaces dependent routines, then drops the old rule table and UUID column. It never converts department restrictions into guidance. It uses a transaction and fails if locks cannot be acquired promptly.
4. Deploy the matching backend and frontend before reopening traffic. Force existing portal tabs to reload. Rebuild/publish the mobile app for numbered points; older mobile apps can still read the derived textual course-details field.
5. Verify HOD Save/Cancel, point reordering, student Yes/No across ranks and refreshes, fixed-paper guidance, manual-placement capacity, and `SELECT public.production_readiness();`. Ask HODs to populate the new lists.
6. Reopen registration and allocation. Existing submitted preferences and confirmed registrations remain intact and do not require server-side declarations.

## Recovery

A failed migration rolls back its database changes. After a successful cutover, keep the matching application version deployed. Restoring the old application requires restoring its old schema and legacy configuration together from the verified backup or a project backup; do not deploy old code against the new schema. Student answers have no database recovery step because they are never stored there.

## Fresh databases and verification

`baseline/bootstrap.psql` applies both schema stages after the historical snapshot and teacher-change repair. Keep the historical snapshot/migration files unchanged. The isolated database regression suite exercises this same sequence, including existing legacy rows, JSON validation, guarded course updates, reference integrity and backend-only access.

Allocation retains preference rounds, global capacity, semester proximity, submission-time and student-ID tie-breaks. Same-semester eligibility normally makes proximity zero. Academic blueprint rules remain in effect.


## Semester 4 guidance data

`supabase/data/semester_4_prerequisites.sql` was executed against the reviewed 38-course live catalogue on 2026-10-25. It uses course codes and exact titles rather than generated IDs, changes only Semester 4, validates catalogue coverage, and refuses to overwrite existing guidance. Do not rerun it after HOD edits. The data is deliberately separate from schema bootstrap because a fresh database has no uploaded course catalogue.

The backup before configuration is `scratch/semester4-before-configuration-2026-10-25.json` (127 course rows and one legacy rule). Read-back verification confirmed every one of the 101 points and all original course fields. `production_readiness()` remains true and retirement subsequently removed the old schema without changing the JSON lists. No student answers were stored.

The security advisor introduced no new findings; the existing provider-level [leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains unchanged.

## Coordinated schema cleanup

The broader cleanup now follows prerequisite retirement in `baseline/bootstrap.psql`. Use [the combined cleanup release procedure](SCHEMA_CLEANUP_ROLLOUT.md) for the production maintenance window, full application export, rehearsal and retained-data verification. Both destructive migrations are now applied to production; application publication is outstanding.
