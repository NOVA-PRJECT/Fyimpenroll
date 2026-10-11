import type {
  AIGeneratorResponse,
  CourseNode,
  ValidationViolation,
  SlotMap,
  ParallelGroup,
  TeacherReservation,
  EffectiveRuleDocument,
  RuleDefinition,
} from './types';
import { buildCampusPaperGroups, CAMPUS_WIDE_CATEGORIES } from './campus-paper-groups';

export function validateTimetable(
  response: AIGeneratorResponse,
  courses: CourseNode[],
  slotMap: SlotMap,
  parallelGroups: ParallelGroup[] = [],
  teacherReservations: TeacherReservation[] = [],
  options?: {
    semester?: number;
    effectiveRules?: EffectiveRuleDocument | RuleDefinition[];
  }
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  const courseMap = new Map(courses.map((c) => [c.courseId, c]));
  const semester = options?.semester;

  // Extract rules if provided
  let rulesList: RuleDefinition[] = [];
  if (options?.effectiveRules) {
    if (Array.isArray(options.effectiveRules)) {
      rulesList = options.effectiveRules;
    } else if (options.effectiveRules.rules) {
      rulesList = options.effectiveRules.rules;
    }
  }

  // F36: Complete coverage check — ensure every course with contact hours is scheduled
  for (const course of courses) {
    if (course.theoryHours > 0 || course.practicalHours > 0) {
      const assignment = response.assignments.find((a) => a.courseId === course.courseId);
      if (!assignment || assignment.slots.length === 0) {
        violations.push({
          type: 'unplaced_course',
          courseId: course.courseId,
          detail: `Course ${course.courseCode} has ${course.theoryHours} theory and ${course.practicalHours} practical hours but was not scheduled.`,
        });
      }
    }
  }

  // Build: studentId → Set of (day-period) strings assigned to them
  const studentSchedule = new Map<string, Set<string>>();
  // F37: Build teacherId → Set of (day-period) strings assigned to them
  const teacherSchedule = new Map<string, Set<string>>();

  // Extract campus/global time limit rules (R19)
  const timeLimitRules = rulesList.filter(
    (r) => r.kind === 'CAMPUS_TIME_LIMIT' || r.kind === 'DAY_WINDOW'
  );

  for (const assignment of response.assignments) {
    const course = courseMap.get(assignment.courseId);
    if (!course) continue;

    const category = (course.category || '').toUpperCase().trim();
    if (category === 'MDC' && (course.practicalHours !== 0 || (semester === 1 && course.theoryHours !== 3))) {
      violations.push({ type: 'hours_mismatch', courseId: course.courseId,
        detail: `Course ${course.courseCode} (MDC) must have no practical hours; Semester 1 requires 3 theory hours. Correct the course catalogue before publication.` });
    }
    const categoryWindows = rulesList.filter(r => r.kind === 'CATEGORY_WINDOW' && r.isHard &&
      (!r.targetSemester || r.targetSemester === semester) &&
      (!r.targetCategory || r.targetCategory.toUpperCase().trim() === category) &&
      (!r.targetCourseId || r.targetCourseId === course.courseId) &&
      (!r.targetDepartmentId || r.targetDepartmentId === course.departmentId) &&
      (!r.parameters?.courseCodes || r.parameters.courseCodes.includes(course.courseCode)));
    let theoryCount = 0;
    let practicalCount = 0;
    const seenSlotsInCourse = new Set<string>();

    for (const slot of assignment.slots) {
      // F36: Domain validation (Days 1-5, Periods 1-6)
      if (slot.day < 1 || slot.day > 5 || slot.period < 1 || slot.period > 6) {
        violations.push({
          type: 'hours_mismatch',
          courseId: assignment.courseId,
          day: slot.day,
          period: slot.period,
          detail: `Invalid slot Day ${slot.day} Period ${slot.period} outside operational timetable domain (Mon-Fri, P1-P6).`,
        });
        continue;
      }

      // R19: Enforce dynamic time limit rules (e.g. limiting to Friday P6)
      for (const tRule of timeLimitRules) {
        if (tRule.isHard) {
          const params = tRule.parameters || {};
          const allowedDays: number[] | undefined = params.days || params.allowed_days;
          const allowedPeriods: number[] | undefined = params.periods || params.allowed_periods;

          if (allowedDays && !allowedDays.includes(slot.day)) {
            violations.push({
              type: 'invalid_window',
              courseId: assignment.courseId,
              day: slot.day,
              period: slot.period,
              detail: `Slot Day ${slot.day} Period ${slot.period} for ${course.courseCode} violates hard time limit rule "${tRule.id}" (allowed days: ${allowedDays.join(', ')}).`,
            });
          }
          if (allowedPeriods && !allowedPeriods.includes(slot.period)) {
            violations.push({
              type: 'invalid_window',
              courseId: assignment.courseId,
              day: slot.day,
              period: slot.period,
              detail: `Slot Day ${slot.day} Period ${slot.period} for ${course.courseCode} violates hard time limit rule "${tRule.id}" (allowed periods: ${allowedPeriods.join(', ')}).`,
            });
          }
        }
      }

      // R17: Semester 1 AEC restriction — strictly on Tuesdays (2) and/or Wednesdays (3) during afternoon (P4, P5, P6)
      for (const rule of categoryWindows) {
        const params = rule.parameters || {};
        const days: number[] | undefined = params.days || params.allowed_days;
        const periods: number[] | undefined = params.periods || params.allowed_periods;
        if ((days && !days.includes(slot.day)) || (periods && !periods.includes(slot.period))) {
          violations.push({ type: 'invalid_window', courseId: course.courseId, day: slot.day, period: slot.period,
            detail: `Course ${course.courseCode} violates hard category window "${rule.id}" at Day ${slot.day} Period ${slot.period}.` });
        }
      }

      if (semester === 1 && category === 'AEC') {
        const paperDay = course.courseCode === 'KU01AECENG101' ? 2 : course.courseCode === 'KU01AECENG102' ? 3 : undefined;
        const isAllowedDay = paperDay ? slot.day === paperDay : slot.day === 2 || slot.day === 3;
        const isAllowedPeriod = slot.period >= 4 && slot.period <= 6;
        if (!isAllowedDay || !isAllowedPeriod) {
          violations.push({
            type: 'invalid_window',
            courseId: assignment.courseId,
            day: slot.day,
            period: slot.period,
            detail: `Course ${course.courseCode} (AEC) slot Day ${slot.day} Period ${slot.period} violates Semester 1 mandatory window (${paperDay ? (paperDay === 2 ? 'Tuesday' : 'Wednesday') : 'Tuesday/Wednesday'} P4-P6).`,
          });
        }
      }

      // R18: Semester 3 VAC restriction — strictly on Mondays (1) during Periods 5 and 6 (P5+P6) for ALL session periods
      if (semester === 3 && category === 'VAC') {
        const isAllowed = slot.day === 1 && (slot.period === 5 || slot.period === 6);
        if (!isAllowed) {
          violations.push({
            type: 'invalid_window',
            courseId: assignment.courseId,
            day: slot.day,
            period: slot.period,
            detail: `Course ${course.courseCode} (VAC) slot Day ${slot.day} Period ${slot.period} violates Semester 3 mandatory window (strictly Monday P5+P6).`,
          });
        }
      }

      const key = `${slot.day}-${slot.period}`;

      // F36: Duplicate assignment check in same course
      if (seenSlotsInCourse.has(key)) {
        violations.push({
          type: 'hours_mismatch',
          courseId: assignment.courseId,
          day: slot.day,
          period: slot.period,
          detail: `Course ${course.courseCode} has duplicate assignment at Day ${slot.day} Period ${slot.period}.`,
        });
      } else {
        seenSlotsInCourse.add(key);
      }

      // Count hours
      if (slot.sessionType === 'theory') theoryCount++;
      if (slot.sessionType === 'practical') practicalCount++;

      // Lunch overlap check
      if (
        slot.period === 4 &&
        assignment.slots.some(
          (s) => s.day === slot.day && s.period === 3 && s.isLabBlock
        )
      ) {
        violations.push({
          type: 'lunch_overlap',
          courseId: assignment.courseId,
          day: slot.day,
          period: slot.period,
          detail: `Course ${course.courseCode} has a lab block spanning P3→P4 (crosses lunch break)`,
        });
      }

      // Student conflict check
      for (const studentId of course.studentIds) {
        if (!studentSchedule.has(studentId)) {
          studentSchedule.set(studentId, new Set());
        }
        if (studentSchedule.get(studentId)!.has(key)) {
          violations.push({
            type: 'student_conflict',
            courseId: assignment.courseId,
            studentId,
            day: slot.day,
            period: slot.period,
            detail: `Student ${studentId} has two courses at Day ${slot.day} Period ${slot.period} including ${course.courseCode}`,
          });
        } else {
          studentSchedule.get(studentId)!.add(key);
        }
      }

      // F37: Shared Teacher Conflict check (within current timetable)
      if (course.teacherId) {
        if (!teacherSchedule.has(course.teacherId)) {
          teacherSchedule.set(course.teacherId, new Set());
        }
        if (teacherSchedule.get(course.teacherId)!.has(key)) {
          violations.push({
            type: 'teacher_conflict',
            courseId: assignment.courseId,
            teacherId: course.teacherId,
            day: slot.day,
            period: slot.period,
            detail: `Teacher ${course.teacherId} is scheduled for multiple courses at Day ${slot.day} Period ${slot.period} including ${course.courseCode}`,
          });
        } else {
          teacherSchedule.get(course.teacherId)!.add(key);
        }
      }
    }

    // Hours mismatch check
    if (theoryCount !== course.theoryHours) {
      violations.push({
        type: 'hours_mismatch',
        courseId: assignment.courseId,
        detail: `Course ${course.courseCode} needs ${course.theoryHours} theory hours but got ${theoryCount}`,
      });
    }
    if (practicalCount !== course.practicalHours) {
      violations.push({
        type: 'hours_mismatch',
        courseId: assignment.courseId,
        detail: `Course ${course.courseCode} needs ${course.practicalHours} practical hours but got ${practicalCount}`,
      });
    }

    // Semester 1 MDC rule: "split into a 2-hour continuous session on one day and a 1-hour session on another day"
    if (semester === 1 && category === 'MDC' && course.theoryHours === 3 && course.practicalHours === 0) {
      const slotsByDay = new Map<number, number[]>();
      for (const s of assignment.slots) {
        if (!slotsByDay.has(s.day)) slotsByDay.set(s.day, []);
        slotsByDay.get(s.day)!.push(s.period);
      }
      if (slotsByDay.size !== 2) {
        violations.push({
          type: 'invalid_window',
          courseId: assignment.courseId,
          detail: `Semester 1 MDC course ${course.courseCode} must be split across exactly 2 different days (got ${slotsByDay.size} day(s)).`,
        });
      } else {
        const dayCounts = Array.from(slotsByDay.values()).map((pList) => pList.length).sort((a, b) => a - b);
        if (dayCounts[0] !== 1 || dayCounts[1] !== 2) {
          violations.push({
            type: 'invalid_window',
            courseId: assignment.courseId,
            detail: `Semester 1 MDC course ${course.courseCode} must have 1 single session on one day and a 2-hour continuous block on another day.`,
          });
        }
      }
    }

    // R21: Validate lab blocks are valid consecutive pairs with NO unapproved single-hour exceptions
    const labSlots = assignment.slots.filter((s) => s.isLabBlock || s.sessionType === 'practical');
    if (labSlots.length % 2 !== 0) {
      violations.push({
        type: 'invalid_lab_block',
        courseId: assignment.courseId,
        detail: `Course ${course.courseCode} has an odd number of lab slots (${labSlots.length}) — all practical contact hours must be in exact 2-period pairs (R21).`,
      });
    }

    // Group lab slots by day, check they are valid consecutive pairs
    const labByDay = new Map<number, number[]>();
    for (const s of labSlots) {
      if (!labByDay.has(s.day)) labByDay.set(s.day, []);
      labByDay.get(s.day)!.push(s.period);
    }

    for (const [day, periods] of labByDay) {
      periods.sort((a, b) => a - b);
      for (let i = 0; i < periods.length; i += 2) {
        const pA = periods[i];
        const pB = periods[i + 1];
        if (pB === undefined) {
          violations.push({
            type: 'invalid_lab_block',
            courseId: assignment.courseId,
            day,
            detail: `Course ${course.courseCode} lab block on day ${day} has un-paired period: ${pA} (R21: no single-hour practicals permitted).`,
          });
          continue;
        }
        if (pB !== pA + 1) {
          violations.push({
            type: 'invalid_lab_block',
            courseId: assignment.courseId,
            day,
            detail: `Course ${course.courseCode} lab block on day ${day} has non-consecutive periods: ${pA} and ${pB}`,
          });
        }
        // Valid pairs: (1, 2), (2, 3), (4, 5), (5, 6)
        // P3+P4 crosses lunch
        if (pA === 3 && pB === 4) {
          violations.push({
            type: 'lunch_overlap',
            courseId: assignment.courseId,
            day,
            detail: `Course ${course.courseCode} lab block on day ${day} crosses lunch (P3+P4)`,
          });
        }
      }
    }
  }

  // F37: Fixed Teacher Reservations check (against published schedules in other semesters/campuses)
  for (const res of teacherReservations) {
    const resKey = `${res.day}-${res.period}`;
    if (teacherSchedule.has(res.teacherId) && teacherSchedule.get(res.teacherId)!.has(resKey)) {
      violations.push({
        type: 'teacher_conflict',
        teacherId: res.teacherId,
        day: res.day,
        period: res.period,
        detail: `Teacher ${res.teacherId} conflicts with published timetable reservation at Day ${res.day} Period ${res.period} (from semester ${res.sourceSemester || 'other'}, course ${res.sourceCourseId || 'other'}).`,
      });
    }
  }

  // ── Parallel Half-Block Overlap Check ──────────────────────────────────────
  for (const assignmentA of response.assignments) {
    const courseA = courseMap.get(assignmentA.courseId);
    if (!courseA) continue;

    const labSlotsA = assignmentA.slots.filter((s) => s.isLabBlock || s.sessionType === 'practical');
    const labByDayA = new Map<number, number[]>();
    for (const s of labSlotsA) {
      if (!labByDayA.has(s.day)) labByDayA.set(s.day, []);
      labByDayA.get(s.day)!.push(s.period);
    }

    for (const [day, periodsA] of labByDayA) {
      periodsA.sort((a, b) => a - b);
      for (let i = 0; i < periodsA.length; i += 2) {
        const p1 = periodsA[i];
        const p2 = periodsA[i + 1];
        if (p2 === undefined) continue;

        // Check all other assignments sharing department
        for (const assignmentB of response.assignments) {
          if (assignmentB.courseId === assignmentA.courseId) continue;
          const courseB = courseMap.get(assignmentB.courseId);
          if (!courseB) continue;
          if (courseB.departmentId !== courseA.departmentId) continue;

          const slotsBOnDay = assignmentB.slots.filter((s) => s.day === day);
          const hasP1 = slotsBOnDay.some((s) => s.period === p1);
          const hasP2 = slotsBOnDay.some((s) => s.period === p2);

          if ((hasP1 && !hasP2) || (!hasP1 && hasP2)) {
            const presentP = hasP1 ? p1 : p2;
            const missingP = hasP1 ? p2 : p1;
            violations.push({
              type: 'half_block_overlap',
              courseId: assignmentB.courseId,
              day,
              period: presentP,
              detail: `Course ${courseB.courseCode} occupies only Period ${presentP} of the 2-hour block on Day ${day} (P${p1}+P${p2}) running for ${courseA.departmentName} (${courseA.courseCode}), leaving students idle in Period ${missingP}. Parallel courses must span both periods or be moved to another slot.`,
            });
          }
        }
      }
    }
  }

  // ── Parallel Groups Synchronization & Category Purity Checks (F71) ────────
  let mandatoryGroups: ParallelGroup[] = [];
  try { mandatoryGroups = buildCampusPaperGroups(courses); }
  catch (error) { violations.push({ type: 'category_slot_mismatch', detail: (error as Error).message }); }
  const departmentGroups = parallelGroups.filter(group =>
    !group.courseIds.some(id => CAMPUS_WIDE_CATEGORIES.has((courseMap.get(id)?.category || '').toUpperCase().trim())));
  for (const group of [...mandatoryGroups, ...departmentGroups]) {
      const grpAssignments = response.assignments.filter((a) =>
        group.courseIds.includes(a.courseId)
      );
      if (grpAssignments.length < 2) continue;

      const refAssignment = grpAssignments[0];
      const refCourse = courseMap.get(refAssignment.courseId);
      const refSlotsStr = refAssignment.slots
        .map((s) => `${s.day}-${s.period}`)
        .sort()
        .join(',');

      for (let i = 1; i < grpAssignments.length; i++) {
        const curr = grpAssignments[i];
        const currCourse = courseMap.get(curr.courseId);
        const currSlotsStr = curr.slots
          .map((s) => `${s.day}-${s.period}`)
          .sort()
          .join(',');

        if (currSlotsStr !== refSlotsStr) {
          violations.push({
            type: 'category_slot_mismatch',
            courseId: curr.courseId,
            detail: `Parallel basket [${group.category || 'Group'}] synchronization mismatch: Course ${currCourse?.courseCode ?? curr.courseId} slots [${currSlotsStr}] do not match basket reference [${refSlotsStr}] of course ${refCourse?.courseCode ?? refAssignment.courseId}. Courses in the same parallel basket must share identical slots.`,
          });
        }
      }
  }

  // Category Purity in Parallel Slots: Ensure courses running at the same slot for the same cohort have identical category
  const slotCohortCategory = new Map<string, { category: string; courseCode: string }>();
  for (const assignment of response.assignments) {
    const course = courseMap.get(assignment.courseId);
    if (!course) continue;
    const cat = (course.category || '').toUpperCase().trim();

    for (const slot of assignment.slots) {
      const cohortKey = `${slot.day}-${slot.period}:${course.departmentId}`;
      if (slotCohortCategory.has(cohortKey)) {
        const existing = slotCohortCategory.get(cohortKey)!;
        if (existing.category && cat && existing.category !== cat) {
          violations.push({
            type: 'mixed_category_conflict',
            courseId: course.courseId,
            day: slot.day,
            period: slot.period,
            detail: `Mixed category parallelization violation at Day ${slot.day} Period ${slot.period}: Course ${course.courseCode} [${cat}] is scheduled parallel with ${existing.courseCode} [${existing.category}] for the same department cohort. Parallel slots must only contain courses of the identical category.`,
          });
        }
      } else {
        slotCohortCategory.set(cohortKey, { category: cat, courseCode: course.courseCode });
      }
    }
  }

  return violations;
}

export function violationsToText(violations: ValidationViolation[]): string[] {
  return violations.map((v) => v.detail);
}
