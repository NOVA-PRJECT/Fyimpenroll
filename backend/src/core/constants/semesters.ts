export const SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

export type Semester = typeof SEMESTERS[number]

export const ODD_SEMESTERS = [1, 3, 5, 7, 9] as const
export const EVEN_SEMESTERS = [2, 4, 6, 8, 10] as const

/** @deprecated Slot count is now dynamic — derived from pathway.slots.length */