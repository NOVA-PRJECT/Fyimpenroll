import { SLOT_RULES } from '../constants/courseCategories'
import { HOD_COURSE_CATEGORIES } from '@fyimp/contracts'
import type { Pathway } from '../types/course.types'

export function getBlueprintPathways(blueprint: Record<string, any> | null | undefined): Pathway[] {
  if (!blueprint) return []
  if (Array.isArray(blueprint.pathways) && blueprint.pathways.length) return blueprint.pathways
  const slots = Array.from({ length: 8 }, (_, i) => ({
    rule: blueprint[`slot_${i + 1}_rule`] || '',
    target: blueprint[`slot_${i + 1}_target`] || '',
    name: blueprint[`slot_${i + 1}_name`] || `Paper ${i + 1}`,
  }))
  while (slots.length && !slots[slots.length - 1].rule) slots.pop()
  return slots.length ? [{ id: 'legacy-default', name: 'Default', slots }] : []
}

export function isBasketCategory(target: string): boolean {
  return (HOD_COURSE_CATEGORIES as readonly string[]).includes(target)
}

export function normalizeSlotTarget(rule: string, target?: string | null): string {
  if (rule === SLOT_RULES.POOL_RESTRICTED) return 'POOLED'
  if (rule === SLOT_RULES.GLOBAL_BASKET) return (target || '').trim().toUpperCase()
  return (target || '').trim()
}

/** Resolve a configured slot first, including slots 7/8. Only absent minor slots get the legacy rule. */
export function getStudentSlotDefinition(pathway: { slots?: any[] } | undefined, slot: number, departmentId: string) {
  if (!pathway || !Array.isArray(pathway.slots) || slot < 1 || slot > 8) return undefined
  const configured = pathway.slots[slot - 1]
  if (configured?.rule) return configured
  if (slot >= 7) return { rule: 'LEGACY_MINOR', target: departmentId, name: `Paper ${slot} (Minor Elective)` }
  return undefined
}

export function normalizeCourseCode(code: string | null | undefined): string {
  if (!code) return ''
  let trimmed = code.trim().toUpperCase()
  // Normalize KU1/KU2/KU3 to KU01/KU02/KU03
  trimmed = trimmed.replace(/^KU([1-9])(DSC|MDC|AEC|VAC|SEC|DSS|DSE)/, 'KU0$1$2')
  return trimmed
}

export function isCourseEligibleForSlot(
  course: {
    course_code: string
    department_id: string
    category: string
    semester: number
  },
  rule: string,
  target: string,
  studentDepartmentId: string,
  deptMap: Map<string, string>,
  studentSemester: number,
  slotName?: string
): boolean {
  if (!Number.isInteger(studentSemester) || course.semester !== studentSemester) return false
  if (rule === 'LEGACY_MINOR') {
    return course.department_id !== studentDepartmentId && ['DSC', 'DSE', 'DSS', 'MDC'].includes(course.category)
  }
  if (
    rule === SLOT_RULES.FIXED ||
    rule === SLOT_RULES.AEC_ELECT ||
    rule === SLOT_RULES.CAMPUS_FIXED
  ) {
    return normalizeCourseCode(course.course_code) === normalizeCourseCode(target)
  }

  if (rule === SLOT_RULES.DEPT_RESTRICTED) {
    if (!target) return false
    const allowedDeptCodes = target.split(',').map(code => code.trim().toUpperCase())
    const allowedDeptIds = allowedDeptCodes
      .map(code => deptMap.get(code) || (Array.from(deptMap.values()).includes(code) ? code : undefined))
      .filter((id): id is string => id !== undefined)
    return allowedDeptIds.includes(course.department_id) && ['DSC', 'DSE', 'DSS'].includes(course.category)
  }

  if (rule === SLOT_RULES.EXCLUDE_DEPT) {
    if (!target) return false
    const excludedDeptCodes = target.split(',').map(code => code.trim().toUpperCase())
    const excludedDeptIds = excludedDeptCodes
      .map(code => deptMap.get(code) || (Array.from(deptMap.values()).includes(code) ? code : undefined))
      .filter((id): id is string => id !== undefined)
    
    if (excludedDeptIds.includes(course.department_id)) {
      return false
    }

    const isMdc = (slotName && slotName.toUpperCase().includes('MDC')) || target.toUpperCase().includes('MDC')
    if (isMdc) {
      return course.category === 'MDC'
    }
    return ['DSC', 'DSE', 'DSS'].includes(course.category)
  }

  if (rule === SLOT_RULES.POOL_RESTRICTED) {
    return course.department_id === studentDepartmentId && course.category === 'DSE'
  }

  if (rule === SLOT_RULES.GLOBAL_BASKET) {
    const trimmedTarget = (target || '').trim().toUpperCase()
    if (!isBasketCategory(trimmedTarget) || course.category !== trimmedTarget) return false

    if (trimmedTarget === 'MDC' && course.department_id === studentDepartmentId) {
      return false
    }
    return true
  }

  return false
}

export interface PrerequisiteRule {
  id?: string
  course_id: string
  rule: 'COMPLETED_COURSE' | 'COMPLETED_SEMESTER' | 'DEPARTMENT' | string
  target: string
  created_at?: string
}

export interface PrerequisiteEvaluationResult {
  eligible: boolean
  reason?: string
  score: number
}

/**
 * Validates pathway slots for duplicate fixed courses and unsupported slot counts (F20, D02).
 * Allows variable component sizes (1 to 8) to accommodate research and project semesters.
 */
export function validatePathwaySlots(
  slots: Array<{ rule: string; target?: string | null; name?: string | null }>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!Array.isArray(slots) || slots.length === 0) {
    errors.push('Pathway must contain at least one configured component/paper')
    return { valid: false, errors }
  }

  if (slots.length > 8) {
    errors.push(`Pathway contains ${slots.length} slots, exceeding maximum supported 8 slots`)
  }

  const fixedTargets = new Set<string>()
  const slotNumbers = new Set<number>()

  slots.forEach((s: any, idx) => {
    if (!s) {
      errors.push(`Slot ${idx + 1} definition is missing or null`)
      return
    }

    if (s.slot !== undefined && s.slot !== null) {
      if (slotNumbers.has(s.slot)) {
        errors.push(`Duplicate slot number ${s.slot} configured in pathway`)
      }
      slotNumbers.add(s.slot)
    }

    if (!s.rule) {
      errors.push(`Slot ${idx + 1} is missing a rule configuration`)
      return
    }

    if (s.rule === SLOT_RULES.GLOBAL_BASKET && !isBasketCategory((s.target || '').trim().toUpperCase())) {
      errors.push(`Slot ${idx + 1} (GLOBAL_BASKET) requires a supported course category`)
    }
    if (s.rule === SLOT_RULES.POOL_RESTRICTED && s.target !== 'POOLED') {
      errors.push(`Slot ${idx + 1} (POOL_RESTRICTED) requires target POOLED`)
    }

    const isFixed =
      s.rule === SLOT_RULES.FIXED ||
      s.rule === SLOT_RULES.AEC_ELECT ||
      s.rule === SLOT_RULES.CAMPUS_FIXED

    if (isFixed) {
      if (!s.target || !s.target.trim()) {
        errors.push(`Fixed slot ${idx + 1} (${s.rule}) requires a target course code`)
      } else {
        const norm = normalizeCourseCode(s.target)
        if (fixedTargets.has(norm)) {
          errors.push(
            `Duplicate fixed course detected: "${norm}" is configured in multiple compulsory slots (slot ${idx + 1})`,
          )
        } else {
          fixedTargets.add(norm)
        }
      }
    }
  })

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Evaluates prerequisite eligibility and scoring across all assignment paths (F19).
 * Prior registration in a course is treated as evidence of completion.
 * An ineligible student is strictly denied; eligible students are scored consistently.
 */
export function evaluateCoursePrerequisites(
  course: {
    id: string
    course_code: string
    semester: number
    prerequisite_course_ids?: string[] | null
  },
  rules: PrerequisiteRule[],
  student: {
    department_code?: string | null
    current_semester: number
  },
  completedCourseCodes: Set<string>,
  completedCourseIds: Set<string> = new Set(),
): PrerequisiteEvaluationResult {
  let earnedScore = 0

  // 1. Check legacy prerequisite_course_ids UUIDs if configured
  if (Array.isArray(course.prerequisite_course_ids) && course.prerequisite_course_ids.length > 0) {
    for (const prereqId of course.prerequisite_course_ids) {
      if (prereqId && !completedCourseIds.has(prereqId)) {
        return {
          eligible: false,
          reason: `Missing required prior registration for prerequisite course ID ${prereqId}`,
          score: 0,
        }
      }
    }
  }

  // 2. Check HOD-managed course_prerequisite_rules
  for (const r of rules) {
    if (r.rule === 'COMPLETED_COURSE') {
      const requiredCode = normalizeCourseCode(r.target)
      if (!completedCourseCodes.has(requiredCode)) {
        return {
          eligible: false,
          reason: `Missing required prior registration in prerequisite course ${r.target.trim().toUpperCase()}`,
          score: 0,
        }
      }
      earnedScore += 1
    } else if (r.rule === 'COMPLETED_SEMESTER') {
      const targetSem = parseInt(r.target.trim(), 10)
      if (isNaN(targetSem) || student.current_semester <= targetSem) {
        return {
          eligible: false,
          reason: `Requires completion of semester ${r.target.trim()} prior to enrolment (current semester: ${student.current_semester})`,
          score: 0,
        }
      }
      earnedScore += 1
    } else if (r.rule === 'DEPARTMENT') {
      const allowedCodes = r.target.split(',').map((c) => c.trim().toUpperCase())
      const dept = (student.department_code || '').trim().toUpperCase()
      if (!dept || !allowedCodes.includes(dept)) {
        return {
          eligible: false,
          reason: `Course enrollment is restricted to departments: ${r.target} (student department: ${dept || 'None'})`,
          score: 0,
        }
      }
      earnedScore += 1
    }
  }

  // Proximity points for ranking tie-breaks
  const proximityPoints = Math.max(0, student.current_semester - course.semester)
  earnedScore += proximityPoints

  return {
    eligible: true,
    score: earnedScore,
  }
}
