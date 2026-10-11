# Timetable draft save repair

Run **the entire `APPLY_TIMETABLE_DRAFT_REPAIR.sql` file** in Supabase SQL Editor after any running timetable generation finishes. This is a new repair; do not rerun the earlier production repair bundle. The handoff exactly matches migration `20261011010000_timetable_draft_delivery_repair.sql`.

The failed Semester 1 save encountered 144 existing draft entries without a host campus ID. The previous atomic replacement function deleted only entries with an explicit matching campus ID, leaving those legacy rows to collide with the new schedule. The deployed `timetable_entries_unique` index already includes `course_id`, so parallel MDC or other category options were not the cause of this error.

The repair replaces that historical index with a unique delivery key containing both campus and course. Different courses can share a department slot, and the same course can be delivered at different campuses. Duplicate deliveries within one campus remain prohibited, including rows containing null fields.

The replacement function includes legacy campus-less rows belonging to the requested campus's departments when checking published schedules and replacing drafts. It retains worker fencing, lease checks, atomic rollback, draft fingerprints, and backend-only execution. Applying the SQL changes no timetable rows. Legacy drafts are removed only within the next successful atomic draft replacement. Published schedules and other campuses or terms remain protected.

The SQL stops without committing if generation is active, existing deliveries are duplicated, or an index has an unexpected definition. It does not recover jobs or delete conflicting data automatically. If it reports active generation, wait for that job to finish before rerunning the entire file.

The final result should show `timetable_entries_delivery_unique`, with `campus_id` and `course_id` in its definition and `NULLS NOT DISTINCT`. Then generate the timetable again from the director dashboard. A successful complete generation saves the draft; incomplete review drafts continue to list unscheduled sessions and cannot be published.

Validation covers reproduction of the original error, repair reapplication, constraint-owned and standalone historical indexes, parallel courses, multi-campus delivery, preservation of unrelated rows and indexes, rollback on bad input, published legacy rows, expired worker claims, RPC privileges, and refusal to discard existing duplicates. CI also runs the transaction suite against disposable PostgreSQL 16.

Local backend compilation passed. The complete backend suite passed sequentially: 288 tests passed, with only the separate real-PostgreSQL concurrency check skipped locally. The initial parallel run had one solver process failure; its isolated rerun and the full sequential run passed. The fresh bootstrap table definition also compiled in a disposable database and created the expected delivery index.
