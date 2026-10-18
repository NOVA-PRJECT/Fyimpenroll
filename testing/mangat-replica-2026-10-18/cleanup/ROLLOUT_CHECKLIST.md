# Final rollout checklist

**CURRENT STATUS: CLEANUP COMPLETE AND VERIFIED** at 2026-10-18T15:42:23.029513+00:00. User explicitly authorized deletion without a full backup. All 921 selected public rows and 151 linked Auth users are removed, with other data preserved. See [CLEANUP_VERIFICATION.json](CLEANUP_VERIFICATION.json) and [EXECUTION_AUTHORIZATION.json](EXECUTION_AUTHORIZATION.json). Everything below is the historical preparation/review record; its earlier backup/approval blocks were superseded by that user instruction.


These checks do not imply that the entire system has passed. S2 timetable feasibility is still unresolved and was deliberately left aside by the user.

## Before cleanup approval

- [x] Save the exact test record/Auth ID manifest and user-reported test results.
- [x] Save test public rows and schema/guard definitions locally; verify package counts/checksums.
- [x] Check shared courses, foreign keys and embedded references; preserve the real Hindi AEC.
- [ ] Verify a completed recoverable backup/PITR point covering the final test state. Do not treat the local fixture JSON as a full backup.
- [ ] Decide the rollout disposition of the unresolved S2 timetable issue. The tested registration mix cannot fit 34 conflicting hours in 30 periods.
- [ ] Confirm deployment of the invalid-dashboard URL session fix, then verify valid HOD navigation to an unknown URL preserves the session in production.
- [ ] Recheck successful campus arrival/departure persistence: there are zero saved campus sign-in rows in this inventory despite the user's reported campus sign-in checks.
- [ ] Freeze test activity, refresh inventory and approve the final deletion list.

## Cleanup execution — separate authorization required

- [ ] Perform the approved public-data cleanup, preserving all non-test rows and the published timetable guard.
- [ ] Remove the approved Auth IDs through Admin API and verify no selected users/sessions/identities remain.
- [ ] Verify other campuses, shared courses, real registrations, timetable entries and accounts remain unchanged.
- [ ] Record actual execution results and recovery evidence. Preserve the historical reports.

## Production smoke check after cleanup

- [ ] Sign in with a real authorized director/HOD account and verify the correct campus/department.
- [ ] Confirm S2/S4 blueprints, published course hours, category windows, deadlines, capacities and staff assignments against intended production setup.
- [ ] Verify no TT fixture courses appear in shared option baskets.
- [ ] Verify published timetable views and teacher rosters for real records without adding test marks to real attendance.
- [ ] Check role isolation, unknown-page session preservation, exports and API/backend health.
- [ ] Confirm backup availability, support ownership and error monitoring for rollout.

Do not claim the S2 timetable, all 151 account onboarding flows or all GPS boundary cases independently passed based on the fixture setup alone.
