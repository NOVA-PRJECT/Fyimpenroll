# Course loading and department metadata fixes

Implemented on 19 October 2026. Backend release: `7efd180`.

## Behavior

- HOD catalogue results sort by course code, then ID. Courses and Blueprint retain independent filters.
- All course-list loads share a cancellable request generation. Superseded successes, errors and completion states cannot replace the selected semester.
- Visited semesters render their own in-memory cache immediately while refreshing. Failed refreshes keep that semester's saved list with Retry; uncached failures never display another semester's courses.
- Successful course mutations invalidate all semester caches and reload the active filter. Unmount disposes pending requests and prevents late mutations from restarting them. Course-move guards and prerequisite rules remain intact.
- Department names and codes are each globally unique after trimming and ignoring case. Names retain display capitalization; codes uppercase during entry, submission and database writes. Campus sharing remains allowed.
- Add/Edit checks exclude the edited department. Concurrent conflicts are enforced by database indexes and return readable 409 messages.
- Superadmin errors prefer explanatory API messages, remain inside the active dialog, preserve form input and release busy states. List/profile failures offer Retry. Server/network failures use safe action-specific messages.

## Validation

14 focused tests passed (`backend/test/department-metadata.test.cjs`, `frontend/test/course-loading.test.cjs`):

- Reversed 3 → 4 and 3 → 4 → 3 responses, ignored cancellation, stale failures, cache revalidation, mutation invalidation, wrong-semester payloads, unmount and Strict Mode remount.
- API error parsing and non-JSON/network failures; endpoint validation; department create/edit/self-exclusion; global duplicate conflicts; deterministic catalogue ordering.
- Isolated PostgreSQL tests for normalization, concurrent writes, direct writes, preserved IDs/campus sharing, and migration rollback on collisions or unexpected code normalization.

All 78 existing regression tests passed across roles, logout, middleware, blueprints, scheduling rules and timetable publication. The local-network HTTP test and solver suite were rerun serially outside sandbox restrictions after an initial EACCES/timeout; both passed. Backend build, frontend type checks and the final frontend production build passed.

Browser checks used isolated fixture data, with no production registration or account writes. Rapid semester switching retained the correct list; a cached list appeared immediately during refresh. Typing `it` displayed `IT`; a simulated 409 displayed a specific duplicate-code message inside the department dialog and preserved inputs. See `department-validation.jpg`.

## Database and performance evidence

Migration: `20261019133029_normalize_department_metadata.sql`, applied successfully to the connected project. Verified 13 departments, 13 normalized names and codes, all codes canonical, both normalized unique indexes present and the normalization trigger enabled. History retains ID `e814d190-e1c2-4731-b2ec-d97d5dc897e0` in KUC Mangattuparamba. No test campus was created.

The pre-change representative database execution was approximately 8.2 ms using the existing department/semester index. Read-only service queries against live data, including network time, measured 761/556/307/409 ms for semesters 3/4/3/4. All returned the requested semester in code order. These samples are not end-to-end authenticated browser timings or a latency guarantee; the cache removes the network wait when revisiting a semester. No unnecessary course index was added.

Security-advisor findings were unchanged after migration: five existing informational RLS-without-policy findings and the existing leaked-password-protection warning. No new findings. References: [RLS advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [password security](https://supabase.com/docs/guides/auth/password-security).

The migration and backend were released first. The backend process restarted and database/scheduler readiness passed before the frontend release.
