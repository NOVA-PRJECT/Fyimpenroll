export const COURSE_CATEGORIES = {
  DSC: 'DSC',
  DSE: 'DSE',
  MDC: 'MDC',
  VAC: 'VAC',
  SEC: 'SEC',
  AEC: 'AEC',
  MOC: 'MOC',
  MOOC: 'MOOC',
  INT: 'INT',
  RPH: 'RPH',
  FWD: 'FWD',
  DSS: 'DSS',
  DMP: 'DMP',
  CIP: 'CIP',
} as const

export type CourseCategory = typeof COURSE_CATEGORIES[keyof typeof COURSE_CATEGORIES]

export const SLOT_RULES = {
  FIXED: 'FIXED',
  AEC_ELECT: 'AEC_ELECT',
  CAMPUS_FIXED: 'CAMPUS_FIXED',
  DEPT_RESTRICTED: 'DEPT_RESTRICTED',
  EXCLUDE_DEPT: 'EXCLUDE_DEPT',
  POOL_RESTRICTED: 'POOL_RESTRICTED',
  GLOBAL_BASKET: 'GLOBAL_BASKET',
} as const


export type SlotRule = typeof SLOT_RULES[keyof typeof SLOT_RULES]