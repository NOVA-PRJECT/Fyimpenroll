# Invalid dashboard URL session fix

The user found that an SBS HOD was logged out after replacing the role segment with an unknown value. The middleware treated an unmatched dashboard route as an invalid session and explicitly deleted auth, refresh and role cookies. A broad prefix match also treated `/dashboardv/...` as a dashboard route.

The local fix lets authenticated unknown dashboard routes proceed to Next's not-found handling, preserves any rotated credentials, and matches the dashboard segment at a slash boundary. Existing known-role redirects, shared-route restrictions, invalid-session handling, password-change and consent gates remain enforced.

Verification: three regression scenarios failed before the change; all nine middleware tests passed after it, covering all six roles, typo URLs, own-role subpages, denied roles, refresh rotation, invalid sessions, backend outages and onboarding gates. Run `npm run test:middleware --workspace=frontend` from the repository root, or `npm run test:middleware` in frontend.

Deployment is pending. After deploying the frontend, sign in as HOD, open `/dashboard/gibberish` and `/dashboardv/gibberish`, verify the not-found page, then revisit `/dashboard/hod` without signing in again. A known director URL must still redirect the HOD to their own dashboard.
