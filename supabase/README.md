# Database setup and recovery

The historical migration directory contains changes to an existing database. **Do not apply that history to an empty database.** `baseline/schema.sql` is the complete application schema as of migration `20261020135038`: 27 tables, 42 routines, 3 compatibility views, constraints, indexes, triggers, RLS policies, service-role grants and legacy migration receipts. The snapshot includes no student, faculty, password, campus, registration or attendance rows.

For a **fresh Supabase project**, use its standard Auth installation and run as the database `postgres` user:

```sh
psql "$NEW_DATABASE_URL" -f supabase/baseline/bootstrap.psql
```

The bootstrap loads the snapshot, seeds the 30 public timetable periods, then applies the later teacher-change repair both stages of the plain-English prerequisite schema, and the application schema cleanup. It stops at the first SQL error. It is intentionally not idempotent: running a schema bootstrap over an existing application database fails rather than replacing it. Do not run it against the current live project.

After bootstrap, align the Supabase CLI migration history with the historical versions already represented by the snapshot and the later migrations applied by bootstrap, using `supabase migration repair --help` for the installed CLI. This records history only; never replay the historical SQL. Apply only subsequent migrations to this initialized database. When adding a migration, update bootstrap and the isolated restore tests to include it.

Create the initial administrator through Supabase Auth, then insert the matching UUID/name/email into `public.admins` using trusted administrator access. Create campuses, departments and faculty through the portal. Set backend credentials and public client configuration to the new project. Application clients have no direct table/RPC grants; only the backend service role accesses application data.

For disaster recovery with existing users and records, use Supabase project backups/PITR or a separately secured full logical backup covering Auth, Storage and application data. This schema snapshot is for provisioning and schema reconstruction; it is not a backup of user records, authentication configuration, service secrets, storage files or platform-managed schemas. Preserve those independently according to the institution's retention policy.

Verification:

```sh
npm test
```

The regression suite restores the full schema into an isolated PostgreSQL runtime, applies newer migrations, verifies backend-only access/readiness and exercises transactional teacher changes, rollback, role validation and clash prevention. Synthetic accounts exist only in the test database. Production data is not used.

See [the prerequisite release procedure](PREREQUISITES_ROLLOUT.md) before deploying the new course prerequisite model to an existing database.

See [the schema cleanup release procedure](SCHEMA_CLEANUP_ROLLOUT.md) for the completed production schema removal, application publication steps and recovery procedure.
