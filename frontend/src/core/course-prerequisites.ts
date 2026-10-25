export interface PrerequisiteContext {
  studentId: string
  academicYear: string
  semester: number
}

export interface PrerequisiteCourse { id: string; prerequisites?: string[] }

export interface PrerequisiteReviewGroup<T extends PrerequisiteCourse> {
  course: T
  placements: string[]
  informational: boolean
}

/** Show each course once, including every rank/paper where it was selected. */
export function groupCoursePrerequisites<T extends PrerequisiteCourse>(
  selections: Array<{ course: T; placement: string; informational: boolean }>,
): PrerequisiteReviewGroup<T>[] {
  const groups = new Map<string, PrerequisiteReviewGroup<T>>()
  for (const selection of selections) {
    const existing = groups.get(selection.course.id)
    if (existing) {
      if (!existing.placements.includes(selection.placement)) existing.placements.push(selection.placement)
      existing.informational = existing.informational && selection.informational
    } else {
      groups.set(selection.course.id, {
        course: selection.course,
        placements: [selection.placement],
        informational: selection.informational,
      })
    }
  }
  return [...groups.values()]
}

/** Browser guidance only. No declaration is sent to an API. */
export function createPrerequisiteAnswers(storage: () => Pick<Storage, 'getItem' | 'setItem'>) {
  const memory = new Map<string, boolean>()
  function key(context: PrerequisiteContext, course: PrerequisiteCourse) {
    // Exact ordered content acts as the revision: no hashing collisions or server version needed.
    return `fyimp_prerequisites:${JSON.stringify([context.studentId, context.academicYear, context.semester, course.id, course.prerequisites || []])}`
  }
  return {
    get(context: PrerequisiteContext, course: PrerequisiteCourse): boolean | undefined {
      if (!course.prerequisites?.length) return true
      const name = key(context, course)
      if (memory.has(name)) return memory.get(name)
      try {
        const value = storage().getItem(name)
        if (value === 'yes' || value === 'no') {
          const answer = value === 'yes'
          memory.set(name, answer)
          return answer
        }
      } catch { /* Storage unavailable: answers live for this page session. */ }
      return undefined
    },
    set(context: PrerequisiteContext, course: PrerequisiteCourse, answer: boolean) {
      const name = key(context, course)
      memory.set(name, answer)
      try { storage().setItem(name, answer ? 'yes' : 'no') } catch { /* Keep the in-memory answer. */ }
    },
  }
}
