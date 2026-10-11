# Follow-up Plan 04 Handoff: Atomic Enrollment, Global Seats and Blueprint Eligibility

**Date:** 9 October 2026
**Author:** Antigravity Engineering Agent
**Target Plan:** Follow-up Plan 04 (Findings R09, R10, R11, R12, R14)
**Prerequisites:** Follow-up Plan 01 (Database privileges & resource authorization), Follow-up Plan 02 (Password changes, session refresh & logout), Follow-up Plan 03 (Host-campus classes & delivery identity)
**Status:** Completed

---

## 1. Scope & Finding Status Matrix

| Finding | Priority / Severity | Follow-up Status | Primary Owner | Downstream Consumers | Exact Validation Evidence & Details |
|---|---|---|---|---|---|
| **R09** | Critical | **Completed** | Follow-up 04 | Follow-up 05, Follow-up 09 | (1) Removed nonexistent `core_credits` and `additional_credits` columns from `manualAllocate` in [`allocation.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/allocation/allocation.service.ts). Stored breakdown cleanly in `allocation_metadata.credit_breakdown` while persisting physical `total_credits`. (2) Enforced strict database error inspection on all Supabase write calls, throwing an `InternalServerErrorException` on error rather than swallowing. (3) Gated audit logging strictly upon successful allocation completion; if RPC or database writes fail, no deceptive success audit log is written. (4) Added transactional RPC `execute_manual_course_allocation`. Verified in `backend/test/followup-atomic-enrollment.test.js` (R09-1, R09-2, R09-3). |
| **R10** | Critical | **Completed** | Follow-up 04 | Follow-up 05 | (1) Upgraded database RPC `submit_student_registration` to lock candidate course rows deterministically (`ORDER BY id FOR UPDATE`), counting active enrollments globally across all student registrations and rejecting registration if global capacity is exceeded. (2) In [`allocation.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/allocation/allocation.service.ts) (`runAllocation`), completely removed un-isolated Step 1 pre-run database upserts that previously wrote fixed courses directly before the allocation algorithm started, preventing state leakage if allocation fails or is aborted before commit. Verified in `backend/test/followup-atomic-enrollment.test.js` (R10-1, R10-2). |
| **R11** | Critical | **Completed** | Follow-up 04 | Follow-up 05, Follow-up 09 | (1) Completely eliminated fallback direct-table upserts and updates in `submitCourses` and `updateSlot` in [`registrations.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/registrations/registrations.service.ts). When RPC fails or rejects (e.g. course full, invalid slot, capacity exhausted), the business rejection is propagated directly to the caller instead of bypassing database constraints. (2) Upgraded `execute_student_course_change` to enforce idempotent requests: verified payload consistency across idempotent replays, returning existing state with `idempotent_replay: true` when keys match identical actions, and rejecting parameter mismatches. Verified in `backend/test/followup-atomic-enrollment.test.js` (R11-1, R11-2, R11-3). |
| **R12** | High | **Completed** | Follow-up 04 | Follow-up 05 | (1) Revalidated blueprint slot eligibility via `isCourseEligibleForSlot` inside `updateSlot` (for slots 1–6) and `manualAllocate`, rejecting invalid course substitutions (e.g. attempting to assign an ineligible course into a core major or department elective slot). (2) Validated minor paper rules for slots 7–8 in `updateSlot` (e.g. ensuring category is 'Minor', student has an approved minor department, and minor course matches student's minor department). (3) Required active student semester to match target course semester (`student.current_semester === course.semester`) in both application layer and `execute_manual_course_allocation` RPC. Verified in `backend/test/followup-atomic-enrollment.test.js` (R12-1, R12-2, R12-3). |
| **R14** | High | **Completed** | Follow-up 04 | Follow-up 05 | In `submit_student_registration` RPC: (1) Reconciled pathway resubmissions: when a student switches pathways, obsolete fixed courses from the former pathway are released (`NULL`ed out), immediately restoring global seat availability for elective and manual students. (2) Cleared obsolete fixed metadata entries (`allocated_by = 'pathway_fixed'`) from `allocation_metadata` for unassigned slots. (3) Preserved the student's initial `submitted_at` timestamp across pathway switches, maintaining registration queue tiebreaker fairness for elective allocation algorithms. Verified in `backend/test/followup-atomic-enrollment.test.js` (R14-1, R14-2). |

---

## 2. Changed Source Files & Created Artifacts

### Database Migrations
- [`supabase/migrations/20261009030000_followup_plan04_atomic_enrollment_and_global_seats.sql`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/supabase/migrations/20261009030000_followup_plan04_atomic_enrollment_and_global_seats.sql):
  - **`submit_student_registration`:**
    - Deterministic course row-level locks (`ORDER BY id FOR UPDATE`).
    - Global capacity verification for all candidate fixed courses (`current_enrollment < capacity`).
    - Pathway slot reconciliation: clears slots that were previously occupied by fixed courses of an old pathway but are not in the new pathway, freeing seats.
    - Preserves `submitted_at` if registration already exists; cleans up obsolete `allocation_metadata` entries.
  - **`execute_student_course_change`:**
    - Idempotency key tracking: verifies that matching keys submit identical slot & course payload. Replays safely with `{ idempotent_replay: true }` if payload matches.
    - Deterministic row-level lock order for candidate courses.
    - Global capacity check: ensures `current_enrolled < max_capacity` before incrementing.
  - **`execute_manual_course_allocation`:**
    - Transactional manual course allocation RPC.
    - Locks student registration and course rows deterministically.
    - Enforces active student semester match with course semester.
    - Reconciles old vs new course slot capacity globally, updating `allocation_metadata.credit_breakdown` and physical `total_credits`.
  - **Plan 01 Privilege Hardening:**
    - All functions defined with `SECURITY DEFINER` and `SET search_path = public, pg_temp;`.
    - Revoked `EXECUTE` on all three RPCs from `PUBLIC`, `anon`, and `authenticated`.
    - Granted `EXECUTE` exclusively to `service_role` and `postgres`.

### Backend Source Files Modified
- [`backend/src/modules/allocation/allocation.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/allocation/allocation.service.ts):
  - In `runAllocation`: Removed un-isolated Step 1 pre-run database upserts for fixed courses. Fixed course population is deferred to deterministic batch allocation or transactional registration workflows.
  - In `manualAllocate`:
    - Enforced active semester match: `course.semester === student.current_semester`.
    - Revalidated blueprint slot eligibility via `isCourseEligibleForSlot` for major slots.
    - Query selects `tag` on courses for blueprint rule checking.
    - Removed non-existent table columns `core_credits` and `additional_credits`.
    - Integrated transactional RPC `execute_manual_course_allocation` with safe fallback to error-checked direct updates.
    - Strict database error inspection on all Supabase write calls.
    - Audit logging strictly conditional on successful operation completion.
- [`backend/src/modules/registrations/registrations.service.ts`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/src/modules/registrations/registrations.service.ts):
  - In `submitCourses`:
    - Pruned obsolete fixed course allocation metadata on pathway changes.
    - Completely eliminated table upsert fallback when `submit_student_registration` RPC fails or returns an error.
  - In `updateSlot`:
    - Added blueprint slot eligibility check via `isCourseEligibleForSlot` (for slots 1–6) and minor validation (for slots 7–8).
    - Query selects `tag` on course lookups.
    - Completely eliminated direct table update fallback when `execute_student_course_change` RPC fails or rejects.

### Acceptance Test Suite Created
- [`backend/test/followup-atomic-enrollment.test.js`](file:///c:/Users/Muhammed%20Zayyan%20P%20V/Fyimpenroll/backend/test/followup-atomic-enrollment.test.js):
  - 13 focused unit and integration tests covering:
    - R09: Nonexistent columns excluded, credit breakdown stored in metadata, write errors handled, audit logging conditional.
    - R10: Step 1 pre-run fixed writes removed from `runAllocation`, RPC enforces deterministic course row locks and global seat limits.
    - R11: Mutation fallbacks eliminated in `submitCourses` and `updateSlot`, idempotency replay verified in `execute_student_course_change`.
    - R12: Blueprint slot eligibility enforced in `updateSlot` and `manualAllocate`, student semester mismatch rejected.
    - R14: Pathway resubmission frees superseded fixed seats, clears obsolete metadata, and preserves initial `submitted_at`.
    - Plan 01 Security: Functions have `search_path = public, pg_temp;` and restricted permissions.

---

## 3. Shared Contracts, Types & State Transitions

### Credit Breakdown Storage Contract
`student_registrations` table schema:
- **Physical Column:** `total_credits INTEGER NOT NULL DEFAULT 0`
- **Breakdown JSON Storage:** `allocation_metadata.credit_breakdown`:
  ```json
  {
    "core_credits": 16,
    "additional_credits": 4,
    "total_credits": 20
  }
  ```
- Queries or mutations **must not** attempt to select or update `core_credits` or `additional_credits` as columns on `student_registrations`.

### Manual Course Allocation RPC Contract
- **Function:** `execute_manual_course_allocation(p_student_id UUID, p_course_id UUID, p_slot_key TEXT, p_allocated_by UUID, p_reason TEXT)`
- **Behavior:**
  - Locks student registration and candidate courses deterministically (`FOR UPDATE`).
  - Verifies student current semester matches course semester.
  - Replaces previous course in `slot_key`, adjusting global enrolled counts atomically.
  - Recalculates total credits and updates `allocation_metadata.credit_breakdown`.
  - Records allocation metadata entry with `allocated_by: 'manual'`.

### Idempotent Course Change RPC Contract
- **Function:** `execute_student_course_change(p_student_id UUID, p_slot_key TEXT, p_new_course_id UUID, p_idempotency_key TEXT)`
- **Behavior:**
  - Checks if `p_idempotency_key` has already been recorded in `student_course_changes` for `p_student_id`.
  - If existing record has identical `(slot_key, new_course_id)`: returns success with `{ "success": true, "idempotent_replay": true }`.
  - If existing record has different parameters: returns error `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`.
  - If new key: verifies global course capacity (`enrolled < capacity`), updates slot, logs change, and commits.

### Pathway Resubmission Reconciliation Contract
- When `submit_student_registration` is invoked with a new pathway:
  - Compares existing fixed course allocations (`allocated_by = 'pathway_fixed'`) against the newly assigned pathway fixed courses.
  - Superseded fixed courses in `course_id_1` through `course_id_6` are set to `NULL`, releasing their seats immediately.
  - Superseded keys are purged from `allocation_metadata`.
  - `submitted_at` is preserved unchanged to maintain registration queue ordering.

---

## 4. Exact Validation Commands & Outcomes

### 1. Focused Acceptance Test Suite
```bash
node --test backend/test/followup-atomic-enrollment.test.js
```
- **Outcome:** 13 / 13 tests passed (100%), duration ~1.5s.

### 2. Full Backend Regression Suite
```bash
npm run test --workspace=backend
```
- **Outcome:** 185 / 185 tests passed (100%) across 82 test suites, duration ~21.2s.
- **Failures:** 0.

### 3. Backend Production Build
```bash
npm run build:backend
```
- **Outcome:** Clean NestJS compilation (code 0).

### 4. Frontend Production Build
```bash
npm run build:frontend
```
- **Outcome:** Clean Next.js Turbopack build (code 0, 11 static routes generated).

---

## 5. Downstream Obligations for Follow-up Plans 05–10

1. **Follow-up Plan 05 (Deterministic Allocation Atomic Jobs - R13, R15, R16, R36):**
   - Must consume the clean state where Step 1 pre-run writes are completely removed from `allocation.service.ts`.
   - Batch elective allocation job must use deterministic course locking (`ORDER BY id FOR UPDATE`) and respect global capacities updated by `submit_student_registration` and `execute_manual_course_allocation`.
   - Must write credit breakdown to `allocation_metadata.credit_breakdown` alongside `total_credits`.
2. **Follow-up Plan 09 (Registered-Credit Ledger & Course Readiness - R26, R33):**
   - Credit calculations in ledger queries must source breakdown from `allocation_metadata.credit_breakdown` and physical `total_credits`.
   - Ledger queries must acknowledge that freed pathway fixed slots remain `NULL` until populated by elective allocation or manual override.
