const CAMPUS_CATEGORIES = new Set(['MDC', 'SEC', 'VAC', 'AEC']);

/** A cohort sees the papers its students selected, regardless of course ownership. */
export function entriesForDepartment<T extends { category?: string; departmentId?: string; departmentCode?: string; enrolledDepartmentIds?: string[] }>(
  entries: T[], departmentId: string, departmentCode?: string,
): T[] {
  return entries.filter(entry => entry.enrolledDepartmentIds
    ? entry.enrolledDepartmentIds.includes(departmentId)
    : CAMPUS_CATEGORIES.has((entry.category || '').trim().toUpperCase()) ||
      entry.departmentId === departmentId ||
      !!(departmentCode && entry.departmentCode && departmentCode.toUpperCase() === entry.departmentCode.toUpperCase()));
}
