import { getStudentSlotDefinition, isCourseEligibleForSlot } from './slotRules'

type Choice = { course_id: string; rank: number }
type Slot = { slot: number; rule?: string; name?: string; is_fixed?: boolean; choices: Choice[] }
type Course = { course_code: string; department_id: string; category: string; semester: number }

/** Validate against the current pathway, never the rule copied into an older preference submission. */
export function revalidateAllocationChoices(
  slots: Slot[],
  pathway: { slots?: any[] } | undefined,
  student: { department_id: string; current_semester: number },
  courses: Map<string, Course>,
  departments: Map<string, string>,
) {
  const skipped: Array<{ slot: number; course_id: string; rank: number; reason: string }> = []
  const validated = slots.map(slot => {
    const definition = getStudentSlotDefinition(pathway, slot.slot, student.department_id)
    const choices = slot.choices.filter(choice => {
      const course = courses.get(choice.course_id)
      const reason = !definition ? 'Pathway or slot no longer exists'
        : !course ? 'Course unavailable in allocation semester'
        : !isCourseEligibleForSlot(course, definition.rule, definition.target || '', student.department_id, departments, student.current_semester, definition.name)
          ? 'Course does not satisfy current slot rules and student semester' : ''
      if (reason) skipped.push({ slot: slot.slot, ...choice, reason })
      return !reason
    })
    const fixed = ['FIXED', 'AEC_ELECT', 'CAMPUS_FIXED'].includes(definition?.rule)
    return { ...slot, rule: definition?.rule, name: definition?.name || slot.name, choices,
      // An invalid fixed choice must remain unresolved, rather than count as allocated.
      is_fixed: fixed && choices.length > 0 }
  })
  return { slots: validated, skipped }
}
