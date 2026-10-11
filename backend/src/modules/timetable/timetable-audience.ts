import { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPaginated, fetchByIdChunks } from '../../core/database/pagination.util';

const SLOT_FIELDS = Array.from({ length: 8 }, (_, i) => `slot_${i + 1}_course_id`);
const CAMPUS_CATEGORIES = new Set(['MDC', 'SEC', 'VAC', 'AEC']);

/** Course ownership is distinct from the home departments of enrolled students. */
export async function loadTimetableAudience(db: SupabaseClient, campusId: string, academicYear: string, semester: number) {
  const registrations = await fetchAllPaginated<any>(db.from('student_registrations')
    .select(`student_id,${SLOT_FIELDS.join(',')}`)
    .eq('campus_id', campusId).eq('academic_year', academicYear).eq('semester', semester).order('id'));
  // Resolve by IDs rather than embedding: legacy databases may have duplicate
  // student foreign keys that make PostgREST's relationship choice ambiguous.
  const students = await fetchByIdChunks<{ id: string; department_id: string }>(
    registrations.map(registration => registration.student_id), ids => db.from('students')
      .select('id,department_id').in('id', ids).order('id'));
  const studentDepartments = new Map(students.map(student => [student.id, student.department_id]));
  const courseDepartments = new Map<string, Set<string>>();
  const departmentStudents = new Map<string, Set<string>>();
  for (const registration of registrations) {
    const departmentId = studentDepartments.get(registration.student_id);
    if (!departmentId || !registration.student_id) throw new Error('A registered student has no department mapping.');
    const students = departmentStudents.get(departmentId) || new Set<string>();
    students.add(registration.student_id);
    departmentStudents.set(departmentId, students);
    for (const field of SLOT_FIELDS) {
      const courseId = registration[field];
      if (!courseId) continue;
      const departments = courseDepartments.get(courseId) || new Set<string>();
      departments.add(departmentId);
      courseDepartments.set(courseId, departments);
    }
  }
  // Only aggregated audience metadata leaves this helper; student IDs stay private.
  return {
    courseDepartments: new Map([...courseDepartments].map(([course, departments]) => [course, [...departments].sort()])),
    departmentCounts: new Map([...departmentStudents].map(([department, students]) => [department, students.size])),
  };
}

export function belongsToCohort(entry: { category?: string; enrolledDepartmentIds?: string[] }, departmentId: string) {
  return CAMPUS_CATEGORIES.has((entry.category || '').trim().toUpperCase()) ||
    !!entry.enrolledDepartmentIds?.includes(departmentId);
}
