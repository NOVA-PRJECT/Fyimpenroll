# Registration status and destination attendance copy

Implemented 19 October 2026. Frontend-only change; no schema/API migrations or production fixture writes.

## Registration status

The old pre-allocation renderer treated the presence of a fixed blueprint course as a confirmed allocation. It also described closed-window elective slots as unsuccessful allocation rounds without checking whether the student had submitted or a run had completed.

- Fixed papers before allocation use neutral **Fixed blueprint course** cards, not green allocation badges.
- Closed-window messaging distinguishes **Registration not submitted** from **Awaiting allocation**.
- Confirmed allocations require a completed allocation phase and a persisted student slot. After allocation, missing fixed slots cannot fall back to the blueprint course or contribute to enrolled credits.
- Blueprint credits are explicitly labelled as unconfirmed; post-allocation totals count only persisted slots.
- Refreshing clears absent/stale slot and allocation maps.

## Attendance copy

- Removed “Copy to P…” from schedule cards.
- The destination marking modal offers **Copy from P…** for a marked, eligible previous practical period. Existing same-course/semester and allowed consecutive-pair restrictions remain: 1→2, 2→3, 4→5, 5→6; no lunch crossing.
- Copy performs a read of source marks and replaces only the destination draft. Cancel/Close/Escape discard the draft; **Save & Submit** persists through the existing attendance endpoint with the destination revision and timestamp.
- Incomplete or mismatched rosters are rejected rather than defaulting unmatched students to present. Failed or superseded copy requests leave the draft unchanged. Closing/changing the modal context aborts pending reads and ignores delayed responses.
- The existing server-side atomic copy endpoint remains compatible; the new UI does not call it.

## Verification

**66 focused and related regression tests passed**, including seven new status/copy tests plus blueprint, session, course-loading and password-option regressions. The final frontend production build/type checks passed.

Isolated browser fixtures verified:

- Unsubmitted students: neutral fixed cards and an explicit registration-not-submitted explanation.
- Submitted students before allocation: awaiting-allocation message, no confirmed badges.
- Allocated students: actual persisted courses confirmed; a missing fixed slot contributes no enrolled credits.
- P5 modal: Copy from P4 changed draft counts from 2 present/0 absent to 1 present/1 absent with **zero writes**.
- Cancel and reopen restored the original target marks, still zero writes.
- Explicit Save sent one `/api/attendance/period/submit` request for P5, the selected date, copied absent student IDs and **expected_revision: 7** from P5.
- Mismatched source roster rejected without draft changes; closing a delayed copy left no modal and zero writes.

Screenshots: `unregistered-blueprint.jpg`, `copy-from-p4.jpg`. All records and requests in these browser tests were local mocks, with no production registrations or attendance changed.
