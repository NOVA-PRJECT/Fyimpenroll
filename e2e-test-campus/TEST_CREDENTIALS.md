# Synthetic staging credentials

These credentials are for the isolated staging campus only. They must never be used in production or committed to a public repository.

## Default password policy

- Seed password: `NSTC-Stage-2026!ChangeMe`
- Every account must change this password on first login.
- After seeding, replace the seed password with a unique generated password per account and record it in the approved secret manager.
- Do not paste real passwords, API keys, service-role keys, or tokens into this folder.

## Account naming convention

| Role | Login pattern | Example |
|---|---|---|
| Superadmin | `superadmin.nstc@example.test` | `superadmin.nstc@example.test` |
| Campus director | `director.nstc@example.test` | `director.nstc@example.test` |
| HOD | `hod.d01.nstc@example.test` | `hod.d01.nstc@example.test` |
| Teacher | `teacher.d01.01.nstc@example.test` | `teacher.d01.01.nstc@example.test` |
| Teaching staff | `staff.d01.01.nstc@example.test` | `staff.d01.01.nstc@example.test` |
| Student | `student.d01.s2.01.nstc@example.test` | `student.d01.s2.01.nstc@example.test` |

Use the exact accounts in `staff.csv` and `students.csv`. The password column contains the staging seed value only.
