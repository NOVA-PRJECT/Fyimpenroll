/** Preserve the allocation status API while reading the canonical system log row. */
export function allocationRunResponse(row: Record<string, any> | null) {
  if (!row) return null
  const metadata = row.metadata ?? {}
  return {
    id: row.id, campus_id: row.campus_id, academic_year: row.academic_year,
    semester: row.semester, status: row.status,
    triggered_at: row.started_at, total_students: Number(metadata.total_students ?? 0),
    fully_allocated: Number(metadata.fully_allocated ?? 0),
    partially_allocated: Number(metadata.partially_allocated ?? 0),
    unallocated: Number(metadata.unallocated ?? 0), summary: metadata.summary ?? {},
    error_message: row.error_message, completed_at: row.completed_at,
  }
}
