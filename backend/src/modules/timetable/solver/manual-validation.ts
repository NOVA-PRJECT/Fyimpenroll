import { BadRequestException } from '@nestjs/common';
import { ManualEntry } from './schemas';
import { CourseNode, ParallelGroup, RuleDefinition, SlotMap, TeacherReservation, ValidationViolation } from './types';
import { validateTimetable } from './validator';

/** Identity/domain errors are never scheduling overrides. Missing hours may remain in drafts. */
export function validateManualEntries(entries: ManualEntry[], courses: CourseNode[], slotMap: SlotMap,
  parallelGroups: ParallelGroup[], teacherReservations: TeacherReservation[], semester: number, rules: RuleDefinition[]) {
  const courseMap = new Map(courses.map(course => [course.courseId, course]));
  const seen = new Set<string>();
  const assignments = new Map<string, { courseId: string; slots: ManualEntry[] }>();
  for (const entry of entries) {
    if (!courseMap.has(entry.courseId)) throw new BadRequestException('A session references a course outside this registered campus cohort.');
    if (!slotMap.get(entry.day)?.has(entry.period)) throw new BadRequestException('A session references an unavailable timetable slot.');
    const key = `${entry.courseId}:${entry.day}:${entry.period}`;
    if (seen.has(key)) throw new BadRequestException('The same course cannot be entered twice in one slot.');
    seen.add(key);
    const assignment = assignments.get(entry.courseId) || { courseId: entry.courseId, slots: [] };
    assignment.slots.push(entry);
    assignments.set(entry.courseId, assignment);
  }
  const response = { assignments: [...assignments.values()] };
  const context = { semester, effectiveRules: rules };
  const violations = validateTimetable(response, courses, slotMap, parallelGroups, teacherReservations, context);
  const blockingViolations = validateTimetable(response, courses, slotMap, parallelGroups, teacherReservations,
    { ...context, allowPartial: true });
  for (const entry of entries) {
    if (entry.isLabBlock !== (entry.sessionType === 'practical')) {
      const violation: ValidationViolation = { type: 'invalid_lab_block', courseId: entry.courseId, day: entry.day, period: entry.period,
        detail: `${courseMap.get(entry.courseId)!.courseCode}: practical sessions must be marked as lab periods; theory sessions must not.` };
      violations.push(violation); blockingViolations.push(violation);
    }
  }
  const remaining = courses.flatMap(course => (['theory', 'practical'] as const).flatMap(sessionType => {
    const required = sessionType === 'theory' ? course.theoryHours : course.practicalHours;
    const placed = entries.filter(entry => entry.courseId === course.courseId && entry.sessionType === sessionType).length;
    return required > placed ? [{ courseId: course.courseId, courseCode: course.courseCode, courseName: course.courseTitle,
      departmentId: course.departmentId, sessionType, periods: required - placed }] : [];
  }));
  const warnings: ValidationViolation[] = [];
  for (const course of courses) {
    const placed = entries.filter(entry => entry.courseId === course.courseId);
    if (placed.length && !course.teacherId) warnings.push({ type: 'teacher_conflict', courseId: course.courseId,
      detail: `${course.courseCode} has no HOD-assigned teacher. Ask the HOD to assign one.` });
    for (const rule of rules.filter(rule => !rule.isHard && (!rule.targetSemester || rule.targetSemester === semester) &&
      (!rule.targetCourseId || rule.targetCourseId === course.courseId) &&
      (!rule.targetDepartmentId || rule.targetDepartmentId === course.departmentId) &&
      (!rule.targetCategory || rule.targetCategory.toUpperCase() === course.category.toUpperCase()))) {
      if (['DAY_WINDOW', 'CAMPUS_TIME_LIMIT', 'CATEGORY_WINDOW'].includes(rule.kind)) {
        const parameters = rule.parameters || {};
        const days: number[] | undefined = parameters.days || parameters.allowed_days;
        const periods: number[] | undefined = parameters.periods || parameters.allowed_periods;
        if ((!parameters.courseCodes || parameters.courseCodes.includes(course.courseCode)) &&
          placed.some(entry => (days && !days.includes(entry.day)) || (periods && !periods.includes(entry.period)))) {
          warnings.push({ type: 'invalid_window', courseId: course.courseId, detail: `${course.courseCode}: ${rule.description}` });
        }
      }
      if (rule.kind === 'P6_LAST_RESORT' && placed.some(entry => entry.period === 6)) {
        warnings.push({ type: 'invalid_window', courseId: course.courseId, detail: `${course.courseCode}: ${rule.description}` });
      }
      if (rule.kind === 'THEORY_SPREAD') {
        const theory = placed.filter(entry => entry.sessionType === 'theory');
        if (new Set(theory.map(entry => entry.day)).size < theory.length) warnings.push({ type: 'invalid_window',
          courseId: course.courseId, detail: `${course.courseCode}: ${rule.description}` });
      }
      if (rule.kind === 'DEPARTMENT_TIME_PREFERENCE' && placed.some(entry => course.isCrossDept ? entry.period < 4 : entry.period > 3)) {
        warnings.push({ type: 'invalid_window', courseId: course.courseId, detail: `${course.courseCode}: ${rule.description}` });
      }
    }
  }
  return { violations, blockingViolations, warnings, remaining,
    unscheduledPeriods: remaining.reduce((sum, item) => sum + item.periods, 0),
    complete: remaining.length === 0 };
}
