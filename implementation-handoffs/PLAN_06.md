# Implementation Handoff — Plan 06: Local OR-Tools Timetables, JSON Constraints & Recovery

## 1. Findings Status Summary

| Finding | Priority / Severity | Status | Precise Rationale |
|---|---|---|---|
| **F33** | P0 / Critical | **Completed** | Published timetable immutability & in-place teacher substitution. Timetable entries with `status = 'published'` cannot be deleted, cleared, or overwritten by generation. Enforced at the database layer via PostgreSQL trigger `trg_guard_published_timetable_entries` and at the service layer in `TimetableService.generate` and `job.ts`. Added in-place teacher assignment via `PUT /api/timetable/entries/:id/teacher` (`substituteTeacher`) which updates `teacher_id` in place, preserving `id`, `class_id`, and linked attendance records without cascading deletions. |
| **F34** | P1 / High | **Completed** | Campus-scoped draft replacement. Draft timetable regeneration replaces only entries matching the specified `campus_id, academic_year, semester`, leaving other cohorts and other campuses completely untouched. |
| **F35** | P0 / Critical | **Completed** | Removal of Gemini / external AI timetable generation. Completely replaced with local Google OR-Tools CP-SAT solver (`ortools==9.11.4210`). No external AI calls, tokens, or fallbacks are used. Generation is 100% deterministic, local, and mathematically verified. |
| **F36** | P1 / High | **Completed** | Complete course coverage and domain validation. `validateSchedule` verifies that 100% of required course contact hours are placed into legal day/period slots. Unplaced courses or invalid day/period coordinates (e.g. Day 99) fail validation immediately. |
| **F37** | P0 / Critical | **Completed** | Shared-teacher cross-campus clash prevention and reservations. Shared faculty are modeled as time resources across campuses and semesters. Loader queries all published timetable entries for the academic year to extract `teacher_reservations`. OR-Tools solver strictly prevents double-booking teachers in any reserved slot, and validator flags teacher conflicts. |
| **F39** | P1 / High | **Completed** | Durable JSON constraints management. Resolved Render Free ephemeral disk data loss by storing per-campus overrides in `campus_settings.timetable_constraints` (JSONB) in Supabase. `TimetableService.getConstraints` and `updateConstraints` dynamically merge director overrides with the baseline `constraints.base.json`. |
| **F40** | P0 / Critical | **Completed** | Production OR-Tools CP-SAT model. Built `ortools_solver.py` with theory session variables, 2-period lab pairings, lunch period (P3–P4 boundary) constraints, student conflict graph penalties, and parallel group synchronization. Evaluates optimal/feasible solutions within bounded time. |
| **F41** | P1 / High | **Completed** | Timetable generation preconditions. `TimetableService.generate` strictly verifies that: (1) campus registration window is closed (`now >= deadline`), and (2) an allocation run has successfully completed for the cohort (`status = 'completed'`). Fails fast with descriptive errors if either precondition is violated. |
| **F42** | P1 / High | **Completed** | Durable job execution and stale worker lease recovery. Background timetable generation jobs are tracked in `system_logs` with status transitions (`running`, `completed`, `failed`). Stale jobs exceeding the 10-minute worker lease (`now - updated_at > interval '10 minutes'`) are automatically recovered and marked as failed. |
| **F71** | P0 / Critical | **Completed** | AEC-1 and AEC-2 compulsory basket separation. Replaced naive category-based grouping with disjoint basket partitioning in `detectParallelGroups`. Compulsory multi-basket parallel courses (e.g. AEC-1 English and AEC-2 Second Language taken by the same students) are partitioned into separate parallel groups, avoiding student collision and eliminating spurious `category_slot_mismatch` errors. |
| **D03** | Data Observation | **Completed** | Handled single 1-hour practical periods gracefully in `validator.ts`, permitting valid 1-hour sessions when `practicalHours === 1` without failing 2-period lab pair checks. |
| **D04** | Data Observation | **Completed** | Added preflight validation diagnostics in `loader.ts` for zero-student elective courses, surfacing warnings if unallocated courses are submitted for timetable scheduling. |
| **D05** | Data Observation | **Completed** | Added preflight validation diagnostics in `loader.ts` for non-standard credit-to-contact-hour ratios. |

---

## 2. Changed Files & Migrations

### Modified Files:
- `backend/requirements.txt` & `requirements.txt`:
  - Added `ortools==9.11.4210`.
- `render.yaml`:
  - Updated `buildCommand` to install python requirements: `pip install -r requirements.txt && npm install --include=dev && npm run build`.
- `backend/nest-cli.json`:
  - Added compiler asset glob `"**/*.py"` so `ortools_solver.py` is copied to `dist/` on build.
- `backend/src/modules/timetable/solver/ortools_solver.py`:
  - Implemented standalone Python CLI tool using OR-Tools CP-SAT solver.
  - Encodes contact hour domains, student clash graphs, 2-period lab blocks, lunch boundary protection, teacher clash prevention, and fixed reservations.
- `backend/src/modules/timetable/solver/ortools-runner.ts`:
  - Implemented Node.js child-process runner invoking `python` with stdin/stdout JSON streaming and timeout management.
- `backend/src/modules/timetable/solver/loader.ts`:
  - Implemented zero-overlap basket partitioning (`detectParallelGroups`) separating AEC-1 and AEC-2 baskets (F71).
  - Loaded teacher assignments and cross-campus reservations from published entries for the academic year (F37).
  - Added preflight diagnostics for D03, D04, and D05.
- `backend/src/modules/timetable/solver/validator.ts`:
  - Added complete course coverage checking (F36).
  - Added teacher clash checking and published reservation checking (F37).
  - Added parallel basket synchronization checking (F71).
  - Handled 1-hour practical courses (D03).
- `backend/src/modules/timetable/solver/job.ts`:
  - Integrated local OR-Tools solver runner.
  - Enforced immutable published timetable guard (F33).
  - Scoped draft replacement strictly to current campus and cohort (F34).
  - Recorded durable job state in `system_logs` (F42).
- `backend/src/modules/timetable/timetable.service.ts`:
  - Enforced registration window closed precondition and completed allocation precondition (F41).
  - Enforced published timetable immutability guard (F33).
  - Stored and merged per-campus overrides in `campus_settings.timetable_constraints` (F39).
  - Added in-place `substituteTeacher` method (F33, F37).
  - Recovered stale generation jobs exceeding 10 minutes (F42).
- `backend/src/modules/timetable/timetable.controller.ts`:
  - Wired campus context to `getConstraints` and `updateConstraints` (F39).
  - Added `PUT /api/timetable/entries/:id/teacher` endpoint for in-place teacher assignment (F33).
- `backend/test/ortools-timetable-solver.test.js`:
  - 14 automated unit and integration tests covering F33, F34, F35, F36, F37, F39, F40, F41, F42, F71, D03.

### Migrations Created:
- `supabase/migrations/20261007030000_plan06_timetable_constraints_and_guards.sql`:
  - Added `timetable_constraints JSONB` column to `campus_settings` (F39).
  - Added `teacher_id UUID` and `class_id UUID` columns with indexes to `timetable_entries` (F33, F37).
  - Created trigger function `guard_published_timetable_entries()`:
    - Rejects deletion or unpublishing of `published` timetable entries.
    - Allows in-place updates to `teacher_id` on published entries.
    - Rejects modification of day, period, or course on published entries.
  - Attached trigger `trg_guard_published_timetable_entries` on `timetable_entries`.
  - Added index on `system_logs(action, status, created_at)` for timetable job recovery (F42).

---

## 3. Downstream Contracts & Invariants

1. **Local OR-Tools Only:**
   - Timetable generation must only execute via the local OR-Tools CP-SAT solver (`ortools_solver.py`). External LLM calls or heuristic-only generation must never be reintroduced.
2. **Published Immutability & In-Place Teacher Substitution:**
   - Published timetable entries (`status = 'published'`) can never be deleted or replaced by regeneration. Only `teacher_id` can be updated in-place via `substituteTeacher`.
   - Attendance records linked via foreign keys are preserved and never subject to cascading deletes.
3. **Disjoint Basket Synchronization:**
   - Multi-basket compulsory options (e.g. AEC-1 and AEC-2) must never share slot assignments when common students are enrolled. They must be partitioned into disjoint parallel groups.
4. **Cross-Campus Teacher Clashes:**
   - Visiting teachers cannot be assigned to overlapping slots in the same academic year across any campus. Published entries reserve the slot globally.
5. **Durable Per-Campus Constraints:**
   - Campus constraints must be stored in `campus_settings.timetable_constraints` (JSONB) to survive ephemeral Render restarts.

---

## 4. Verification Evidence

- **Automated Backend Tests:** `npm --workspace=backend run test` executes **89 automated tests across 43 test suites**, passing with **0 failures**:
  - Plan 01 suites: 22 tests passing.
  - Plan 02 suites: 14 tests passing.
  - Plan 03 suites: 12 tests passing.
  - Plan 04 suites: 16 tests passing.
  - Plan 05 suites: 11 tests passing.
  - Plan 06 suites: 14 tests passing (`backend/test/ortools-timetable-solver.test.js`).
- **Local Python Environment:** `python -c "import ortools; print(ortools.__version__)"` verified returning `9.11.4210`.
- **Backend Build:** `npm --workspace=backend run build` (`nest build`) compiles with 0 errors and packages `.py` assets.
- **Frontend Build:** `npm --workspace=frontend run build` (`next build` with Turbopack) compiles with 0 errors across all routes.
