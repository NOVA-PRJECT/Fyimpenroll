/** Registered-credit reporting has no approved degree-compliance matrix yet. */
export const ADVISORY_MATRIX_VERSION = null
export const ADVISORY_CREDIT_DISCLAIMER =
  'This ledger reports registered credits, not passed courses or certified degree completion. ' +
  'Missing historical snapshots use current catalogue credits and are disclosed explicitly.'
export const UNRESOLVED_REQUIREMENT_NOTE =
  'Academic-level mappings, degree requirements and enforcement policy await approval. ' +
  'Registered totals remain available without definitive degree certification.'
export const CANONICAL_CATEGORIES = [
  'DSC', 'DSE', 'MDC', 'VAC', 'SEC', 'AEC', 'MOC', 'MOOC', 'INT', 'RPH', 'FWD', 'DSS', 'DMP', 'CIP',
] as const
export type CanonicalCategory = typeof CANONICAL_CATEGORIES[number]
export type LevelBandKey = '100s' | '200s' | '300s' | '400s' | '500s' | 'Unknown'
export const DEPARTMENT_ALIASES: Record<string, string> = {
  IT: 'CSE', CSE: 'IT', MATH: 'MAT', MATHEMATICS: 'MAT', ENG: 'ENG', ENGLISH: 'ENG',
  PHYSICS: 'PHY', CHEMISTRY: 'CHE', BOTANY: 'BOT', ZOOLOGY: 'ZOO',
}
export interface ParsedKuCourseCode {
  originalCode: string
  isValid: boolean
  semester?: number
  category?: string
  discipline?: string
  serialNumber?: string
  derivedLevelBand: LevelBandKey
}
/** KU / two-digit semester / category / discipline / serial. Serial is not level. */
export function parseKuCourseCode(rawCode: string, explicitLevel?: string | null): ParsedKuCourseCode {
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : ''
  const level: LevelBandKey = ['100s', '200s', '300s', '400s', '500s'].includes(explicitLevel || '')
    ? explicitLevel as LevelBandKey : 'Unknown'
  const match = code.match(/^KU(0[1-9]|10)(MOOC|DSC|DSE|MDC|VAC|SEC|AEC|MOC|INT|RPH|FWD|DSS|DMP|CIP)([A-Z]{2,4})(\d{3,4})$/)
  return {
    originalCode: code, isValid: !!match, derivedLevelBand: level,
    ...(match ? { semester: Number(match[1]), category: match[2], discipline: match[3], serialNumber: match[4] } : {}),
  }
}
