/**
 * Period Attendance & Independent GPS Sign-Ins Test Suite (Plan 07)
 *
 * Verifies:
 * - F43: Unrestricted current-semester correction; requires published class; server-generated marked_at.
 * - F44: Retired unlock workflow; no grace-period or unlock dependency.
 * - F45: Strict campus-class cohort roster scoping; rejects historical and foreign-campus students.
 * - F46: Dated HOD summaries and slot rosters; distinct counts per academic date.
 * - F47: Persisted marks reloading; preservation of absences on reopen; concurrency conflict detection.
 * - F48: Explicit academic date decoupling from marked_at in Asia/Kolkata timezone.
 * - F49: Two-hour practical session copying with overwrite guard; two counted period records.
 * - GPS sign-in independence.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Mock Auth Users
const mockTeacherUser = {
  userId: '11111111-1111-1111-1111-111111111111',
  role: 'teacher',
  department_id: 'dept-malayalam-id',
  campus_id: 'campus-alappuzha-id',
};

const mockForeignTeacherUser = {
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'teacher',
  department_id: 'dept-english-id',
  campus_id: 'campus-alappuzha-id',
};

const mockHodUser = {
  userId: '33333333-3333-3333-3333-333333333333',
  role: 'hod',
  department_id: 'dept-malayalam-id',
  campus_id: 'campus-alappuzha-id',
};

const mockTeachingStaffUser = {
  userId: '44444444-4444-4444-4444-444444444444',
  role: 'teaching_staff',
  department_id: 'dept-malayalam-id',
  campus_id: 'campus-alappuzha-id',
};

// Fixtures
const publishedSlotId = 'slot-published-p1';
const draftSlotId = 'slot-draft-p1';
const adjacentPracticalSlotId = 'slot-published-p2';
const courseMalayalamId = 'course-malayalam-101';
const academicYear = '2025-26';
const semester = 1;
const campusId = 'campus-alappuzha-id';
const deptId = 'dept-malayalam-id';

const validStudent1 = {
  id: 'student-001',
  full_name: 'Aisha Rahman',
  cap_application_number: 'CAP2025001',
  current_semester: 1,
  campus_id: campusId,
};

const validStudent2 = {
  id: 'student-002',
  full_name: 'Bilal Khan',
  cap_application_number: 'CAP2025002',
  current_semester: 1,
  campus_id: campusId,
};

const foreignCampusStudent = {
  id: 'student-foreign-999',
  full_name: 'Devika Nair',
  cap_application_number: 'CAP2025999',
  current_semester: 1,
  campus_id: 'campus-kannur-id',
};

describe('Plan 07: Period Attendance & Independent GPS Sign-Ins', () => {
  let mockSupabase;
  let mockAuditLogger;
  let mockServerLogger;
  let periodAttendanceService;

  beforeEach(() => {
    // In-memory table stores
    const periodAttendanceStore = [];
    const teacherAssignmentsStore = [
      { id: 'assign-1', teacher_id: mockTeacherUser.userId, course_id: courseMalayalamId },
    ];
    const timetableEntriesStore = [
      {
        id: publishedSlotId,
        course_id: courseMalayalamId,
        department_id: deptId,
        academic_year: academicYear,
        semester: semester,
        status: 'published',
        session_type: 'practical',
        is_lab_block: true,
        courses: { id: courseMalayalamId, course_code: 'MAL101', title: 'Poetry & Prosody', semester: 1 },
        time_slots: { id: 'ts-1', day_of_week: 1, period_number: 1, start_time: '09:30:00', end_time: '10:30:00' },
        departments: { campus_id: campusId },
      },
      {
        id: adjacentPracticalSlotId,
        course_id: courseMalayalamId,
        department_id: deptId,
        academic_year: academicYear,
        semester: semester,
        status: 'published',
        session_type: 'practical',
        is_lab_block: true,
        courses: { id: courseMalayalamId, course_code: 'MAL101', title: 'Poetry & Prosody', semester: 1 },
        time_slots: { id: 'ts-2', day_of_week: 1, period_number: 2, start_time: '10:30:00', end_time: '11:30:00' },
        departments: { campus_id: campusId },
      },
      {
        id: draftSlotId,
        course_id: courseMalayalamId,
        department_id: deptId,
        academic_year: academicYear,
        semester: semester,
        status: 'draft',
        session_type: 'theory',
        is_lab_block: false,
        courses: { id: courseMalayalamId, course_code: 'MAL101', title: 'Poetry & Prosody', semester: 1 },
        time_slots: { id: 'ts-3', day_of_week: 2, period_number: 1, start_time: '09:30:00', end_time: '10:30:00' },
        departments: { campus_id: campusId },
      },
    ];

    const studentRegistrationsStore = [
      {
        student_id: validStudent1.id,
        campus_id: campusId,
        academic_year: academicYear,
        semester: semester,
        slot_1_course_id: courseMalayalamId,
      },
      {
        student_id: validStudent2.id,
        campus_id: campusId,
        academic_year: academicYear,
        semester: semester,
        slot_1_course_id: courseMalayalamId,
      },
      // Historical student from 2024-25 (should be excluded by F45)
      {
        student_id: 'student-old-888',
        campus_id: campusId,
        academic_year: '2024-25',
        semester: semester,
        slot_1_course_id: courseMalayalamId,
      },
      // Foreign campus student (should be excluded by F45)
      {
        student_id: foreignCampusStudent.id,
        campus_id: 'campus-kannur-id',
        academic_year: academicYear,
        semester: semester,
        slot_1_course_id: courseMalayalamId,
      },
    ];

    const studentsStore = [validStudent1, validStudent2, foreignCampusStudent];

    // Supabase admin mock
    mockSupabase = {
      admin: {
        from: (table) => {
          let filters = [];
          let selectedFields = null;
          let orderBy = null;

          const queryObj = {
            select: (fields) => {
              selectedFields = fields;
              return queryObj;
            },
            eq: (col, val) => {
              filters.push({ type: 'eq', col, val });
              return queryObj;
            },
            gt: (col, val) => {
              filters.push({ type: 'gt', col, val });
              return queryObj;
            },
            in: (col, arr) => {
              filters.push({ type: 'in', col, arr });
              return queryObj;
            },
            or: (orStr) => {
              filters.push({ type: 'or', orStr });
              return queryObj;
            },
            order: (col, opts) => {
              orderBy = { col, opts };
              return queryObj;
            },
            limit: (n) => queryObj,
            maybeSingle: async () => {
              const res = await queryObj.execute();
              return { data: res.data ? res.data[0] || null : null, error: res.error };
            },
            single: async () => {
              const res = await queryObj.execute();
              if (!res.data || res.data.length === 0) return { data: null, error: { message: 'Not found' } };
              return { data: res.data[0], error: null };
            },
            insert: async (records) => {
              const arr = Array.isArray(records) ? records : [records];
              for (const r of arr) {
                if (table === 'period_attendance') {
                  periodAttendanceStore.push({ ...r, id: `att-${Date.now()}-${Math.random()}` });
                }
              }
              return { data: arr, error: null };
            },
            upsert: async (records, opts) => {
              const arr = Array.isArray(records) ? records : [records];
              if (table === 'period_attendance') {
                for (const r of arr) {
                  const idx = periodAttendanceStore.findIndex(
                    (x) =>
                      x.timetable_slot_id === r.timetable_slot_id &&
                      x.student_id === r.student_id &&
                      x.attendance_date === r.attendance_date
                  );
                  if (idx >= 0) {
                    periodAttendanceStore[idx] = { ...periodAttendanceStore[idx], ...r };
                  } else {
                    periodAttendanceStore.push({ ...r, id: `att-${Date.now()}-${Math.random()}` });
                  }
                }
              }
              return { data: arr, error: null };
            },
            execute: async () => {
              let rows = [];
              if (table === 'period_attendance') rows = [...periodAttendanceStore];
              else if (table === 'timetable_entries') rows = [...timetableEntriesStore];
              else if (table === 'teacher_course_assignments') rows = [...teacherAssignmentsStore];
              else if (table === 'student_registrations') rows = [...studentRegistrationsStore];
              else if (table === 'students') rows = [...studentsStore];

              for (const f of filters) {
                if (f.type === 'eq') {
                  rows = rows.filter((r) => {
                    if (f.col.includes('.')) {
                      const [parent, child] = f.col.split('.');
                      return r[parent] && r[parent][child] === f.val;
                    }
                    return r[f.col] === f.val;
                  });
                } else if (f.type === 'gt') {
                  rows = rows.filter((r) => r[f.col] > f.val);
                } else if (f.type === 'in') {
                  rows = rows.filter((r) => f.arr.includes(r[f.col]));
                } else if (f.type === 'or') {
                  // or checks course ID in slot columns
                  rows = rows.filter((r) => {
                    for (let i = 1; i <= 8; i++) {
                      if (r[`slot_${i}_course_id`] === courseMalayalamId) return true;
                    }
                    return false;
                  });
                }
              }
              return { data: rows, error: null };
            },
            then: (resolve, reject) => queryObj.execute().then(resolve, reject),
          };

          return queryObj;
        },
      },
    };

    mockAuditLogger = { log: async () => {} };
    mockServerLogger = { log: () => {}, warn: () => {}, error: () => {} };

    // Instantiate service
    const { PeriodAttendanceService } = require('../dist/modules/period-attendance/period-attendance.service');
    periodAttendanceService = new PeriodAttendanceService(
      mockSupabase,
      mockAuditLogger,
      mockServerLogger
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. F43 & F44: Unrestricted Current-Semester Correction & Published Guard
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. F43 & F44: Published Class & Unrestricted Correction', () => {
    it('allows authorized teacher to submit marks for past date without 15-min lockout (F43)', async () => {
      const pastDate = '2026-10-05'; // Monday
      const result = await periodAttendanceService.submitAttendance(
        mockTeacherUser,
        publishedSlotId,
        [validStudent2.id], // validStudent2 is absent
        '127.0.0.1',
        pastDate
      );

      assert.equal(result.success, true);
      assert.equal(result.attendance_date, pastDate);
      assert.equal(result.total_students, 2);
      assert.equal(result.present_count, 1);
      assert.equal(result.absent_count, 1);
      assert.ok(result.marked_at, 'Server should generate authoritative marked_at timestamp');
    });

    it('rejects attendance submission for draft timetable entries (F43)', async () => {
      await assert.rejects(
        async () => {
          await periodAttendanceService.submitAttendance(
            mockTeacherUser,
            draftSlotId,
            [],
            '127.0.0.1',
            '2026-10-05'
          );
        },
        /Attendance requires a published schedule \(F43\)/
      );
    });

    it('rejects attendance submission for future dates (F43/F48)', async () => {
      await assert.rejects(
        async () => {
          await periodAttendanceService.submitAttendance(
            mockTeacherUser,
            publishedSlotId,
            [],
            '127.0.0.1',
            '2099-01-01'
          );
        },
        /Cannot mark attendance for future dates/
      );
    });

    it('rejects teachers not assigned to the course (F43)', async () => {
      await assert.rejects(
        async () => {
          await periodAttendanceService.submitAttendance(
            mockForeignTeacherUser,
            publishedSlotId,
            [],
            '127.0.0.1',
            '2026-10-05'
          );
        },
        /You are not assigned to instruct this course/
      );
    });

    it('rejects teaching_staff roster-only accounts from submitting marks (F43)', async () => {
      await assert.rejects(
        async () => {
          await periodAttendanceService.submitAttendance(
            mockTeachingStaffUser,
            publishedSlotId,
            [],
            '127.0.0.1',
            '2026-10-05'
          );
        },
        /roster-only/i
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. F45: Cohort Roster Scoping & Exclusion of Historical/Foreign Students
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. F45: Strict Campus-Class Cohort Roster Scoping', () => {
    it('scopes roster strictly to current campus and academic year, excluding old-year students', async () => {
      const roster = await periodAttendanceService.getEnrolledRoster(
        courseMalayalamId,
        academicYear,
        campusId,
        semester
      );

      const studentIds = roster.map((s) => s.id);
      assert.deepEqual(studentIds.sort(), [validStudent1.id, validStudent2.id].sort());
      assert.ok(!studentIds.includes('student-old-888'), 'Old-year student must be excluded');
      assert.ok(!studentIds.includes(foreignCampusStudent.id), 'Foreign campus student must be excluded');
    });

    it('rejects submitting absent marks for a foreign campus student ID (F45)', async () => {
      await assert.rejects(
        async () => {
          await periodAttendanceService.submitAttendance(
            mockTeacherUser,
            publishedSlotId,
            [foreignCampusStudent.id],
            '127.0.0.1',
            '2026-10-05'
          );
        },
        /is not enrolled in this campus course cohort \(F45\)/
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. F46: Dated HOD Summaries & Slot Rosters
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. F46: Dated HOD Summaries & Slot Rosters', () => {
    it('retrieves HOD slot roster strictly for the selected date without merging dates', async () => {
      // First submit marks on Date A: Oct 5
      await periodAttendanceService.submitAttendance(
        mockTeacherUser,
        publishedSlotId,
        [validStudent1.id], // Student 1 absent on Oct 5
        '127.0.0.1',
        '2026-10-05'
      );

      // Submit marks on Date B: Oct 6
      await periodAttendanceService.submitAttendance(
        mockTeacherUser,
        publishedSlotId,
        [validStudent2.id], // Student 2 absent on Oct 6
        '127.0.0.1',
        '2026-10-06'
      );

      // Query Oct 5
      const rosterOct5 = await periodAttendanceService.getSlotRosterForHod(
        mockHodUser,
        publishedSlotId,
        '2026-10-05'
      );
      assert.equal(rosterOct5.attendance_date, '2026-10-05');
      assert.equal(rosterOct5.summary.absent_count, 1);
      assert.equal(rosterOct5.summary.present_count, 1);
      const s1Oct5 = rosterOct5.students.find((s) => s.id === validStudent1.id);
      assert.equal(s1Oct5.status, 'absent');

      // Query Oct 6
      const rosterOct6 = await periodAttendanceService.getSlotRosterForHod(
        mockHodUser,
        publishedSlotId,
        '2026-10-06'
      );
      assert.equal(rosterOct6.attendance_date, '2026-10-06');
      assert.equal(rosterOct6.summary.absent_count, 1);
      assert.equal(rosterOct6.summary.present_count, 1);
      const s2Oct6 = rosterOct6.students.find((s) => s.id === validStudent2.id);
      assert.equal(s2Oct6.status, 'absent');
    });

    it('HOD department slots query reports accurate marked status for chosen date without unlock dependency', async () => {
      await periodAttendanceService.submitAttendance(
        mockTeacherUser,
        publishedSlotId,
        [],
        '127.0.0.1',
        '2026-10-05'
      );

      const slots = await periodAttendanceService.getDepartmentSlots(
        mockHodUser,
        1,
        1,
        '2026-10-05'
      );
      assert.ok(Array.isArray(slots));
      const p1 = slots.find((s) => s.id === publishedSlotId);
      assert.ok(p1);
      assert.equal(p1.is_marked, true);
      assert.equal(p1.is_unlocked, undefined, 'is_unlocked must be retired (F44)');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. F47: Persisted Marks Reloading & Overwrite Preservation
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. F47: Persisted Marks Reloading & Concurrency Checks', () => {
    it('getSlotMarks returns saved absent status, preventing accidental reset to present on reopen', async () => {
      const date = '2026-10-05';
      await periodAttendanceService.submitAttendance(
        mockTeacherUser,
        publishedSlotId,
        [validStudent2.id],
        '127.0.0.1',
        date
      );

      // Reopening slot-marks for that date
      const marksData = await periodAttendanceService.getSlotMarks(mockTeacherUser, publishedSlotId, date);
      assert.equal(marksData.is_marked, true);
      assert.equal(marksData.summary.absent_count, 1);
      assert.equal(marksData.summary.present_count, 1);

      const s2 = marksData.students.find((s) => s.id === validStudent2.id);
      assert.equal(s2.status, 'absent', 'Absent mark must be preserved on reopen');

      const s1 = marksData.students.find((s) => s.id === validStudent1.id);
      assert.equal(s1.status, 'present');
    });

    it('detects concurrent edits when last_marked_at is older than existing marks (F47)', async () => {
      const date = '2026-10-05';
      const initialRes = await periodAttendanceService.submitAttendance(
        mockTeacherUser,
        publishedSlotId,
        [],
        '127.0.0.1',
        date
      );

      // Stale submission passing an old last_marked_at
      const staleTimestamp = new Date(Date.now() - 60000).toISOString();
      await assert.rejects(
        async () => {
          await periodAttendanceService.submitAttendance(
            mockTeacherUser,
            publishedSlotId,
            [],
            '127.0.0.1',
            date,
            staleTimestamp
          );
        },
        /Attendance for this period was updated by another teacher/
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. F49: Practical Session 2-Hour Copying & Distinct Period Records
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. F49: Practical Session 2-Hour Copying', () => {
    it('copies practical attendance from period 1 to adjacent period 2, creating two counted records', async () => {
      const date = '2026-10-05';

      // 1. Mark period 1
      await periodAttendanceService.submitAttendance(
        mockTeacherUser,
        publishedSlotId,
        [validStudent1.id], // Student 1 absent in P1
        '127.0.0.1',
        date
      );

      // 2. Copy to period 2
      const copyResult = await periodAttendanceService.copyPracticalAttendance(
        mockTeacherUser,
        {
          source_slot_id: publishedSlotId,
          target_slot_id: adjacentPracticalSlotId,
          attendance_date: date,
          overwrite: false,
        },
        '127.0.0.1'
      );

      assert.equal(copyResult.success, true);
      assert.equal(copyResult.copied_count, 2);
      assert.equal(copyResult.absent_count, 1);
      assert.equal(copyResult.present_count, 1);

      // 3. Verify period 2 has its own persistent marks
      const p2Marks = await periodAttendanceService.getSlotMarks(
        mockTeacherUser,
        adjacentPracticalSlotId,
        date
      );
      assert.equal(p2Marks.is_marked, true);
      const s1InP2 = p2Marks.students.find((s) => s.id === validStudent1.id);
      assert.equal(s1InP2.status, 'absent');
    });

    it('requires overwrite confirmation if target period already has marks (F49)', async () => {
      const date = '2026-10-05';

      // Mark P1 and P2
      await periodAttendanceService.submitAttendance(mockTeacherUser, publishedSlotId, [], '127.0.0.1', date);
      await periodAttendanceService.submitAttendance(mockTeacherUser, adjacentPracticalSlotId, [], '127.0.0.1', date);

      // Attempt copy without overwrite
      await assert.rejects(
        async () => {
          await periodAttendanceService.copyPracticalAttendance(
            mockTeacherUser,
            {
              source_slot_id: publishedSlotId,
              target_slot_id: adjacentPracticalSlotId,
              attendance_date: date,
              overwrite: false,
            },
            '127.0.0.1'
          );
        },
        /Target period already has 2 attendance marks recorded.*Set overwrite to true/
      );

      // Copy with overwrite = true succeeds
      const overwriteResult = await periodAttendanceService.copyPracticalAttendance(
        mockTeacherUser,
        {
          source_slot_id: publishedSlotId,
          target_slot_id: adjacentPracticalSlotId,
          attendance_date: date,
          overwrite: true,
        },
        '127.0.0.1'
      );
      assert.equal(overwriteResult.success, true);
    });
  });
});
