## University infrastructure preparation

Owner: university infrastructure and network teams. Complete these steps in staging first, then repeat the approved configuration in production. The command examples use Ubuntu Server 24.04 LTS and Bash. Equivalent university standard operating systems need their own tested package and service commands.

STEP Record the production public IPv4 address, optional IPv6 address, internal addresses, network masks, gateway, DNS resolvers, VLANs, server names, and university asset numbers. Confirm that the connection accepts inbound public traffic; a private address behind carrier grade NAT is insufficient without a university ingress service.
STEP Reserve `enroll.university.example` for the portal. Replace this example with the actual university domain everywhere, including emails and mobile builds. Reserve a separate staging hostname and, for the Supabase route, `sb.university.example`. Keep administrative hostnames accessible through the university VPN.
STEP Ask the network team to create the necessary NAT or load balancer mappings and university firewall rules. Public clients need HTTPS 443. Open HTTP 80 only for redirection or the approved certificate challenge. Permit SSH only from the management network. Do not expose application ports 3000 or 4000, PostgreSQL 5432, pooler 6543, Redis 6379, Docker sockets, or database administration interfaces to the Internet.
STEP Check IPv6 separately. Publish an AAAA record only after IPv6 routing, filtering, and HTTPS have passed the same tests as IPv4. Test split DNS from inside campus and public DNS from outside campus. Arrange NAT loopback or internal DNS resolution for campus clients if needed.
STEP Provision separate staging and production machines or isolated virtual networks. Keep production data out of ordinary developer machines. If a production restore is needed for rehearsal, restrict access, suppress outgoing mail, document retention, and use approved anonymization before broader testing.
STEP Install the approved operating system image and updates. Configure server time synchronization, a supported time zone database, monitoring, encrypted disks where required, and university backup agents. Store event timestamps consistently; verify that attendance dates and cutover records display correctly in Asia/Kolkata. Record whether the host and database store or display UTC.
STEP Create a named administrator and a noninteractive application service account. Install the administrator's SSH public key, test a second session, and only then disable password based SSH and direct root login according to university policy. Record the emergency console and recovery access procedure.
STEP Create separate locations for releases, configuration, state, and backups. A reference layout is `/srv/fyimp/releases/RELEASE_ID`, `/srv/fyimp/current`, `/etc/fyimp`, `/var/lib/fyimp`, and `/srv/fyimp-backups`. Use a unique immutable release directory for each build. Keep secrets outside releases and outside the web root.
STEP Give the deployment account ownership of release directories and the service account read and execute access. Grant write access only to documented runtime cache or state directories, including the Next.js cache if used. Make secret files root owned and readable only by the intended service identity or systemd. Test access without making the entire tree writable.
STEP Install Git, Nginx, CA certificates, OpenSSL, Python 3.12 with virtual environment support, and PostgreSQL client tools compatible with the source database. Install the repository required Node 24.19.x and npm 11.17.x from university approved packages or verified official archives. Record exact versions and package checksums. Do not replace them with an arbitrary distribution Node version.

```bash
sudo apt-get update
sudo apt-get install -y git nginx ca-certificates openssl \
  python3 python3-venv python3-pip dnsutils
node --version
npm --version
python3 --version
psql --version
```

STEP Configure outbound access deliberately. Builds need the approved source repository and npm and Python package sources or university mirrors. Runtime needs DNS, time synchronization, SMTP, certificate renewal where applicable, and currently `api.pwnedpasswords.com` over HTTPS for password writes. Add Supabase endpoints only for route A. Mirror dependencies and replace external runtime integrations when policy forbids them; test the replacement before cutover.
STEP Remove production Upstash credentials unless their continued use is explicitly permitted. The code uses the Upstash HTTP API, so pointing its URL at a normal Redis TCP server will not work. For the initial single API process, the existing bounded local limiter is available, but counters reset on restart. Use an approved shared limiter or adapt the code to university Redis before multiple API replicas. Check abuse controls at the university ingress as well.
STEP Replace Google Fonts links in `frontend/src/app/layout.tsx` with licensed local font files if runtime requests must stay within university infrastructure. Remove obsolete cloud links, environment values, telemetry integrations, and external backup destinations. Record which external dependencies are retained, replaced, or unused.
STEP Size resources from measured demand and include database, WAL, temporary sort space, solver memory, exports, build memory, and backup growth. As an initial planning allocation, use separate application and database VMs with 4 to 8 vCPU and 8 to 16 GB RAM each, then load test. These figures are project planning assumptions, not measured capacity or a guaranteed minimum. A single machine is a documented single point of failure.

Completion evidence: approved topology and firewall matrix; tested management access; version inventory; runtime egress register; usable disk and backup capacity; staging isolation.

## Building the application release

Owner: application team. Build the exact approved source revision. For the plain PostgreSQL route, complete the replacement implementation and its tests before these production build steps.

STEP Record the deployed production SHA and the chosen migration release SHA separately. The local source reviewed for this document had HEAD `5d05294e811b22dd9145ab0c8e6fab284e34e499` plus working tree edits. Release from a reviewed commit or controlled source archive that includes intended changes; do not assume that local HEAD is the deployed system.
STEP Clone the university controlled repository into a fresh release directory, check out the approved revision, and record `git rev-parse HEAD` and `git status --short`. Preserve the monorepo structure: `backend`, `frontend`, `mobile`, `contracts`, `vendor`, `patches`, root package files, and build scripts. Local workspace packages depend on this layout.
STEP Create the backend and frontend environment files using the route specific matrix in this document. Apply restrictive file permissions. Set frontend public values and `BACKEND_URL` before building, since public variables and the configured rewrite destination are build sensitive. Build staging and production separately when their public endpoints differ.
STEP Run `npm ci` from the repository root with development dependencies available for compilation. Keep lifecycle scripts enabled: root postinstall applies the repository's security patches. Retain `package-lock.json`. Record install output, patch results, and approved dependency exceptions; do not perform an unreviewed dependency upgrade during migration.
STEP Create a dedicated Python virtual environment and install the pinned solver requirements. Use its absolute Python path in `PYTHON_PATH` for both API and worker. Include the virtual environment or recreate it deterministically on the runtime host; it is not supplied by the Node build.

```bash
cd /srv/fyimp/releases/RELEASE_ID
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -c 'from ortools.sat.python import cp_model'
npm test
npm run build:frontend
npm run typecheck --workspace=mobile
```

STEP Confirm that the backend build contains `backend/dist/main.js`, `backend/dist/worker.js`, `ortools_solver.py`, and `constraints.base.json` under the solver directory. The Nest configuration copies JSON and Python assets. Test using the production working directory and service account so source path fallbacks do not hide missing build assets.
STEP Preserve the runtime workspace dependencies and Next.js build output. Start the frontend through `next start`, not a static file server: the project uses server behavior and API rewrites. A container or standalone Next.js packaging scheme is optional new packaging work and must be built and rehearsed separately; this repository does not currently supply a university deployment Compose file.
STEP Record the build SHA, lockfile hash, Node and Python versions, SQL release version, environment names, and artifact checksums in a release manifest. Store the build log privately. Keep secrets and authentication tokens out of the manifest.

Completion evidence: reproducible build artifacts, security patches applied, solver import works, production assets exist, and relevant tests have recorded outcomes. A passing build alone does not authorize public release.

## Process supervision and public HTTPS

Owner: infrastructure team with application team verification. The reference routing sends portal `/api/` directly from Nginx to NestJS and all other portal requests to Next.js. This gives the browser one origin and gives NestJS one trusted reverse proxy hop.

STEP Open `/etc/systemd/system/fyimp-api.service` with the university approved administrator editor, paste the reference unit below, substitute actual paths, save, and verify file permissions. Replace the executable path with the installed approved Node toolchain path and resolve `PYTHON_PATH` to a stable release path. Ensure that the service account already exists and can read its configuration. Environment files use systemd syntax, not shell commands.

```ini
[Unit]
Description=FYIMP API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=fyimp
Group=fyimp
WorkingDirectory=/srv/fyimp/current
Environment=PATH=/opt/node/bin:/usr/bin:/bin
EnvironmentFile=/etc/fyimp/backend.env
ExecStart=/opt/node/bin/npm run start:prod --workspace=backend
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=120
NoNewPrivileges=true
UMask=0027

[Install]
WantedBy=multi-user.target
```

STEP Save a matching unit at `/etc/systemd/system/fyimp-web.service` with the same working directory and toolchain path, `Environment=NODE_ENV=production`, an optional separate frontend runtime environment file, and `ExecStart=/opt/node/bin/npm run start --workspace=frontend`. Permit Next.js cache writes only where required. Keep frontend startup secrets separate from backend privileged credentials.
STEP Choose exactly one initial job execution mode. The simplest supported mode is one API process with `RUN_REVIEW_WORKER=true`. In dedicated mode, set it to false in the API and install `fyimp-worker.service` with `ExecStart=/opt/node/bin/npm run start:worker --workspace=backend`, the backend configuration, and the same solver runtime. Rehearse worker readiness and graceful shutdown in that mode. Do not accidentally add a second worker while assuming only one exists.
STEP Point `/srv/fyimp/current` at the approved release using an atomic symlink replacement prepared by the deployment account. Check the resolved path before changing it. Run `systemctl daemon-reload`, enable the chosen services, start them, and inspect their journals. Start the database and authentication services first. Confirm service autostart after a controlled reboot.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fyimp-api.service fyimp-web.service
sudo systemctl status fyimp-api.service fyimp-web.service
sudo journalctl -u fyimp-api.service -n 100 --no-pager
curl --fail http://127.0.0.1:4000/api/health
curl --fail http://127.0.0.1:4000/api/health/ready
```

STEP Obtain a certificate covering the final portal hostname from the university PKI trusted by public devices or an approved public CA. Install the full chain and restrict private key access. Set automated renewal and a monitored expiry alert. Test renewal. Do not use a self-signed certificate for public mobile and browser access.
STEP Save the Nginx HTTPS server below at `/etc/nginx/sites-available/fyimp.conf`. Substitute actual names and certificate paths, then enable it with a symlink in `/etc/nginx/sites-enabled/` under the university's configuration convention. Remove any conflicting default virtual host only after checking what it serves. Configure the HTTP server separately to redirect to HTTPS and permit only the selected certificate challenge if required. Do not redirect a still unconfigured HTTPS hostname during certificate issuance.

```nginx
server {
    listen 443 ssl;
    server_name enroll.university.example;
    ssl_certificate /etc/fyimp/tls/fullchain.pem;
    ssl_certificate_key /etc/fyimp/tls/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 10m;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 120s;
        proxy_cache off;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_buffering off;
    }
}
```

STEP Retain the `/api/` prefix: the example `proxy_pass` intentionally has no trailing slash. Align upload limits with actual approved bulk file sizes and application limits; 10 MB is a starting value for testing, not a final requirement. Queued timetable generation should return promptly and be polled; do not solve long jobs by raising every request timeout indefinitely. [O3]
STEP Set `TRUST_PROXY_HOPS=1` only for the documented direct Nginx to Nest route. If a university load balancer or the Next.js rewrite is also in the chain, document the real chain and re-evaluate trust and header sanitization. Never trust arbitrary forwarded client addresses. A useful test is to send a forged `X-Forwarded-For` and confirm the recorded caller remains correct.
STEP Disable proxy caching on authenticated routes, API responses, recovery pages, and `sw.js`. Check that application no-store headers survive the proxy and that service worker responses are current. Remove query strings from access logs on password recovery routes so recovery proof is not retained in logs. Do not enable request body or Authorization header logging.
STEP Test Nginx syntax with `sudo nginx -t`, reload it, and use `curl --resolve` or a hosts file to test the final hostname before public DNS changes. Confirm certificate hostname and chain, secure cookies, API forwarding, deep links, exports, and the absence of mixed content.

```bash
sudo nginx -t
sudo systemctl reload nginx
# Substitute the real hostname and public address.
curl --fail --resolve enroll.university.example:443:PUBLIC_IP \
  https://enroll.university.example/api/health/ready
dig A enroll.university.example
dig AAAA enroll.university.example
curl --fail https://enroll.university.example/api/health/ready
```

Completion evidence: services restart automatically, public HTTPS is valid, the portal and API work through the final hostname, no internal service port is exposed, and logs contain no credentials.

## Validation before the public switch

Owner: application QA, database owner, security reviewer, and designated university users. Perform destructive and concurrency tests only on an isolated test database.

STEP Run `npm test`, the frontend production build, and mobile type checking for the release. Run `npm run test:browser` with the required browser installed; the existing browser configuration exercises a local fixture server and does not replace live acceptance testing.
STEP Run `npm run test:postgres` only with `FYIMP_TEST_DATABASE_URL` pointing to a new disposable database. Inspect `tests/helpers/final-database.cjs` first: the harness rebuilds application objects and uses synthetic accounts. It must never receive a live or migrated production database URL. For route B, adapt the Supabase dependent fixture and add real driver integration coverage.
STEP Verify `/api/health` and `/api/health/ready` through both the local API and the final public portal origin. Current readiness checks database compatibility, solver assets, and recent worker heartbeat. It does not prove successful login or SMTP. Route B must provide equivalent real dependency checks rather than hardcode readiness success.
STEP Test valid login, invalid login, refresh, logout, expiry, revoked sessions, forced password change, current policy consent, and disabled or deleted accounts. Repeat password recovery with a fresh email using the final hostname. Confirm that merely previewing the email or visiting the confirmation URL does not consume the reset proof.
STEP Use controlled accounts for superadmin, campus director, HOD, teacher or teaching staff, and student. Test both permitted actions and rejected requests, including direct API requests with another student's ID, another campus ID, an unrelated department, and a stale academic term. Viewing and mutation permissions must be tested separately.
STEP Test student registration, ranked preferences, allocation status, seat capacity, timetable generation, manual timetable placement and overrides, teacher assignment, attendance first submission and correction revisions, campus geolocation sign-in, exports, department notices, and account administration. Preserve intended visiting teacher and historical term behavior.
STEP Exercise duplicate submissions, competing allocations, teacher reassignment during attendance, cancellation during completion, worker termination and lease recovery, and stale term operations. Confirm there is no duplicate committed work, silent overwrite, or loss of history. Reconcile failed jobs before retrying them.
STEP Load test the anticipated registration peak plus representative timetable jobs and exports. Agree the expected concurrent users, request mix, p95 response times, error rate, queue delay, database connections, disk latency, CPU, and memory before testing. Record the achieved limits and adjust capacity or concurrency before launch.
STEP Test from campus Wi-Fi, campus wired access, and a mobile data connection outside campus. Use at least one real Android device and an iPhone if iOS is distributed. Confirm location permission handling, certificate trust, legal page access before login, session storage, and recovery links.
STEP Restore the newest backup into an isolated environment, start the application against it, and verify identity, records, schema, and a representative report. Record the actual recovery time and recovered timestamp. A completed backup job without a restore test is insufficient.

Completion evidence: signed test record with release SHA, environment, accounts, expected and actual results, defects, and responsible reviewers. Any unresolved security, data reconciliation, authentication, worker, or restore failure blocks opening writes.

## Timed cutover and rollback

Owner: named cutover lead. Record actual timestamps with time zone, source and destination identifiers, operator names, and go or no-go decisions. The sequence below uses a planned maintenance window; it does not promise zero downtime.

STEP At least 48 hours before the window, lower relevant DNS TTL to an agreed short value such as 300 seconds. Confirm the previous longer TTL has elapsed. Prepare the public notice, support contacts, maintenance page, old endpoint write fence, rollback artifacts, and staff coverage. Do not send notices until the university authorizes their content and channel.
STEP Before the window, stage the new application behind restricted ingress. Complete the restore rehearsal, record its duration, and derive the window from export, transfer, restore, validation, and contingency time. Freeze application deployments and database schema changes on the source.
STEP At the start of maintenance, stop new writes at every old entry point: portal, direct API, native apps, integrations, jobs, and administrative scripts. A maintenance page on the website alone does not block mobile or direct API clients. Stop or drain the source worker, inspect committed job outcomes, and prevent authentication changes, recovery writes, and new account creation during the final snapshot.
STEP Verify the Auth freeze separately from the backend freeze. Existing native clients can contact source Supabase Auth directly. The source owner must prepare and rehearse provider-supported controls that prevent those identity and password writes during the final snapshot, or a separately reviewed database write fence with service impact understood. Disabling signup alone is insufficient. If identity writes cannot be fenced, stop the cutover until a tested final identity delta and conflict reconciliation procedure is available; do not declare a consistent migration from the portal maintenance page alone.
STEP Confirm quiescence using source activity, queue state, and controlled rejected write attempts. Record the last accepted transaction or cutoff timestamp. Take the final database export and identity export, synchronize any object files, compute checksums, and transfer them over a protected channel. Follow the route specific restore sequence into the prepared empty destination.
STEP Reconcile final table and identity counts, UUID mappings, sequence values, credit and attendance totals, term state, history, grants, and required constraints. Do not migrate a queued notification that could resend unexpectedly. Preserve audit history and explicitly classify any transient job or session records being discarded.
STEP Start destination authentication, API, and the chosen worker while user writes are still blocked. Allow readiness to reflect a fresh heartbeat. Check health, perform controlled login and recovery tests, inspect logs, and verify that no destructive job starts unexpectedly. Remove test records through the approved test cleanup procedure.
STEP Hold the go or no-go review. The cutover lead, database owner, application owner, and network owner confirm reconciliation, authentication, readiness, restore evidence, valid HTTPS, and rollback readiness. If any required evidence is missing, keep maintenance active and use the pre-write rollback below.
STEP Update the university DNS or ingress target, keeping the old site write fenced. If the old hostname is provider owned, such as a Vercel subdomain, the university cannot repoint its DNS; configure a tested redirect or retirement message there through the current account owner. Publish the university hostname and update QR codes, documentation, and recovery templates.
STEP Confirm DNS using multiple resolvers and an outside campus connection. Open writes only on the university destination. Record the exact opening time. Monitor the first real login, registration, worker result, email, and export. Keep the source read-only for the approved observation period, not as a second writable deployment.
STEP Before destination writes open, rollback is straightforward: keep the destination fenced, restore the old ingress and source configuration, resume the old worker, confirm health, then reopen source writes. Reissue provider-specific recovery links and require login when signing keys differ. Record the failed destination and evidence for investigation.
STEP After any destination writes, do not simply switch DNS back: source data is stale. Fence both systems, take a destination backup, enumerate and reconcile new records, identity and password changes, deletions, and external effects. Use the rehearsed reverse migration or forward repair with the database owner. Reopen exactly one writer only after reconciliation; record the accepted recovery point and any approved loss.
STEP Keep prior code, configuration, keys, and encrypted source exports accessible only to authorized recovery staff until the retention and acceptance period expires. Rollback application code only to a version compatible with the installed schema; do not undo database history by replaying old migrations.

Completion evidence: final source and destination manifests, signed reconciliation and go-live record, one active writer, public accessibility, support ownership, and documented rollback status.

## Backups operations and retirement

Owner: university operations team and database owner. Hosting transfers ongoing service responsibility to the university, including software security, data protection, backups, monitoring, and incident response.

STEP Agree measurable recovery objectives before launch. A proposed starting target is at most 15 minutes of data loss and restoration within 4 hours; university owners must approve or replace these values. Daily logical dumps alone cannot satisfy a 15 minute recovery point. Use rehearsed base backups plus continuous WAL archiving when that objective is selected. [O4]
STEP Schedule encrypted database backups to a second university controlled fault domain with separately stored keys and least privilege access. Include identities, application schema and data, role definitions, migration receipts, job state where needed, and sequence values. Back up file objects separately when used; database metadata alone does not contain object bytes.
STEP Back up service configuration, TLS recovery material according to PKI policy, mail templates, deployment manifests, signing material, and mobile signing assets into restricted stores. Protect password hashes and backup files as credentials. Do not include plaintext passwords, recovery URLs, or active session values in routine support bundles.
STEP Monitor backup age, WAL archival gaps, archive growth, database storage, connection usage, deadlocks, replication lag if present, queue age, failures and retries, worker heartbeat, solver runtime, API errors, authentication errors, SMTP delivery, certificate expiry, and host resource pressure. Send alerts to the named university duty team through an approved internal channel.
STEP Check alerts and failed jobs daily during initial operation; verify backup success and perform sample business reconciliations. Schedule periodic isolated restore drills, with a full application recovery exercise at least quarterly as a proposed operating baseline. Record outcomes and remediate failures.
STEP Apply supported OS, Node, Python, PostgreSQL, Nginx, and route specific service patches through staging and a maintenance window. Pin versions, review release notes, take a usable backup, test auth and database compatibility, and retain a compatible rollback artifact. Do not run an unattended upgrade to latest across the stack.
STEP Document certificate renewal, secret rotation, user onboarding and offboarding, privileged access, job recovery, disk exhaustion, compromised credentials, lost signing keys, and database corruption procedures. Transfer source access, build access, PKI access, domain administration, mobile signing custody, and backup recovery access to named university custodians.
STEP After the approved observation period and written acceptance, take the final retained source archive and confirm its restore capability. Remove old API keys from applications and CI, revoke cloud credentials, remove obsolete deployments and integrations, and retire the old cloud data and backups according to the university's retention decision. Confirm that old mobile clients and old recovery links cannot silently write to the retired source.
STEP Keep an ownership register, architecture diagram, endpoint inventory, software and license inventory, evidence directory, backup restoration record, latest release manifest, and incident contacts with the university service desk. Verify that a second operator can perform the documented restart and restore procedures.

Completion evidence: university operations acceptance; successful monitored backups and restore drill; named support and security owners; cloud retirement record; final public service ownership.

## Shared technical references

References were checked on 5 November 2026. Recheck the selected package versions and commands during implementation. Repository paths refer to the approved source checkout and are not public service endpoints.

[O1] Next.js self-hosting and build time public environment behavior: https://nextjs.org/docs/app/guides/self-hosting

[O2] PostgreSQL logical backup and restore behavior: https://www.postgresql.org/docs/current/backup-dump.html

[O3] Nginx reverse proxy directives and URI forwarding: https://nginx.org/en/docs/http/ngx_http_proxy_module.html

[O4] PostgreSQL continuous archiving and point in time recovery: https://www.postgresql.org/docs/current/continuous-archiving.html

[O5] Expo local native builds and platform constraints: https://docs.expo.dev/build-reference/local-builds/
