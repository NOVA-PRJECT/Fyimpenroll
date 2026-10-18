export interface SchedulingRule {
  id: string
  kind: string
  scope: string
  description: string
  isHard: boolean
  weight?: number
  version?: number
  targetSemester?: number
  targetCategory?: string
  targetCourseId?: string
  targetDepartmentId?: string
  parameters?: Record<string, unknown>
}

export const WINDOW_RULE_KINDS = ['DAY_WINDOW', 'CAMPUS_TIME_LIMIT', 'CATEGORY_WINDOW']
export const SCHEDULING_CATEGORIES = ['DSC', 'MDC', 'AEC', 'SEC', 'VAC']
const RULE_KINDS = new Set([
  'NO_STUDENT_OVERLAP', 'NO_TEACHER_OVERLAP', 'TEACHER_RESERVATIONS', 'NO_LUNCH_OVERLAP',
  'EXACT_CONTACT_HOURS', 'LAB_CONSECUTIVE_PAIR', 'P6_LAST_RESORT', 'THEORY_SPREAD',
  'DEPARTMENT_TIME_PREFERENCE', ...WINDOW_RULE_KINDS, 'SESSION_BLOCK', 'PARALLEL_CATEGORY_SYNC',
])
const SCOPES = new Set(['global', 'campus', 'semester', 'category', 'course', 'department'])

export function appliesToSemester(rule: SchedulingRule, semester: number) {
  return rule.targetSemester === undefined || rule.targetSemester === semester
}

export function createWindowRule(kind: 'DAY_WINDOW' | 'CATEGORY_WINDOW', semester: number, id: string): SchedulingRule {
  return {
    id, kind, scope: kind === 'DAY_WINDOW' ? 'campus' : 'semester', targetSemester: semester,
    ...(kind === 'CATEGORY_WINDOW' ? { targetCategory: semester === 4 ? 'SEC' : 'AEC' } : {}),
    isHard: true, version: 1,
    description: `Semester ${semester} ${kind === 'CATEGORY_WINDOW' ? 'category' : 'campus'} availability`,
    parameters: { days: [1, 2, 3, 4, 5], periods: [1, 2, 3, 4, 5, 6] },
  }
}

export function validateSchedulingRules(rules: SchedulingRule[]): string {
  if (!rules.length || rules.length > 100) return 'Use between 1 and 100 scheduling rules.'
  if (new Set(rules.map(r => r.id)).size !== rules.length) return 'Each scheduling rule needs a unique ID.'
  for (const rule of rules) {
    if (!rule.id || !RULE_KINDS.has(rule.kind) || !SCOPES.has(rule.scope) || typeof rule.isHard !== 'boolean' ||
      typeof rule.description !== 'string' || !rule.description.trim() || rule.description.length > 500) return 'Each rule needs a valid type and a description.'
    if (rule.targetSemester !== undefined && (!Number.isInteger(rule.targetSemester) || rule.targetSemester < 1 || rule.targetSemester > 10)) return 'Choose a semester from 1 to 10, or all semesters.'
    if (rule.weight !== undefined && (!Number.isFinite(rule.weight) || rule.weight < 0 || rule.weight > 1000)) return 'Preference weights must be between 0 and 1000.'
    for (const key of ['days', 'allowed_days', 'periods', 'allowed_periods']) {
      const values = rule.parameters?.[key]
      const maximum = key.includes('days') ? 5 : 6
      if (values !== undefined && (!Array.isArray(values) || !values.length || values.length > maximum || values.some(n => !Number.isInteger(n) || n < 1 || n > maximum))) return 'Choose at least one valid day and period for every availability rule.'
    }
    if (rule.kind === 'CATEGORY_WINDOW' && !rule.targetCategory?.trim() && !rule.targetCourseId && !rule.targetDepartmentId && !rule.parameters?.courseCodes) return 'Choose a category or specific course for each category rule.'
    const codes = rule.parameters?.courseCodes
    if (codes !== undefined && (!Array.isArray(codes) || !codes.length || codes.length > 100 || codes.some(c => typeof c !== 'string' || !c.trim() || c.length > 100))) return 'Enter valid course codes, or leave the course-code field empty for the whole category.'
  }
  return ''
}

// Preserve every semester's rules and merge newly supplied repository defaults.
export function restoreBrowserRules(repositoryRules: SchedulingRule[], saved: string | null): SchedulingRule[] {
  if (!saved) return structuredClone(repositoryRules)
  const parsed: unknown = JSON.parse(saved)
  if (!Array.isArray(parsed) || parsed.some(r => !r || typeof r !== 'object')) throw new Error('Saved scheduling rules are invalid. Restore the default rules to continue.')
  const error = validateSchedulingRules(parsed)
  if (error) throw new Error(`Saved scheduling rules are invalid: ${error}`)
  const overrides = new Map((parsed as SchedulingRule[]).map(rule => [rule.id, rule]))
  const repositoryIds = new Set(repositoryRules.map(rule => rule.id))
  const merged = [...repositoryRules.map(rule => overrides.get(rule.id) ?? rule), ...(parsed as SchedulingRule[]).filter(rule => !repositoryIds.has(rule.id))]
  const mergedError = validateSchedulingRules(merged)
  if (mergedError) throw new Error(mergedError)
  return structuredClone(merged)
}
