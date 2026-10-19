export function registrationSlotState({ allocationCompleted, submitted, windowOpen, persistedCourseId, fixed }: {
  allocationCompleted: boolean; submitted: boolean; windowOpen: boolean; persistedCourseId?: string | null; fixed: boolean
}) {
  const confirmed = allocationCompleted && !!persistedCourseId
  return {
    confirmed,
    badge: confirmed ? 'Confirmed Allocation' : fixed ? 'Fixed blueprint course' : submitted ? 'Preferences submitted' : 'Not registered',
    pendingTitle: !submitted ? 'Registration not submitted' : 'Awaiting allocation',
    pendingText: !submitted
      ? windowOpen ? 'Submit your course preferences before the registration deadline.' : 'The registration window closed before you submitted. Contact your HOD for assistance.'
      : 'Your preferences have been submitted. Course allocation has not completed yet.',
  }
}
