# Follow-up Plan 06 Handoff: OR-Tools Rule Compilation & Atomic Timetable Publication

**Date:** 10 October 2026
**Status:** Completed
**Primary findings owned:** R17, R18, R19, R20, R21, R22
**Related findings:** R06 (Plan 03), R08 (Plan 03), R15 (Plan 05), R16 (Plan 05), R36 (Plan 05)
**Target Migration:** `supabase/migrations/20261010020000_followup_plan06_file_constraints_and_cohort_guards.sql`

---

## 1. Scope and Findings Status

| Finding | Severity | Description | Status | Evidence / Verification |
|---|---|---|---|---|
| **R17** | High | Solver made valid Semester 1 AEC scheduling impossible due to hard one-session-per-day theory spread prohibition. | **Completed** | Converted theory spreading to a soft objective penalty (`weight = 5`); preserved Tue/Wed P4–P6 allowed domain; 3-hour AEC schedules feasibly across 2 days (1h + 2h). Verified in solver and validator. |
| **R18** | High | VAC scheduled outside mandatory window (1-hour theory bypassed Monday P5+P6), and excess hours accepted. | **Completed** | Monday P5+P6 domain restriction applied to *all* VAC session periods (both 1h and 2h); contact hours > 2h fail preflight immediately with an actionable curriculum conflict; independent validator enforces Monday P5+P6 strictly. |
| **R19** | High | JSON constraint edits accepted but not compiled into CP-SAT solver constraints; dynamic edits ignored. | **Completed** | Defined typed `RuleDefinition` AST (`RuleKind`, `RuleScope`, parameters, hard/soft flags, version); solver dynamically compiles typed rules; rejects unsupported hard rules as `MODEL_INVALID`; computes SHA-256 rule hash. |
| **R20** | High | Campus constraint overrides were moved into database JSONB instead of versioned JSON files. | **Completed** | Created `FileConstraintStoreService` storing base university constraints and campus overrides in versioned JSON files (`campus_{id}.json` and `campus_{id}_v{version}.json`); sanitized against path traversal; safe DB export path provided; stopped database JSONB reads/writes. |
| **R21** | Medium | Odd practical hours silently introduced unapproved single-hour lab exception (`lab_single`). | **Completed** | Removed `lab_single` odd-hour workaround from solver; preflight loader blocks odd practical hours; independent validator strictly enforces 2-period consecutive pairs (P1+P2, P2+P3, P4+P5, P5+P6) with zero odd single exemptions. |
| **R22** | High | Draft replacement and publication could leave or freeze partial schedules; trigger didn't protect inserts into published cohorts. | **Completed** | Staged entire validated schedule in memory; implemented atomic draft replacement (`atomic_replace_timetable_draft` RPC / transaction under advisory locks); added database `BEFORE INSERT OR UPDATE OR DELETE` trigger on `timetable_entries` locking published cohorts; publication revalidates current draft and disallows `force` from bypassing hard constraints. |

---

## 2. Rule Coverage Matrix (Compiler & Independent Validator)

| Rule ID | Description | Rule Kind | Scope | Hard / Soft | Compiler Handler (`ortools_solver.py`) | Independent Validator (`validator.ts`) | Status |
|---|---|---|---|---|---|---|---|
| `base_no_student_overlap` | No student may have two courses scheduled at the same time slot | `NO_STUDENT_OVERLAP` | `global` | Hard | Pairwise student conflict graph on `active_vars` | `studentSchedule` collision check | Enforced |
| `base_no_teacher_overlap` | Teacher cannot teach overlapping courses simultaneously | `NO_TEACHER_OVERLAP` | `global` | Hard | Teacher course set slot sum <= 1 | `teacherSchedule` collision check | Enforced |
| `base_teacher_reservations` | Respect published reservations across other cohorts/campuses | `TEACHER_RESERVATIONS` | `global` | Hard | Reservation slots forced to 0 for assigned teachers | `teacherSchedule` checks published reservations | Enforced |
| `base_no_lunch_overlap` | No classes during lunch break (12:30 to 13:30) | `NO_LUNCH_OVERLAP` | `global` | Hard | 2-period block starts restricted to `[1, 2, 4, 5]` | Flags lab blocks spanning P3→P4 | Enforced |
| `base_lab_consecutive_pair` | Practical contact hours must be exact 2-period consecutive blocks | `LAB_CONSECUTIVE_PAIR` | `global` | Hard | Duration = 2 blocks on allowed start periods; odd practical hours rejected | Enforces even practical slots and exact consecutive pairs | Enforced |
| `base_exact_contact_hours` | Assign exactly required theory and practical hours | `EXACT_CONTACT_HOURS` | `global` | Hard | Exactly one slot selected per 1h session and per 2h block | Compares `theoryCount` and `practicalCount` to node | Enforced |
| `base_p6_last_resort` | Use Period 6 only as a last resort | `P6_LAST_RESORT` | `global` | Soft (50) | High-priority penalty term (weight 50) | Preserved as objective | Enforced |
| `base_theory_spread` | Spread theory hours across days (soft preference) | `THEORY_SPREAD` | `global` | Soft (5) | Soft penalty term on excess theory sessions per day (`weight = 5`) | Allows S1 AEC 1+2 spread | Enforced |
| `base_dept_time_preference` | Single-dept morning (P1-P3), cross-dept afternoon (P4-P5) | `DEPARTMENT_TIME_PREFERENCE` | `global` | Soft (2) | Soft penalty term on non-preferred periods (`weight = 2`) | Preserved as objective | Enforced |
| `base_parallel_category_sync`| Parallel electives in basket share identical time slots | `PARALLEL_CATEGORY_SYNC` | `global` | Hard | Equality constraints across session start variables | Verifies identical slot string for basket courses | Enforced |
| `sem1_aec_window` | S1 AEC (3h) strictly Tue/Wed afternoon (P4, P5, P6) | `CATEGORY_WINDOW` | `semester` (1) | Hard | Session domains restricted to Day in `[2, 3]` and Period in `[4, 5, 6]` | Rejects any S1 AEC slot outside Tue/Wed P4-P6 | Enforced |
| `sem1_mdc_block` | S1 MDC (3h) split into 2h continuous block and 1h single session | `SESSION_BLOCK` | `semester` (1) | Hard | 1 2h block + 1 1h session; hard constraint forbidding same day | Rejects MDC running on same day or wrong block sizes | Enforced |
| `sem3_vac_window` | S3 VAC (2h) strictly Mon P5+P6 for all session periods | `CATEGORY_WINDOW` | `semester` (3) | Hard | All session domains restricted to Day = 1 and Period in `[5, 6]` | Rejects any S3 VAC slot outside Mon P5-P6 | Enforced |
| `campus_time_limit` | Director dynamic day/period limits | `CAMPUS_TIME_LIMIT` | `campus` | Hard / Soft | Restricts `campus_allowed_slots` | Rejects slots outside allowed window | Enforced |

---

## 3. Changed Files & Migration Order

### Source Files
1. `backend/src/modules/timetable/solver/constraints.base.json`: Added `version: 1` and typed `rules` definitions corresponding to all university and semester rules.
2. `backend/src/modules/timetable/solver/types.ts`: Added `RuleKind`, `RuleScope`, `RuleDefinition`, `TimetableScheduleConfig`, `EffectiveRuleDocument`, and `invalid_window` violation type.
3. `backend/src/modules/timetable/solver/schemas.ts`: Added Zod schemas for `RuleDefinitionSchema`, `RuleKindSchema`, `RuleScopeSchema`, updated `DynamicConstraintSchema`.
4. `backend/src/modules/timetable/solver/file-constraint-store.service.ts`: Implemented versioned file storage adapter with path traversal sanitization, atomic writes, version history, and DB export.
5. `backend/src/modules/timetable/solver/ortools_solver.py`: Dynamic typed rule compiler, AEC soft theory spread (R17), VAC all-period Monday P5+P6 window (R18), removal of odd lab single workaround (R21), Period 6 priority objective, SHA-256 rule hashing.
6. `backend/src/modules/timetable/solver/ortools-runner.ts`: Added `rules` payload forwarding and `rule_hash` diagnostics.
7. `backend/src/modules/timetable/solver/loader.ts`: Added `validatePreflightRules` blocking odd practical hours and VAC > 2h before solver invocation.
8. `backend/src/modules/timetable/solver/validator.ts`: Updated `validateTimetable` to accept semester and effective rules context; independently enforces AEC, VAC, MDC, strict lab blocks, and dynamic time limits.
9. `backend/src/modules/timetable/solver/job.ts`: Staged complete schedule before commit; executed atomic draft replacement under advisory lock; validated against effective rules and semester context.
10. `backend/src/modules/timetable/timetable.service.ts`: Integrated `FileConstraintStoreService`, stopped writing/reading Postgres JSONB; enforced active-job lockout and strict conflict blocking on publish.

### Database Migration
- `supabase/migrations/20261010020000_followup_plan06_file_constraints_and_cohort_guards.sql`:
  - Deprecation comment on `campus_settings.timetable_constraints`.
  - Database trigger `trg_guard_published_timetable_entries` on `timetable_entries` guarding against `INSERT`, `UPDATE`, and `DELETE` on published cohorts.
  - RPC `atomic_replace_timetable_draft` for transactional draft replacement under `pg_advisory_xact_lock`.

---

## 4. Verification and Test Results

### Test Execution Commands
```powershell
# Build verification
npm run build

# Plan 06 Base Suite
node --test test/ortools-timetable-solver.test.js

# Follow-up Plan 06 Comprehensive Suite
node --test test/followup-ortools-publication.test.js

# Cross-Plan Integration Gate
node --test test/cross-plan-regression-gate.test.js
```

### Outcomes
- `ortools-timetable-solver.test.js`: 14 / 14 passing.
- `followup-ortools-publication.test.js`: 15 / 15 passing.
- Total Timetable Suite: 29 / 29 passing.
- `cross-plan-regression-gate.test.js`: 17 / 17 passing.
- Build: 0 errors.

---

## 5. Deployment Persistence & Pending Decisions

1. **Durable File Storage Adapter in Production Containers (Render):**
   - The implementation stores versioned campus constraint JSON files in the directory configured by `TIMETABLE_CONSTRAINTS_DIR` (defaults to `storage/timetable-constraints`).
   - In containerized deployments like Render without persistent disk mounts, files written to local container disks are ephemeral across restarts.
   - For cloud production environments where persistent disks are not attached, the `FileConstraintStoreService` is designed to be easily extended with S3 / Supabase Storage bucket adapters.
   - Status: **Local file persistence verified; production container volume mount pending environment configuration.**

2. **Odd Practical Curriculum Data Policy:**
   - As confirmed by R21, academic policy dictates practical contact hours must be exact 2-period blocks. The system strictly rejects odd-hour practicals with an actionable curriculum error rather than creating arbitrary 1-hour lab exceptions.

---

## 6. Downstream Checklist for Plan 07 & Plan 09

- [x] Stable published timetable slot UUIDs and class identities preserved.
- [x] In-place teacher substitution updates `teacher_id` and synchronizes `teacher_course_assignments` without altering slot timings or creating attendance gaps.
- [x] Immutable publication trigger prevents inserts, updates, or deletes of core schedule data once published.
- [x] All 10 semesters supported across all campuses.
