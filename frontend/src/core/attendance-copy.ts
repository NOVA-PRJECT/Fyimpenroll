interface CopySlot {
  timetable_slot_id: string; course_id: string; period_number: number; is_marked: boolean
  is_lab_block?: boolean; session_type?: string; adjacent_practical_slot_id?: string | null; course_semester?: number
}
export function attendanceCopySource<T extends CopySlot>(periods: T[], target: T): T | undefined {
  if (![2,3,5,6].includes(target.period_number) || !(target.is_lab_block || target.session_type === 'practical')) return undefined
  return periods.find(source => source.is_marked && source.period_number === target.period_number - 1 &&
    source.adjacent_practical_slot_id === target.timetable_slot_id && source.course_id === target.course_id &&
    (source.is_lab_block || source.session_type === 'practical') && source.course_semester === target.course_semester)
}

/** Copy only a complete matching roster; missing/unmarked students must never become present by default. */
export function copiedAbsences(target: { id: string }[], source: { id: string; status?: string }[]) {
  const marks = new Map(source.map(student => [student.id, student.status]))
  if (marks.size !== source.length || new Set(target.map(student => student.id)).size !== target.length ||
    marks.size !== target.length || target.some(student => !['present','absent'].includes(marks.get(student.id) || ''))) {
    throw new Error('The period rosters differ or the source has incomplete marks. Mark this period manually.')
  }
  return new Set(target.filter(student => marks.get(student.id) === 'absent').map(student => student.id))
}
