# Generation session recovery

An expired access cookie could leave the timetable generation popup showing
"Authentication token missing" until a page reload. Browser reads renewed the
session, but generation and other mutations returned the initial 401 unchanged.
API middleware also performed a separate refresh when the access cookie was
missing, allowing competing rotations during polling and on the refresh route.

The authentication guard now marks missing or invalid credentials with
`AUTH_SESSION_REJECTED`, before a controller or protected operation can execute.
The browser coordinator renews cookies and retries that explicitly rejected
request once, including generation, allocation and other mutations. An ambiguous
mutation failure is never automatically replayed. Safe reads retain their single
retry. Concurrent requests share renewal; late 401 responses reuse renewed
cookies. Logout invalidates pending refresh and retry decisions.

API middleware forwards requests without rotating cookies. Page middleware still
verifies roles, consent and password restrictions and recovers expired sessions
on navigation. Logout with only a refresh cookie renews internally to revoke the
session, without issuing credentials, and still clears cookies during outages.
Provider/network/rate-limit outages during renewal return a
recoverable 503 instead of the original misleading 401. Revoked refresh sessions
remain unauthorized and require sign-in; session lifetimes are unchanged.

No database migration, solver change or mobile change is required. Deploy the
backend guard marker and frontend coordinator. If the frontend arrives first,
unmarked mutation failures retain the existing no-replay behavior.

Regression checks cover missing and expired access credentials, a consumed POST
body, simultaneous generation and polling, late 401 responses, logout before
and during renewal, revoked refresh credentials, repeated rejection and provider
outages. To verify production, leave the director page open until the access
cookie expires while the refresh cookie remains, then generate a timetable:
expect one coordinated refresh, one accepted generation request and continued
progress polling without a page reload. Do not remove the refresh cookie or
publish the draft solely for this check.
