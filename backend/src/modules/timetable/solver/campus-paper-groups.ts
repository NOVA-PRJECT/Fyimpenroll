import { CourseNode, ParallelGroup } from './types';

export const CAMPUS_WIDE_CATEGORIES = new Set(['MDC', 'VAC', 'SEC', 'AEC']);

/** A paper's ordinal within its category is independent of department slot numbering. */
export function resolveCampusPapers(
  registrations: Array<Record<string, unknown>>,
  catalogue: Map<string, { category: string; courseCode: string }>,
): Map<string, number> {
  const papers = new Map<string, number>();
  for (const registration of registrations) {
    const ordinals = new Map<string, number>();
    for (let slot = 1; slot <= 8; slot++) {
      const id = registration[`slot_${slot}_course_id`];
      if (typeof id !== 'string') continue;
      const course = catalogue.get(id);
      if (!course) throw new Error('[Campus Paper Conflict] A registered course is missing from the catalogue.');
      const category = (course.category || '').toUpperCase().trim();
      if (!CAMPUS_WIDE_CATEGORIES.has(category)) continue;
      const paper = (ordinals.get(category) || 0) + 1;
      ordinals.set(category, paper);
      const fixedPaper = course.courseCode === 'KU01AECENG101' ? 1 : course.courseCode === 'KU01AECENG102' ? 2 : undefined;
      if ((papers.has(id) && papers.get(id) !== paper) || (fixedPaper && fixedPaper !== paper)) {
        throw new Error(`[Campus Paper Conflict] ${course.courseCode} is registered in inconsistent ${category} paper positions. Correct the course selections before generation.`);
      }
      papers.set(id, paper);
    }
  }
  return papers;
}

/** Never partition a common paper by hours, department, teacher or enrollment overlap. */
export function buildCampusPaperGroups(courses: CourseNode[]): ParallelGroup[] {
  const buckets = new Map<string, CourseNode[]>();
  for (const course of courses) {
    const category = (course.category || '').toUpperCase().trim();
    if (!CAMPUS_WIDE_CATEGORIES.has(category)) continue;
    const paper = course.campusPaper ?? (course.courseCode === 'KU01AECENG102' ? 2 : 1);
    if (!Number.isInteger(paper) || paper < 1 || paper > 8) {
      throw new Error(`[Campus Paper Conflict] ${course.courseCode} has an invalid campus paper position.`);
    }
    const fixedPaper = course.courseCode === 'KU01AECENG101' ? 1 : course.courseCode === 'KU01AECENG102' ? 2 : undefined;
    if (fixedPaper && fixedPaper !== paper) {
      throw new Error(`[Campus Paper Conflict] ${course.courseCode} has an inconsistent AEC paper position.`);
    }
    const key = `${category}:paper:${paper}`;
    const bucket = buckets.get(key) || [];
    if (!bucket.some(c => c.courseId === course.courseId)) bucket.push(course);
    buckets.set(key, bucket);
  }
  const groups: ParallelGroup[] = [];
  for (const [key, bucket] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
    bucket.sort((a, b) => a.courseCode.localeCompare(b.courseCode));
    const expected = bucket[0].theoryHours + bucket[0].practicalHours;
    const students = new Set<string>();
    for (const course of bucket) {
      if (course.theoryHours + course.practicalHours !== expected) {
        throw new Error(`[Campus Paper Conflict] ${key} requires identical total contact hours across departments. ${bucket.map(c => `${c.courseCode}=${c.theoryHours + c.practicalHours}`).join(', ')}. Correct the catalogue; this common paper cannot be split.`);
      }
      if ([...course.studentIds].some(id => students.has(id))) {
        throw new Error(`[Campus Paper Conflict] ${key} contains overlapping student enrollments across course options. Correct the selections; this common paper cannot be split.`);
      }
      course.studentIds.forEach(id => students.add(id));
    }
    if (bucket.length > 1) groups.push({ groupId: `campus:${key}`, departmentId: 'CAMPUS_WIDE',
      category: bucket[0].category.toUpperCase().trim(), isCampusWide: true,
      courseIds: bucket.map(c => c.courseId), courseCodes: bucket.map(c => c.courseCode) });
  }
  return groups;
}
