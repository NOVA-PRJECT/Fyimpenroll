# Fyimpenroll implementation reference

Companion to the [system walkthrough](SYSTEM_WALKTHROUGH.md). Snapshot of main at `5d05294`. The HTTP index was extracted from Nest controller decorators. The database inventory was queried from an isolated database restored from the repository bootstrap. Hosted installations can differ.

## HTTP entry points

Use the role column as the first gate only. The guard and service can impose additional consent, campus, department, ownership, delivery, time and term checks. A dash means no Roles decorator. Check the linked handler for authentication and any other guards.

### admin

| Request | Roles decorator | Handler |
|---|---|---|
| `GET /api/admin/auth-cleanup` | superadmin | [`cleanupStatus`](../backend/src/modules/admin/admin.controller.ts#L68) |
| `POST /api/admin/auth-cleanup/retry` | superadmin | [`retryCleanup`](../backend/src/modules/admin/admin.controller.ts#L75) |
| `GET /api/admin/campuses` | superadmin | [`getCampuses`](../backend/src/modules/admin/admin.controller.ts#L84) |
| `POST /api/admin/campuses` | superadmin | [`createCampus`](../backend/src/modules/admin/admin.controller.ts#L90) |
| `PUT /api/admin/campuses` | superadmin | [`updateCampus`](../backend/src/modules/admin/admin.controller.ts#L100) |
| `DELETE /api/admin/campuses` | superadmin | [`deleteCampus`](../backend/src/modules/admin/admin.controller.ts#L110) |
| `GET /api/admin/departments` | superadmin | [`getDepartments`](../backend/src/modules/admin/admin.controller.ts#L121) |
| `POST /api/admin/departments` | superadmin | [`createDepartment`](../backend/src/modules/admin/admin.controller.ts#L127) |
| `PUT /api/admin/departments` | superadmin | [`updateDepartment`](../backend/src/modules/admin/admin.controller.ts#L140) |
| `DELETE /api/admin/departments` | superadmin | [`deleteDepartment`](../backend/src/modules/admin/admin.controller.ts#L153) |
| `GET /api/admin/faculty-list` | superadmin | [`getFacultyList`](../backend/src/modules/admin/admin.controller.ts#L164) |
| `POST /api/admin/faculty-list` | superadmin | [`createFaculty`](../backend/src/modules/admin/admin.controller.ts#L170) |
| `PUT /api/admin/faculty-list` | superadmin | [`updateFaculty`](../backend/src/modules/admin/admin.controller.ts#L188) |
| `DELETE /api/admin/faculty-list` | superadmin | [`deleteFaculty`](../backend/src/modules/admin/admin.controller.ts#L205) |
| `POST /api/admin/campus/promote-students` | campus_director | [`promoteStudents`](../backend/src/modules/admin/admin.controller.ts#L213) |
| `POST /api/admin/campus/graduate-students` | campus_director, superadmin | [`graduateStudents`](../backend/src/modules/admin/admin.controller.ts#L225) |
| `GET /api/admin/campus/graduation-candidates` | campus_director | [`graduationCandidates`](../backend/src/modules/admin/admin.controller.ts#L243) |
| `GET /api/admin/logs` | superadmin | [`getLogs`](../backend/src/modules/admin/admin.controller.ts#L249) |

### allocation

| Request | Roles decorator | Handler |
|---|---|---|
| `DELETE /api/allocation/runs/:runId/cancel` | campus_director | [`cancel`](../backend/src/modules/allocation/allocation.controller.ts#L29) |
| `POST /api/allocation/run` | campus_director | [`runAllocation`](../backend/src/modules/allocation/allocation.controller.ts#L38) |
| `GET /api/allocation/status` | campus_director, hod | [`getRunStatus`](../backend/src/modules/allocation/allocation.controller.ts#L50) |
| `DELETE /api/allocation/runs/:runId` | campus_director | [`clearFailedRun`](../backend/src/modules/allocation/allocation.controller.ts#L62) |
| `GET /api/allocation/unresolved` | hod | [`getUnresolvedStudents`](../backend/src/modules/allocation/allocation.controller.ts#L72) |
| `GET /api/allocation/remaining-seats` | hod | [`getRemainingSeats`](../backend/src/modules/allocation/allocation.controller.ts#L82) |
| `POST /api/allocation/manual-allocate` | hod, teacher, superadmin | [`manualAllocate`](../backend/src/modules/allocation/allocation.controller.ts#L94) |

### assignments

| Request | Roles decorator | Handler |
|---|---|---|
| `GET /api/assignments/history` | hod, campus_director, teacher, superadmin | [`history`](../backend/src/modules/assignments/assignments.controller.ts#L31) |
| `GET /api/assignments/courses` | hod, superadmin | [`getCoursesAndAssignments`](../backend/src/modules/assignments/assignments.controller.ts#L40) |
| `POST /api/assignments/assign` | hod | [`assignTeacher`](../backend/src/modules/assignments/assignments.controller.ts#L46) |
| `POST /api/assignments/batch-assign` | hod | [`batchAssignTeachers`](../backend/src/modules/assignments/assignments.controller.ts#L72) |
| `PATCH /api/assignments/:id/reassign` | hod | [`reassignTeacher`](../backend/src/modules/assignments/assignments.controller.ts#L89) |
| `DELETE /api/assignments/:id` | hod | [`removeAssignment`](../backend/src/modules/assignments/assignments.controller.ts#L106) |

### auth

| Request | Roles decorator | Handler |
|---|---|---|
| `POST /api/auth/login` | — | [`login`](../backend/src/modules/auth/auth.controller.ts#L39) |
| `GET /api/auth/session` | — | [`session`](../backend/src/modules/auth/auth.controller.ts#L100) |
| `POST /api/auth/refresh` | — | [`refresh`](../backend/src/modules/auth/auth.controller.ts#L112) |
| `POST /api/auth/logout` | — | [`logout`](../backend/src/modules/auth/auth.controller.ts#L155) |
| `GET /api/auth/profile` | — | [`getProfile`](../backend/src/modules/auth/auth.controller.ts#L182) |
| `POST /api/auth/change-password` | — | [`changePassword`](../backend/src/modules/auth/auth.controller.ts#L190) |
| `POST /api/auth/complete-password-reset` | — | [`completePasswordReset`](../backend/src/modules/auth/auth.controller.ts#L232) |
| `POST /api/auth/sync-password-status` | — | [`syncPasswordStatus`](../backend/src/modules/auth/auth.controller.ts#L242) |

### campus-attendance

| Request | Roles decorator | Handler |
|---|---|---|
| `POST /api/attendance/campus/sign-in` | student | [`signIn`](../backend/src/modules/campus-attendance/campus-attendance.controller.ts#L37) |
| `GET /api/attendance/campus/status/:studentId` | student, teacher, teaching_staff, hod, campus_director, superadmin | [`getStatus`](../backend/src/modules/campus-attendance/campus-attendance.controller.ts#L65) |
| `GET /api/attendance/campus/roster` | hod, campus_director, superadmin | [`getDepartmentRoster`](../backend/src/modules/campus-attendance/campus-attendance.controller.ts#L78) |

### consent

| Request | Roles decorator | Handler |
|---|---|---|
| `GET /api/consent/status` | — | [`getStatus`](../backend/src/modules/consent/consent.controller.ts#L25) |
| `POST /api/consent/accept` | — | [`acceptConsent`](../backend/src/modules/consent/consent.controller.ts#L31) |

### credit-ledger

| Request | Roles decorator | Handler |
|---|---|---|
| `GET /api/credit-ledger/me` | student | [`getMyLedger`](../backend/src/modules/credit-ledger/credit-ledger.controller.ts#L24) |
| `GET /api/credit-ledger/:studentId` | student, teacher, hod, campus_director, superadmin | [`getStudentLedger`](../backend/src/modules/credit-ledger/credit-ledger.controller.ts#L34) |
| `GET /api/export/registrations` | student, hod, campus_director, superadmin, teacher | [`exportRegistrations`](../backend/src/modules/credit-ledger/export.controller.ts#L37) |
| `GET /api/export/unresolved-allocations` | hod, campus_director, superadmin, teacher | [`exportUnresolvedAllocations`](../backend/src/modules/credit-ledger/export.controller.ts#L62) |
| `GET /api/export/class-roster` | teacher, teaching_staff, hod, campus_director, superadmin | [`exportClassRoster`](../backend/src/modules/credit-ledger/export.controller.ts#L83) |
| `GET /api/export/timetable` | student, teacher, teaching_staff, hod, campus_director, superadmin | [`exportTimetable`](../backend/src/modules/credit-ledger/export.controller.ts#L106) |
| `GET /api/export/period-attendance` | teacher, hod, campus_director, superadmin | [`exportPeriodAttendance`](../backend/src/modules/credit-ledger/export.controller.ts#L131) |
| `GET /api/export/gps-signins` | campus_director, superadmin | [`exportGpsSignIns`](../backend/src/modules/credit-ledger/export.controller.ts#L158) |
| `GET /api/export/credit-ledger/:studentId` | student, teacher, hod, campus_director, superadmin | [`exportCreditLedger`](../backend/src/modules/credit-ledger/export.controller.ts#L183) |

### director

| Request | Roles decorator | Handler |
|---|---|---|
| `GET /api/director/attendance-settings` | campus_director | [`getAttendanceSettings`](../backend/src/modules/director/director.controller.ts#L24) |
| `PUT /api/director/attendance-settings` | campus_director | [`updateAttendanceSettings`](../backend/src/modules/director/director.controller.ts#L29) |
| `GET /api/director/settings` | campus_director | [`getSettings`](../backend/src/modules/director/director.controller.ts#L34) |
| `PUT /api/director/settings` | campus_director | [`updateSettings`](../backend/src/modules/director/director.controller.ts#L39) |

### faculty

| Request | Roles decorator | Handler |
|---|---|---|
| `GET /api/faculty/courses` | teacher, teaching_staff, hod | [`getCourses`](../backend/src/modules/faculty/faculty.controller.ts#L21) |
| `GET /api/faculty/attendance` | teacher, teaching_staff, hod | [`getAttendance`](../backend/src/modules/faculty/faculty.controller.ts#L26) |
| `GET /api/faculty/defaulters` | hod | [`getDefaulters`](../backend/src/modules/faculty/faculty.controller.ts#L32) |

### health

| Request | Roles decorator | Handler |
|---|---|---|
| `GET /api/health` | — | [`check`](../backend/src/modules/health/health.controller.ts#L16) |
| `GET /api/health/ready` | — | [`ready`](../backend/src/modules/health/health.controller.ts#L19) |

### hod

| Request | Roles decorator | Handler |
|---|---|---|
| `GET /api/hod/catalog-readiness` | hod | [`getCatalogReadiness`](../backend/src/modules/hod/hod.controller.ts#L82) |
| `GET /api/hod/blueprint` | hod | [`getBlueprint`](../backend/src/modules/hod/hod.controller.ts#L88) |
| `PUT /api/hod/blueprint` | hod | [`updateBlueprintPut`](../backend/src/modules/hod/hod.controller.ts#L95) |
| `POST /api/hod/blueprint` | hod | [`updateBlueprintPost`](../backend/src/modules/hod/hod.controller.ts#L104) |
| `GET /api/hod/courses` | hod | [`getCourses`](../backend/src/modules/hod/hod.controller.ts#L114) |
| `POST /api/hod/courses` | hod | [`createCourse`](../backend/src/modules/hod/hod.controller.ts#L128) |
| `PUT /api/hod/courses` | hod | [`updateCourse`](../backend/src/modules/hod/hod.controller.ts#L137) |
| `DELETE /api/hod/courses` | hod | [`deleteCourse`](../backend/src/modules/hod/hod.controller.ts#L146) |
| `GET /api/hod/departments` | hod | [`getDepartments`](../backend/src/modules/hod/hod.controller.ts#L155) |
| `GET /api/hod/students` | hod | [`getStudents`](../backend/src/modules/hod/hod.controller.ts#L161) |
| `POST /api/hod/students/add` | hod | [`addStudent`](../backend/src/modules/hod/hod.controller.ts#L166) |
| `PUT /api/hod/students/update` | hod | [`updateStudent`](../backend/src/modules/hod/hod.controller.ts#L175) |
| `DELETE /api/hod/students/remove` | hod | [`removeStudent`](../backend/src/modules/hod/hod.controller.ts#L184) |
| `POST /api/hod/bulk-students` | hod | [`bulkCreateStudents`](../backend/src/modules/hod/hod.controller.ts#L192) |
| `GET /api/hod/export-students-excel` | hod | [`exportStudentsExcel`](../backend/src/modules/hod/hod.controller.ts#L209) |
| `GET /api/hod/teachers` | hod | [`getTeachers`](../backend/src/modules/hod/hod.controller.ts#L215) |
| `POST /api/hod/teachers` | hod | [`createTeacher`](../backend/src/modules/hod/hod.controller.ts#L220) |
| `DELETE /api/hod/teachers/:id` | hod | [`deleteTeacher`](../backend/src/modules/hod/hod.controller.ts#L229) |

### period-attendance

| Request | Roles decorator | Handler |
|---|---|---|
| `GET /api/attendance/export/statement` | hod, superadmin | [`exportStatement`](../backend/src/modules/period-attendance/attendance-export.controller.ts#L26) |
| `GET /api/attendance/period/current` | teacher, teaching_staff, hod | [`getCurrentPeriod`](../backend/src/modules/period-attendance/period-attendance.controller.ts#L35) |
| `GET /api/attendance/period/teacher-schedule` | teacher, teaching_staff, hod | [`getTeacherSchedule`](../backend/src/modules/period-attendance/period-attendance.controller.ts#L41) |
| `GET /api/attendance/period/slot-marks` | teacher, hod, superadmin | [`getSlotMarks`](../backend/src/modules/period-attendance/period-attendance.controller.ts#L50) |
| `POST /api/attendance/period/submit` | teacher, hod | [`submitAttendance`](../backend/src/modules/period-attendance/period-attendance.controller.ts#L66) |
| `POST /api/attendance/period/copy-to-next-period` | teacher, hod | [`copyPracticalAttendance`](../backend/src/modules/period-attendance/period-attendance.controller.ts#L90) |
| `GET /api/attendance/period/roster` | hod, superadmin | [`getSlotRosterForHod`](../backend/src/modules/period-attendance/period-attendance.controller.ts#L106) |
| `GET /api/attendance/period/slots` | hod, superadmin | [`getDepartmentSlots`](../backend/src/modules/period-attendance/period-attendance.controller.ts#L119) |
| `GET /api/attendance/period/export/statement` | hod, superadmin | [`exportStatement`](../backend/src/modules/period-attendance/period-attendance.controller.ts#L136) |

### registrations

| Request | Roles decorator | Handler |
|---|---|---|
| `GET /api/registrations/blueprint` | student | [`getBlueprint`](../backend/src/modules/registrations/registrations.controller.ts#L27) |
| `GET /api/registrations/my` | student | [`getMyRegistration`](../backend/src/modules/registrations/registrations.controller.ts#L32) |
| `GET /api/registrations/pathway-slots` | student | [`getPathwaySlots`](../backend/src/modules/registrations/registrations.controller.ts#L37) |
| `POST /api/registrations/submit` | student | [`submitCourses`](../backend/src/modules/registrations/registrations.controller.ts#L47) |
| `GET /api/registrations/available-seats` | student | [`getAvailableSeats`](../backend/src/modules/registrations/registrations.controller.ts#L63) |
| `POST /api/registrations/update-slot` | student | [`updateSlot`](../backend/src/modules/registrations/registrations.controller.ts#L80) |

### student

| Request | Roles decorator | Handler |
|---|---|---|
| `GET /api/student/overview` | student | [`overview`](../backend/src/modules/student/student.controller.ts#L34) |
| `GET /api/student/courses` | student | [`courses`](../backend/src/modules/student/student.controller.ts#L39) |
| `GET /api/student/courses/:id` | student | [`course`](../backend/src/modules/student/student.controller.ts#L44) |
| `GET /api/student/attendance` | student | [`attendance`](../backend/src/modules/student/student.controller.ts#L49) |
| `GET /api/student/timetable` | student | [`timetable`](../backend/src/modules/student/student.controller.ts#L54) |
| `GET /api/student/dashboard-summary` | student | [`getDashboardSummary`](../backend/src/modules/student/student.controller.ts#L59) |
| `POST /api/student/change-password` | student | [`changePassword`](../backend/src/modules/student/student.controller.ts#L67) |

### timetable

| Request | Roles decorator | Handler |
|---|---|---|
| `DELETE /api/timetable/jobs/:id` | campus_director | [`cancelJob`](../backend/src/modules/timetable/timetable.controller.ts#L35) |
| `GET /api/timetable/manual` | campus_director | [`getManual`](../backend/src/modules/timetable/timetable.controller.ts#L42) |
| `POST /api/timetable/manual/preview` | campus_director | [`previewManual`](../backend/src/modules/timetable/timetable.controller.ts#L50) |
| `PUT /api/timetable/manual` | campus_director | [`saveManual`](../backend/src/modules/timetable/timetable.controller.ts#L58) |
| `POST /api/timetable/manual/publish` | campus_director | [`publishManual`](../backend/src/modules/timetable/timetable.controller.ts#L66) |
| `GET /api/timetable/constraints` | superadmin, campus_director, hod | [`getConstraints`](../backend/src/modules/timetable/timetable.controller.ts#L75) |
| `PUT /api/timetable/constraints` | campus_director | [`updateConstraints`](../backend/src/modules/timetable/timetable.controller.ts#L84) |
| `PUT /api/timetable/entries/:id/teacher` | hod | [`substituteTeacher`](../backend/src/modules/timetable/timetable.controller.ts#L91) |
| `GET /api/timetable/entries` | superadmin, campus_director, hod, teaching_staff, teacher, student | [`getEntries`](../backend/src/modules/timetable/timetable.controller.ts#L107) |
| `POST /api/timetable/generate` | campus_director | [`generate`](../backend/src/modules/timetable/timetable.controller.ts#L123) |
| `GET /api/timetable/job-status` | campus_director | [`getJobStatus`](../backend/src/modules/timetable/timetable.controller.ts#L135) |
| `GET /api/timetable/progress` | campus_director | [`progress`](../backend/src/modules/timetable/timetable.controller.ts#L146) |
| `POST /api/timetable/publish` | campus_director | [`publish`](../backend/src/modules/timetable/timetable.controller.ts#L154) |

## Database relations

Tables store rows. Views calculate a projection when queried. The key for a view often comes from its underlying table. Column names below are in schema order. Follow [the bootstrap](../supabase/baseline/bootstrap.psql) for constraints, triggers, permissions and changes to older definitions.

| Relation | Kind | Columns |
|---|---|---|
| `admins` | base table | id, full_name, email, role |
| `auth_cleanup_tasks` | base table | id, request_id, user_id, actor_id, scope, resource_id, status, attempts, next_attempt, lease_until, fence, error, created_at, updated_at |
| `campus_settings` | base table | id, campus_id, deadline, academic_year, min_credits, max_credits, last_promoted_at, timetable_constraints, term_version, term_started_at |
| `campus_sign_ins` | base table | id, student_id, campus_id, session_type, signed_in_at, signed_in_date, location_accuracy_meters, status, source |
| `campuses` | base table | id, name, code, center_latitude, center_longitude, radius_meters, morning_cutoff_time, midday_split_time, evening_cutoff_time, day_end_time |
| `cohort_schedule_outcomes` | base table | campus_id, academic_year, semester, term_version, outcome, finalized_by, finalized_at |
| `consent_records` | base table | id, user_id, policy_version, accepted_at |
| `courses` | base table | id, course_code, title, department_id, semester, credits, category, theory_hours_per_week, practical_hours_per_week, seat_limit, academic_level, prerequisites |
| `departments` | base table | id, name, code, campus_id |
| `faculty` | base table | id, full_name, email, role, department_id, campus_id |
| `period_attendance` | base table | id, timetable_slot_id, student_id, course_id, marked_by, status, marked_at, is_late_entry, unlocked_by, attendance_date |
| `period_attendance_sessions` | base table | id, timetable_slot_id, attendance_date, revision, revision_token, marked_by, last_marked_at, total_students, present_count, absent_count, created_at, updated_at |
| `registration_preferences` | base table | id, student_id, campus_id, semester, academic_year, pathway_id, preferences, legacy_allocation_metadata_snapshot, submitted_at, created_at, updated_at |
| `review_jobs` | base table | id, kind, campus_id, actor_id, academic_year, semester, term_version, payload, status, fence, attempts, lease_until, created_at, updated_at, error |
| `review_lock_samples` | base table | id, sampled_at, operation, wait_ms, transaction_elapsed_ms |
| `review_worker_state` | base table | id, last_seen |
| `schedule_dependency_revisions` | base table | key, revision |
| `schema_migrations` | base table | version, name, applied_at |
| `semester_blueprints` | base table | id, department_id, semester, min_credits, max_credits, pathways |
| `student_registrations` | base table | id, student_id, campus_id, semester, academic_year, slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id, total_credits, submitted_at, pathway_id, selections, allocation_metadata, slot_7_course_id, slot_8_course_id, term_version |
| `students` | base table | id, full_name, department_id, campus_id, current_semester, cap_application_number, academic_year_joined, must_change_password |
| `system_logs` | base table | id, log_type, status, progress, error_message, error_stack, campus_id, academic_year, semester, user_id, user_role, event_type, action, resource_type, resource_id, ip_address, user_agent, route, metadata, started_at, completed_at, created_at, updated_at, term_version |
| `teacher_course_assignments` | base table | id, teacher_id, course_id, assigned_by, assigned_at, campus_id, academic_year, semester, term_version |
| `time_slots` | base table | id, day_of_week, period_number, start_time, end_time |
| `timetable_conflicts` | base table | id, academic_year, semester, course_id, blocking_course_id, reason, conflicting_student_count, resolved, created_at |
| `timetable_entries` | base table | id, academic_year, semester, course_id, department_id, time_slot_id, is_lab_block, status, generated_by, generated_at, published_at, session_type, teacher_id, class_id, campus_id, term_version |
| `current_student_registrations` | view | id, student_id, campus_id, semester, academic_year, slot_1_course_id, slot_2_course_id, slot_3_course_id, slot_4_course_id, slot_5_course_id, slot_6_course_id, total_credits, submitted_at, pathway_id, selections, allocation_metadata, slot_7_course_id, slot_8_course_id, term_version |
| `current_system_logs` | view | id, log_type, status, progress, error_message, error_stack, campus_id, academic_year, semester, user_id, user_role, event_type, action, resource_type, resource_id, ip_address, user_agent, route, metadata, started_at, completed_at, created_at, updated_at, term_version |
| `current_teacher_course_assignments` | view | id, teacher_id, course_id, assigned_by, assigned_at, campus_id, academic_year, semester, term_version |
| `current_timetable_entries` | view | id, academic_year, semester, course_id, department_id, time_slot_id, is_lab_block, status, generated_by, generated_at, published_at, session_type, teacher_id, class_id, campus_id, term_version |

## Database relationships

Read each row as “the child stores a reference to the parent.” Deleting the parent can cascade to children, clear the reference, or be refused. Several business relationships, such as course IDs inside preference JSON, require application or SQL checks in addition to these foreign keys.

| Child | Constraint definition |
|---|---|
| `admins` | `FOREIGN KEY (id) REFERENCES auth.users(id)` |
| `campus_settings` | `FOREIGN KEY (campus_id) REFERENCES campuses(id)` |
| `campus_sign_ins` | `FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE` |
| `campus_sign_ins` | `FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE` |
| `cohort_schedule_outcomes` | `FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE` |
| `consent_records` | `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE` |
| `courses` | `FOREIGN KEY (department_id) REFERENCES departments(id)` |
| `departments` | `FOREIGN KEY (campus_id) REFERENCES campuses(id)` |
| `faculty` | `FOREIGN KEY (campus_id) REFERENCES campuses(id)` |
| `faculty` | `FOREIGN KEY (department_id, campus_id) REFERENCES departments(id, campus_id)` |
| `faculty` | `FOREIGN KEY (department_id) REFERENCES departments(id)` |
| `faculty` | `FOREIGN KEY (id) REFERENCES auth.users(id)` |
| `period_attendance` | `FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE` |
| `period_attendance` | `FOREIGN KEY (marked_by) REFERENCES auth.users(id) ON DELETE SET NULL` |
| `period_attendance` | `FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE` |
| `period_attendance` | `FOREIGN KEY (timetable_slot_id) REFERENCES timetable_entries(id) ON DELETE CASCADE` |
| `period_attendance` | `FOREIGN KEY (unlocked_by) REFERENCES auth.users(id) ON DELETE SET NULL` |
| `period_attendance_sessions` | `FOREIGN KEY (marked_by) REFERENCES auth.users(id) ON DELETE SET NULL` |
| `period_attendance_sessions` | `FOREIGN KEY (timetable_slot_id) REFERENCES timetable_entries(id) ON DELETE CASCADE` |
| `registration_preferences` | `FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE` |
| `registration_preferences` | `FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE` |
| `registration_preferences` | `FOREIGN KEY (student_id) REFERENCES auth.users(id) ON DELETE CASCADE` |
| `semester_blueprints` | `FOREIGN KEY (department_id) REFERENCES departments(id)` |
| `student_registrations` | `FOREIGN KEY (campus_id) REFERENCES campuses(id)` |
| `student_registrations` | `FOREIGN KEY (slot_1_course_id) REFERENCES courses(id)` |
| `student_registrations` | `FOREIGN KEY (slot_2_course_id) REFERENCES courses(id)` |
| `student_registrations` | `FOREIGN KEY (slot_3_course_id) REFERENCES courses(id)` |
| `student_registrations` | `FOREIGN KEY (slot_4_course_id) REFERENCES courses(id)` |
| `student_registrations` | `FOREIGN KEY (slot_5_course_id) REFERENCES courses(id)` |
| `student_registrations` | `FOREIGN KEY (slot_6_course_id) REFERENCES courses(id)` |
| `student_registrations` | `FOREIGN KEY (slot_7_course_id) REFERENCES courses(id) ON DELETE SET NULL` |
| `student_registrations` | `FOREIGN KEY (slot_8_course_id) REFERENCES courses(id) ON DELETE SET NULL` |
| `student_registrations` | `FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE` |
| `students` | `FOREIGN KEY (campus_id) REFERENCES campuses(id)` |
| `students` | `FOREIGN KEY (department_id) REFERENCES departments(id)` |
| `students` | `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE` |
| `system_logs` | `FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE` |
| `teacher_course_assignments` | `FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL` |
| `teacher_course_assignments` | `FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE SET NULL` |
| `teacher_course_assignments` | `FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE` |
| `teacher_course_assignments` | `FOREIGN KEY (teacher_id) REFERENCES auth.users(id) ON DELETE CASCADE` |
| `timetable_conflicts` | `FOREIGN KEY (blocking_course_id) REFERENCES courses(id)` |
| `timetable_conflicts` | `FOREIGN KEY (course_id) REFERENCES courses(id)` |
| `timetable_entries` | `FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE` |
| `timetable_entries` | `FOREIGN KEY (course_id) REFERENCES courses(id)` |
| `timetable_entries` | `FOREIGN KEY (department_id) REFERENCES departments(id)` |
| `timetable_entries` | `FOREIGN KEY (generated_by) REFERENCES auth.users(id)` |
| `timetable_entries` | `FOREIGN KEY (teacher_id) REFERENCES auth.users(id) ON DELETE SET NULL` |
| `timetable_entries` | `FOREIGN KEY (time_slot_id) REFERENCES time_slots(id)` |
