-- Recovery for the single abandoned job observed on 11 October 2026.
-- Pause new timetable generation, then run this whole file before rerunning
-- APPLY_PENDING_WEB_REPAIRS.sql. No academic records or timetable entries change.
-- The exact ID and last-update guard prevent cancelling a refreshed worker.
ROLLBACK;
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtext('timetable:5b5289d5-17eb-43ba-832e-19883e9eaada:2026-27:1'));
UPDATE public.system_logs
SET status = 'failed',
    error_message = 'Abandoned worker recovered before web repair rollout; last update 2026-09-03. Retry generation after deployment.',
    completed_at = now(),
    updated_at = now()
WHERE id = '988fc349-e413-40b6-98ff-a607672d25bf'::uuid
  AND log_type = 'timetable_job'
  AND status = 'running'
  AND campus_id = '5b5289d5-17eb-43ba-832e-19883e9eaada'::uuid
  AND academic_year = '2026-27' AND semester = 1
  AND updated_at = '2026-09-03T08:43:57.264586+00:00'::timestamptz
  AND updated_at < now() - interval '30 minutes'
RETURNING id, log_type, status, completed_at;
COMMIT;
-- This must return no rows before the repair bundle can proceed.
SELECT id, log_type, status, academic_year, semester, started_at, updated_at
FROM public.system_logs
WHERE log_type IN ('allocation_run','timetable_job') AND status IN ('queued','running')
ORDER BY updated_at;
