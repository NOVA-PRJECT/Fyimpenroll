# Follow-up Plan 03 Handoff: Host-Campus Classes and Teacher Identity

**Date:** 9 October 2026
**Author:** Antigravity Engineering Agent
**Target Plan:** Follow-up Plan 03 (Findings R06, R07, R08)
**Prerequisites:** Follow-up Plan 01 (Database privileges & resource authorization), Follow-up Plan 02 (Password changes, session refresh & logout)
**Status:** Completed

---

## 1. Scope & Finding Status Matrix

| Finding | Priority / Severity | Follow-up Status | Primary Owner | Downstream Consumers | Exact Validation Evidence & Details |
|---|---|---|---|---|---|
| **R06** | High | **Completed** | Follow-up 03 | Follow-up 05, Follow-up 06, Follow-up 07 | Created additive migration `supabase/migrations/20261009020000_followup_plan03_host_campus_delivery_identity.sql` adding `campus_id UUID REFERENCES campuses(id) ON DELETE CASCADE` to `timetable_entries`, composite indexes `(campus_id, academic_year, semester)` and `(campus_id, course_id, academic_year, semester)`, non-destructive backfill from `departments.campus_id`, and updated publication immutability trigger `trg_guard_published_timetable_entries` to protect `campus_id`. In `backend/src/modules/timetable/solver/job.ts`, persisted `campus_id: campusId` on all generated entries and scoped draft deletions/published checks strictly to `campus_id`. In `backend/src/modules/timetable/timetable.service.ts` (`publish`), scoped publication updates by `campus_id = user.campus_id`, preventing cross-campus catalog courses from being unintentionally published or omitted. In `faculty.service.ts` (`getClassRoster`), decoupled student registration queries from visiting teacher's home campus to the actual delivery campus. Verified in `backend/test/followup-host-campus-classes.test.js` (R06-1, R06-2, R06-3). |
| **R07** | High | **Completed** | Follow-up 03 | Follow-up 07, Follow-up 09 | In `backend/src/modules/period-attendance/period-attendance.service.ts`: (1) Updated `getCurrentPeriod` and `getTeacherSchedule` to filter and authorize classes using composite delivery identity `(course_id, campus_id, academic_year, semester)` and direct slot assignments (`entry.teacher_id === user.userId`), eliminating leakage across terms or campuses. (2) Replaced `.maybeSingle()` queries on `teacher_course_assignments` with composite array lookups in `getSlotMarks` and `submitAttendance`, preventing 500 crashes when teachers hold legitimate assignments across multiple terms/campuses. (3) Scoped student enrollment roster queries in `getEnrolledRoster` strictly to `entry.campus_id`. (4) Maintained legacy error contract (`'You are not assigned to instruct this course'`) for regression safety. Verified in `backend/test/followup-host-campus-classes.test.js` (R07-1, R07-2). |
| **R08** | High | **Completed** | Follow-up 03 | Follow-up 06, Follow-up 07 | (1) Updated `backend/src/modules/timetable/solver/loader.ts` to include `campus_id` and `teacher_id` in published reservations, removed heuristic `!allCourseIds.has(...)` filter, and loaded foreign-campus published slots as `TeacherReservation` with explicit `sourceCampusId`. (2) In `backend/src/modules/assignments/assignments.service.ts` (`assignTeacher`, `batchAssignTeachers`, `reassignTeacher`), checked for time-slot clashes against published timetable entries across **all** campuses and semesters before committing assignments, and atomically synchronized `timetable_entries.teacher_id` in-place. (3) In `backend/src/modules/timetable/timetable.service.ts` (`substituteTeacher`), enforced global published slot conflict checks across all campuses/semesters and synchronized `teacher_course_assignments`. Verified in `backend/test/followup-host-campus-classes.test.js` (R08-1, R08-2, R08-3). |

---

## 2. Changed Source Files & Created Artifacts

### Database Migrations
- `supabase/migrations/20261009020000_followup_plan03_host_campus_delivery_identity.sql`:
  - Added additive column `campus_id UUID REFERENCES campuses(id) ON DELETE CASCADE` to `timetable_entries`.
  - Non-destructively backfilled legacy entries via `UPDATE timetable_entries SET campus_id = d.campus_id FROM departments d WHERE timetable_entries.department_id = d.id AND timetable_entries.campus_id IS NULL`.
  - Created composite performance indexes:
    - `idx_timetable_entries_host_term ON timetable_entries(campus_id, academic_year, semester)`
    - `idx_timetable_entries_delivery ON timetable_entries(campus_id, course_id, academic_year, semester)`
    - `idx_timetable_entries_teacher_slot ON timetable_entries(teacher_id, time_slot_id) WHERE status = 'published'`
  - Updated trigger function `guard_published_timetable_entry_immutability()` to guard `campus_id` against in-place mutations once status is `'published'`.

### Source Files Modified
- `backend/src/modules/timetable/solver/loader.ts`:
  - Selected `campus_id` and `teacher_id` from `timetable_entries`.
  - Indexed teacher assignments by composite key `${a.course_id}:${a.academic_year || ''}:${a.semester || ''}`.
  - Replaced heuristic course filter with explicit check (`entryCampusId !== campusId`).
  - Added `sourceCampusId` to populated `TeacherReservation` objects.
- `backend/src/modules/timetable/solver/job.ts`:
  - Persisted `campus_id: campusId` on all inserted timetable entries.
  - Scoped draft deletion strictly to `campus_id = campusId`.
  - Scoped immutable published check strictly to `campus_id = campusId`.
- `backend/src/modules/timetable/timetable.service.ts`:
  - Added `campus_id` and `teacher_id` to `getEntries` query and entry formatting.
  - Scoped campus director timetable queries to `user.campus_id`.
  - Scoped `publish(academicYear, semester, user, force)` updates to `campus_id = user.campus_id` (with fallback to department campus), isolating cross-campus catalog courses.
  - In `substituteTeacher`, verified host campus authority, performed global clash detection across all campuses and semesters, updated `timetable_entries.teacher_id` in-place, and synchronized `teacher_course_assignments`.
- `backend/src/modules/period-attendance/period-attendance.service.ts`:
  - In `getCurrentPeriod` and `getTeacherSchedule`, verified composite assignments `(course_id, campus_id, academic_year, semester)` and direct slot assignments (`entry.teacher_id === user.userId`).
  - In `getSlotMarks` and `submitAttendance`, replaced `.maybeSingle()` query with composite assignment array lookup, eliminating crashes from multiple assignments across terms; scoped student roster lookup to `entry.campus_id`.
  - In `copyPracticalAttendance`, supported direct slot authorization (`entry.teacher_id === user.userId`) alongside composite assignments.
- `backend/src/modules/faculty/faculty.service.ts`:
  - In `getClassRoster`, decoupled student registration and student queries from teacher's home campus to the actual class delivery campus (`deliveryCampusId`).
- `backend/src/modules/assignments/assignments.service.ts`:
  - In `assignTeacher`, `batchAssignTeachers`, and `reassignTeacher`, checked for slot clashes against published timetable entries across all campuses and semesters before committing, and atomically synchronized `timetable_entries.teacher_id` in-place.

### New Test Suite Created
- `backend/test/followup-host-campus-classes.test.js`:
  - 8 comprehensive automated acceptance tests validating R06, R07, and R08:
    - Host-campus class delivery identity & independent publication isolation.
    - Visiting teacher roster access for cross-campus deliveries.
    - Composite delivery authorization in period attendance without `maybeSingle` multi-row failures.
    - Cross-campus unauthorized attendance denial for identical catalog courses.
    - Solver loader cross-campus teacher reservations loading.
    - Shared-teacher double-booking rejection across campuses and terms during manual assignment and substitution.

---

## 3. Shared Contracts, Types & State Transitions

### Composite Class Delivery Identity
A concrete teaching delivery is uniquely identified across FYIMP by the 4-tuple:
```
(campus_id, academic_year, semester, course_id)
```
- **Catalogue Course Ownership:** `courses.department_id` identifies the home academic department that created or owns the syllabus.
- **Operational Delivery:** `timetable_entries.campus_id` identifies the campus hosting and scheduling instruction for the cohort.
- **Teacher Assignment:** `teacher_course_assignments` associates a teacher with a course for a specific term and host campus:
  ```ts
  {
    teacher_id: string;
    course_id: string;
    campus_id: string;
    academic_year: string;
    semester: number;
  }
  ```
- **Direct Timetable Slot Assignment:** `timetable_entries.teacher_id` represents the exact assigned instructor for a specific timetable block, allowing direct authorization in attendance marking and substitution workflows.

### Solver published Reservation Contract (R08)
- Solver generation input loads published entries from **all** campuses.
- Any published entry with a valid `teacher_id` whose `campus_id != currentGenerationCampusId` is registered as a `TeacherReservation`:
  ```ts
  {
    teacherId: entry.teacher_id,
    dayOfWeek: slot.day_of_week,
    periodNumber: slot.period_number,
    reason: `Published slot at campus ${entry.campus_id}`,
    sourceCampusId: entry.campus_id
  }
  ```
- OR-Tools solver penalizes or forbids placing the teacher at that slot in the current campus timetable.

### Timetable Immutability & Substitution Contract
- Published timetable entries cannot have their `id`, `time_slot_id`, `room_id`, `campus_id`, `academic_year`, `semester`, `department_id`, or `course_id` altered.
- `substituteTeacher` only mutates `teacher_id` in-place, preserving attendance links, student selections, and downstream references.

---

## 4. Exact Validation Commands & Outcomes

### 1. Focused Acceptance Test Suite
```bash
node --test backend/test/followup-host-campus-classes.test.js
```
- **Outcome:** 8 / 8 tests passed (100%), duration ~1.8s.

### 2. Full Backend Regression Suite
```bash
npm run test --workspace=backend
```
- **Outcome:** 172 / 172 tests passed (100%) across 75 test suites, duration ~18.3s.
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
- **Outcome:** Clean Next.js Turbopack build (code 0).

---

## 5. Downstream Obligations for Follow-up Plans 04–10

1. **Follow-up Plan 04 (Timetable solver and reservations):**
   - Must consume `timetable_entries.campus_id` and the multi-campus `TeacherReservation` model established in `loader.ts`.
   - Must respect the in-place `timetable_entries.teacher_id` substitution contract.
2. **Follow-up Plan 05 (Student registration, pathway and capacity):**
   - Must query course deliveries and capacities scoped to `campus_id`.
3. **Follow-up Plan 06 (OR-Tools timetable generation):**
   - Must maintain solver constraints respecting cross-campus teacher reservations.
4. **Follow-up Plan 07 (Period attendance corrections & rosters):**
   - Must continue using composite delivery identity `(campus_id, academic_year, semester, course_id)` and direct slot instructor checks without re-introducing single-row assumptions.
5. **Follow-up Plan 09 (HOD catalog readiness & assignments):**
   - Must use the composite term keys when querying or managing faculty assignments.
