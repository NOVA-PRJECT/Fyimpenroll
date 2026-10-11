const CAMPUS_CATEGORIES = new Set(['MDC', 'SEC', 'VAC', 'AEC']);

/** Campus paper options appear in every department's director view and exports. */
export function entriesForDepartment<T extends { category?: string; departmentId: string; departmentCode?: string }>(
  entries: T[], departmentId: string, departmentCode?: string,
): T[] {
  return entries.filter(entry => CAMPUS_CATEGORIES.has((entry.category || '').trim().toUpperCase()) ||
    entry.departmentId === departmentId ||
    !!(departmentCode && entry.departmentCode && departmentCode.toUpperCase() === entry.departmentCode.toUpperCase()));
}
