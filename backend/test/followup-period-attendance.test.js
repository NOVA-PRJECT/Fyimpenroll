/**
 * Follow-up Plan 07 Acceptance Test Suite
 *
 * Verifies Primary Findings:
 * - R03 (High): Practical-attendance copying lacks resource authorization and pair validation.
 * - R28 (Medium): Any-time attendance edits restricted to valid dated classes in retained active semester.
 * - R29 (Medium): Atomic optimistic concurrency CAS for mark submission and practical copying.
 *
 * Additional checks:
 * - GPS independence.
 * - Roster page completeness and foreign student rejection.
 * - Retired/concluded term repopulation lockout.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// Auth Personas
const authorizedTeacher = {
  userId: '11111111-1111-1111-1111-111111111111',
  role: 'teacher',
  department_id: 'dept-cs-main',
  campus_id: 'campus-main',
};

const unassignedTeacher = {
  userId: '22222222-2222-2222-2222-222222222222',
  role: 'teacher',
  department_id: 'dept-cs-main',
  campus_id: 'campus-main',
};

const visitingTeacherHostClass = {
  userId: '33333333-3333-3333-3333-333333333333',
  role: 'teacher',
  department_id: 'dept-cs-north',
  campus_id: 'campus-north', // home campus is north, but assigned to instruct at main
};

const foreignHod = {
  userId: '44444444-4444-4444-4444-444444444444',
  role: 'hod',
  department_id: 'dept-math-main', // Class belongs to dept-cs-main
  campus_id: 'campus-main',
};

const authorizedHod = {
  userId: '55555555-5555-5555-5555-555555555555',
  role: 'hod',
  department_id: 'dept-cs-main',
  campus_id: 'campus-main',
};

const teachingStaffRosterOnly = {
  userId: '66666666-6666-6666-6666-666666666666',
  role: 'teaching_staff',
  department_id: 'dept-cs-main',
  campus_id: 'campus-main',
};

describe('Follow-up Plan 07: Current-Semester Attendance, Practical Copying & Concurrent Edits (R03, R28, R29)', () => {
  let periodAttendanceService;
  let inMemoryDb;
  let auditLogs;

  const validMondayDate = '2026-10-05'; // Monday, day 1
  const earlierMondayDate = '2026-09-28'; // Monday, day 1

  beforeEach(() => {
    auditLogs = [];

    // Table stores
    const timetableEntriesStore = [
      // Approved practical pair: P1 & P2 on Monday
      {
        id: 'slot-lab-p1',
        course_id: 'course-os-lab',
        department_id: 'dept-cs-main',
        campus_id: 'campus-main',
        teacher_id: authorizedTeacher.userId,
        academic_year: '2025-26',
        semester: 1,
        status: 'published',
        session_type: 'practical',
        is_lab_block: true,
        courses: { id: 'course-os-lab', course_code: 'CS101L', title: 'OS Lab', semester: 1 },
        time_slots: { id: 'ts-1', day_of_week: 1, period_number: 1, start_time: '09:30:00', end_time: '10:30:00' },
        departments: { id: 'dept-cs-main', campus_id: 'campus-main' },
      },
      {
        id: 'slot-lab-p2',
        course_id: 'course-os-lab',
        department_id: 'dept-cs-main',
        campus_id: 'campus-main',
        teacher_id: authorizedTeacher.userId,
        academic_year: '2025-26',
        semester: 1,
        status: 'published',
        session_type: 'practical',
        is_lab_block: true,
        courses: { id: 'course-os-lab', course_code: 'CS101L', title: 'OS Lab', semester: 1 },
        time_slots: { id: 'ts-2', day_of_week: 1, period_number: 2, start_time: '10:30:00', end_time: '11:30:00' },
        departments: { id: 'dept-cs-main', campus_id: 'campus-main' },
      },
      // Theory session at P1
      {
        id: 'slot-theory-p1',
        course_id: 'course-os-lab',
        department_id: 'dept-cs-main',
        campus_id: 'campus-main',
        teacher_id: authorizedTeacher.userId,
        academic_year: '2025-26',
        semester: 1,
        status: 'published',
        session_type: 'theory',
        is_lab_block: false,
        courses: { id: 'course-os-lab', course_code: 'CS101L', title: 'OS Lab', semester: 1 },
        time_slots: { id: 'ts-1', day_of_week: 1, period_number: 1, start_time: '09:30:00', end_time: '10:30:00' },
        departments: { id: 'dept-cs-main', campus_id: 'campus-main' },
      },
      // Non-adjacent practical at P6
      {
        id: 'slot-lab-p6',
        course_id: 'course-os-lab',
        department_id: 'dept-cs-main',
        campus_id: 'campus-main',
        teacher_id: authorizedTeacher.userId,
        academic_year: '2025-26',
        semester: 1,
        status: 'published',
        session_type: 'practical',
        is_lab_block: true,
        courses: { id: 'course-os-lab', course_code: 'CS101L', title: 'OS Lab', semester: 1 },
        time_slots: { id: 'ts-6', day_of_week: 1, period_number: 6, start_time: '15:30:00', end_time: '16:30:00' },
        departments: { id: 'dept-cs-main', campus_id: 'campus-main' },
      },
      // Lunch boundary pair: P3 & P4
      {
        id: 'slot-lab-p3',
        course_id: 'course-os-lab',
        department_id: 'dept-cs-main',
        campus_id: 'campus-main',
        teacher_id: authorizedTeacher.userId,
        academic_year: '2025-26',
        semester: 1,
        status: 'published',
        session_type: 'practical',
        is_lab_block: true,
        courses: { id: 'course-os-lab', course_code: 'CS101L', title: 'OS Lab', semester: 1 },
        time_slots: { id: 'ts-3', day_of_week: 1, period_number: 3, start_time: '11:30:00', end_time: '12:30:00' },
        departments: { id: 'dept-cs-main', campus_id: 'campus-main' },
      },
      {
        id: 'slot-lab-p4',
        course_id: 'course-os-lab',
        department_id: 'dept-cs-main',
        campus_id: 'campus-main',
        teacher_id: authorizedTeacher.userId,
        academic_year: '2025-26',
        semester: 1,
        status: 'published',
        session_type: 'practical',
        is_lab_block: true,
        courses: { id: 'course-os-lab', course_code: 'CS101L', title: 'OS Lab', semester: 1 },
        time_slots: { id: 'ts-4', day_of_week: 1, period_number: 4, start_time: '13:30:00', end_time: '14:30:00' },
        departments: { id: 'dept-cs-main', campus_id: 'campus-main' },
      },
      // Visiting teacher delivery class at campus-main
      {
        id: 'slot-visiting-p1',
        course_id: 'course-visiting-lab',
        department_id: 'dept-cs-main',
        campus_id: 'campus-main',
        teacher_id: null,
        academic_year: '2025-26',
        semester: 1,
        status: 'published',
        session_type: 'practical',
        is_lab_block: true,
        courses: { id: 'course-visiting-lab', course_code: 'VLAB101', title: 'Visiting Lab', semester: 1 },
        time_slots: { id: 'ts-1', day_of_week: 1, period_number: 1, start_time: '09:30:00', end_time: '10:30:00' },
        departments: { id: 'dept-cs-main', campus_id: 'campus-main' },
      },
      // Draft slot
      {
        id: 'slot-draft-p1',
        course_id: 'course-os-lab',
        department_id: 'dept-cs-main',
        campus_id: 'campus-main',
        teacher_id: authorizedTeacher.userId,
        academic_year: '2025-26',
        semester: 1,
        status: 'draft',
        session_type: 'practical',
        is_lab_block: true,
        courses: { id: 'course-os-lab', course_code: 'CS101L', title: 'OS Lab', semester: 1 },
        time_slots: { id: 'ts-1', day_of_week: 1, period_number: 1, start_time: '09:30:00', end_time: '10:30:00' },
        departments: { id: 'dept-cs-main', campus_id: 'campus-main' },
      },
    ];

    const teacherAssignmentsStore = [
      {
        id: 'assign-auth-lab',
        teacher_id: authorizedTeacher.userId,
        course_id: 'course-os-lab',
        campus_id: 'campus-main',
        academic_year: '2025-26',
        semester: 1,
      },
      {
        id: 'assign-auth-theory',
        teacher_id: authorizedTeacher.userId,
        course_id: 'course-os-theory',
        campus_id: 'campus-main',
        academic_year: '2025-26',
        semester: 1,
      },
      // Visiting teacher assigned to campus-main delivery
      {
        id: 'assign-visiting',
        teacher_id: visitingTeacherHostClass.userId,
        course_id: 'course-visiting-lab',
        campus_id: 'campus-main',
        academic_year: '2025-26',
        semester: 1,
      },
    ];

    const studentRegistrationsStore = [
      {
        student_id: 'stu-001',
        campus_id: 'campus-main',
        academic_year: '2025-26',
        semester: 1,
        slot_1_course_id: 'course-os-lab',
        slot_2_course_id: 'course-os-theory',
        slot_3_course_id: 'course-visiting-lab',
      },
      {
        student_id: 'stu-002',
        campus_id: 'campus-main',
        academic_year: '2025-26',
        semester: 1,
        slot_1_course_id: 'course-os-lab',
        slot_2_course_id: 'course-os-theory',
        slot_3_course_id: 'course-visiting-lab',
      },
    ];

    const studentsStore = [
      { id: 'stu-001', full_name: 'Ananya Sharma', cap_application_number: 'CAP001', current_semester: 1, campus_id: 'campus-main' },
      { id: 'stu-002', full_name: 'Basil Thomas', cap_application_number: 'CAP002', current_semester: 1, campus_id: 'campus-main' },
    ];

    const periodAttendanceStore = [];
    const periodAttendanceSessionsStore = [];
    const retiredCohortsStore = [];
    const campusSettingsStore = [
      { campus_id: 'campus-main', academic_year: '2025-26' },
    ];

    // Mock Database Client
    inMemoryDb = {
      admin: {
        from: (table) => {
          let filters = [];
          const query = {
            select: () => query,
            eq: (col, val) => { filters.push({ type: 'eq', col, val }); return query; },
            in: (col, arr) => { filters.push({ type: 'in', col, arr }); return query; },
            gt: (col, val) => { filters.push({ type: 'gt', col, val }); return query; },
            or: (orStr) => { filters.push({ type: 'or', orStr }); return query; },
            order: () => query,
            limit: () => query,
            maybeSingle: async () => {
              const res = await query.execute();
              return { data: res.data ? res.data[0] || null : null, error: res.error };
            },
            single: async () => {
              const res = await query.execute();
              return { data: res.data && res.data.length > 0 ? res.data[0] : null, error: null };
            },
            upsert: async (records) => {
              const arr = Array.isArray(records) ? records : [records];
              if (table === 'period_attendance') {
                for (const r of arr) {
                  const idx = periodAttendanceStore.findIndex(
                    (x) => x.timetable_slot_id === r.timetable_slot_id &&
                           x.student_id === r.student_id &&
                           x.attendance_date === r.attendance_date
                  );
                  if (idx >= 0) periodAttendanceStore[idx] = { ...periodAttendanceStore[idx], ...r };
                  else periodAttendanceStore.push({ ...r, id: `att-${Date.now()}-${Math.random()}` });
                }
              } else if (table === 'period_attendance_sessions') {
                for (const r of arr) {
                  const idx = periodAttendanceSessionsStore.findIndex(
                    (x) => x.timetable_slot_id === r.timetable_slot_id && x.attendance_date === r.attendance_date
                  );
                  if (idx >= 0) periodAttendanceSessionsStore[idx] = { ...periodAttendanceSessionsStore[idx], ...r };
                  else periodAttendanceSessionsStore.push({ ...r, id: `sess-${Date.now()}` });
                }
              } else if (table === 'retired_cohorts') {
                for (const r of arr) {
                  const idx = retiredCohortsStore.findIndex(
                    (x) => x.campus_id === r.campus_id && x.academic_year === r.academic_year && x.semester === r.semester
                  );
                  if (idx >= 0) retiredCohortsStore[idx] = { ...retiredCohortsStore[idx], ...r };
                  else retiredCohortsStore.push({ ...r, id: `ret-${Date.now()}` });
                }
              }
              return { data: arr, error: null };
            },
            execute: async () => {
              let rows = [];
              if (table === 'timetable_entries') rows = [...timetableEntriesStore];
              else if (table === 'teacher_course_assignments') rows = [...teacherAssignmentsStore];
              else if (table === 'student_registrations') rows = [...studentRegistrationsStore];
              else if (table === 'students') rows = [...studentsStore];
              else if (table === 'period_attendance') rows = [...periodAttendanceStore];
              else if (table === 'period_attendance_sessions') rows = [...periodAttendanceSessionsStore];
              else if (table === 'retired_cohorts') rows = [...retiredCohortsStore];
              else if (table === 'campus_settings') rows = [...campusSettingsStore];

              for (const f of filters) {
                if (f.type === 'eq') {
                  rows = rows.filter((r) => r[f.col] === f.val);
                } else if (f.type === 'gt') {
                  rows = rows.filter((r) => r[f.col] > f.val);
                } else if (f.type === 'in') {
                  rows = rows.filter((r) => f.arr.includes(r[f.col]));
                } else if (f.type === 'or') {
                  rows = rows.filter((r) => {
                    for (let i = 1; i <= 8; i++) {
                      if (r[`slot_${i}_course_id`]) return true;
                    }
                    return false;
                  });
                }
              }
              return { data: rows, error: null };
            },
            then: (resolve, reject) => query.execute().then(resolve, reject),
          };
          return query;
        },
      },
    };

    const mockAudit = {
      log: async (entry) => { auditLogs.push(entry); },
    };

    const { PeriodAttendanceService } = require('../dist/modules/period-attendance/period-attendance.service');
    periodAttendanceService = new PeriodAttendanceService(inMemoryDb, mockAudit);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Finding R03: Resource Authorization & Valid Practical Pairing
  // ───────────────────────────────────────────────────────────────────────────
  describe('Finding R03: Class Authorization & Valid Practical Pairing', () => {
    it('unassigned teacher cannot inspect marks or copy attendance', async () => {
      // getSlotMarks rejected
      await assert.rejects(
        async () => {
          await periodAttendanceService.getSlotMarks(unassignedTeacher, 'slot-lab-p1', validMondayDate);
        },
        /You are not assigned to instruct this course/
      );

      // copy rejected
      await assert.rejects(
        async () => {
          await periodAttendanceService.copyPracticalAttendance(
            unassignedTeacher,
            { source_slot_id: 'slot-lab-p1', target_slot_id: 'slot-lab-p2', attendance_date: validMondayDate },
            '127.0.0.1'
          );
        },
        /You are not assigned to instruct this course/
      );
    });

    it('foreign HOD cannot inspect marks or copy attendance for another department', async () => {
      await assert.rejects(
        async () => {
          await periodAttendanceService.getSlotMarks(foreignHod, 'slot-lab-p1', validMondayDate);
        },
        /Cannot manage attendance for another department/
      );

      await assert.rejects(
        async () => {
          await periodAttendanceService.copyPracticalAttendance(
            foreignHod,
            { source_slot_id: 'slot-lab-p1', target_slot_id: 'slot-lab-p2', attendance_date: validMondayDate },
            '127.0.0.1'
          );
        },
        /Cannot manage attendance for another department/
      );
    });

    it('visiting teacher can mark their assigned delivery class, but cannot access unassigned delivery', async () => {
      // Allowed on assigned visiting class
      const visitMarks = await periodAttendanceService.getSlotMarks(
        visitingTeacherHostClass,
        'slot-visiting-p1',
        validMondayDate
      );
      assert.strictEqual(visitMarks.slot.id, 'slot-visiting-p1');

      // Rejected on unassigned class
      await assert.rejects(
        async () => {
          await periodAttendanceService.getSlotMarks(
            visitingTeacherHostClass,
            'slot-lab-p1',
            validMondayDate
          );
        },
        /You are not assigned to instruct this course/
      );
    });

    it('rejects practical copy when either period is a theory session', async () => {
      // Mark theory session at P1
      await periodAttendanceService.submitAttendance(
        authorizedTeacher,
        'slot-theory-p1',
        [],
        '127.0.0.1',
        validMondayDate
      );

      // Attempt copy from theory P1 to lab P2
      await assert.rejects(
        async () => {
          await periodAttendanceService.copyPracticalAttendance(
            authorizedTeacher,
            { source_slot_id: 'slot-theory-p1', target_slot_id: 'slot-lab-p2', attendance_date: validMondayDate },
            '127.0.0.1'
          );
        },
        /Practical attendance copying is only allowed between practical \/ lab sessions \(R03\)/
      );
    });

    it('rejects lunch-crossing copy between Period 3 and Period 4', async () => {
      // Mark P3 lab
      await periodAttendanceService.submitAttendance(
        authorizedTeacher,
        'slot-lab-p3',
        [],
        '127.0.0.1',
        validMondayDate
      );

      // Attempt copy from P3 to P4 across lunch boundary
      await assert.rejects(
        async () => {
          await periodAttendanceService.copyPracticalAttendance(
            authorizedTeacher,
            { source_slot_id: 'slot-lab-p3', target_slot_id: 'slot-lab-p4', attendance_date: validMondayDate },
            '127.0.0.1'
          );
        },
        /Cannot copy practical attendance across lunch boundary \(Period 3 to Period 4 is forbidden\) \(R03\)/
      );
    });

    it('rejects non-adjacent practical copy between Period 1 and Period 6', async () => {
      // Mark P1 lab
      await periodAttendanceService.submitAttendance(
        authorizedTeacher,
        'slot-lab-p1',
        [],
        '127.0.0.1',
        validMondayDate
      );

      // Attempt copy from P1 to P6
      await assert.rejects(
        async () => {
          await periodAttendanceService.copyPracticalAttendance(
            authorizedTeacher,
            { source_slot_id: 'slot-lab-p1', target_slot_id: 'slot-lab-p6', attendance_date: validMondayDate },
            '127.0.0.1'
          );
        },
        /Invalid practical period pair \(Period 1 to Period 6\)/
      );
    });

    it('authorized practical copy on adjacent P1-P2 succeeds and creates distinct counted marks', async () => {
      // 1. Mark Period 1 with Student 2 absent
      const p1Res = await periodAttendanceService.submitAttendance(
        authorizedTeacher,
        'slot-lab-p1',
        ['stu-002'],
        '127.0.0.1',
        validMondayDate
      );
      assert.strictEqual(p1Res.success, true);
      assert.strictEqual(p1Res.present_count, 1);
      assert.strictEqual(p1Res.absent_count, 1);

      // 2. Copy practical marks to Period 2
      const copyRes = await periodAttendanceService.copyPracticalAttendance(
        authorizedTeacher,
        {
          source_slot_id: 'slot-lab-p1',
          target_slot_id: 'slot-lab-p2',
          attendance_date: validMondayDate,
          overwrite: false,
        },
        '127.0.0.1'
      );

      assert.strictEqual(copyRes.success, true);
      assert.strictEqual(copyRes.copied_count, 2);
      assert.strictEqual(copyRes.present_count, 1);
      assert.strictEqual(copyRes.absent_count, 1);

      // 3. Verify Period 2 has its own persistent distinct marks
      const p2Marks = await periodAttendanceService.getSlotMarks(
        authorizedTeacher,
        'slot-lab-p2',
        validMondayDate
      );
      assert.strictEqual(p2Marks.is_marked, true);
      assert.strictEqual(p2Marks.summary.present_count, 1);
      assert.strictEqual(p2Marks.summary.absent_count, 1);
      const stu2Mark = p2Marks.students.find((s) => s.id === 'stu-002');
      assert.strictEqual(stu2Mark.status, 'absent');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Finding R28: Calendar Date & Scheduled Weekday Validation in Active Term
  // ───────────────────────────────────────────────────────────────────────────
  describe('Finding R28: Date & Weekday Alignment in Active Term Scope', () => {
    it('allows editing past valid date in the active semester at any unrestricted time', async () => {
      const pastMonday = earlierMondayDate; // Sep 28
      const res = await periodAttendanceService.submitAttendance(
        authorizedTeacher,
        'slot-lab-p1',
        [],
        '127.0.0.1',
        pastMonday
      );
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.attendance_date, pastMonday);
    });

    it('rejects impossible Gregorian dates (e.g. Feb 30, Nov 31)', async () => {
      await assert.rejects(
        async () => {
          await periodAttendanceService.submitAttendance(
            authorizedTeacher,
            'slot-lab-p1',
            [],
            '127.0.0.1',
            '2026-02-30'
          );
        },
        /Invalid calendar date '2026-02-30'/
      );

      await assert.rejects(
        async () => {
          await periodAttendanceService.submitAttendance(
            authorizedTeacher,
            'slot-lab-p1',
            [],
            '127.0.0.1',
            '2026-11-31'
          );
        },
        /Invalid calendar date '2026-11-31'/
      );
    });

    it('rejects mismatched weekday for a scheduled slot', async () => {
      // slot-lab-p1 is scheduled for Day 1 (Monday). 2026-10-06 is Tuesday (Day 2).
      await assert.rejects(
        async () => {
          await periodAttendanceService.submitAttendance(
            authorizedTeacher,
            'slot-lab-p1',
            [],
            '127.0.0.1',
            '2026-10-06'
          );
        },
        /Attendance date 2026-10-06 falls on day 2, but scheduled slot is for day 1 \(R28\)/
      );
    });

    it('rejects draft timetable entries from attendance marking', async () => {
      await assert.rejects(
        async () => {
          await periodAttendanceService.submitAttendance(
            authorizedTeacher,
            'slot-draft-p1',
            [],
            '127.0.0.1',
            validMondayDate
          );
        },
        /Attendance requires a published schedule/
      );
    });

    it('rejects attendance submission or copying for retired cohorts', async () => {
      // Mark cohort as retired in registry
      await periodAttendanceService.retireCohort(
        'campus-main',
        '2025-26',
        1,
        authorizedHod.userId,
        'Semester 1 concluded'
      );

      // Submission rejected
      await assert.rejects(
        async () => {
          await periodAttendanceService.submitAttendance(
            authorizedTeacher,
            'slot-lab-p1',
            [],
            '127.0.0.1',
            validMondayDate
          );
        },
        /Cannot record attendance: cohort \(2025-26 Semester 1 for campus campus-main\) is retired or concluded \(R28\)/
      );

      // Practical copy rejected
      await assert.rejects(
        async () => {
          await periodAttendanceService.copyPracticalAttendance(
            authorizedTeacher,
            { source_slot_id: 'slot-lab-p1', target_slot_id: 'slot-lab-p2', attendance_date: validMondayDate },
            '127.0.0.1'
          );
        },
        /is retired or concluded/
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Finding R29: Atomic Optimistic Concurrency with Revision Compare-and-Swap
  // ───────────────────────────────────────────────────────────────────────────
  describe('Finding R29: Atomic Optimistic Concurrency & Revision Tokens', () => {
    it('initial submission creates Revision 1 and returns distinct revision token', async () => {
      const res = await periodAttendanceService.submitAttendance(
        authorizedTeacher,
        'slot-lab-p1',
        ['stu-001'],
        '127.0.0.1',
        validMondayDate
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.revision, 1);
      assert.ok(res.revision_token, 'Must return non-empty revision token');

      const marks = await periodAttendanceService.getSlotMarks(
        authorizedTeacher,
        'slot-lab-p1',
        validMondayDate
      );
      assert.strictEqual(marks.revision, 1);
      assert.strictEqual(marks.revision_token, res.revision_token);
    });

    it('subsequent submission requires expected revision and detects stale concurrent edit', async () => {
      // Teacher A marks initial attendance (creates rev 1)
      const res1 = await periodAttendanceService.submitAttendance(
        authorizedTeacher,
        'slot-lab-p1',
        [],
        '127.0.0.1',
        validMondayDate
      );
      assert.strictEqual(res1.revision, 1);

      // Teacher A updates attendance based on Rev 1 (advances to rev 2)
      const res2 = await periodAttendanceService.submitAttendance(
        authorizedTeacher,
        'slot-lab-p1',
        ['stu-002'],
        '127.0.0.1',
        validMondayDate,
        undefined,
        1 // expected_revision = 1
      );
      assert.strictEqual(res2.revision, 2);

      // Teacher B attempts update based on stale expected_revision = 1 -> Conflict!
      await assert.rejects(
        async () => {
          await periodAttendanceService.submitAttendance(
            authorizedTeacher,
            'slot-lab-p1',
            ['stu-001'],
            '127.0.0.1',
            validMondayDate,
            undefined,
            1 // stale revision token
          );
        },
        /revision mismatch: current 2, expected 1/
      );

      // Teacher B refreshes and submits based on current revision 2 -> Success!
      const res3 = await periodAttendanceService.submitAttendance(
        authorizedTeacher,
        'slot-lab-p1',
        ['stu-001'],
        '127.0.0.1',
        validMondayDate,
        undefined,
        2 // current revision token
      );
      assert.strictEqual(res3.revision, 3);
    });

    it('practical copy requires expected target revision to overwrite existing target marks', async () => {
      // 1. Mark source P1
      await periodAttendanceService.submitAttendance(
        authorizedTeacher,
        'slot-lab-p1',
        ['stu-001'],
        '127.0.0.1',
        validMondayDate
      );

      // 2. Mark target P2 directly (creates target rev 1)
      await periodAttendanceService.submitAttendance(
        authorizedTeacher,
        'slot-lab-p2',
        ['stu-002'],
        '127.0.0.1',
        validMondayDate
      );

      // 3. Attempt copy without expected revision and overwrite false -> Conflict
      await assert.rejects(
        async () => {
          await periodAttendanceService.copyPracticalAttendance(
            authorizedTeacher,
            {
              source_slot_id: 'slot-lab-p1',
              target_slot_id: 'slot-lab-p2',
              attendance_date: validMondayDate,
              overwrite: false,
            },
            '127.0.0.1'
          );
        },
        /Target period already has 2 attendance marks recorded/
      );

      // 4. Copy with stale target revision -> Conflict
      await assert.rejects(
        async () => {
          await periodAttendanceService.copyPracticalAttendance(
            authorizedTeacher,
            {
              source_slot_id: 'slot-lab-p1',
              target_slot_id: 'slot-lab-p2',
              attendance_date: validMondayDate,
              expected_target_revision: 99,
            },
            '127.0.0.1'
          );
        },
        /Target period revision mismatch \(current 1, expected 99\)/
      );

      // 5. Copy with matching target revision 1 -> Advances target to rev 2
      const copyRes = await periodAttendanceService.copyPracticalAttendance(
        authorizedTeacher,
        {
          source_slot_id: 'slot-lab-p1',
          target_slot_id: 'slot-lab-p2',
          attendance_date: validMondayDate,
          expected_target_revision: 1,
        },
        '127.0.0.1'
      );

      assert.strictEqual(copyRes.success, true);
      assert.strictEqual(copyRes.target_revision, 2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Operational Invariants: Roster Completeness & GPS Independence
  // ───────────────────────────────────────────────────────────────────────────
  describe('Operational Invariants: Roster Scoping & GPS Independence', () => {
    it('rejects absent student IDs outside the course cohort roster', async () => {
      await assert.rejects(
        async () => {
          await periodAttendanceService.submitAttendance(
            authorizedTeacher,
            'slot-lab-p1',
            ['stu-foreign-999'],
            '127.0.0.1',
            validMondayDate
          );
        },
        /Student ID stu-foreign-999 is not enrolled in this campus course cohort \(F45\)/
      );
    });

    it('GPS campus sign-in operates completely independent of classroom period marks', async () => {
      // Submitting classroom attendance does not check or mutate campus GPS sign-ins
      const res = await periodAttendanceService.submitAttendance(
        authorizedTeacher,
        'slot-lab-p1',
        [],
        '127.0.0.1',
        validMondayDate
      );
      assert.strictEqual(res.success, true);

      // Slot marks inspection requires no GPS sign-in records
      const marks = await periodAttendanceService.getSlotMarks(
        authorizedTeacher,
        'slot-lab-p1',
        validMondayDate
      );
      assert.strictEqual(marks.is_marked, true);
      assert.strictEqual(marks.students.length, 2);
    });
  });
});
