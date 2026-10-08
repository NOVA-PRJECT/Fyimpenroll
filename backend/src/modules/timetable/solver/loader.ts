import { SupabaseClient } from '@supabase/supabase-js';
import { CourseNode, ParallelGroup, SlotId, SlotLookup, SlotMap } from './types';

/**
 * Build human-readable conflict summary in plain English for each course.
 */
function buildConflictSummary(
  courseId: string,
  allCourses: CourseNode[],
  courseCodeMap: Map<string, string>
): string {
  const conflicts: string[] = [];
  const thisCourse = allCourses.find((c) => c.courseId === courseId);
  if (!thisCourse) return 'No conflicts with other courses';

  for (const other of allCourses) {
    if (other.courseId === courseId) continue;
    const sharedCount = [...thisCourse.studentIds].filter((s) => other.studentIds.has(s)).length;
    if (sharedCount > 0) {
      const otherCode = courseCodeMap.get(other.courseId) ?? other.courseId;
      conflicts.push(`${otherCode} (${sharedCount} shared students)`);
    }
  }

  return conflicts.length > 0
    ? `Conflicts with: ${conflicts.join(', ')}`
    : 'No conflicts with other courses';
}

const CAMPUS_WIDE_CATEGORIES = new Set(['MDC', 'VAC', 'SEC', 'AEC']);

/**
 * Auto-detect parallel groups from live registration data.
 * For campus-wide categories (MDC, VAC, SEC, AEC), courses are grouped campus-wide
 * by category and matching session hour structures.
 * For department-specific categories (DSC, DSE), courses are grouped by student department.
 * Category purity is strictly enforced: courses with different categories are NEVER mixed.
 */
export function detectParallelGroups(
  courses: CourseNode[],
  studentDeptMap: Map<string, string> = new Map()
): ParallelGroup[] {
  const parallelGroups: ParallelGroup[] = [];

  // Group courses by scope + category + matching hours structure
  const buckets = new Map<string, CourseNode[]>();

  for (const course of courses) {
    const rawCategory = (course.category || '').toUpperCase().trim();
    const isCampusWide = CAMPUS_WIDE_CATEGORIES.has(rawCategory);

    if (isCampusWide) {
      // Campus-wide grouping: all departments share identical slots for this category
      const key = `campus:${rawCategory}:T${course.theoryHours}:P${course.practicalHours}`;
      if (!buckets.has(key)) buckets.set(key, []);
      const list = buckets.get(key)!;
      if (!list.some((c) => c.courseId === course.courseId)) {
        list.push(course);
      }
    } else {
      // Department-level grouping: by student batch department + category + hours
      const studentDepts = new Set<string>();
      for (const studentId of course.studentIds) {
        const deptId = studentDeptMap.get(studentId);
        if (deptId) studentDepts.add(deptId);
      }
      if (studentDepts.size === 0) {
        studentDepts.add(course.departmentId);
      }

      for (const deptId of studentDepts) {
        const key = `${deptId}:${rawCategory || 'General'}:T${course.theoryHours}:P${course.practicalHours}`;
        if (!buckets.has(key)) buckets.set(key, []);
        const list = buckets.get(key)!;
        if (!list.some((c) => c.courseId === course.courseId)) {
          list.push(course);
        }
      }
    }
  }

  for (const [key, bucket] of buckets) {
    // Need at least 2 courses to form a parallel group
    if (bucket.length < 2) continue;
    const parts = key.split(':');
    const scopeOrDept = parts[0];
    const category = parts[1];
    const isCampusWide = scopeOrDept === 'campus';

    // Check if ALL pairs in this bucket have zero student overlap.
    let allZeroOverlap = true;

    outer:
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        for (const studentId of bucket[i].studentIds) {
          if (bucket[j].studentIds.has(studentId)) {
            allZeroOverlap = false;
            break outer;
          }
        }
      }
    }

    if (allZeroOverlap) {
      parallelGroups.push({
        groupId: crypto.randomUUID(), // runtime only — never stored in DB
        departmentId: isCampusWide ? 'CAMPUS_WIDE' : scopeOrDept,
        category,
        isCampusWide,
        courseIds: bucket.map((c) => c.courseId),
        courseCodes: bucket.map((c) => c.courseCode),
      });
    }
  }

  return parallelGroups;
}

export async function loadGenerationInput(
  supabase: SupabaseClient,
  academicYear: string,
  semester: number,
  campusId?: string,
  onProgress?: (progress: number, stepMessage: string, stats?: Record<string, any>) => Promise<void> | void
): Promise<{
  courses: CourseNode[];
  slotMap: SlotMap;
  slotLookup: SlotLookup;
  studentDeptMap: Map<string, string>;
  parallelGroups: ParallelGroup[];
  stats: {
    registrationCount: number;
    studentCount: number;
    departmentCount: number;
    courseCount: number;
    crossDeptCourseCount: number;
    slotCount: number;
  };
}> {
  await onProgress?.(5, '🔍 Reading student course registrations from database...');

  // Query 1: Fetch student registrations
  let regQuery = supabase
    .from('student_registrations')
    .select(`
      student_id,
      campus_id,
      semester,
      academic_year,
      slot_1_course_id,
      slot_2_course_id,
      slot_3_course_id,
      slot_4_course_id,
      slot_5_course_id,
      slot_6_course_id,
      slot_7_course_id,
      slot_8_course_id
    `)
    .eq('academic_year', academicYear)
    .eq('semester', semester);

  if (campusId) {
    regQuery = regQuery.eq('campus_id', campusId);
  }

  const { data: rawRegistrations, error: regError } = await regQuery;

  if (regError) {
    console.error('loadGenerationInput student_registrations error:', regError);
    throw new Error(`Database error while reading student registrations: ${regError.message}`);
  }

  if (!rawRegistrations || rawRegistrations.length === 0) {
    throw new Error('No student registrations found for this academic year and semester. Ensure students have submitted their course registrations.');
  }

  await onProgress?.(
    10,
    `📥 Loaded ${rawRegistrations.length} student registration submissions...`,
    { registrationCount: rawRegistrations.length }
  );

  // Extract all student-to-course pairs from all 8 supported slots (F15)
  const studentCoursePairs: Array<{ studentId: string; courseId: string }> = [];
  const allCourseIds = new Set<string>();

  for (const reg of rawRegistrations) {
    const slots = [
      reg.slot_1_course_id,
      reg.slot_2_course_id,
      reg.slot_3_course_id,
      reg.slot_4_course_id,
      reg.slot_5_course_id,
      reg.slot_6_course_id,
      (reg as any).slot_7_course_id,
      (reg as any).slot_8_course_id,
    ];
    for (const courseId of slots) {
      if (courseId) {
        studentCoursePairs.push({ studentId: reg.student_id, courseId });
        allCourseIds.add(courseId);
      }
    }
  }

  if (allCourseIds.size === 0) {
    throw new Error('No course selections found in student registrations for this semester.');
  }

  // Query 2: Fetch student to department mapping
  const studentDeptMap = new Map<string, string>();
  const allStudentIds = Array.from(new Set(rawRegistrations.map((r: any) => r.student_id).filter(Boolean)));

  if (allStudentIds.length > 0) {
    const { data: studentDepts } = await supabase
      .from('students')
      .select('id, department_id')
      .in('id', allStudentIds);

    for (const row of studentDepts ?? []) {
      if (row.department_id) studentDeptMap.set(row.id, row.department_id);
    }

    const unmappedIds = allStudentIds.filter((id) => !studentDeptMap.has(id));
    if (unmappedIds.length > 0) {
      const { data: userDepts } = await supabase
        .from('users')
        .select('id, department_id, dep')
        .in('id', unmappedIds);

      for (const row of userDepts ?? []) {
        const deptId = row.department_id || row.dep;
        if (deptId) studentDeptMap.set(row.id, deptId);
      }
    }
  }

  const deptCount = new Set(Array.from(studentDeptMap.values())).size;

  // Query 2b: Fetch all departments for name mapping
  const { data: rawDepts } = await supabase.from('departments').select('id, name, code');
  const deptNameMap = new Map<string, string>();
  for (const d of rawDepts ?? []) {
    deptNameMap.set(d.id, d.name);
  }

  await onProgress?.(
    18,
    `🏢 Mapped ${studentDeptMap.size} enrolled students across ${deptCount} campus departments...`,
    {
      registrationCount: rawRegistrations.length,
      studentCount: studentDeptMap.size,
      departmentCount: deptCount,
    }
  );

  // Query 3: Fetch courses metadata
  const { data: rawCourses, error: courseError } = await supabase
    .from('courses')
    .select('id, title, course_code, department_id, theory_hours_per_week, practical_hours_per_week, category')
    .in('id', Array.from(allCourseIds));

  if (courseError) {
    console.error('loadGenerationInput courses error:', courseError);
    throw new Error(`Database error while reading courses: ${courseError.message}`);
  }

  const courseMetaMap = new Map<
    string,
    {
      departmentId: string;
      departmentName: string;
      courseCode: string;
      courseTitle: string;
      theoryHours: number;
      practicalHours: number;
      category: string;
    }
  >();

  const courseCodeMap = new Map<string, string>();

  for (const c of rawCourses || []) {
    const code = (c.course_code || 'N/A').trim();
    courseCodeMap.set(c.id, code);
    courseMetaMap.set(c.id, {
      departmentId: c.department_id,
      departmentName: deptNameMap.get(c.department_id) || 'Department',
      courseCode: code,
      courseTitle: (c.title || 'Course').trim(),
      theoryHours: c.theory_hours_per_week ?? 3,
      practicalHours: c.practical_hours_per_week ?? 0,
      category: (c.category || 'General').trim(),
    });
  }

  // Group student enrollments by course_id
  const courseGroupMap = new Map<
    string,
    {
      departmentId: string;
      departmentName: string;
      courseCode: string;
      courseTitle: string;
      theoryHours: number;
      practicalHours: number;
      category: string;
      studentIds: Set<string>;
      studentDeptIds: Set<string>;
    }
  >();

  for (const pair of studentCoursePairs) {
    const meta = courseMetaMap.get(pair.courseId);
    if (!meta) continue;

    let group = courseGroupMap.get(pair.courseId);
    if (!group) {
      group = {
        departmentId: meta.departmentId,
        departmentName: meta.departmentName,
        courseCode: meta.courseCode,
        courseTitle: meta.courseTitle,
        theoryHours: meta.theoryHours,
        practicalHours: meta.practicalHours,
        category: meta.category,
        studentIds: new Set<string>(),
        studentDeptIds: new Set<string>(),
      };
      courseGroupMap.set(pair.courseId, group);
    }
    group.studentIds.add(pair.studentId);
    const sDept = studentDeptMap.get(pair.studentId);
    if (sDept) {
      group.studentDeptIds.add(sDept);
    } else if (meta.departmentId) {
      group.studentDeptIds.add(meta.departmentId);
    }
  }

  const courses: CourseNode[] = [];

  for (const [courseId, group] of courseGroupMap.entries()) {
    if (group.studentIds.size === 0) continue;

    courses.push({
      courseId,
      departmentId: group.departmentId,
      departmentName: group.departmentName,
      courseCode: group.courseCode,
      courseTitle: group.courseTitle,
      category: group.category,
      theoryHours: group.theoryHours,
      practicalHours: group.practicalHours,
      isCrossDept: group.studentDeptIds.size > 1,
      studentIds: group.studentIds,
      conflictSummary: '', // computed below once all courses are populated
    });
  }

  if (courses.length === 0) {
    throw new Error('No active courses found for the registered students in this campus.');
  }

  // Compute plain-English conflict summary for each CourseNode
  for (const course of courses) {
    course.conflictSummary = buildConflictSummary(course.courseId, courses, courseCodeMap);
  }

  const crossDeptCourseCount = courses.filter((c) => c.isCrossDept).length;
  await onProgress?.(
    25,
    `📚 Prepared ${courses.length} active courses (${crossDeptCourseCount} cross-department)...`,
    {
      registrationCount: rawRegistrations.length,
      studentCount: studentDeptMap.size,
      departmentCount: deptCount,
      courseCount: courses.length,
      crossDeptCourseCount,
    }
  );

  // Query 4: Fetch time slots
  const { data: rawSlots, error: slotError } = await supabase
    .from('time_slots')
    .select('id, day_of_week, period_number')
    .order('day_of_week')
    .order('period_number');

  if (slotError) {
    console.error('loadGenerationInput time_slots error:', slotError);
    throw new Error(`Database error while reading time slots: ${slotError.message}`);
  }

  if (!rawSlots || rawSlots.length === 0) {
    throw new Error('System time slot configurations are missing. Please contact the administrator.');
  }

  const slotMap: SlotMap = new Map();
  const slotLookup: SlotLookup = new Map();

  for (const slot of rawSlots || []) {
    let dayMap = slotMap.get(slot.day_of_week);
    if (!dayMap) {
      dayMap = new Map<number, SlotId>();
      slotMap.set(slot.day_of_week, dayMap);
    }
    dayMap.set(slot.period_number, slot.id);
    slotLookup.set(slot.id, { day: slot.day_of_week, period: slot.period_number });
  }

  let slotCount = 0;
  slotMap.forEach((dayMap) => (slotCount += dayMap.size));

  // Auto-detect parallel groups dynamically from live registration data using studentDeptMap
  const parallelGroups = detectParallelGroups(courses, studentDeptMap);

  const stats = {
    registrationCount: rawRegistrations.length,
    studentCount: studentDeptMap.size,
    departmentCount: deptCount,
    courseCount: courses.length,
    crossDeptCourseCount,
    slotCount,
  };

  await onProgress?.(
    30,
    `⏰ Verified ${slotCount} weekly time slots & detected ${parallelGroups.length} parallel group(s). Ready for AI scheduling...`,
    stats
  );

  return { courses, slotMap, slotLookup, studentDeptMap, parallelGroups, stats };
}
