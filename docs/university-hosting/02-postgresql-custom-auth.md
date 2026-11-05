# Fyimpenroll university hosting with PostgreSQL and custom authentication

Sequential replacement migration and public launch runbook

Prepared for the university IT team, application maintainers, database owner, security reviewers, and service owner

5 November 2026 | Version 1.0

## Purpose and decision

Use this document when the university does not permit the Supabase stack and requires standard PostgreSQL with authentication and authorization operated by the application. This route retains PostgreSQL as the relational database and replaces Supabase Auth, its API client integration, and any used platform services. It is an application engineering project followed by a hosting migration.

Changing `SUPABASE_URL` to a PostgreSQL connection string will not work. The current NestJS backend uses Supabase Auth and PostgREST rather than a PostgreSQL wire driver. The web and mobile recovery flows also use Supabase directly. Complete and validate the replacement release before scheduling the production cutover. The procedures below identify required new implementation artifacts; they do not assert that this replacement has already been built.

The reference destination is a university managed Next.js portal, NestJS API, Python timetable solver, PostgreSQL database, application session service inside NestJS, and university SMTP. Ordinary business clients continue to use the API. PostgreSQL accepts connections only from approved application and management hosts. No public database endpoint or client SQL access is introduced.

## Governance and current system inventory

STEP Appoint a cutover lead, application engineering lead, database owner, infrastructure owner, network owner, mail administrator, independent security reviewer, and role based acceptance representatives. Record responsibility for session design, identity mapping, authorization regression tests, and account recovery support as well as ordinary server administration.
STEP Confirm the actual reason Supabase is prohibited and document the allowed software list. Distinguish a ban on third party hosting from a ban on the Supabase software itself. If only hosting ownership is restricted, review the self hosted route before committing to this substantially larger replacement.
STEP Record the current production frontend and backend SHA, database version, extensions, identity count, table sizes, schema and migration state, SMTP and recovery settings, active jobs, Storage objects, Realtime subscriptions, Edge Functions, schedules, and all external services. Do not infer production state from the local checkout or historical release notes.
STEP Inventory every `.from`, `.rpc`, `.auth`, Supabase client import, URL, key, and provider-specific error assumption across backend, web, mobile, tests, and deployment scripts. Trace credential provisioning, profile changes, consent, account deletion, and jobs as well as login. Record file and call site ownership in a replacement tracker.

```bash
rg -n 'supabase|SUPABASE|\.auth\.|\.rpc\(|\.from\(' \
  backend/src frontend/src mobile/src tests contracts
rg -n 'auth\.|storage\.|service_role|authenticated|anon' \
  supabase/baseline supabase/changes supabase/migrations
```

STEP Capture the live schema, function definitions, grants, constraints, indexes, triggers, views, extensions, and identity references through the database owner's read-only procedure. Include SQL text inside routines, not just foreign keys: lifecycle and cleanup routines currently refer to `auth.users`, `auth.sessions`, and optional Storage ownership.
STEP Record the real business permission rules from current code and acceptance decisions. Preserve campus and department scope, current versus historical academic terms, HOD assignment ownership, student self access, and allowed visiting teacher and cross-campus timetable viewing. Avoid replacing these with a broad role-only check.
STEP Freeze the target business behavior for the replacement release. Preserve schema integrity and historical records. Treat unrelated feature changes, pending allocation repair, and attendance repairs as separately approved changes; changing authentication is not authorization to rewrite academic records.

Completion evidence: approved replacement scope, complete provider dependency register, named design reviewers, production state inventory, and explicit business behavior to preserve.

## Designing application identities and sessions

Owner: application team with independent security review. The following is a concrete reference design. Implement it using maintained libraries and standard cryptographic primitives; do not invent password hashing or token algorithms.

STEP Introduce a private application identity schema, for example `identity`. Use UUID primary keys matching current Supabase user UUIDs. Separate account identity and status from student, faculty, and administrator profiles, preserving their foreign key relationships. Define canonical email normalization and a uniqueness rule that matches the existing account population before migration.
STEP Design identity tables for accounts, credentials, sessions, refresh credentials, recovery requests, and security audit events. Store account status, email verification state, forced password change, credential version, timestamps, and explicit revocation fields. Keep role and campus or department authority in trusted server managed records, not user editable metadata.
STEP Define password storage with a maintained Argon2id implementation and a reviewed work factor suited to server capacity. The OWASP baseline is at least 19 MiB memory, two iterations, and parallelism one; benchmark and increase where practical. Store the encoded hash including its algorithm parameters and library generated salt. Never store plaintext passwords or reversibly encrypted passwords. [A1]
STEP Decide password migration before schema work. The simplest migration policy is to preserve accounts and require a controlled password reset at first use. A lower friction alternative is to import only supported existing password hash formats into an explicitly versioned legacy credential field, verify using a maintained matching library, and rehash with Argon2id on successful login. Never feed an existing hash to the new password hasher as if it were the user's password.
STEP For legacy hash migration, inventory every distinct algorithm and unsupported credential type, including passwordless accounts, providers, or MFA. Test with authorized known-password fixture accounts, never by requesting student passwords. Unsupported accounts need a verified reset or reenrollment path. Record the approved fallback and remove legacy hashes after the transition period.
STEP Choose opaque random session tokens for the reference design. Generate at least 32 cryptographically random bytes per access or refresh secret and transmit only over HTTPS. Store only a one-way digest or keyed digest of each secret in the identity database. Use a public selector plus secret if needed for efficient lookup. Keep raw tokens out of logs, backups of application caches, and audit descriptions. [A2]
STEP Set explicit lifetimes and rotation policy. A proposed starting point is 15 minute access credentials, refresh rotation on use, and a 7 day absolute session limit; these are university policy choices requiring review. Store issue time, expiry, session family, predecessor, replacement, revoked time, and device label sufficient for support without excessive tracking.
STEP Implement refresh rotation as an atomic transaction: lock the refresh row, validate current account and expiry, mark it consumed, create its successor, and commit once. Detect reuse of a consumed credential and revoke the family under the chosen policy. Define and test the behavior of simultaneous legitimate refreshes so the web client's concurrency handling does not cause accidental account lockout.
STEP Maintain immediate revocation on the server. Logout revokes the active session family before acknowledging success. Password reset, account disablement, role changes requiring reauthentication, and administrator initiated revocation invalidate affected sessions or credential versions. A delayed refresh response must not resurrect a logged-out browser session.
STEP Preserve browser `HttpOnly`, `Secure`, host scoped cookies with appropriate SameSite and path settings. Keep short lived access and refresh secrets out of localStorage. For native apps, use the existing secure device storage facilities and explicit bearer credentials. If response bodies still carry tokens for mobile compatibility, ensure the web client does not persist them in ordinary application caches.
STEP Retain a server-side session endpoint supplying trusted routing facts. Update any frontend middleware, bootstrap logic, or mobile helper that assumes tokens are JWTs or that decodes Supabase claims. Opaque tokens must be validated by the API; token shape or a client supplied role is never proof of authorization.
STEP Require CSRF protection for every state changing cookie-authenticated route, including login, refresh, recovery completion, and logout. Use strict origin validation plus a reviewed CSRF token mechanism where appropriate. Keep exact CORS allowlists; a permissive CORS policy is not an authorization control. Distinguish explicit mobile bearer requests from ambient browser cookies.

Completion evidence: reviewed identity schema, password transition policy, documented token lifecycle, browser and native storage design, and threat scenarios with test cases. This is a release prerequisite, not a production time configuration choice.

## Implementing account and recovery workflows

STEP Implement login with parameterized identity lookup, constant-time password verification through the maintained library, account status checks, trusted profile resolution, consent and forced password state, session creation, and a generic failure response. Avoid different responses that expose whether an email exists. Record security audit events without passwords or raw credentials. [A3]
STEP Replace both IP and account targeted throttles with university operated controls. Use an approved Redis driver and Redis instance, or atomic PostgreSQL-backed counters with tested cleanup and contention behavior. Add the chosen driver to backend production dependencies. The existing Upstash REST client cannot speak directly to a normal Redis server.
STEP Preserve the existing password policy from shared contracts or deliberately version the change. Apply it to user changes, resets, administrator provisioning, bulk import, and any other credential write. If the external Pwned Passwords service is prohibited, implement an approved local breached password check or university service before removing that dependency. Retain the current retryable failure semantics until the replacement policy is approved.
STEP Implement a recovery request endpoint in NestJS to replace `supabase.auth.resetPasswordForEmail`. Return the same public message and approximately uniform behavior for known and unknown emails; throttle by IP and account. Use the configured trusted portal origin rather than a request supplied Host header to construct links. Queue mail delivery through university SMTP with safe retry behavior. [A4]
STEP Generate a single-use random recovery secret, store its digest with account, purpose, expiry, and consumed timestamp, and email only the raw secret in the trusted HTTPS link. A suggested expiry is 20 minutes, subject to university policy. Multiple requests must have an explicit invalidation policy. Prevent open redirects and token leakage through analytics or referrers.
STEP Build recovery confirmation so GET and email preview never consume proof. On password submission, atomically lock the proof, verify purpose, expiry, unused state, and account status, update the password hash and forced-change state, consume the proof, and revoke existing sessions. Concurrent submissions must allow one successful completion. Do not accept an ordinary login token as recovery proof.
STEP Separate verified password change from any later profile synchronization retry. A synchronization failure must not cause password corruption or permit password change without proof. Design a restricted short-lived retry capability if the operation cannot be one transaction; never reuse an unrestricted recovery session just for convenience.
STEP Implement authenticated password change requiring the current password or a documented privileged recovery procedure. Update the hash and credential version transactionally, apply session rotation or revocation policy, clear forced-change state, and audit the event. Use the same policy on every password-change route.
STEP Replace provider admin APIs used for creating, updating, and deleting users. Implement transactional identity and profile provisioning, canonical email checks, role validation, invitation or initial-password delivery, forced change, and audit entries. Do not allow public signup to assign a privileged role or create an unattached portal account.
STEP Implement bulk provisioning with per-row validation, clear partial-failure handling, and idempotent retry identifiers. Preserve existing institutional identifiers and UUID mappings. Initial credentials, if still used under approved policy, must be distributed privately and require change; do not insert them into logs or public exports.
STEP Replace account cleanup tasks with application identity deletion or disablement semantics, including session revocation, retained academic history, ownership dependencies, retry state, fencing, and audit. Reconcile a deletion already committed before acknowledging a retry. Do not copy a Supabase Auth deletion call into the new worker and assume it is complete.
STEP Preserve policy consent history and enforcement using server managed records and current policy version. Replace writes to Supabase app metadata with updates to the new trusted identity or profile model. Consent and forced-change screens must remain accessible when ordinary dashboard access is blocked.
STEP Provide a university support process for users without working email access, duplicated emails, migrated MFA, and privileged account recovery. Require identity verification and an audit trail; do not create a universal administrator reset password or bypass link. Enable a reviewed privileged-account MFA mechanism if required by the university's security policy.

Completion evidence: complete login, refresh, logout, password, recovery, provisioning, consent, and cleanup APIs with functional and abuse tests. Delivery and support ownership for recovery mail must work before launch.

## Replacing data access and authorization

STEP Add a pinned PostgreSQL driver such as `pg` to backend runtime dependencies and update the root lockfile. The repository currently has `pg` as a root development dependency for tests; that does not establish a production backend data layer. Implement a connection pool with bounded size, TLS verification where remote, statement and lock timeouts, connection acquisition timeouts, and graceful shutdown.
STEP Create a trusted identity context after server-side session validation. Load the current account, role, campus, department, account status, consent, and academic term facts from the database. Do not use user supplied JSON, profile metadata, request query parameters, or an unverified token body to choose authority.
STEP Replace every Supabase query builder call with a reviewed repository query. Preserve filtering, projection, ordering, pagination, null behavior, exact count semantics, write return values, and error handling. Parameterize all values and whitelist dynamic identifiers. Preserve cache scoping by actor, role, campus, department, and academic term, including invalidation after changes.
STEP Replace `.rpc` calls with parameterized function invocation or equivalent explicit transactions. Existing PostgreSQL business functions can often remain after provider dependencies are rewritten. Preserve their argument types, row locks, advisory locks, unique constraints, revision checks, term checks, fencing tokens, and atomic commit behavior rather than splitting them into unrelated API writes.
STEP Derive actor IDs passed into database operations from the verified server context. Many current routines trust a backend service actor argument; never pass an arbitrary client-supplied actor ID through to them. Worker actors must come from the validated durable job record, with authority rechecked at commit where required.
STEP Build a permission matrix and tests for each endpoint and routine. Superadmin manages institution-wide configuration through explicit permissions; directors act within authorized campus operations; HODs retain teacher assignment ownership within permitted departments; teachers perform authorized teaching and attendance actions; students act on their own permitted records. Confirm the exact inherited permissions from current application behavior rather than assuming a role hierarchy.
STEP Preserve the distinction between timetable viewing and assignment mutation. Visiting teachers and cross-campus or cross-term views may be permitted while attendance and teacher assignment remain narrowly scoped. Preserve historical access without allowing stale term mutations. Test guessed object IDs and requests after reassignment or account revocation. [A5]
STEP Use separate PostgreSQL identities for schema ownership, migrations, application runtime, worker operations, and backups as appropriate. The runtime role must not be a superuser, database owner, schema owner, or BYPASSRLS role. Revoke unneeded CREATE privileges and routine EXECUTE from PUBLIC. Restrict routine grants to intended callers.
STEP Decide which existing RLS policies remain meaningful and rewrite any that call Supabase `auth.uid()` or use provider roles. PostgreSQL RLS can remain as defense in depth, but it does not invent application identity. If transaction-local actor context is used, set it only after authentication, use `SET LOCAL` inside every transaction, and test pool reuse. Never rely on a connection-wide setting that can leak one user's identity to the next request. [A6]
STEP Review every security definer function and view. Use fixed safe search paths, qualified objects, minimal owner privileges, and explicit caller authorization. Table owners ordinarily bypass RLS; test runtime behavior with the real nonowner role and assess FORCE ROW LEVEL SECURITY where appropriate. Do not replace failed authorization checks with a more privileged database login.
STEP Rewrite SQL referencing `auth.users`, `auth.sessions`, provider role grants, JWT metadata, Storage ownership, and provider-specific readiness assumptions. Redirect identity foreign keys to the new identity table after UUIDs have been loaded. Preserve ON DELETE behavior deliberately; account deletion must not erase retained academic history unintentionally.
STEP Replace the database access service in workers, health checks, consent services, provisioning, attendance, allocation, timetable generation, and account cleanup. Remove provider networking from the new release. Preserve the durable PostgreSQL job queue and its leases, attempt limits, cancellation semantics, heartbeats, and completion reconciliation.
STEP Replace health readiness with real checks of database connectivity and schema version, solver import and assets, worker heartbeat, and any required session or limiter store. Maintain separate liveness and readiness meanings. SMTP delivery needs its own monitor and recovery test rather than being inferred from database readiness.
STEP If Storage, Realtime, or Edge Functions are actually used, implement and validate their replacements before removal. Possible university components are a private object store with authorized download APIs, API polling or an application event channel, and Nest worker tasks. Preserve object permissions and checksums; do not make a former private bucket publicly readable during migration.
STEP Remove the Supabase SDK, keys, URLs, recovery session helpers, and incompatible error mappings from backend, frontend, mobile, and runtime deployment files once all call sites have replacements. Update CSP to the exact university API and optional event origins. Keep historical SQL and recovery evidence in source control; archive it clearly rather than deleting history needed for source recovery.

Completion evidence: provider replacement tracker has no unexplained runtime dependency, all endpoint permissions are tested, runtime credentials are least privilege, and database transactional invariants survive the driver migration.

## Preparing the replacement schema and migration package

STEP Create new versioned owner-run SQL files for the university PostgreSQL target. Include identity schema, credential and session tables, migrated application schema, provider dependency rewrites, required extensions, views, routines, triggers, constraints, indexes, runtime grants, and a schema version or compatibility routine. Supply these as reviewed files for the database owner; do not edit the live source schema as an experiment.
STEP Prepare a manifest identifying each required implementation artifact and its checksum: target schema SQL, source extraction manifest, identity mapping loader, application data loader, post-load constraints and grants, reconciliation SQL, runtime smoke tests, and reverse migration or forward repair procedure. These artifacts must be produced and tested by the replacement project; they are not already available in this repository.
STEP Use actual source schema definitions as input. The historical baseline is not a plain PostgreSQL installer: it assumes Supabase roles, Auth, and subsequent feature releases. Reconstruct the final approved target schema from the current source state and explicit rewrites. Do not run `supabase/baseline/bootstrap.psql` against a vanilla target.
STEP Preserve primary keys, timestamps, numeric precision, term versions, sequence or identity values, foreign key semantics, checks, uniqueness, indexes, and academic audit history. Keep PostgreSQL specific features that are useful; removing Supabase does not require replacing PL/pgSQL business transactions with application-only code.
STEP Test the target schema creation and every migration artifact from an empty disposable database. Run fixtures containing students, faculty, admin identities, multiple campuses, visiting assignments, historical terms, revoked sessions, and job retries. Prove a second migration attempt fails safely or behaves idempotently according to its documented contract.
STEP Adapt tests that currently emulate or initialize Supabase Auth. Keep the existing business regression intent and add real PostgreSQL integration tests through the new driver and session service. Include refresh replay, recovery replay, race conditions, object authorization, and account deletion recovery. Have an independent reviewer assess the custom authentication and access control before the production freeze.

Completion evidence: complete reviewed migration package, replacement source release, security review, disposable restore rehearsal, and measured duration. Do not reserve the production cutover based only on a design document.

{{University infrastructure preparation}}

## Installing standard PostgreSQL

Owner: database and infrastructure teams. The reference implementation uses a supported PostgreSQL major that matches the source where possible. Select the exact major and latest approved minor after extension and migration compatibility review.

STEP Install PostgreSQL server and matching clients from the approved university or official PostgreSQL repository. Record package versions. Enable automatic service startup, provision durable storage with capacity for the database, indexes, WAL, temporary files, and backups, and set disk space alerts before loading data.
STEP Initialize an empty UTF-8 cluster with deliberate locale, collation, and time zone choices. Compare source collation and ordering requirements. Do not copy the managed provider's data directory into a different PostgreSQL major or operating system. Use the reviewed logical migration for the move.
STEP Restrict `listen_addresses` to loopback or the intended private interface. Configure `pg_hba.conf` for the exact application and management hosts, require SCRAM authentication, and use verified TLS over remote networks. Do not use `trust` authentication or `0.0.0.0/0` broad application rules.
STEP Create the database, a nonlogin schema owner, a tightly controlled migration login, and limited runtime identities using owner reviewed SQL. Store credentials in the university secret store and PostgreSQL service definitions. Grant database CONNECT and only the required schema and routine access. Do not share the owner credential with the API or worker.
STEP Install only required supported extensions and record why each is needed. Configure connection limits and pool sizes so all API and worker replicas plus maintenance reserve fit below the database connection ceiling. Set timeouts and idle transaction limits; load test before increasing global memory or connection settings.
STEP Enable appropriate query and error monitoring with sensitive parameter redaction. Capture slow query and lock evidence without recording passwords or session secrets. Establish base backup and WAL archival tooling when required by the approved recovery objectives, then verify restoration before application publication.

Completion evidence: private standard PostgreSQL service, least privilege roles, compatible extensions, tested TLS, monitored storage, and working backups.

## Migrating accounts and academic records

STEP Create protected PostgreSQL service entries for the source and target and verify their database names, users, addresses, and versions. Take a full logical source archive and a separate role inventory for recovery. Use a matching source major `pg_dump`, and do not restore platform roles or reserved internal schemas into the plain target. [D1]

```bash
umask 077
pg_dump --dbname='service=fyimp_source' --format=custom \
  --file=source-full.dump
pg_restore --list source-full.dump > source-toc.list
sha256sum source-full.dump source-toc.list > source-checksums.txt
```

STEP Export identity UUIDs, canonical email, account status, verification state, and permitted trusted attributes using the approved version-specific extraction manifest. Include password hashes only when the reviewed legacy transition supports them. Treat that export as credential material. Never export plaintext passwords or assume every user has a password credential.
STEP Apply the reviewed target schema file with `psql -X`, `ON_ERROR_STOP=on`, and transaction boundaries appropriate to the migration package. Keep identity and application write access disabled. Record the applied schema version and file hash. This is the new target installer, not the old Supabase bootstrap.
STEP Load identity rows first while preserving UUIDs exactly, then role and profile records and application data in the documented dependency order. Rebuild foreign keys that formerly referenced `auth.users` so they reference the new identity table. Detect duplicate or conflicting normalized emails and missing or multi-role profiles as blocking discrepancies; do not silently merge accounts.
STEP Load all agreed academic and audit tables, including historical registrations, credits, attendance, notices, teacher assignments, timetable history, current term settings, allocation records, and durable job records. Preserve sequence values and timestamps. Use a manifest of actual current tables, not the obsolete table count in a historical baseline.
STEP Classify job state before enabling workers. Drain completed source work where possible; migrate queued work only with a compatible payload and recorded retry policy. Reconcile running leases and committed outputs so a new worker cannot duplicate an allocation or deletion. Do not replay old recovery emails or source authentication cleanup calls.
STEP Apply reviewed post-load constraints, indexes, routines, triggers, and runtime grants. Verify every required constraint is validated or has an explicit accepted preexisting exception. Do not disable integrity checks to force problematic data through. Run ANALYZE after loading and review representative query plans.
STEP Compare source and destination table counts, stable key sets, identity and profile mappings, sums and business aggregates, and representative exports. Validate student credit totals, attendance totals and revisions, published cohort schedules, historical terms, teacher ownership, and deletion retention rules. Record any transformed rows with a deterministic reason and owner acceptance.
STEP Start the replacement API in restricted staging mode and test migrated accounts through the chosen password transition. For forced resets, test university mail delivery, proof consumption, and user support before enabling mass requests. For legacy verification, test successful rehash, failed login, unsupported hashes, and session revocation without altering source credentials.
STEP Transfer actual file objects and metadata into the replacement object service when used, preserving access rules and checksums. Replace URLs that embedded a source provider hostname using an audited mapping. Verify authorized downloads and rejection of unauthorized object IDs.
STEP Take a target backup and restore it into a second isolated environment. Run business and authentication smoke tests on that restore. At final cutover, recreate a clean production target from the proven scripts and repeat the final export only after fencing all source writes. Do not overlay final data onto an active rehearsal database.

Completion evidence: reconciled identities and academic history, valid target constraints, successful password transition, compatible durable jobs, migrated files if used, and a proven target restore.

## Replacement release configuration

Owner: application team. The following new environment names are a proposed contract to implement in the replacement code, not variables understood by the current Supabase release. Final names and semantics must match the delivered replacement configuration validator.

STEP Implement startup validation that rejects missing or contradictory database, session, SMTP, origin, and worker settings. Keep server secrets in `/etc/fyimp/backend.env` or an approved injected secret store. Log variable names and validation failures without values.

```ini
NODE_ENV=production
PORT=4000
FRONTEND_URL=https://enroll.university.example
TRUST_PROXY_HOPS=1
DATABASE_URL=REPLACE_WITH_PRIVATE_RUNTIME_CONNECTION
DATABASE_SSL_CA_FILE=/etc/fyimp/database-ca.pem
AUTH_PUBLIC_ORIGIN=https://enroll.university.example
AUTH_ACCESS_TTL_SECONDS=900
AUTH_REFRESH_TTL_SECONDS=604800
SMTP_HOST=REPLACE_WITH_UNIVERSITY_SMTP
SMTP_PORT=587
SMTP_USER=REPLACE_WITH_MAIL_IDENTITY
SMTP_PASSWORD=REPLACE_WITH_MAIL_SECRET
SMTP_FROM=REPLACE_WITH_APPROVED_SENDER
RUN_REVIEW_WORKER=true
PYTHON_PATH=/srv/fyimp/current/.venv/bin/python
OPENBLAS_NUM_THREADS=1
OMP_NUM_THREADS=1
```

STEP Validate remote database certificates with the configured CA; do not use `rejectUnauthorized=false`. Configure the selected PostgreSQL driver to honor the intended TLS settings and avoid conflicting URL SSL parameters. Use a local socket or protected loopback alternative only where explicitly selected and tested.
STEP Keep web browser business requests on the same public origin through `/api/`. Set `BACKEND_URL=http://127.0.0.1:4000` for the reference single host build and remove all `NEXT_PUBLIC_SUPABASE_*` values after the client code no longer requires them. Update recovery pages to use the new API and clear obsolete provider session state.
STEP Implement mobile configuration with `EXPO_PUBLIC_API_BASE_URL=https://enroll.university.example` and `EXPO_PUBLIC_PORTAL_URL=https://enroll.university.example`. Update `mobile/src/config/env.ts` and `mobile/scripts/check-config.cjs` to remove the two Supabase requirements. Do not leave placeholder provider values just to pass the old validator.
STEP Update CSP to the actual university origins, remove `*.supabase.co` when unused, and replace external fonts if policy requires. Search the final browser bundles, native configuration, process environment inventory, and network trace for retired provider references. Historical source documents may retain those references; production runtime must not depend on them.

{{Building the application release}}

{{Process supervision and public HTTPS}}

## Web and mobile client publication

STEP Test the new web client against the replacement API through the final HTTPS hostname before public DNS changes. Check every auth route, refresh behavior, CSRF handling, forced-change screen, consent screen, recovery form, and HTTP error mapping. Verify that no provider JWT decoding or provider session helper is needed.
STEP Verify cache isolation and session cleanup when two different accounts use the same device. Login as one campus role, log out, then log in as another. Check dashboards, cached reference data, recovery state, queued mutations, and offline behavior. Never automatically replay an old queued write whose revision or current authority cannot be verified.
STEP Build Expo bundles and typecheck using the updated configuration validator. Remember that `npm run build --workspace=mobile` is an export, not a signed native binary. Produce actual signed Android and iOS releases through the university approved native toolchain and existing distribution channel. For local builds, follow supported Expo and platform requirements; iOS requires macOS and Xcode. [O5]
STEP Retain `org.fyimp.mobile` identifiers and the established signing identities so users can upgrade. Increment native build identifiers. Test both upgrading an existing installed app and a clean installation. Require a fresh server session after migration, remove stale provider credentials, and verify secure storage, geolocation, consent, and recovery links on physical devices.
STEP Establish a minimum supported client contract for the replacement API. Old mobile clients may contain Supabase URLs and token assumptions; they will not become compatible through a DNS change. Keep the source write fenced and provide a tested update or retirement message through the old API or app release channel until the support period ends.
STEP Test PWA updates, `sw.js` freshness, public legal pages after logout, and deep links. The old provider owned web hostname may need a redirect managed in the old hosting account. Publish the final university address and new recovery links; do not assume the university owns the provider subdomain's DNS.

Completion evidence: compatible web and signed native releases where distributed, final endpoints, clean session transition, verified update path, and a controlled old client policy.

{{Validation before the public switch}}

## Additional acceptance for custom authentication

STEP Review authentication and authorization independently of ordinary feature QA. Test incorrect passwords, disabled accounts, missing profiles, stale role changes, session theft scenarios, expired access, revoked refresh, refresh reuse, simultaneous refresh, logout races, and password changes while old sessions remain active.
STEP Test recovery request enumeration resistance, throttling, scanner visits, expired proof, already consumed proof, wrong purpose, modified proof, replay, concurrent completion, mail retries, Host header injection, and malicious redirects. Verify that tokens are absent from access logs, application logs, monitoring events, and referrer headers.
STEP Execute the permission matrix against the actual PostgreSQL runtime role and API, not only mocked repository methods. Test cross-user, cross-campus, cross-department, revoked assignment, stale term, and direct function invocation attempts. Confirm that backend actor context cannot be overridden by request payload fields.
STEP Test pool reuse and transaction rollback so actor context, manual override flags, role switches, or statement settings never leak into another request. Test database and shared limiter failures, SMTP failure, process restart, and full host reboot. Confirm controlled errors and recoverable jobs rather than accidental permission bypass or false readiness.
STEP Run approved dependency and vulnerability review for the new authentication, password hashing, SMTP, database, and limiter libraries. Keep an inventory and patch owner. Close material findings and record accepted residual risks before the go-live decision.

Completion evidence: independent security review, real database permission tests, credential and recovery abuse tests, failure recovery results, and release approval.

{{Timed cutover and rollback}}

## Reverse migration considerations

STEP Define the post-write rollback policy before launch. Returning from custom authentication to Supabase is a reverse migration, not just a DNS change. Academic writes, new accounts, disabled accounts, changed emails, deleted identities, password changes, consent, and job effects all need reconciliation.
STEP Prefer forward repair when it is safer than reintroducing a provider schema. If returning to Supabase is required, rehearse an explicit reverse identity and data mapping and determine which destination hashes the provider can import. Do not assume new Argon2id credentials can be inserted into the old Auth service. Some users may need a new verified recovery flow.
STEP Keep the source read-only and preserve the exact source compatible application artifact and keys for the agreed observation period. Do not keep the old source writable as an emergency shortcut. After the university accepts the migration, retire source credentials and cloud data under the retention decision.

{{Backups operations and retirement}}

## University acceptance record

STEP Attach the replacement dependency tracker, identity and session design, reviewed migration SQL package, authorization matrix, independent security review, final data reconciliation, password transition results, restore evidence, load results, native release results, and operations handover to the change record.
STEP Obtain acceptance from the application owner, database owner, security reviewer, infrastructure owner, network owner, mail administrator, and university service owner. Record the final public URL, release SHA, schema version, first writable timestamp, supported client versions, recovery objectives, support contacts, and any explicitly accepted limitations.

Acceptance statement: the university operates the application, standard PostgreSQL, identity and session lifecycle, authorization enforcement, mail recovery workflow, backups, and recovery process. No production runtime path relies on Supabase unless an exception is explicitly documented and accepted.

## PostgreSQL and authentication references

[A1] OWASP password storage and Argon2id baseline: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

[A2] OWASP session token generation, storage, cookies, and lifecycle: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html

[A3] OWASP authentication controls and failure behavior: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

[A4] OWASP recovery proof, enumeration resistance, and reset lifecycle: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html

[A5] OWASP server-side authorization, least privilege, and object access: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

[A6] PostgreSQL row security, default deny, and owner bypass behavior: https://www.postgresql.org/docs/current/ddl-rowsecurity.html

[D1] PostgreSQL export compatibility and archive behavior: https://www.postgresql.org/docs/current/app-pgdump.html

Repository evidence reviewed: `package.json`, backend dependency and Supabase service definitions, Auth guard and controller, consent and worker code, health checks, rate limiter and Upstash adapter, solver runner and assets, frontend CSP and recovery pages, mobile configuration and package metadata, SQL baseline and release routines, real PostgreSQL tests, and existing rollout instructions.

{{Shared technical references}}
