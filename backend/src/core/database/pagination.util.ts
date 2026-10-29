/**
 * Pagination Utility for Complete-Cohort Operations (R36)
 *
 * Provides batch traversal using PostgREST .range(from, to) to prevent
 * silent truncation when cohort sizes exceed default API response caps (1,000 rows).
 */

export async function fetchAllPaginated<T>(
  fetchPageOrQuery: any,
  pageSize = 1000,
  maxRecords = 100000,
  knownMaximum?: number,
): Promise<T[]> {
  if (!fetchPageOrQuery) return []

  // If passed a page factory function (from, to) => Promise<{ data, error }>
  if (typeof fetchPageOrQuery === 'function') {
    const allResults: T[] = []
    let from = 0
    while (from < maxRecords) {
      const to = from + pageSize - 1
      const res = await fetchPageOrQuery(from, to)
      if (res?.error) {
        throw new Error(`Failed to fetch paginated records: ${res.error.message}`)
      }
      const data = res?.data || []
      allResults.push(...data)
      if ((res.count != null && allResults.length >= res.count) || (knownMaximum != null && allResults.length >= knownMaximum)) break
      if (data.length === 0) {
        break
      }
      from += data.length
    }
    if (from >= maxRecords) throw new Error('Record safety limit exceeded; export was not truncated silently')
    return allResults
  }

  // If passed a Supabase query builder without range method (e.g. simplified test mock)
  if (typeof fetchPageOrQuery.range !== 'function') {
    const res = await fetchPageOrQuery
    if (res?.error) {
      throw new Error(`Failed to fetch records: ${res.error.message}`)
    }
    return (res?.data || []) as T[]
  }

  // Supabase query builder with .range()
  const allResults: T[] = []
  let from = 0
  while (from < maxRecords) {
    const to = from + pageSize - 1
    const res = await fetchPageOrQuery.range(from, to)
    if (res?.error) {
      throw new Error(`Failed to fetch paginated records: ${res.error.message}`)
    }
    const data = res?.data || []
    allResults.push(...data)
    if ((res.count != null && allResults.length >= res.count) || (knownMaximum != null && allResults.length >= knownMaximum)) break
    if (data.length === 0) {
      break
    }
    from += data.length
  }
  if (from >= maxRecords) throw new Error('Record safety limit exceeded; export was not truncated silently')
  return allResults
}

/** Keep PostgREST URLs bounded when resolving a complete set of UUIDs. */
export async function fetchByIdChunks<T>(ids: string[], query: (chunk: string[]) => any, oneRowPerId = false): Promise<T[]> {
  const unique = [...new Set(ids)]
  const rows: T[] = []
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100)
    rows.push(...await fetchAllPaginated<T>(query(chunk), 1000, 100000, oneRowPerId ? chunk.length : undefined))
  }
  return rows
}
