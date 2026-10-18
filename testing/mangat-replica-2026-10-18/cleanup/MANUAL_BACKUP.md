# Manual backup on the free tier

**CURRENT STATUS: CLEANUP COMPLETE AND VERIFIED** at 2026-10-18T15:42:23.029513+00:00. User explicitly authorized deletion without a full backup. All 921 selected public rows and 151 linked Auth users are removed, with other data preserved. See [CLEANUP_VERIFICATION.json](CLEANUP_VERIFICATION.json) and [EXECUTION_AUTHORIZATION.json](EXECUTION_AUTHORIZATION.json). Everything below is the historical preparation/review record; its earlier backup/approval blocks were superseded by that user instruction.


The user confirmed that no managed backup is available on the free plan. Cleanup remains blocked. Paid backups are not required to take a manual database backup.

Use the official [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) procedure. The prepared [manual-backup.ps1](manual-backup.ps1) automates its roles/schema/data exports and file checks. It never restores or deletes database data.

## What is missing on this machine

- Supabase CLI is not installed or on PATH.
- Docker Desktop/CLI is not installed or on PATH.
- No PostgreSQL database connection string or database password is configured.
- The existing Supabase secret/service key is an API credential; it does not supply the database connection password.

Install [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) and Docker Desktop and start Docker. The script discovers installed commands via help before running them. No system-wide tools have been installed by this preparation.

## Run locally

From the repository root:

```powershell
& .\testing\mangat-replica-2026-10-18\cleanup\manual-backup.ps1 -CheckPrerequisites
& .\testing\mangat-replica-2026-10-18\cleanup\manual-backup.ps1
```

Copy the database URI from this project's [Connect panel](https://supabase.com/dashboard/project/lhnjlwtdphugjaluzrsp?showConnect=true&method=session), selecting **Session pooler**, port 5432. Supply the existing database password in the URI with special characters URL-encoded. The script accepts the locally configured `SUPABASE_DB_URL` environment variable or prompts for the full URI with hidden input. Do not paste the password/URI in this chat. No password reset is performed.

The project guard allows only this exact Supabase project, session/direct connection on 5432 and the postgres database. Supabase CLI output is captured instead of echoed because error messages can contain connection details.

Outputs are in the Git-ignored `scratch/mangat-replica-2026-10-18/manual-backups/<timestamp>/` folder:

- roles.sql
- schema.sql
- data.sql, including Auth users/identities
- BACKUP_REPORT.json, containing file sizes and SHA-256 checksums but no connection credentials

The data export excludes the two vector storage metadata tables specified in the current official backup guide. No Storage files exist in the earlier inventory; recheck before backup. If files are added, transfer them separately. Existing migration records in public.schema_migrations are application data; Supabase-managed migration history, custom Auth/Storage schema changes, provider/SMTP settings, Edge Functions and other project-level configuration need separate consideration as described in the official guide.

The script checks required COPY sections and file integrity. It deliberately reports **RESTORE_NOT_TESTED**. A dump existing on disk is not proof that it restores successfully.

## Verify recovery before cleanup

1. Keep test activity/schema changes paused during the final export; refresh the cleanup inventory if anything changes.
2. Test restoration in a separate disposable Supabase project using the official restore procedure, never the production project.
3. Check public schema, policies, functions/triggers, row counts and Auth users/identities. Confirm account login and application access in that disposable environment.
4. Record the backup location/checksums and actual restore result in BACKUP_STATUS.json. Keep a second private copy outside the repository workspace.
5. Review the refreshed cleanup manifest and obtain separate deletion approval.

The earlier fixture JSON has no Auth password hashes and is still not a substitute for this recovery backup.
