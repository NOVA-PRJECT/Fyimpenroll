# Login and navigation release — 2026-10-11

The backend returns verified routing facts through `GET /api/auth/session` and includes the final destination in login responses. Middleware now enforces role, password-change and consent gates through that endpoint. Login avoids unchanged Supabase metadata writes and starts independent operations together. Student summary queries start together using verified campus information, with a fresh campus check before returning data.

Dashboard navigation renders while optional data loads. Registration and timetable links show immediate pending text and a spinner, retaining native keyboard and modified-click behavior. Route and HOD chunk fallbacks are visible. Service failures preserve valid sessions and provide retry controls. Registration, allocation and publication controls remain dependent on authoritative data.

Scope: web frontend/backend only. No database migration and no mobile release.

## Verification

- Backend suite: 251 passed, 0 failed; 1 separate-connection database test skipped locally. Backend commit `1250db9` passed GitHub Production checks, including PostgreSQL checks and clean deployment builds.
- Frontend: 22 tests passed; type check, lint (zero warnings) and production build passed.
- Coverage includes consent accepted/missing, password-change priority, wrong roles, expired session refresh, provider/network outages and malformed session facts. Existing account-switch cleanup and full reload behavior are preserved.
- Local production frontend against synthetic responses: student and HOD shells appeared before six-second section responses completed; director actions were disabled until campus settings loaded.
- With an eight-second session response during navigation, the old page immediately displayed a spinner and `Opening…` (observed within 0.633 seconds including browser-tool overhead), then completed navigation. Registration also displayed its route fallback. Return links worked with Enter.
- Timetable settings HTTP 503 displayed a retry control and kept generation disabled. Retrying after recovery enabled generation. Session-provider HTTP 503 displayed a recoverable page at the original URL; retry restored the HOD dashboard without signing in again.

Controlled warm AuthService benchmark: five samples per role, synthetic accepted-consent accounts and 50 ms per external operation.

| Role | Previous median | New median |
| --- | ---: | ---: |
| Director | 290 ms | 231 ms |
| Student | 279 ms | 232 ms |
| HOD | 280 ms | 216 ms |

These measurements exclude transport, browser rendering and hosting startup. They are not production login timings. Authenticated production checks and cold-start comparisons require role test accounts and a completed hosting rollout.

## Deployment order and Render repair

Backend commit `1250db9` was pushed first. Production `/api/auth/session` returned HTTP 401 for a request without credentials, confirming the additive endpoint was live before frontend rollout. Deploy the frontend after that check; no schema changes are required.

The current Render dashboard Build Command supplied by the owner was `npm install --include=dev && npm run build`. This omits the solver dependency install. Production readiness returned HTTP 503 with `database: true` and `solverAndRules: false`, independently of the session endpoint rollout. Startup messages saying the service is live do not verify solver readiness.

For the existing manually configured Render service, apply these settings in its dashboard (repository YAML alone may not update that service):

- Root Directory: repository root, blank or `.`
- Environment: `PYTHON_VERSION=3.12.14` (matches the locally verified Python minor version and the pinned OR-Tools wheel support).
- Build Command:

```sh
python3 -m pip install -r requirements.txt && python3 -c "from ortools.sat.python import cp_model" && npm ci --workspace=backend --include-workspace-root --include=dev && npm run build:backend && npm prune --omit=dev --workspace=backend --include-workspace-root
```

- Start Command: `npm run start:prod --workspace=backend`
- Redeploy, then require `/api/health/ready` to return HTTP 200 with `database: true` and `solverAndRules: true`.

`render.yaml` carries the same settings for Blueprint deployments. Python support was checked against [OR-Tools 9.11 release files](https://pypi.org/project/ortools/9.11.4210/#files) and [Render Python-version documentation](https://render.com/docs/python-version).

Production smoke checks: director/student/HOD login; mandatory password and consent redirects; account switching; student registration/return navigation; director timetable/return navigation; HOD tab loading; provider failure/retry. Compare warm login-to-shell and click-to-page timings separately from service startup. Use test accounts; avoid changing live academic data during navigation checks.
