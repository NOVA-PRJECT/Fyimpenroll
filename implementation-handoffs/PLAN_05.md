# Implementation Handoff — Plan 05: Deterministic Allocation and Atomic Jobs

## 1. Findings Status Summary

| Finding | Priority / Severity | Status | Precise Rationale |
|---|---|---|---|
| **F18** | P0 / Critical | **Completed** | Deterministic rank-first allocation engine. Removed the arbitrary-order direct confirmation pre-round shortcut that allowed rank-2 and rank-3 choices to jump ahead of rank-1 applicants on undersubscribed courses. Rounds 1, 2, and 3 now execute strictly in sequence. Candidates are sorted deterministically using: (1) Score DESC (prerequisites + proximity points), (2) Primary tiebreaker: frozen original `submitted_at` ASC, (3) Secondary tiebreaker: stable deterministic key `student_id ASC` for exact timestamp ties. |
| **F22** | P1 / High | **Completed** | Closed campus window and unpublished cohort timetable guard. Both backend service (`AllocationService.runAllocation`) and PostgreSQL RPC (`claim_allocation_run`) enforce that the campus registration window must be closed (`now >= deadline`) and cohort timetable entries must NOT be published (`status <> 'published'`). Fails fast with clear actionable error messages if window is open or timetable is published. |
| **F23** | P0 / Critical | **Completed** | Atomic run claiming and serialization via `claim_allocation_run` RPC. Atomically checks active running claims within lease duration (300 seconds), marks abandoned leases as failed, validates closed registration window and unpublished timetable, verifies no completed run already exists for the cohort, and inserts a running claim into `system_logs` (`allocation_runs` view) with a leased lock. |
| **F24** | P0 / Critical | **Completed** | Complete removal of partial-write fallback. When `apply_course_allocation` RPC encounters an error or lock timeout, `runAllocation` marks the run as `failed` in `system_logs`, preserves the previous consistent database state, and throws `InternalServerErrorException`. Under no circumstances are non-atomic partial row updates written. |
| **F25** | P1 / High | **Completed** | Failed-run cleanup guard. `AllocationService.clearFailedRun` strictly allows clearing runs only if `status === 'failed'`. Clearing runs with `status === 'completed'` or `status === 'running'` is strictly forbidden. Furthermore, deleting runs for cohorts with published timetable entries is prohibited to maintain timetable audit integrity. |
| **F26** | P1 / High | **Completed** | Non-negative distinct student metrics. Replaced previous bugged calculation (`fully_allocated: total_students - unallocated_slots`, which became negative for multi-slot unallocated students) with distinct student categorization: `total_students === fully_allocated + partially_allocated + unallocated` where all counts are >= 0. Added summary breakdown for unresolved core slots (slots 1–6) and unresolved optional slots (slots 7–8). Persisted in `allocation_runs.metadata` and displayed in Director UI. |
| **F70** | P0 / Critical | **Completed** | Hardened `apply_course_allocation` PostgreSQL RPC. Verifies that `p_run_id` exists in `system_logs`, matches `p_campus_id, p_academic_year, p_semester`, and is currently `status = 'running'`. Validates that cohort timetable is unpublished. Validates slot keys against an allowlist (`slot_1` to `slot_8`). Asserts student campus membership for all allocated and unallocated entries. Locks courses `FOR UPDATE` and enforces global capacity limits across all campuses within the transaction. |

---

## 2. Changed Files & Migrations

### Modified Files:
- `backend/src/modules/allocation/allocation.service.ts`:
  - Integrated registration window check and published timetable check (F22).
  - Integrated atomic run claim via `claim_allocation_run` RPC with serialization lock (F23).
  - Removed direct confirmation pre-round shortcut; enforced strict preference rounds (F18).
  - Enforced deterministic candidate sorting: Score DESC -> `submitted_at` ASC -> `student_id` ASC (F18).
  - Computed non-negative distinct student metrics: `total_students`, `fully_allocated`, `partially_allocated`, `unallocated`, and slot breakdowns (F26).
  - Deleted non-atomic partial-write fallback; enforced fail-fast state preservation on RPC error (F24).
  - Hardened `clearFailedRun` to allow deletion only for `status === 'failed'` and unpublished cohorts (F25).
- `frontend/src/app/dashboard/director/page.tsx`:
  - Added real-time Registration Window Protocol Status banner (Open vs Closed) explaining requirements before running allocation (F22).
  - Added distinct student allocation metric summary cards on completed allocation runs (`Total Students`, `Fully Allocated`, `Partially Allocated`, `Unallocated`) (F26).
- `backend/test/deterministic-allocation-jobs.test.js`:
  - Comprehensive unit test suite covering F18, F22, F23, F24, F25, F26, and F70 (11 tests across 7 suites).

### Migrations Created:
- `supabase/migrations/20261007020000_plan05_deterministic_allocation_atomic_jobs.sql`:
  - Stored procedure `claim_allocation_run`:
    - Checks `campus_settings.deadline <= now()` (window closed).
    - Checks cohort timetable unpublished (`status <> 'published'`).
    - Checks no completed run exists for this term.
    - Cleans up stale runs exceeding lease window and checks for active concurrent claims.
    - Atomically inserts running claim in `system_logs` (`allocation_runs` view).
  - Stored procedure `apply_course_allocation` (hardened):
    - Validates `p_run_id` ownership, cohort match, and running status.
    - Guards against published timetable entries.
    - Whitelists slot keys (`slot_1` .. `slot_8`).
    - Validates student campus membership.
    - Locks courses `FOR UPDATE` and verifies global seat limits across all campuses within the transaction.
    - Atomically applies winning allocations, records unallocated slots, recalculates credits, and updates run completion metadata.

---

## 3. Downstream Contracts & Invariants

1. **Strict Rank Priority:**
   - Round 1 allocations are evaluated and confirmed for all qualifying rank-1 preferences before Round 2 begins. Under no circumstances may an undersubscribed course assign a rank-2 or rank-3 preference ahead of rank-1 applicants.
2. **Determinism:**
   - Allocation outcomes must be 100% reproducible for an identical set of student preferences. The secondary tiebreaker `student_id ASC` guarantees that ties with identical scores and identical frozen `submitted_at` timestamps produce the exact same winners.
3. **Registration Window Lock:**
   - Course allocation can only execute after registration has closed for the campus. If the window is still open, execution must fail fast with `BadRequestException`.
4. **Cohort Immutability Post-Publication:**
   - Once a cohort timetable has entries with `status = 'published'`, course allocations and failed run records are locked and cannot be re-executed or deleted.
5. **Atomic Commit or Clean Rollback:**
   - Course allocations are applied as a single atomic database transaction via `apply_course_allocation`. If any error occurs, the run is marked as `failed` and no partial rows or corrupted states are written.

---

## 4. Verification Evidence

- **Automated Backend Tests:** `npm --workspace=backend run test` executes **75 automated tests across 35 test suites**, passing with **0 failures**:
  - Plan 01 suites: 22 tests passing.
  - Plan 02 suites: 14 tests passing.
  - Plan 03 suites: 12 tests passing.
  - Plan 04 suites: 16 tests passing.
  - Plan 05 suites: 11 tests passing (`backend/test/deterministic-allocation-jobs.test.js`).
- **Backend Build:** `npm --workspace=backend run build` (`nest build`) compiles with 0 errors.
- **Frontend Build:** `npm --workspace=frontend run build` (`next build` with Turbopack) compiles with 0 errors across all routes.
