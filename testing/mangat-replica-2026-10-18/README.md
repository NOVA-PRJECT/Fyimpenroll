# KUC Mangattuparamba replica — registrations ready for allocation

**Created and verified on 18 October 2026:** one test campus, eight test departments, its settings row, ten staff Auth accounts with matching faculty profiles, 61 TT courses, twelve S2/S4 blueprints and all 120 user-uploaded students with linked Auth accounts. [LIVE_STATUS.json](LIVE_STATUS.json) records the executed scope. [STUDENT_UPLOAD_VERIFICATION.json](STUDENT_UPLOAD_VERIFICATION.json) records the complete CSV/Auth comparison. [NEXT_STEPS.md](NEXT_STEPS.md) covers first login, registration, allocation and the later timetable/attendance phase. Teachers remain deferred.

Source: KUC Mangattuparamba (MANGAT), 5b5289d5-17eb-43ba-832e-19883e9eaada.
**Live test campus:** Test KUC Mangattuparamba TT (`MANGATTT`). All 61 copied course codes have the `TT` suffix; embedded source spacing is retained.

## Student bulk-upload files

[All six department CSVs](bulk-upload/README.md) were uploaded by the user and verified: ECOTT, EVSTT, ITTT, MATTT, PESTT and SBSTT each have 20 students, split ten S2 (`2026-27`) and ten S4 (`2025-26`). Every name, CAP number, email, admission year, semester, department and campus matches the CSVs. All 120 have confirmed, correctly linked Auth accounts, with no duplicates, orphan accounts or field/claim mismatches. All still required first-login password changes at verification time. The upload guide records an existing UI/API mismatch in summary count fields; verification used the database and each saved CSV row.

## Automated registration rehearsal

After the manual student registration, edit/resubmit and HOD defaulter checks, the user authorized automatic submissions for the remaining test students. [REGISTRATION_SEED.md](REGISTRATION_SEED.md) documents the scoped script and [REGISTRATION_SEED_REPORT.json](REGISTRATION_SEED_REPORT.json) records its current prepared/executed status. The original manual submission is preserved; this seed uses backend business validation and does not count as testing login, password change or consent for each seeded student.

## Staff login credentials

[All ten verified login credentials](../../scratch/mangat-replica-2026-10-18/AUTH_CREDENTIALS.md) are kept locally under ignored scratch/. Each account was created with the user-requested initial password `Password123!`. The private Auth ID manifest is `scratch/mangat-replica-2026-10-18/auth-creation-state.json`. The offline draft generator deliberately refuses to overwrite credentials after creation has started.

## Auth creation script

[Auth setup instructions](AUTH_SETUP.md) explain the server-only `create-auth-accounts.cjs` script. It reads the Supabase URL and secret/service-role key from `process.env`, defaults to an offline preview, supports read-only `--check`, and requires `--apply` for live writes. Its live execution completed with all ten staff accounts and faculty profiles verified. Reruns preserve existing passwords and resume only records belonging to the exact saved seed plan.

## Replica scope and current counts

| Item | Planned total | Created |
|---|---:|---:|
| campuses | 1 | 1 |
| departments | 8 | 8 |
| campus_settings | 1 | 1 |
| courses | 62 | 62 |
| semester_2_courses | 24 | 24 |
| semester_4_courses | 38 | 38 |
| blueprints | 12 | 12 |
| students | 120 | 120 |
| teachers | 0 | 0 |
| staff | 10 | 10 |
| auth_accounts | 130 | 130 |

Staff seeding created ten Auth users: one director, eight HODs and one teaching-staff account. The user then created 120 student Auth/profile pairs through the normal bulk-upload flow, for 130 test-campus Auth accounts in total. Teacher creation remains deferred. Staff and student names/emails are synthetic; source users, passwords and sessions were not copied.

| Source department | Test department | Created S2 courses | Created S4 courses | Created blueprints |
|---|---|---:|---:|---|
| ECO | ECOTT | 7 | 8 | S2, S4 |
| EVS | EVSTT | 2 | 4 | S2, S4 |
| IT | ITTT | 4 | 5 | S2, S4 |
| MAT | MATTT | 3 | 5 | S2, S4 |
| PES | PESTT | 2 | 4 | S2, S4 |
| SBS | SBSTT | 3 | 6 | S2, S4 |
| STA | STATT | 3 | 6 | None saved |
| SWT | SWTTT | 0 | 0 | None saved |

ECOTT, EVSTT, ITTT, MATTT, PESTT and SBSTT each have twenty verified students, ten per semester, meeting the 15–28-per-department rehearsal target. S2 admission is 2026–27; S4 admission is 2025–26. Statistics supplies courses because its S2/S4 source blueprints are absent. Wood Science is mirrored as an empty department; no missing courses or blueprints were invented.

After allocation, the user approved one additional ECOTT S2 AEC (`KU02AECHIN103TT`, 3 credits, 60 seats) to enable the pending HOD manual-allocation test. The base academic replica remains 61 copied courses; the current live total is 62 including this additional paper. [TEST_AEC_ADDITION_VERIFICATION.json](TEST_AEC_ADDITION_VERIFICATION.json) records the extra ID and verification. The original shared language papers and capacities are unchanged.

## Copy and reset rules

- Copy all 61 campus-owned S2/S4 courses with their stored titles, semester, category, credits, contact hours, capacities, tags and academic level. Assign them only to new test departments.
- Copy the twelve saved pathway blueprints, including slot order, names, rules and source credit limits: S2 20–22; S4 0–22. Rewrite fixed course targets and department targets to their test counterparts; synchronize the six legacy slot columns with the copied default pathway.
- Copy campus geofence/times and academic settings. Set the new deadline to null (registration initially closed) and last_promoted_at to null. The test director opens the test registration window through the normal flow.
- Create only the ten director/HOD/teaching-staff Auth users and matching faculty profiles with server-controlled app_metadata. Reuse the locally prepared draft password in ignored scratch/ during approved creation. Students are excluded for user bulk upload. Teacher profiles and teacher Auth accounts are deferred.
- Copy no registrations, preferences, allocations, attendance, timetables, assignment history, audit history or promotion state from the source.

## Test-only reference repairs

- S2 source slot target `KU2DSCMAT101` does not match stored code `KU02DSCMAT10 1`. The copied target is `KU02DSCMAT10 1TT`. The original course and blueprint remain unchanged.
- S2 source slot target `KU2DSCMAT102` does not match stored code `KU02DSCMAT10 2`. The copied target is `KU02DSCMAT10 2TT`. The original course and blueprint remain unchanged.

## Shared behavior explicitly approved

GLOBAL_BASKET and EXCLUDE_DEPT keep their existing cross-campus behavior. TT suffixes identify copies for review/cleanup; they do not isolate option lists. Test students can see/select real courses, and real students can see test courses. Allocating test students to real courses can consume shared capacity. Shared language papers are used from the existing global catalogue and are not duplicated into invented language departments.

The existing Malayalam AEC course KU02AECMAL101 is restricted to HIN/MAL by its source prerequisite rule. That restriction is preserved, so the six test cohorts use the eligible Hindi option for the basic S2 rehearsal. Do not silently loosen the real course rule.

S2 EXCLUDE_DEPT rules ensure that minors exclude the specified home test department; they do not themselves enforce that Minor 1 and Minor 2 have different supplier departments. During the rehearsal, choose two distinct suppliers and record a defect if the agreed negative case is accepted.

## Validation and execution

All 12 copied pathways passed the current backend slot and prerequisite helpers against the expected combined real+test catalogue. Every slot has an eligible option, fixed slots resolve to TT copies, and all attainable course combinations total 22 credits within the copied limits. This is configuration validation only.

The foundation SQL transaction and staff Auth script have completed. Thirteen local Auth tests pass; live verification found ten confirmed Auth users, ten matching faculty profiles, eight HOD assignments, one director and one teaching-staff account, with no invalid pairs. Existing campuses, departments and settings retain their exact pre-run fingerprints. Student, course and blueprint counts outside the test foundation are unchanged.

The 61 TT courses and twelve blueprints were inserted in one guarded transaction after the live source matched the saved snapshot. Exact readback comparison confirmed every copied metadata field. The existing course, blueprint and prerequisite-rule fingerprints are unchanged. All twelve live pathways passed the current backend slot/prerequisite helpers: 72 slots have eligible options, fixed targets resolve to TT courses, and every attainable credit range is 22–22. Each S2 sample includes an eligible AEC and two minors from different test departments. These samples describe valid choices; they do not change the application's shared behavior or enforce distinct minor suppliers.

The academic copy made no changes to Auth users, faculty or students. The campus, departments, courses and blueprints already exist and must not be inserted again. The subsequent user bulk upload is complete and verified; teacher creation remains deferred. Follow NEXT_STEPS.md for the normal login, registration, allocation, timetable and later attendance rehearsal.

The campus insert trigger generated the live settings ID `70986f40-2662-46d0-b429-c68f5fa80d15`; it is recorded in LIVE_STATUS.json and the preview mapping. Registration starts closed (`deadline: null`), academic year is 2026–27, and credits are 18–26. Live foreign keys do not generally cascade campus deletion: future cleanup must remove dependents before parents.

Files: LIVE_STATUS.json (executed scope and live IDs), create-campus-and-departments.sql (executed foundation transaction), create-courses-and-blueprints.sql (executed academic transaction), prepare-academic-copy.cjs (local preparation/readback verification), ACADEMIC_VALIDATION_REPORT.json (live catalogue checks and sample course choices), source-snapshot.json (read-only source data), replica-preview.json (saved academic records and ID maps), blueprints/ (twelve verified copies), accounts-plan.json (synthetic account plan without passwords), VALIDATION_REPORT.json (original local configuration checks). Do not rerun the insert SQL files; they deliberately abort if the test records already exist.

Exact created course/blueprint IDs, before/after counts and fingerprint evidence are saved privately in ignored `scratch/mangat-replica-2026-10-18/academic-verification.json`. The saved `academic-before.json` and `academic-after.json` contain the read-only academic snapshots used for verification; neither contains server keys or account passwords.
