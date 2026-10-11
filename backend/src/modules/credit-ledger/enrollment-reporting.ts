/** Flat registration slots are authoritative; JSON selections carry snapshots only. */
export function registrationSlots(registration: Record<string, any>) {
  return Array.from({ length: 8 }, (_, index) => ({
    slot: index + 1,
    courseId: registration[`slot_${index + 1}_course_id`] as string | null,
  })).filter((item) => item.courseId)
}

export function registrationCompletion(registration: Record<string, any>, pathways: any[]) {
  const pathway = pathways.find((item) => item.id === registration.pathway_id)
    ?? (pathways.length === 1 ? pathways[0] : undefined)
  if (!pathway || !Array.isArray(pathway.slots)) {
    return { state: 'Unknown: pathway unavailable', missingRequired: [], missingAdditional: [] }
  }
  const missingRequired: string[] = []
  const missingAdditional: string[] = []
  pathway.slots.forEach((slot: any, index: number) => {
    const number = Number(slot.slot_number ?? slot.slot ?? index + 1)
    if (number < 1 || number > 8) return
    if (!registration[`slot_${number}_course_id`]) {
      (number >= 7 || slot.required === false || slot.is_required === false
        ? missingAdditional : missingRequired).push(`Slot ${number}`)
    }
  })
  return { state: missingRequired.length ? 'Unresolved' : 'Allocated', missingRequired, missingAdditional }
}
