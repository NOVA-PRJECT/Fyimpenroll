# Update the live Fyimpenroll deployment

Deploy updates to the existing Render Free backend and Vercel portal from **`main`**. The manual timetable fallback is part of the application on this branch. The worker runs inside the API.

## 1. Find the release on main

In PowerShell:

```powershell
Set-Location 'C:\Users\Muhammed Zayyan P V\Fyimpenroll'
git switch main
git fetch origin
git status --short --branch
git log -1 --oneline origin/main
```

For the timetable release, use the SHA already on GitHub. In the existing Render service and Vercel project, verify the production branch is `main` and note the currently live SHAs before changing any settings. If both hosts already show the target SHA, go directly to step 5. If only one has deployed it, update the other.

## 2. For future changes, test and push main

Skip this step when deploying a commit already on GitHub. Before starting new work on a clean checkout, run `git pull --ff-only origin main`. Review new and modified files, run `npm test` and the builds for the components you changed, and check any release-specific settings in step 3 before pushing.

```powershell
git status --short
git add -A
git diff --cached --name-status
git diff --cached --check
```

Review the staged list for credentials, local environment files and scratch output. Once it matches the intended release:

```powershell
git commit -m "Describe the production update"
git push origin main
git rev-parse HEAD
```

A push to `main` starts the GitHub production checks and can trigger both hosts. Confirm **database-concurrency**, **browser-regressions** and **production-build** pass for that SHA. [Production checks](../.github/workflows/production-checks.yml)

## 3. Apply the settings that changed for this release

**Render.** In your existing Free backend service, verify these three environment settings. If a setting already matches, skip it. If the service follows the Blueprint, verify the values after sync. For a manually managed service, enter the values in its Environment settings.

| Setting | Value |
|---|---|
| `RUN_REVIEW_WORKER` | `true` |
| `OPENBLAS_NUM_THREADS` | `1` |
| `OMP_NUM_THREADS` | `1` |

The first setting starts queue processing alongside the API. The other two limit numerical-library threads on the shared free instance. Compare the existing build command against [render.yaml](../render.yaml), particularly the Python OR-Tools install and import check. The API start command is `npm run start:prod --workspace=backend` and the health check path is `/api/health/ready`. If an older live revision lacks this readiness route, switch the health check with the new deployment. Saving environment settings can trigger a deployment of the currently watched commit. Verify the final SHA in step 4.

**Supabase.** You already ran the standalone workflow patch. If you ran it through `COMMIT;` successfully, proceed to the application deployment. If you are unsure because the SQL Editor displayed only the function signature, use the read-only check at the end. This release's embedded worker needs no additional SQL.

**Password recovery.** If this is the first live version of the November token-hash recovery flow, have the [reset-password email template](../supabase/templates/recovery.html) ready. Switch the existing project's recovery template when the updated portal goes live. If production already uses this template and the correct Site URL, skip this setting.

## 4. Deploy the same main commit to both hosts

1. Copy the target commit SHA from GitHub’s `main` branch. Use that SHA for both deployments.
2. Open **Render → existing backend → Events/Deploys**. If the push already triggered a deploy for that SHA, follow it. Otherwise manually deploy that commit to the existing service. Look for `Queue processing enabled in the API process` in the new instance's logs.
3. Open **Vercel → existing portal → Deployments**. Follow the **Production** deployment for the same SHA. If it did not trigger, deploy that revision through the project's existing production workflow. A redeploy of an older Vercel deployment rebuilds its older revision. Confirm the live alias is `fyimpenroll.vercel.app`.
4. The hosts may build in parallel. Treat the rollout as complete only after the API is ready and the portal domain points to the matching release. If you control promotion manually, check the direct API first and then promote the portal.

The web and installed PWA receive the Vercel release. If you also distribute a native mobile app and want to ship the mobile source changes included here, use your existing native release channel for the updated build.

## 5. Verify the live update

Copy the backend origin from the existing Render service, then run:

```powershell
$apiOrigin = Read-Host 'Paste your existing Render API origin (https://...)'
Invoke-RestMethod "$($apiOrigin.TrimEnd('/'))/api/health/ready"
Invoke-RestMethod 'https://fyimpenroll.vercel.app/api/health/ready'
```

Both should return `status = ready`, `database = true`, `solverAndRules = true`, and `worker = true`. Allow the Free service to wake on the first request. If `worker` stays false, check the deployed SHA, the startup log and `RUN_REVIEW_WORKER=true`. If only the Vercel URL fails, check the existing project's production `BACKEND_URL` against the Render origin.

Sign in with a test account. Open **Director → Course Allocation** and verify the existing cohort's status loads. On a test cohort, a waiting job should show **Queued**, then **Running**, then its final result. Use a fresh recovery email to verify the password-reset flow if the template changed. Use staging for deletion and cancellation race tests.

**If the update fails**, keep or restore the previous compatible deployment using the SHAs from step 1, or deploy a corrective commit if the previous app is incompatible with the installed SQL or recovery template. Check both health URLs again. Avoid replaying database migrations as an application rollback.

### Optional read-only confirmation of the applied SQL

```sql
SELECT
  public.production_readiness() AS database_readiness,
  strpos(pg_get_functiondef(to_regprocedure(
    'public.finish_review_job(uuid,uuid,text)')),
    'CASE WHEN complete THEN NULL ELSE left(p_error,2000) END') > 0 AS completion_fix,
  strpos(pg_get_functiondef(to_regprocedure(
    'public.cancel_review_job(uuid,uuid)')),
    'Job has already finished. Refresh its status.') > 0 AS cancellation_fix,
  strpos(pg_get_functiondef(to_regprocedure(
    'public.review_delete_accounts(text,uuid,uuid)')),
    'NOT (course_id=ANY(course_ids))') > 0 AS department_fix;
```

Expect all three fix flags to be true and database readiness to report ready. If a flag is false, check the selected project and consult the [existing-release upgrade instructions](../supabase/REVIEW_RELEASE_ROLLOUT.md) before applying further SQL.
