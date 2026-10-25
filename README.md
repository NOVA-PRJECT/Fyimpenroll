# FYIMP course registration

This repository contains the NestJS backend, Next.js web portal, Expo mobile app and shared contracts. The public portal is https://fyimpenroll.vercel.app.

Use Node 24.19.x and npm 11.17.x. Configure the workspace environment files from their examples, then run:

```sh
npm ci
npm run dev
```

Verification and production builds:

```sh
npm test
npm run build:frontend
npm run typecheck --workspace=mobile
npm run build --workspace=mobile
```

Mobile export requires the four public environment variables documented in [mobile/README.md](mobile/README.md); its prebuild check validates them. Set `EXPO_PUBLIC_PORTAL_URL=https://fyimpenroll.vercel.app` for privacy-policy and terms links.

See [database setup and recovery](supabase/README.md) before provisioning a new Supabase project. The baseline bootstrap is for a fresh database only. Migration `20261022141208_atomic_teacher_changes.sql` has already been applied to the connected production database; deploy the corresponding backend changes after this migration.

New or changed passwords are screened by the backend through the Pwned Passwords hash-prefix API. Allow outbound HTTPS to `api.pwnedpasswords.com`. Screening failures return a retryable service error; existing-password login does not depend on this service. Supabase's provider-wide leaked-password setting requires a paid plan and remains unavailable on the current free plan. The backend check covers portal-managed password writes; it does not change direct Supabase Auth API behavior.

The root postinstall applies [temporary dependency security patches](patches/README.md). Keep install scripts enabled, including in mobile build environments. The remaining upstream package versions still appear in npm audit; their regression-tested local patches are documented rather than hidden.

Deploy the backend and frontend together with policy version `2026-10-22`, then rebuild the mobile app with its portal configuration. The version change requires renewed policy consent. Application changes have not been published by this closeout work.

See [the historical codebase review](docs/reviews/2026-10-22-codebase-review.md) for the October 22 repair record and [the internal breach response plan](docs/security/data-breach-response-plan.md) for operational procedures.

The database cleanup has been applied to production. A read-only check on October 25, 2026 confirmed readiness, removal of the old prerequisite engine and registration preferences column, and retention of 191 registrations and 127 courses. Current ranked choices remain in `registration_preferences.preferences`; confirmed enrolments use the registration course slots. The 38 Semester 4 courses retain their practical prerequisite points.

Publish the matching backend and frontend together. Keep the [cleanup release and recovery instructions](supabase/SCHEMA_CLEANUP_ROLLOUT.md), applied migrations, bootstrap and maintained tests; do not rerun the retirement migrations on the cleaned database.
