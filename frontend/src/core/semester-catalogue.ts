export interface CatalogueSnapshot<T> {
  semester: number
  rows: T[] | undefined
  loading: boolean
  error: string
}

/** All refresh paths share one generation; abort alone cannot guard delayed responses. */
export function createSemesterCatalogue<T extends { semester: number; course_code: string; id: string }>(
  load: (semester: number, signal: AbortSignal) => Promise<T[]>,
  publish: (snapshot: CatalogueSnapshot<T>) => void,
  cached: (semester: number) => T[] | undefined = () => undefined,
) {
  let generation = 0, selected = 1, disposed = false
  let controller: AbortController | undefined
  async function select(semester: number) {
    if (disposed) return
    selected = semester
    const request = ++generation
    controller?.abort()
    const active = new AbortController()
    controller = active
    const rows = cached(semester)
    publish({ semester, rows, loading: true, error: '' })
    const current = () => request === generation && selected === semester && !active.signal.aborted
    try {
      const result = await load(semester, active.signal)
      if (!current()) return
      if (!Array.isArray(result) || result.some(row => row.semester !== semester)) throw new Error('The server returned courses for a different semester. Retry loading courses.')
      const sorted = [...result].sort((a, b) => a.course_code < b.course_code ? -1 : a.course_code > b.course_code ? 1 : a.id.localeCompare(b.id))
      publish({ semester, rows: sorted, loading: false, error: '' })
    } catch (error) {
      if (current()) publish({ semester, rows, loading: false, error: error instanceof Error ? error.message : 'Unable to load courses. Retry.' })
    }
  }
  return {
    select,
    start(semester: number) {
      disposed = false
      return select(semester)
    },
    refresh() { return select(selected) },
    invalidate() { return select(selected) },
    cancel() { generation++; controller?.abort() },
    dispose() { disposed = true; generation++; controller?.abort() },
  }
}
