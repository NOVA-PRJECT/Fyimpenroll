import type {
  AIGeneratorResponse,
  CourseNode,
  ValidationViolation,
  SlotMap,
} from './types';

export function validateTimetable(
  response: AIGeneratorResponse,
  courses: CourseNode[],
  slotMap: SlotMap
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];
  const courseMap = new Map(courses.map((c) => [c.courseId, c]));

  // Build: studentId → Set of (day-period) strings assigned to them
  const studentSchedule = new Map<string, Set<string>>();

  for (const assignment of response.assignments) {
    const course = courseMap.get(assignment.courseId);
    if (!course) continue;

    let theoryCount = 0;
    let practicalCount = 0;

    for (const slot of assignment.slots) {
      const key = `${slot.day}-${slot.period}`;

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

    // Validate lab blocks are valid consecutive pairs
    const labSlots = assignment.slots.filter((s) => s.isLabBlock);
    if (labSlots.length % 2 !== 0) {
      violations.push({
        type: 'invalid_lab_block',
        courseId: assignment.courseId,
        detail: `Course ${course.courseCode} has an odd number of lab block slots (${labSlots.length}) — must be in pairs`,
      });
    }

    // Group lab slots by day, check they are consecutive pairs
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
        if (pB === undefined || pB !== pA + 1) {
          violations.push({
            type: 'invalid_lab_block',
            courseId: assignment.courseId,
            day,
            detail: `Course ${course.courseCode} lab block on day ${day} has non-consecutive periods: ${pA} and ${pB}`,
          });
        }
        // P3+P4 is illegal
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

  // ── Parallel Half-Block Overlap Check ──────────────────────────────────────
  // If Course A runs a 2-hour lab block at (day, pA + pB), another course B for the
  // same department must not be scheduled for only one of those two periods (leaving students idle).
  for (const assignmentA of response.assignments) {
    const courseA = courseMap.get(assignmentA.courseId);
    if (!courseA) continue;

    const labSlotsA = assignmentA.slots.filter((s) => s.isLabBlock);
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

  // ── Campus-Wide Category Synchronization & Category Purity Checks ────────
  const CAMPUS_WIDE_CATEGORIES = new Set(['MDC', 'VAC', 'SEC', 'AEC']);

  // 1. Campus-wide category slot consistency (all courses of MDC/VAC/SEC/AEC must share identical slots)
  const categoryAssignments = new Map<string, Array<{ course: CourseNode; slots: string[] }>>();

  for (const assignment of response.assignments) {
    const course = courseMap.get(assignment.courseId);
    if (!course) continue;
    const cat = (course.category || '').toUpperCase().trim();
    if (!CAMPUS_WIDE_CATEGORIES.has(cat)) continue;

    // Use key combining category and total session hours to compare matching structures
    const key = `${cat}:T${course.theoryHours}:P${course.practicalHours}`;
    if (!categoryAssignments.has(key)) categoryAssignments.set(key, []);

    const slotKeys = assignment.slots.map((s) => `${s.day}-${s.period}`).sort();
    categoryAssignments.get(key)!.push({ course, slots: slotKeys });
  }

  for (const [key, group] of categoryAssignments) {
    if (group.length < 2) continue;
    const [cat] = key.split(':');
    const reference = group[0];
    const refSlotsStr = reference.slots.join(',');

    for (let i = 1; i < group.length; i++) {
      const current = group[i];
      const curSlotsStr = current.slots.join(',');
      if (curSlotsStr !== refSlotsStr) {
        violations.push({
          type: 'category_slot_mismatch',
          courseId: current.course.courseId,
          detail: `Campus-wide [${cat}] synchronization mismatch: Course ${current.course.courseCode} slots [${current.slots.join(', ')}] do not match standard ${cat} slots [${reference.slots.join(', ')}] used by ${reference.course.courseCode}. All ${cat} courses must share identical slots campus-wide.`,
        });
      }
    }
  }

  // 2. Category Purity in Parallel Slots: Ensure courses running at the same slot for the same cohort have identical category
  const slotCohortCategory = new Map<string, { category: string; courseCode: string }>();
  for (const assignment of response.assignments) {
    const course = courseMap.get(assignment.courseId);
    if (!course) continue;
    const cat = (course.category || '').toUpperCase().trim();

    for (const slot of assignment.slots) {
      // Cohort key: day-period + departmentId
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
