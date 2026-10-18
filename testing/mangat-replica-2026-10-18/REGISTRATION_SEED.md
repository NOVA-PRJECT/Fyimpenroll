# Automated registration rehearsal

The user authorized automatically preparing all remaining test-student registrations after manually checking registration, defaulters and edit/resubmit.

This is server-side test-data seeding through the actual `RegistrationsService.submitCourses` validation and `submit_student_registration` transaction. It does not exercise the HTTP authentication guards or record first-login password changes or policy consent. Those flows remain separate tests; their records are left unchanged.

Only students in the verified upload manifest for **MANGATTT** are allowed. Existing submissions and their timestamps are preserved. Fixed courses and non-language electives use TT courses owned by the test campus. The shared Hindi/Malayalam AEC papers retain their existing codes and prerequisites. All ranks for each S2 minor use a distinct supplier from the other minor.

Most AEC registrations alternate Hindi/Malayalam preference orders. One ECOTT S2 student deliberately has Malayalam without a fallback, to test an unresolved slot and subsequent manual HOD resolution. The script leaves the campus deadline open and does not run allocation or change course capacities, blueprints, staff, students, Auth users, passwords or consent.

From the repository root, using the existing backend environment file:

```powershell
node --test testing/mangat-replica-2026-10-18/seed-registrations.test.cjs
node --env-file=backend/.env testing/mangat-replica-2026-10-18/seed-registrations.cjs --prepare
node --env-file=backend/.env testing/mangat-replica-2026-10-18/seed-registrations.cjs --apply
node --env-file=backend/.env testing/mangat-replica-2026-10-18/seed-registrations.cjs --verify
```

`--prepare` is read-only against Supabase and saves the plan locally. `--apply` accepts that exact plan, checks that the academic catalogue/settings/student profiles have not changed, and submits only missing records. Its transaction adds a seed identifier and plan hash to allocation metadata, and the normal registration audit event identifies the automated test seed. It can resume a partially completed run without overwriting unrelated submissions.

The local plan, before/after snapshots and resumable state are in the ignored `scratch/mangat-replica-2026-10-18/` directory. The shareable result is `REGISTRATION_SEED_REPORT.json`. Keep the snapshots until test cleanup is finished.

After successful verification, expect **120 preference records and 120 registration records: 60 S2 and 60 S4**, ten per semester in each of the six departments. Elective slots remain unallocated. The next manual step is to close the test registration window and run S2/S4 allocation separately; review capacity/prerequisite failures and resolve outstanding slots through the HOD flow.
