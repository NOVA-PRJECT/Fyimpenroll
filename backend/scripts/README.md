# Blueprint target conversion

`convert-blueprint-targets.cjs` reads the old catalogue and prepares a dry-run report, a rollback snapshot, and transactional SQL. It never changes the database. The legacy nullable `courses.tag` column and its values remain available for rollback; application logic no longer uses them.

From the repository root, capture the live data using the existing backend environment:

```powershell
node --env-file=backend/.env backend/scripts/convert-blueprint-targets.cjs --live --out scratch/blueprint-conversion-release
```

For an offline review, pass `--snapshot path/to/snapshot.json` instead of `--live`. A snapshot contains complete `semester_blueprints` rows in `blueprints` and course fields `id`, `course_code`, `department_id`, `semester`, `category`, `tag` in `courses`. Always use a fresh output directory.

The generated files are:

- `snapshot.json`: original rows and catalogue, with no environment credentials.
- `report.json`: target conversions, added/removed course IDs, non-DSE pool losses, and unresolved mappings.
- `apply.sql`: one transaction that verifies the catalogue and blueprint snapshots, then changes pathway and flat-column targets.
- `rollback.sql`: one transaction that restores the previous targets, guarded against subsequent blueprint edits.

Empty or mixed-category matches require a mapping file: a JSON object whose keys are the unresolved report keys and values are supported categories, for example `{ "blueprint-id:pathway:pathway-id:5": "MDC" }`. Rerun with `--mapping mappings.json`. Unresolved targets exit with status 2 and do not produce apply/rollback SQL. Already valid categories are preserved; legacy pool targets become `POOLED`.

Before release, review eligibility changes and empty pools. Category baskets intentionally include every matching paper across campuses, with MDC excluding the student's department. Multiple former tags within one category now resolve to the same category pool; duplicate-course checks still prevent taking the same paper twice.

Coordinate the release while course, blueprint and preference writes are paused: generate a fresh report, resolve mappings, execute `apply.sql` with `psql --set=ON_ERROR_STOP=1 --dbname <connection-string> --file <apply.sql>`, activate the new backend/frontend together, and smoke-test one HOD blueprint and one student pathway before resuming writes. SQL locks and snapshot guards abort stale conversions rather than partially applying them. Retain the output directory for rollback. Run `rollback.sql` together with restoring the previous application release if rollback is needed; it refuses to overwrite later blueprint edits.

Do not apply the conversion against the old running application: old rule resolution still expects tag targets. Historical student registrations are never rewritten by these scripts. Saved preferences are checked against current rules during allocation; skipped choices are counted in the result and recorded in the run summary (first 100 details, with a truncation flag).

Verification: `npm run test:blueprints --workspace=backend`, then backend and frontend builds. The local historical test guide can be regenerated with `node e2e-test-campus/prepare-tt-blueprints.cjs scratch/tt-category-blueprints`; it writes new examples without overwriting archived evidence.
