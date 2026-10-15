# Expected results and reconciliation

## Population

- Baseline fixture: 95 students.
- Each department has 15–20 students across Semesters 2 and 4.
- Scale pass: department counts between 15 and 28; total between 90 and 168.

## Registration and allocation

- Every submitted student has exactly one valid current-semester registration record.
- `submitted = allocated + unresolved + explicitly rejected`.
- No course enrollment count exceeds its seat limit.
- No student has duplicate enrollment for the same slot/course.
- A failed or retried mutation creates one logical final state.
- A course change releases the old seat once and consumes the new seat once.

## Authorization

- Students see and modify only their own records.
- HODs see and modify only their department and assigned campus.
- Teachers see only assigned teaching data.
- Directors see only their campus.
- Superadmin has the documented global administration scope.

## Timetable and attendance

- Every allocated course requiring teaching has the correct teacher and published schedule.
- No student, teacher, room, or period clash exists in a published timetable.
- Attendance rows reference the correct student, course, semester, period, and academic year.
- Duplicate attendance submission is idempotent.

## Release quality

- Zero open blocker or critical defects.
- All six departments pass both semesters.
- Final clean rerun passes after fixes.
- Backup restore and rollback are proven.
