export interface BulkUploadRowResult {
  row: number
  email: string
  status: 'success' | 'error'
  issues?: string[]
}
export interface BulkUploadResult {
  inserted_count: number
  error_count: number
  results: BulkUploadRowResult[]
}

/** Row outcomes are authoritative, including responses from older backends without totals. */
export function bulkUploadResult(body: unknown): BulkUploadResult {
  const data = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  if (!Array.isArray(data.results) || data.results.some(row => !row || !['success', 'error'].includes(row.status))) {
    throw new Error('Upload results could not be confirmed. Refresh the student list before retrying to avoid duplicate uploads.')
  }
  const results = data.results as BulkUploadRowResult[]
  return {
    inserted_count: results.filter(row => row.status === 'success').length,
    error_count: results.filter(row => row.status === 'error').length,
    results,
  }
}
