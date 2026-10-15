# Northstar Test Campus

## Identity

- Name: Northstar Test Campus
- Code: NSTC
- Campus ID: create in staging and write the generated UUID into the execution log
- Academic year: 2026-27
- Time zone: Asia/Calcutta

## Registration settings

- Semester 2 registration window: 2026-06-01 09:00 through 2026-06-15 23:59:59 Asia/Calcutta
- Semester 4 registration window: 2026-06-01 09:00 through 2026-06-15 23:59:59 Asia/Calcutta
- Minimum credits: 16
- Maximum credits: 24
- Test seat limits: use values in `courses.csv`; keep at least one course at one seat for concurrency testing

## Attendance settings

- Geofence center: use a staging-only campus coordinate, never a real campus coordinate
- Radius: 200 metres
- Sign-in window: 08:00–10:00 Asia/Calcutta
- Grace period: 10 minutes

## Required safeguards

- Isolated staging Supabase project/database.
- Synthetic data only.
- Snapshot before seed, before allocation, and before destructive edge cases.
- No production email, SMS, storage, or service-role credentials.
