# Authentication performance

Login retains credential verification, rate limits, current account/role checks,
password-change requirements, and consent enforcement. Web login can request
`preloadDashboard: true`: the same authenticated operation loads the initial
dashboard data. The browser consumes this data once after navigation, with a
60-second expiry. Middleware still verifies dashboard access, and subsequent
reads, refreshes, and mutations still use authenticated API endpoints. If data
loading or browser storage fails, the dashboard uses its normal API request.
Mobile login does not request this preload; it loads the backend profile once,
outside the Supabase auth event callback. Late responses cannot restore a
signed-out account.

## Audit delivery

Session audit events use the existing `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`. Login/logout wait for Redis acceptance, then the
worker writes batches to `system_logs`. No new database migration or credentials
are needed. Events retain their original timestamp and UUID. Leases last 60
seconds; a failed write, failed acknowledgement, or process restart leaves the
event available for retry. UUID upserts prevent duplicates. Workers check for
recovery every 30 seconds and also run after enqueueing an event.

If Redis is unconfigured or enqueue fails, the existing synchronous database
path remains available. This fallback favors audit delivery over latency. Queue
operations have a two-second timeout. Watch backend warnings for queue/delivery
failures; prolonged database outages delay visibility in the audit log.

## Logout and measurement

Expired-cookie logout renews credentials solely to revoke them, without account
lookups or metadata writes. Regular refresh also skips unchanged metadata.
Web logout suppresses competing refreshes and has a 12-second timeout with retry
feedback. It only navigates after the backend confirms browser cookie cleanup,
and distinguishes that cleanup from successful global revocation.
Mobile global sign-out routes the SDK's revocation request through the backend
once, retaining SDK encrypted-storage cleanup and auth events.

Inspect `Server-Timing` on web login/logout responses. Login reports
`authentication` and `dashboard_preload` separately; logout reports `logout`.
Compare total time from clicking Sign in to a usable dashboard, not just the
login endpoint duration: the preload moves initial data loading into that
response. Compare warm sessions for each role and test expired-cookie logout
separately. Hosting configuration and the health-check cron are unchanged.
