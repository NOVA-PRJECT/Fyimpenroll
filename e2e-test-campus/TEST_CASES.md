# Test case index

Use the full checklist for steps. This index gives every required execution group.

| ID range | Group | Minimum coverage |
|---|---|---|
| ENV-001–010 | Environment/release | migrations, health, time, backup, restore |
| ADM-001–020 | Campus/admin | campus, departments, staff, imports, exports |
| HOD-001–030 | Blueprint/catalog | both semesters × six departments, validation, isolation |
| AUTH-001–020 | Authentication | login, consent, reset, session, role denial |
| PROM-001–010 | Promotion | semesters 1→2 and 3→4, retries, history |
| REG-001–080 | Registration | happy path, all slots, invalid payloads, deadline |
| SEAT-001–020 | Concurrency | final seat, retries, atomicity, global seats |
| ALLOC-001–040 | Allocation | both semesters, fallback, unresolved, manual allocation |
| CHANGE-001–030 | Course changes | eligible, prohibited, concurrent changes, seats |
| TT-001–030 | Timetable | assignment, solver, clashes, publish, audience |
| ATT-001–050 | Attendance | geofence, window, periods, corrections, exports |
| REPORT-001–030 | Reporting | ledger, exports, notices, reconciliation |
| SEC-001–050 | Security | ID tampering, scope, leakage, rate limits, audit |
| PERF-001–020 | Reliability | peak load, failure, retry, restore, rollback |
