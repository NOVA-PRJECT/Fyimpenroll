# Allocation rehearsal findings

## Expected S2 unresolved AEC

S2 completed with 60 students: 59 fully allocated and one partially allocated. `TTMANGAT20261018-ECOTT-S2-010` deliberately submitted only Malayalam AEC. Its HIN/MAL prerequisite excludes ECOTT, so AEC remains empty and actual credits are 19. The other 59 students have 22 credits. This is the intended prerequisite-without-fallback scenario.

The shared Hindi AEC has 60 seats and is already full globally: 59 test-campus students and one enrolment outside this test campus. It cannot currently resolve the pending slot. No capacity, prerequisite or existing allocation was changed during verification.

## HOD manual-allocation catalogue: follow-up needed

Code review found that `AllocationService.getRemainingSeats` returns only courses owned by the HOD's department, and `ManualAllocationTab` uses that list for its allocation selector. This cannot offer shared AEC courses or other department courses allowed by the student's blueprint. The manual allocation endpoint itself checks the student's blueprint/prerequisites and authorizes HODs by the student's department.

The user reproduced the missing AEC selector. The local fix adds student/slot context to the remaining-seats endpoint, resolves the saved pathway, and lists only blueprint-matching courses across permitted departments/campuses. Full or prerequisite-ineligible papers stay visible with disabled selection and a reason. The department capacity overview retains its existing scope.

Validation: all 32 backend blueprint/allocation tests, backend build and frontend type check passed. Read-only verification for ECOTT S2 010 lists both shared AEC papers with the correct blockers. A local browser fixture using the actual component verified both the blocked state and a successful simulated Hindi assignment when one seat is available. No live allocation, prerequisite, capacity or course record was changed. Frontend and backend deployment are still required; production UI/manual resolution is not yet marked complete.

The user approved and the agent created the additional test-owned Hindi AEC `KU02AECHIN103TT` under ECOTT: semester 2, 3 credits, 60 seats. Read-only verification of the corrected picker lists it as selectable for ECOTT S2 010, with 60 remaining seats. The original shared Hindi course is still full and the Malayalam restriction is unchanged. The agent did not assign the student; actual HOD manual allocation remains the next UI test. See [TEST_AEC_ADDITION_VERIFICATION.json](TEST_AEC_ADDITION_VERIFICATION.json).
