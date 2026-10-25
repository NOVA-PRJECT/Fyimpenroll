# Final codebase review and repairs — 22 October 2026

Historical record: the counts and audit findings below describe October 22, 2026. Current database/release status is in [the project README](../../README.md).

The review covered commit `83b5180`: backend, web/PWA, mobile, contracts, database, dependency graph and CI. Repairs are now present in the workspace. The additive database repair has been applied to the connected Supabase project. Application changes still require deployment. Verification did not modify production student, faculty, enrollment or timetable records.

## Finding disposition

| Finding | Final result |
| --- | --- |
| Teacher timetable visibility across campuses and terms | Accepted by the owner; existing viewing behavior retained. |
| Invalid student-portal faculty relationship | Replaced the unsupported embedded relationship with scoped assignment and faculty lookups. |
| Rejected password-reset completion payload | Web recovery now uses the backend completion contract and its recoverable profile synchronization state. The password is changed once. |
| Old logout cookie blocks recovery | Recovery sends an explicit verified bearer token with cookies omitted. Its 401 responses do not trigger cookie-session refresh/replay. |
| Missing reproducible database schema | Added a complete schema baseline, reference periods, fresh-project bootstrap, recovery instructions and isolated restore tests. |
| Substitution permits non-teacher accounts | Database validation requires an eligible faculty teacher; explicit unassignment remains supported. |
| Partial writes and teacher-slot races | Assignment changes and substitutions use one transactional RPC with actor/scope validation, schedule locks and clash checks. Errors propagate and roll back the entire operation. |
| Missing mobile policy/terms target | Configured the owner's public portal URL, required validated mobile configuration and added build-time checks. |
| Vulnerable URI decoder and old xcode UUID dependency | Upgraded through compatible dependency overrides; verified mobile export. |
| Braces recursion and forge signature advisories without upstream fixes | Added deterministic install-time patches and exploit regression tests. Upstream audit warnings remain visible. |
| Supabase leaked-password protection warning | Added server-side compromised-password checks to portal password creation/change/reset paths. Provider-wide protection remains a paid-plan limitation. |

The teacher-change migration is `supabase/migrations/20261022141208_atomic_teacher_changes.sql`. Only the backend service role can invoke its mutation RPC. Existing cross-campus timetable reading was not restricted.

## Verification

| Check | Result |
| --- | --- |
| Backend compilation and regression suite (`npm test`) | Passed: 34 tests. |
| Clean installation in a separate temporary checkout, followed by `npm test` | Passed; dependency postinstall patches applied successfully. |
| Next.js production build | Passed compilation, type checking and static page generation. |
| Mobile TypeScript and public configuration checks | Passed. |
| Expo production exports | Passed for Android and iOS. |
| Complete schema restore in isolated PostgreSQL runtime | Passed; loaded 30 reference timetable periods and newer migration; readiness passed. |
| Teacher mutations | Synthetic tests passed for role/scope checks, rollback after injected failure, reassignment cleanup, atomic batch failure and competing teacher-slot changes. |
| Web recovery | Tests passed for cookie omission, bearer authentication, payload validation, retry state and no cookie-refresh fallback. |
| Password screening | Tests passed for compromised-password rejection, hash-prefix requests and fail-closed outages/malformed responses. A public known-compromised sample was rejected by the live screening service. |
| Dependency patches | Deep/cyclic braces input rejected; valid RSA signature accepted and malformed DigestAlgorithm rejected; patched decoder works through CommonJS. |
| Live database | New migration recorded; production readiness passed; anon/authenticated RPC access denied; service-role access confirmed. An unknown-actor call was safely rejected. |
| Live student-portal query projections | Both corrected zero-row query projections returned HTTP 200. |

Database tests use synthetic accounts in an isolated PostgreSQL runtime; competing requests exercise the SQL conflict guards, not a multi-process production load benchmark. Native device interaction, real-user end-to-end account recovery and production application deployment were not performed. Temporary verification scripts, screenshots, logs and generated build outputs were removed during the owner's requested final workspace cleanup; the maintained tests and verification results remain in the repository.

## Remaining operational limits

The final production dependency audit reports **18 high-severity affected package entries, zero moderate and zero critical**, all tracing to two upstream advisories: [braces recursion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [node-forge signature validation](https://github.com/advisories/GHSA-86w9-cpqp-85rv). Neither advisory lists an upstream fixed release at closeout. Local patches address the reported flaws and retain original package versions; npm audit therefore still flags them. Keep install scripts enabled and retain the regression checks until fixed upstream releases replace the patches. See [patch maintenance instructions](../../patches/README.md).

The connected Supabase organization is on the free plan. [Provider-wide leaked-password protection](https://supabase.com/docs/guides/auth/password-security) requires a paid plan, so that native advisor warning remains. Portal-managed password writes now use server-side Pwned Passwords screening, transmitting only the first five SHA-1 hex characters. Direct Auth API writes are outside that backend enforcement. No plan upgrade or charge was made.

Deploy the backend and frontend together after the database migration (already applied). Both now use policy version `2026-10-22`, including the password-screening disclosure, so users will renew consent. Rebuild the mobile app with `EXPO_PUBLIC_PORTAL_URL=https://fyimpenroll.vercel.app`.

The schema baseline contains no private business rows. Preserve full application/Auth data, authentication configuration, secrets and Storage separately through secured backups; see [database recovery instructions](../../supabase/README.md). The baseline supports reconstruction and fresh provisioning, not recovery of existing user records by itself.
