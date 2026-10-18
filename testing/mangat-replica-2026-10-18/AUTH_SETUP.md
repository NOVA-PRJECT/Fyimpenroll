# Create the test staff Auth accounts

**Current status:** completed and verified on 18 October 2026. The test campus, eight departments and ten staff Auth/profile pairs now exist, along with 61 TT courses and twelve S2/S4 blueprints. See [LIVE_STATUS.json](LIVE_STATUS.json) and the [verified credentials](../../scratch/mangat-replica-2026-10-18/AUTH_CREDENTIALS.md). The commands below remain available for checks and safe reruns.

`create-auth-accounts.cjs` creates the ten accounts in `accounts-plan.json` through the Supabase Admin API and inserts their matching `public.faculty` profiles:

- One campus director.
- Eight HODs, one for each planned test department.
- One teaching-staff account.

Every new account starts with **`Password123!`** and a confirmed email. Students are excluded for user bulk upload. Teachers are deferred. The script does not reset existing passwords.

## Prerequisites

Run commands from the repository root with Node.js 20.6 or newer and the repository dependencies installed. The existing `@supabase/supabase-js` dependency is used; no additional install is needed in this checkout.

The test campus and departments must exist with the exact IDs in `replica-preview.json`. This prerequisite is now satisfied. The executed `create-campus-and-departments.sql` created those records in one transaction and initialized the test settings; it must not be rerun. The Auth script creates only Auth users and faculty profiles. Course and blueprint copies were created and verified separately through `create-courses-and-blueprints.sql`.

The script reads the following server environment variables through `process.env`:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Must be `https://lhnjlwtdphugjaluzrsp.supabase.co` for this replica. |
| `SUPABASE_SECRET_KEY` | Server secret key; preferred when supplied. |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing legacy server key; used if `SUPABASE_SECRET_KEY` is absent. |

Use the ignored `backend/.env` file or variables already set in the shell. Node's `--env-file` loads the file into `process.env`; existing shell variables take precedence. The script never writes the server key to a file or prints it. Keep it in the server environment.

## Run step by step

1. Preview the ten planned accounts locally. This default mode makes zero network requests and needs no key:

   ```powershell
   node testing/mangat-replica-2026-10-18/create-auth-accounts.cjs
   ```

2. After the academic replica exists, run the read-only prerequisite and collision checks:

   ```powershell
   node --env-file=backend/.env testing/mangat-replica-2026-10-18/create-auth-accounts.cjs --check
   ```

   This checks the test campus, all eight department assignments, matching Auth emails across all pages, existing faculty ownership and staff conflicts. It does not change live records or private credential files. All checks must pass before the apply path can start writing.

3. To explicitly create the reviewed accounts, run:

   ```powershell
   node --env-file=backend/.env testing/mangat-replica-2026-10-18/create-auth-accounts.cjs --apply
   ```

   Run one instance at a time. If environment variables are already set in your shell, omit `--env-file=backend/.env`.

4. Check the final `CREATED_VERIFIED` result and open the updated local credentials:

   [Auth credentials](../../scratch/mangat-replica-2026-10-18/AUTH_CREDENTIALS.md)

   All ten rows must say `VERIFIED`. Then test the normal application login for the director, teaching staff and each HOD. API verification does not substitute for that UI rehearsal.

## Reruns and partial failures

Auth creation and faculty insertion are separate requests. Before each mutation, the script saves a checkpoint under ignored `scratch/mangat-replica-2026-10-18/`. It stops on the first error and preserves created accounts for recovery.

If a request fails or its response is lost, rerun the same `--apply` command. The script rechecks live state, resumes only users bearing its exact server-controlled seed marker and plan fingerprint, and skips existing verified pairs. It does not delete accounts, adopt unmarked users, overwrite conflicting profiles, or reset passwords. A changed plan or unrelated existing email stops the run for review.

The private output files are:

| File | Contents |
|---|---|
| `auth-creation-state.json` | Exact Auth IDs, planned roles and ownership, per-account stages and overall result; no passwords or server key. |
| `credentials.json` | Initial test passwords and per-account stages; no server key. |
| `AUTH_CREDENTIALS.md` | Human-readable login list and current verification status. |

`PARTIAL_OR_UNCERTAIN` means a request may have committed. Use the next live preflight to determine its actual state. `prepare-credentials.cjs` is an offline draft generator and deliberately refuses to overwrite credentials once creation has started.

## Local verification

```powershell
node --test testing/mangat-replica-2026-10-18/create-auth-accounts.test.cjs
```

The tests use an in-memory client, not production. They cover missing prerequisites, cross-campus ownership, foreign email conflicts beyond the first Auth page, environment handling, read-only modes, correct claims/profiles, repeated runs, partial failures, lost responses, and private checkpoint output.

Supabase may omit null metadata keys. The live check accepts a missing department only for campus-wide staff; HODs must retain the exact planned department UUID. This behavior is covered by a regression test. All thirteen local tests passed before the successful live run.

Supabase API references: [createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [listUsers](https://supabase.com/docs/reference/javascript/auth-admin-listusers).
