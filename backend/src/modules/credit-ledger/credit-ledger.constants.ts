/**
 * KU-FYIMP Regulation 2024 Credit Rules & Thresholds
 */

export const CATEGORY_REQUIREMENTS = {
  DSC: { name: 'Discipline Specific Core (DSC)', min3Year: 60, min4Year: 80 },
  DSE: { name: 'Discipline Specific Elective (DSE)', min3Year: 24, min4Year: 32 },
  MDC: { name: 'Multidisciplinary Course (MDC)', min3Year: 9, min4Year: 9 },
  VAC: { name: 'Value Addition Course (VAC)', min3Year: 6, min4Year: 6 },
  SEC: { name: 'Skill Enhancement Course (SEC)', min3Year: 9, min4Year: 9 },
  AEC: { name: 'Ability Enhancement Course (AEC)', min3Year: 9, min4Year: 9 },
  MOC: { name: 'Minor Open Elective (MOC)', min3Year: 8, min4Year: 12 },
  MOOC: { name: 'Massive Open Online Course (MOOC)', min3Year: 2, min4Year: 4 },
  INT: { name: 'Internship (INT)', min3Year: 4, min4Year: 4 },
  RPH: { name: 'Research Project / Honours (RPH)', min3Year: 0, min4Year: 12 },
  FWD: { name: 'Field Work / Dissertation (FWD)', min3Year: 0, min4Year: 4 },
  DSS: { name: 'Discipline Specific Skill (DSS)', min3Year: 6, min4Year: 6 },
  DMP: { name: 'Department Major Project (DMP)', min3Year: 0, min4Year: 8 },
  CIP: { name: 'Community Interaction (CIP)', min3Year: 2, min4Year: 2 },
} as const

export const LEVEL_BAND_REQUIREMENTS = {
  '100s': { name: '100-Level Introductory', min: 24, firstDigit: '1' },
  '200s': { name: '200-Level Intermediate', min: 32, firstDigit: '2' },
  '300s': { name: '300-Level Advanced', min: 38, firstDigit: '3' },
  '400s': { name: '400-Level Honours / Advanced', min: 44, firstDigit: '4' },
  '500s': { name: '500-Level Integrated PG', min: 40, firstDigit: '5' },
} as const

export const DEGREE_EXIT_THRESHOLDS = {
  THREE_YEAR_UG: {
    title: '3-Year UG Exit',
    creditsRequired: 133,
    requiredBands: ['100s', '200s', '300s'] as const,
  },
  FOUR_YEAR_HONOURS: {
    title: '4-Year Honours Exit',
    creditsRequired: 177,
    requiredBands: ['100s', '200s', '300s', '400s'] as const,
  },
  FIVE_YEAR_INTEGRATED_PG: {
    title: '5-Year Integrated PG Exit',
    creditsRequired: 217,
    requiredBands: ['100s', '200s', '300s', '400s', '500s'] as const,
  },
} as const
