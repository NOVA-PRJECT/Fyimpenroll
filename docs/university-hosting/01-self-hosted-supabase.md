# Fyimpenroll university hosting with self hosted Supabase

Sequential migration and public launch runbook

Prepared for the university IT team, application maintainers, database owner, and service owner

5 November 2026 | Version 1.0

## Purpose and decision

Use this document when the university permits the Supabase software stack to run on university owned infrastructure. Supabase already uses PostgreSQL; this route moves both PostgreSQL and the supporting authentication and API services into university custody. It retains the application's existing provider integration while transferring hosting, backups, patching, and incident response to the university.

The university should normally prefer this route when its rule concerns infrastructure ownership and it permits the open source Supabase components. It requires migration and compatibility work, but substantially less application replacement work than removing Supabase. Self hosting does not require keeping the managed Supabase cloud service. The university must separately approve any retained external email, font, password screening, build, monitoring, or mobile distribution service.

This runbook covers discovery, university server preparation, Supabase installation, identity and database migration, application build, HTTPS publication, native client transition, acceptance, rollback, and ongoing operations. Execute the steps in order and record evidence at each completion point. Commands are templates for the named environment, not instructions to run against the current live database without the owner's controlled migration procedure.

## Release facts and migration controls

The source reviewed is a NestJS backend, Next.js 16 web portal, Expo mobile app, and shared contracts in one npm workspace. Backend data access uses `@supabase/supabase-js` and PostgREST, with privileged server credentials. Ordinary browser and mobile business requests use the Nest API. Browser password recovery also calls Supabase Auth directly. Application tables and routines are intended to be backend only; retain that boundary.

STEP Assign a cutover lead, infrastructure owner, network and DNS owner, database owner, application owner, security reviewer, and acceptance representatives. Record who may authorize opening writes and who may declare rollback. Establish a private evidence directory and a university change record.
STEP Confirm the university permits Docker or an equivalent supported container runtime and each required Supabase service. Obtain the required licensing and software inventory review. Identify whether the policy covers only production hosting or also build tools, mail delivery, telemetry, backups, and mobile app services.
STEP Inventory actual deployed frontend and backend versions, cloud project identifier, database major version and extensions, table and object sizes, identity counts, current Auth settings, SMTP, recovery template, API keys, DNS, active integrations, Storage objects, Edge Functions, scheduled jobs, and Realtime subscriptions. Record actual usage rather than assuming every bundled Supabase service is used by this application.
STEP Compare the chosen source revision with the live schema and application. The repository's November review release changes recovery, attendance revision contracts, scheduling jobs, and readiness. Use `supabase/REVIEW_RELEASE_ROLLOUT.md` and the actual deployed state to identify missing prerequisites. Migration and application feature rollout should be separate changes wherever possible.
STEP Preserve `supabase/changes/semester_lifecycle.sql` as an already applied historical release for the existing project. Do not rerun it on the source. Do not apply the historical migration directory to an empty database and do not treat the baseline as a user data backup. The fresh project bootstrap is a separate alternative for an intentionally empty application, not the restore path for this migration.
STEP Capture the current read-only compatibility checks below through the database owner's approved SQL client. Record errors as findings; do not attempt to repair them by replaying old SQL. Record existing unvalidated constraints and data inconsistencies for explicit reconciliation.

```sql
SELECT version();
SELECT extname, extversion FROM pg_extension ORDER BY extname;
SELECT public.application_schema_compatibility();
SELECT public.production_readiness();
SELECT conname, convalidated FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY conname;
```

STEP Measure a realistic export and restore in rehearsal. Agree the maintenance window, acceptable data loss, recovery time, rollback retention, and peak usage acceptance targets. Record actual account recovery contacts and university SMTP availability before scheduling the final migration.

Completion evidence: approved route, named owners, production inventory, source and schema compatibility record, and a rehearsable change plan. No live database modification is needed to prepare this document.

{{University infrastructure preparation}}

## Installing and securing the Supabase stack

Owner: infrastructure team with database owner review. Install a separate staging stack first. Use the production Docker deployment, not the Supabase CLI local development stack. [S1]

STEP Install Docker Engine and its Compose plugin using the official instructions for the approved server OS or university mirror. Record versions and confirm `docker version` and `docker compose version`. Understand Docker published port behavior: a host firewall alone may not protect a published container port. Use loopback bindings, network controls, and external scans. [S2]
STEP Select a tested stable self hosted Supabase release tag and record its full Git commit and image digests. Choose the Postgres and Auth versions after comparing them with the source. Prefer the same supported database major for the migration; a database major upgrade is a separate rehearsed operation. Do not pull a moving branch or replace one service image with latest during cutover.
STEP Retrieve the official Supabase repository at that selected tag and copy its `docker/` contents to a persistent configuration directory, for example `/srv/supabase`. Preserve scripts, mounted initialization files, and the release record. Use a separate writable data directory on durable university storage.

```bash
# Replace APPROVED_TAG with the reviewed self-hosted release tag.
git clone --depth 1 --branch APPROVED_TAG \
  https://github.com/supabase/supabase.git /srv/supabase-source
sudo install -d -m 0750 /srv/supabase
sudo cp -a /srv/supabase-source/docker/. /srv/supabase/
cd /srv/supabase
sudo cp .env.example .env
```

STEP Review the pinned release's Docker guide, changelog, Compose files, and secret generation scripts before running them. The current documentation describes `utils/generate-keys.sh` and `utils/add-new-auth-keys.sh`; use only scripts present in the selected release. Generate unique database passwords, dashboard credentials, signing material, encryption keys, and API keys. Replace every example secret and store a recovery copy in the university vault. [S1]
STEP Decide the signing and API key compatibility plan. The current backend explicitly sends `SUPABASE_SERVICE_ROLE_KEY` as both an SDK key and Authorization bearer value. Do not place a new opaque `sb_secret_...` key there without adapting and testing this header behavior. Either use the selected stack's supported legacy JWT anon and service role keys consistently or implement and test the newer key mode throughout gateway, SDK, Auth, and clients. Never place service or secret keys in public frontend or Expo variables. [S3]
STEP Set the public Supabase URL, Auth external URL, Site URL, redirect allowlist, SMTP settings, and all internal service secrets according to that pinned release's `.env.example` and Compose wiring. Public URLs must use the final HTTPS domain. A representative mapping is `SUPABASE_PUBLIC_URL=https://sb.university.example`, `API_EXTERNAL_URL=https://sb.university.example`, and `SITE_URL=https://enroll.university.example`; confirm how the pinned Auth service appends its paths rather than guessing an `/auth/v1` suffix.
STEP Keep normal open self-signup disabled if users are provisioned by the portal. Preserve email confirmation requirements, password settings, token lifetimes, recovery behavior, and any required provider configuration. Configure a university SMTP sender, authenticated transport, TLS, sender authorization, SPF, DKIM, and DMARC with the mail team. Test a nonproduction message without real student mailing lists.
STEP Copy and adapt `supabase/templates/recovery.html`. It must point to the final portal confirmation page and include the token hash expected by the application's backend. The current confirmation page must not exchange the proof on a GET or email preview; verification occurs when the password is submitted. Configure the template through the pinned self hosted Auth template mechanism and serve or mount it as required. Do not paste a cloud dashboard setting into an unsupported server variable.
STEP Change Compose port publications so the gateway is bound to loopback, for example `127.0.0.1:8000:8000`, and database or pooler ports are absent or restricted to the intended internal interface. Protect Studio, postgres-meta, admin APIs, and management interfaces with VPN and access controls. Docker group membership is privileged; restrict it to infrastructure operators.
STEP Decide which optional services can be removed only after the actual usage inventory and compatibility tests. Database, Auth, gateway, and PostgREST are required by the current application. Keep Storage and Realtime if their APIs or data are used. Logs and analytics, Edge Functions, and image processing are usage dependent. Record the backup and operational impact of each retained service.
STEP Review resolved Compose configuration privately because it may display secrets. Pull the pinned images, start the stack, check health, inspect logs, and test connectivity from the application host. Do not use `reset.sh`, remove volumes, or run `docker compose down -v` on a populated stack.

```bash
cd /srv/supabase
docker compose pull
docker compose up -d --wait
docker compose ps
docker compose logs --tail=100 auth rest db
```

STEP Install HTTPS on the Supabase hostname. For the current application, the public browser needs `/auth/v1/`; the backend needs gateway Auth and REST access over loopback or a private network. Use default deny public routing, proxy only required public paths, and keep the gateway root and Studio private. If Storage or Realtime is public, add only the required paths and test WebSocket upgrade headers for Realtime. Do not proxy the entire gateway root publicly just to make password recovery work.
STEP Verify certificates and Auth access through `https://sb.university.example/auth/v1/health` if supported by the selected version. Test CORS for the portal origin, recovery requests, and private backend requests. Check from an outside connection that Studio and database ports remain unreachable.

Completion evidence: healthy pinned services, unique vaulted secrets, version compatible database and Auth schema, private administrative access, verified mail delivery, and the minimal public gateway surface.

## Exporting and restoring records and identities

Owner: database owner. Prepare reviewed SQL files and a restore manifest in rehearsal; run them only under the controlled migration procedure. This runbook uses PostgreSQL clients and does not require installing the Supabase CLI. The vendor's filtered CLI export is an optional alternative for an IT team that elects to use it. Raw full database restore into an initialized Supabase stack is unsafe because platform roles and internal schemas already exist. [S4]

STEP Obtain the source connection information from the current project owner. Use a direct database connection or a session pooler suitable for administrative exports, not a transaction pooler. Use certificate verification for remote connections and protect credentials with a PostgreSQL service file and `.pgpass` permissions rather than exposing passwords in command arguments or shell history.
STEP Define PostgreSQL client service entries `fyimp_source` and `fyimp_target` with explicit host, port, database, user, SSL mode, and trusted CA as applicable. Check `current_database()`, `current_user`, server address, and version on both before each operation. Use a compatible `pg_dump`; it cannot dump a server newer than the client's supported major. Prefer matching source major client tools. [D1]
STEP During rehearsal, export one complete accessible database archive for evidence and fallback. Capture role definitions separately without role passwords. A managed export does not necessarily grant visibility to every provider internal object; inspect logs and the archive inventory. Keep this archive private and never restore it wholesale over the initialized target.

```bash
umask 077
pg_dump --dbname='service=fyimp_source' --format=custom \
  --file=source-full.dump
pg_dumpall --database='service=fyimp_source' \
  --roles-only --no-role-passwords > source-roles.sql
pg_restore --list source-full.dump > source-toc.list
sha256sum source-full.dump source-roles.sql source-toc.list \
  > source-checksums.txt
```

STEP Build a signed restore manifest from the archive table of contents. Classify application schemas and extensions, durable Auth identities, transient Auth sessions, Storage metadata, and provider internal schemas. Preserve source UUIDs, password hashes, confirmation state, trusted role metadata, consent, profile references, and any supported MFA factors. Never copy target database login passwords from the source role dump.
STEP Compare source and target Auth tables, columns, constraints, migration versions, and encryption dependencies. Prepare an explicit identity table and column manifest. Normally users and identities must be preserved; ancillary instance or MFA records depend on the selected version. Do not import source Auth migration history over the target installation. Do not copy active sessions, refresh tokens, recovery tokens, or transient login challenges into the new deployment.
STEP If any durable identity field cannot be migrated safely, stop and choose a tested compatible stack or a documented account recovery transition with the university owner. Password hashes cannot be reversed into plaintext. Any encrypted provider or MFA data needs compatible keys and service versions or a controlled reenrollment plan; skipping it silently can lock out users.
STEP Extract candidate application SQL from the archive. These files are review inputs, not automatically safe scripts. Review duplicate `CREATE SCHEMA public`, extension dependencies, event triggers, provider role references, owners, publication settings, and security definer search paths. Keep managed Auth schema creation with the target Auth service, not with the application restore. [D2]

```bash
pg_restore --schema=public --section=pre-data --no-owner \
  --no-privileges --file=application-pre.sql source-full.dump
pg_restore --schema=public --section=data --no-owner \
  --no-privileges --file=application-data.sql source-full.dump
pg_restore --schema=public --section=post-data --no-owner \
  --no-privileges --file=application-post.sql source-full.dump
# DBA prepares identity-only.list from the archive inventory.
pg_restore --use-list=identity-only.list --data-only --no-owner \
  --no-privileges --file=identity-data.sql source-full.dump
```

STEP Produce owner reviewed copies and a restore driver file. The driver must create approved extension dependencies and custom nonreserved roles, load application pre-data, import compatible identity rows in dependency order, load application data and sequence values, then install post-data constraints, indexes, triggers, and reviewed grants. Keep target service roles and target Auth migrations intact. Ensure target identity tables being imported are empty and contain no manually created test users.
STEP Rehearse with normal constraint and trigger behavior first. Where the selected Supabase version requires temporary trigger suppression to avoid re-encrypting already encrypted values, the database owner must scope it to the import transaction and affected tables, restore normal behavior, and independently verify foreign keys and data integrity afterward. Suppression can skip integrity checks; do not use it as a way to ignore restore failures. [S4]
STEP Apply the reviewed driver against the new target using a fail-fast transaction. The command below assumes `restore-approved.psql` has been created and reviewed. It is a migration artifact to prepare, not an existing repository file. An error means rollback and investigation in the rehearsal target, not retrying fragments against a half-loaded production database.

```bash
psql -X --dbname='service=fyimp_target' \
  --set=ON_ERROR_STOP=on --single-transaction \
  --file=restore-approved.psql
```

STEP Reapply only the intended application grants and routine execution privileges. Because the extraction intentionally omits privileges, the restore is incomplete until the reviewed grant file is applied. Confirm browser anon and authenticated roles have no direct application table or RPC access and that backend service access works. Review default routine execution grants to PUBLIC as well as table RLS.
STEP Compare every migrated application table count and stable key set, all user and profile UUID mappings, sequences, constraint validation status, views, routines, indexes, and migration receipts. Verify credit ledger history, current and archived registrations, teacher assignments, published timetables, attendance revision totals, and current academic term. Record and resolve every unexplained discrepancy.
STEP If Storage is used, transfer the actual files as a separate controlled operation using the supported Storage API or object backend migration method. Preserve bucket policy, object paths, ownership, size, content type, and checksums. Reconcile file bytes with metadata; do not assume the database archive contains the files. Redeploy any actual Edge Functions and recreate approved schedules or integrations separately.
STEP Use new signing material for the university deployment and require users to log in again. Test imported passwords with authorized test accounts and test refresh, logout, password change, consent, and recovery. Invalidate or remove source session state according to the cutover plan rather than promising old sessions will remain valid.
STEP During final cutover, repeat the proven export and restore after all source writes are fenced. Reuse the reviewed manifest and driver against a clean destination; do not overlay a rehearsal dataset or rerun the non-idempotent baseline. Recompute counts and checksums from the final snapshot.

Completion evidence: error-free tested restore, preserved identity UUIDs and records, reconciled business totals, restored grants, working imported login and recovery, and independently migrated file objects if applicable.

## Application configuration for university Supabase

Owner: application team. Existing variable names are retained below. These are configuration templates; use the tested key mode selected earlier.

STEP Set backend values in `/etc/fyimp/backend.env`. On a single host, the private gateway URL may be loopback. Across VMs, use private DNS with authenticated TLS or the approved protected service network. Never use a container's `localhost` to refer to a different container.

```ini
NODE_ENV=production
PORT=4000
FRONTEND_URL=https://enroll.university.example
TRUST_PROXY_HOPS=1
SUPABASE_URL=http://127.0.0.1:8000
SUPABASE_ANON_KEY=REPLACE_WITH_TESTED_PUBLIC_KEY
SUPABASE_SERVICE_ROLE_KEY=REPLACE_WITH_TESTED_SERVER_KEY
RUN_REVIEW_WORKER=true
PYTHON_PATH=/srv/fyimp/current/.venv/bin/python
OPENBLAS_NUM_THREADS=1
OMP_NUM_THREADS=1
EXPORT_MAX_ROWS=10000
EXPORT_MAX_CELLS=500000
```

STEP Set frontend build variables before `npm run build:frontend`. `BACKEND_URL` remains useful for the application's Next.js rewrite even though the reference public Nginx path goes directly to Nest. The public Supabase key is intentionally client visible; the server key is never a frontend variable. [O1]

```ini
BACKEND_URL=http://127.0.0.1:4000
NEXT_PUBLIC_SUPABASE_URL=https://sb.university.example
NEXT_PUBLIC_SUPABASE_ANON_KEY=REPLACE_WITH_TESTED_PUBLIC_KEY
```

STEP Update `frontend/next.config.ts` before the build. Its current production `connect-src` permits `https://*.supabase.co` and the configured backend, which does not automatically permit the new self hosted Auth origin. Add the exact `https://sb.university.example` origin and any actually used WebSocket origin. Avoid a broad wildcard as a shortcut. Review local font CSP changes and test recovery in a browser without CSP errors.
STEP Update the portal Site URL, exact recovery allowlist, email template links, legal contact information, and any hardcoded old public URLs. Check `frontend/.env.example`, `mobile/.env.example`, the PWA manifest, and public support material. Rebuild after changing public values; restarting an old build does not replace baked browser configuration.
STEP Keep the current backend permission model: use its service credential only in trusted server code, verify users through Auth, and load current role and campus or department permissions from trusted application records. Do not grant clients direct table access merely because the database moved. Audit service credential custody and access.

{{Building the application release}}

{{Process supervision and public HTTPS}}

## Mobile and installed PWA transition

Owner: application release owner and university distribution administrator. Public website publication and native application publication are separate operations.

STEP Set all four mobile public variables to university endpoints. For the reference proxy, `EXPO_PUBLIC_API_BASE_URL=https://enroll.university.example` is the origin; existing clients append `/api`. Set `EXPO_PUBLIC_PORTAL_URL` to that same public portal origin, `EXPO_PUBLIC_SUPABASE_URL=https://sb.university.example`, and the corresponding tested public key. Never include the service credential in the app.
STEP Run the mobile configuration check through `npm run build --workspace=mobile` and record its export result. This script exports Expo bundles for Android and iOS; it does not create a signed installable APK, AAB, or IPA. Use the actual native build and signing workflow for distribution.
STEP If cloud build services are prohibited, configure the university Android SDK and JDK toolchain and the Expo supported local native build flow. iOS signing and release builds require an approved macOS and Xcode environment. Preserve the existing `org.fyimp.mobile` identifiers and signing keys for updates. Increment Android version code and iOS build number for store releases. [O5]
STEP Build signed native releases through the established release channel. Test upgrade over the currently distributed app and fresh installation, including certificate trust, geolocation, legal pages, login, logout, and recovery. Document what old versions do while the source API is write fenced; do not redirect credential-bearing POST requests between hosts without a tested contract.
STEP Require reauthentication after the provider transition. Clear stale provider sessions and account scoped caches through the supported logout and version transition behavior. Reissue old recovery links against the new provider. Check that existing PWA installations refresh `sw.js` and do not retain old endpoints or protected cached data.

Completion evidence: final public client configuration, signed native artifacts where distributed, approved upgrade tests, and a tested old client retirement message or compatibility plan.

{{Validation before the public switch}}

{{Timed cutover and rollback}}

{{Backups operations and retirement}}

## University acceptance record

STEP Attach the final release manifest, approved architecture, DNS and firewall record, source and destination reconciliation, restore test, role permission test, peak load results, mobile test results, and configuration custody record to the university change record.
STEP Obtain signoff from the application owner, database owner, infrastructure owner, network owner, security reviewer, and service owner. Record the public URL, opening time, accepted recovery objectives, known accepted limitations, support hours, and escalation contacts. Schedule cloud retirement only after this acceptance and the observation period.

Acceptance statement: the university owns and operates the production application, PostgreSQL and Supabase services, domain routing, secrets, backups, and recovery process. Any continuing external runtime service is named and explicitly accepted.

## Supabase route references

[S1] Supabase production Docker deployment and release specific configuration: https://supabase.com/docs/guides/self-hosting/docker

[S2] Docker installation and published port firewall considerations: https://docs.docker.com/engine/install/ubuntu/

[S3] Supabase API key behavior and public versus privileged credentials: https://supabase.com/docs/guides/api/api-keys

[S6] Self hosted API key and asymmetric signing configuration: https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys

[S4] Supabase platform to self hosted restore scope, Auth preservation, and version compatibility: https://supabase.com/docs/guides/self-hosting/restore-from-platform

[S5] Supabase changelog checked for relevant breaking changes. The November 2026 CLI changes reinforce the need to pin and inspect any optional CLI workflow: https://supabase.com/changelog

[D1] PostgreSQL pg_dump compatibility and export options: https://www.postgresql.org/docs/current/app-pgdump.html

[D2] PostgreSQL selective archive restore and generated SQL: https://www.postgresql.org/docs/current/app-pgrestore.html

Repository evidence reviewed: `package.json`, `render.yaml`, `requirements.txt`, `backend/src/main.ts`, `backend/src/worker.ts`, `backend/nest-cli.json`, `backend/src/core/database/supabase.service.ts`, `backend/src/core/auth/guards/auth.guard.ts`, `backend/src/modules/health/health.controller.ts`, `backend/src/core/jobs/review-worker.ts`, `frontend/next.config.ts`, recovery pages, environment examples, `mobile/app.json`, `supabase/README.md`, `supabase/baseline/bootstrap.psql`, and `supabase/REVIEW_RELEASE_ROLLOUT.md`.

{{Shared technical references}}
