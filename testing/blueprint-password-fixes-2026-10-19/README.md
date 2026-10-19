# Blueprint pickers and password feedback

Implemented 19 October 2026. Backend release: `df1f9a7`.

- Course target pickers show code-sorted **Own department** and **Other departments** groups, with a separator when both exist. Existing semester/category/campus eligibility and search filters remain in effect.
- Global basket choices start with MDC, AEC, VAC and SEC, followed by the remaining catalogue categories except DSC/DSE. Existing saved targets are preserved; a target outside the new choices is shown as a disabled saved value rather than silently rewritten.
- HOD batch default passwords are visible initially. The Hide/Show control remains available; individual student and change-password fields retain their existing hidden defaults.
- Change-password failures show explanatory messages instead of generic HTTP labels. Incorrect current passwords, unchanged passwords and provider rejections identify the affected field. Session expiry, throttling, service outages and unconfirmed network responses have actionable messages.
- Partial success states explain that the password already changed and offer profile synchronization retry. Another password submission is disabled while synchronization is pending. Existing successful response/cookie handling and synchronization proof checks remain intact.

## Verification

All **100 tests passed** in one serial run: 8 new focused tests plus the existing 92 regression tests. Backend build and frontend production build/type checks passed.

Focused tests cover grouping/order without input mutation, empty/single-group results, category priority/exclusions, readable field errors, wrong current password without Auth mutation, reuse rejection, Supabase password-rejection codes, provider outages and unchanged success/partial-sync contracts.

Browser checks used isolated mock data:

- FIXED picker displayed own courses `BBBOWN`, `ZZZOWN`, then the separator and other-department `AAAOTHER`; a foreign-campus DSC remained excluded.
- Category options appeared MDC/AEC/VAC/SEC first, with no DSC/DSE choices.
- Batch input initially had `type=text`; Hide changed it to `type=password`.
- A simulated incorrect-current-password response displayed its explanation in the banner and beside Current Password.
- Simulated partial success displayed synchronization retry and disabled another password submission.

Screenshots: `blueprint-course-groups.jpg`, `password-error.jpg`.

No production passwords, accounts, course records or blueprint records were changed for testing. No schema migration was needed. The backend restarted and passed database/scheduler readiness before releasing the frontend.
