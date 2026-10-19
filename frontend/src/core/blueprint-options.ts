import { HOD_COURSE_CATEGORIES } from '@fyimp/contracts'

const preferred = ['MDC', 'AEC', 'VAC', 'SEC'] as const
export const GLOBAL_BASKET_CATEGORIES: readonly string[] = [
  ...preferred,
  ...HOD_COURSE_CATEGORIES.filter(category => category !== 'DSC' && category !== 'DSE' && !(preferred as readonly string[]).includes(category)),
]

export function groupBlueprintCourses<T extends { is_own_dept?: boolean; course_code: string; id: string }>(courses: T[]) {
  const sorted = [...courses].sort((a,b) => a.course_code.localeCompare(b.course_code) || a.id.localeCompare(b.id))
  return [
    { label: 'Own department', courses: sorted.filter(course => course.is_own_dept === true) },
    { label: 'Other departments', courses: sorted.filter(course => course.is_own_dept !== true) },
  ].filter(group => group.courses.length > 0)
}
