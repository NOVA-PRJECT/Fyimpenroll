import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common'
import { SupabaseService } from '../../core/database/supabase.service'
import { AuthUser } from '../../core/auth/types'
import {
  ADVISORY_MATRIX_VERSION,
  ADVISORY_CREDIT_DISCLAIMER,
  UNRESOLVED_REQUIREMENT_NOTE,
  CATEGORY_REQUIREMENTS,
  LEVEL_BAND_REQUIREMENTS,
  ADVISORY_DEGREE_EXIT_TARGETS,
  DEGREE_EXIT_THRESHOLDS,
  LevelBandKey,
  parseKuCourseCode,
} from './credit-ledger.constants'

export { LevelBandKey }

export interface RegisteredCourseItem {
  id: string
  courseCode: string
  title: string
  credits: number
  category: string
  normalizedCategory: string
  levelBand: LevelBandKey
  isAdditional?: boolean
  departmentId: string
  departmentName: string
  semester: number
}

@Injectable()
export class CreditLedgerService {
  private readonly logger = new Logger(CreditLedgerService.name)

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Extracts the academic level band by parsing course code components explicitly (F51).
   * Does NOT inspect leading digit of semester prefix.
   */
  deriveLevelBand(courseCode: string, explicitLevel?: string | null): LevelBandKey {
    return parseKuCourseCode(courseCode, explicitLevel).derivedLevelBand
  }

  /**
   * Maps course category and course code to one of the 14 canonical FYIMP categories:
   * DSC, DSE, MDC, VAC, SEC, AEC, MOC, MOOC, INT, RPH, FWD, DSS, DMP, CIP.
   */
  normalizeCategory(rawCategory: string, courseCode?: string, courseTitle?: string): string {
    const cat = (rawCategory || '').trim().toUpperCase()
    const code = (courseCode || '').trim().toUpperCase()
    const title = (courseTitle || '').trim().toUpperCase()

    // 1. Direct match on raw category if it is any of the canonical 14
    const CANONICAL = [
      'DSC', 'DSE', 'MDC', 'VAC', 'SEC', 'AEC', 'MOC',
      'MOOC', 'INT', 'RPH', 'FWD', 'DSS', 'DMP', 'CIP',
    ]
    if (CANONICAL.includes(cat)) {
      return cat
    }

    // 2. Check if courseCode equals or contains any canonical category tag
    // (Check MOOC before MOC to prevent substring prefix overlap)
    const CODE_TAGS = [
      'MOOC', 'DSC', 'DSE', 'MDC', 'VAC', 'SEC', 'AEC',
      'MOC', 'INT', 'RPH', 'FWD', 'DSS', 'DMP', 'CIP',
    ]
    for (const tag of CODE_TAGS) {
      if (code.includes(tag)) {
        return tag
      }
    }

    // 3. Fallback for title/keywords (internship, research project, dissertation, etc.)
    if (cat.includes('INTERN') || title.includes('INTERNSHIP') || code.includes('INTERN')) return 'INT'
    if (title.includes('HONOURS RESEARCH') || title.includes('RESEARCH PROJECT') || code.includes('RESEARCH')) return 'RPH'
    if (title.includes('FIELD WORK') || title.includes('DISSERTATION')) return 'FWD'
    if (title.includes('MAJOR PROJECT')) return 'DMP'
    if (title.includes('COMMUNITY INTERACTION')) return 'CIP'

    return cat || 'Other'
  }

  /**
   * Computes the complete registered-credit ledger for a student with access scoping (F50, F51, F52).
   */
  async getCreditLedger(targetStudentId: string, user: AuthUser) {
    // 1. Fetch target student profile
    const { data: student, error: studentError } = await this.supabase.admin
      .from('students')
      .select(`
        id,
        full_name,
        cap_application_number,
        current_semester,
        academic_year_joined,
        department_id,
        campus_id,
        departments ( id, name, code ),
        campuses ( id, name )
      `)
      .eq('id', targetStudentId)
      .single()

    if (studentError || !student) {
      throw new NotFoundException(`Student record not found for id ${targetStudentId}`)
    }

    // 2. Enforce Role & Relationship Scoping (F06: Fail-closed on missing affiliation, deny teaching_staff)
    if (user.role === 'student') {
      if (user.userId !== targetStudentId) {
        throw new ForbiddenException('Students are only authorized to view their own credit ledger')
      }
    } else if (user.role === 'teaching_staff') {
      throw new ForbiddenException('Teaching staff is roster-only and not authorized to access student credit ledgers')
    } else if (user.role === 'hod') {
      if (!user.department_id) {
        throw new ForbiddenException('HOD has no department affiliation (access denied)')
      }
      if (student.department_id !== user.department_id) {
        throw new ForbiddenException('HODs may only access students within their department')
      }
      if (!user.campus_id) {
        throw new ForbiddenException('HOD has no campus affiliation (access denied)')
      }
      if (student.campus_id !== user.campus_id) {
        throw new ForbiddenException('HODs may only access students within their campus')
      }
    } else if (user.role === 'campus_director') {
      if (!user.campus_id) {
        throw new ForbiddenException('Campus Director has no campus affiliation (access denied)')
      }
      if (student.campus_id !== user.campus_id) {
        throw new ForbiddenException('Campus Directors may only access students affiliated with their campus')
      }
    } else if (user.role === 'teacher') {
      if (!user.department_id) {
        throw new ForbiddenException('Teacher has no department affiliation (access denied)')
      }
      if (!user.campus_id) {
        throw new ForbiddenException('Teacher has no campus affiliation (access denied)')
      }
      // If student is outside teacher's home department/campus, check for active teaching assignment duty
      if (student.department_id !== user.department_id || student.campus_id !== user.campus_id) {
        const { data: assignments } = await this.supabase.admin
          .from('teacher_course_assignments')
          .select('course_id')
          .eq('teacher_id', user.userId)

        const assignedCourseIds = (assignments || []).map((a: any) => a.course_id)
        let hasSharedCourse = false
        if (assignedCourseIds.length > 0) {
          const filterConditions = assignedCourseIds
            .map((cid: string) => `slot_1_course_id.eq.${cid},slot_2_course_id.eq.${cid},slot_3_course_id.eq.${cid},slot_4_course_id.eq.${cid},slot_5_course_id.eq.${cid},slot_6_course_id.eq.${cid},slot_7_course_id.eq.${cid},slot_8_course_id.eq.${cid}`)
            .join(',')

          const { data: reg } = await this.supabase.admin
            .from('student_registrations')
            .select('id')
            .eq('student_id', targetStudentId)
            .or(filterConditions)
            .limit(1)

          if (reg && reg.length > 0) {
            hasSharedCourse = true
          }
        }

        if (!hasSharedCourse) {
          throw new ForbiddenException('Teachers may only access credit ledgers for students in their department or actively instructed courses')
        }
      }
    } else if (user.role !== 'superadmin') {
      throw new ForbiddenException(`Role '${user.role}' is not authorized to access credit ledgers`)
    }

    // 3. Fetch all registrations for this student across all semesters
    const { data: registrations, error: regError } = await this.supabase.admin
      .from('student_registrations')
      .select(`
        id,
        semester,
        academic_year,
        slot_1_course_id,
        slot_2_course_id,
        slot_3_course_id,
        slot_4_course_id,
        slot_5_course_id,
        slot_6_course_id,
        slot_7_course_id,
        slot_8_course_id,
        total_credits,
        selections
      `)
      .eq('student_id', targetStudentId)
      .order('semester', { ascending: true })

    if (regError) {
      throw new InternalServerErrorException(`Failed to retrieve registration records: ${regError.message}`)
    }

    // 4. Collect registered course IDs across flat slots (1-8) and selections JSONB
    // Pair each course ID with semester, core vs additional flag, and registration-time credit snapshots (F50)
    const courseSemesterMap = new Map<string, number>()
    const courseIdSet = new Set<string>()
    const coreCourseIdSet = new Set<string>()
    const additionalCourseIdSet = new Set<string>()
    const creditSnapshotMap = new Map<string, number>()

    for (const reg of registrations || []) {
      const sem = reg.semester

      // Slots 1 to 6 are Core slots
      for (let i = 1; i <= 6; i++) {
        const slotKey = `slot_${i}_course_id` as keyof typeof reg
        const courseId = reg[slotKey] as string | null
        if (courseId) {
          courseIdSet.add(courseId)
          coreCourseIdSet.add(courseId)
          if (!courseSemesterMap.has(courseId)) {
            courseSemesterMap.set(courseId, sem)
          }
        }
      }

      // Slots 7 and 8 are Additional / Elective papers
      for (let i = 7; i <= 8; i++) {
        const slotKey = `slot_${i}_course_id` as keyof typeof reg
        const courseId = reg[slotKey] as string | null
        if (courseId) {
          courseIdSet.add(courseId)
          additionalCourseIdSet.add(courseId)
          if (!courseSemesterMap.has(courseId)) {
            courseSemesterMap.set(courseId, sem)
          }
        }
      }

      // Selections JSONB (preserves registration-time credit snapshots and slot numbers)
      const rawSelections = (reg as any).selections
      const selectedList = Array.isArray(rawSelections)
        ? rawSelections
        : Array.isArray(rawSelections?.courses)
          ? rawSelections.courses
          : []

      for (const item of selectedList) {
        const cid = typeof item === 'string' ? item : item?.id || item?.course_id
        if (cid) {
          courseIdSet.add(cid)
          if (!courseSemesterMap.has(cid)) {
            courseSemesterMap.set(cid, sem)
          }

          if (typeof item === 'object') {
            if (item.credits != null && !isNaN(Number(item.credits))) {
              creditSnapshotMap.set(cid, Number(item.credits))
            }
            if (item.slot != null && Number(item.slot) >= 7) {
              additionalCourseIdSet.add(cid)
            } else if (item.slot != null && Number(item.slot) <= 6) {
              coreCourseIdSet.add(cid)
            }
          }
        }
      }
    }

    // 5. Query Course Details
    const courseIds = Array.from(courseIdSet)
    let courseRecords: any[] = []

    if (courseIds.length > 0) {
      const { data: courses, error: courseErr } = await this.supabase.admin
        .from('courses')
        .select(`
          id,
          course_code,
          title,
          credits,
          category,
          academic_level,
          department_id,
          departments ( id, name )
        `)
        .in('id', courseIds)

      if (courseErr) {
        throw new InternalServerErrorException(`Failed to retrieve course details: ${courseErr.message}`)
      }
      courseRecords = courses || []
    }

    // 6. Build the registered courses list with parsed levels and core/additional tags (F50, F51)
    const registeredCourses: RegisteredCourseItem[] = courseRecords.map((c) => {
      const levelBand = this.deriveLevelBand(c.course_code, c.academic_level)
      const normalizedCategory = this.normalizeCategory(c.category, c.course_code, c.title)
      const sem = courseSemesterMap.get(c.id) || 1
      const deptName = (c.departments as any)?.name || 'General'

      // Use registration-time credit snapshot if present, otherwise fall back to catalog value (F50)
      const snapshotCredits = creditSnapshotMap.get(c.id)
      const credits = (snapshotCredits != null && !isNaN(snapshotCredits)) ? snapshotCredits : (Number(c.credits) || 0)
      const isAdditional = additionalCourseIdSet.has(c.id) && !coreCourseIdSet.has(c.id)

      return {
        id: c.id,
        courseCode: c.course_code,
        title: c.title,
        credits,
        category: c.category || 'General',
        normalizedCategory,
        levelBand,
        isAdditional,
        departmentId: c.department_id,
        departmentName: deptName,
        semester: sem,
      }
    })

    // 7. Aggregate Total, Core and Additional Registered Credits (F50)
    const coreCredits = registeredCourses
      .filter((c) => !c.isAdditional)
      .reduce((acc, c) => acc + c.credits, 0)

    const additionalCredits = registeredCourses
      .filter((c) => c.isAdditional)
      .reduce((acc, c) => acc + c.credits, 0)

    const totalCredits = coreCredits + additionalCredits

    // 8. Aggregate Category Breakdown
    const catCreditsMap = new Map<string, number>()
    for (const c of registeredCourses) {
      const current = catCreditsMap.get(c.normalizedCategory) || 0
      catCreditsMap.set(c.normalizedCategory, current + c.credits)
    }

    const categoryKeys = Object.keys(CATEGORY_REQUIREMENTS) as (keyof typeof CATEGORY_REQUIREMENTS)[]
    const categories = categoryKeys.map((catKey) => {
      const req = CATEGORY_REQUIREMENTS[catKey]
      const registered = catCreditsMap.get(catKey) || 0
      const shortfall3Year = Math.max(0, req.min3Year - registered)
      const shortfall4Year = Math.max(0, req.min4Year - registered)
      return {
        category: catKey,
        title: req.name,
        registeredCredits: registered,
        earned: registered, // Backward-compatible alias
        min3Year: req.min3Year,
        min4Year: req.min4Year,
        shortfall3Year,
        shortfall4Year,
        isMet3Year: (req.min3Year as number) <= 0 || registered >= req.min3Year,
        isMet4Year: (req.min4Year as number) <= 0 || registered >= req.min4Year,
        advisoryStatus: registered >= req.min3Year ? 'meets_benchmark' : 'in_progress',
      }
    })

    // 9. Aggregate Level Band Breakdown (F51: includes 100s, 200s, 300s, 400s, 500s, Unknown)
    const bandCreditsMap = new Map<string, number>()
    for (const c of registeredCourses) {
      const current = bandCreditsMap.get(c.levelBand) || 0
      bandCreditsMap.set(c.levelBand, current + c.credits)
    }

    const levelBands: Array<{
      band: LevelBandKey
      title: string
      registeredCredits: number
      earned: number
      minimum: number
      shortfall: number
      isMet: boolean
      advisoryStatus: string
    }> = (Object.keys(LEVEL_BAND_REQUIREMENTS) as (keyof typeof LEVEL_BAND_REQUIREMENTS)[]).map(
      (bandKey) => {
        const req = LEVEL_BAND_REQUIREMENTS[bandKey]
        const registered = bandCreditsMap.get(bandKey) || 0
        const shortfall = Math.max(0, req.min - registered)
        return {
          band: bandKey,
          title: req.name,
          registeredCredits: registered,
          earned: registered, // Backward-compatible alias
          minimum: req.min,
          shortfall,
          isMet: registered >= req.min,
          advisoryStatus: registered >= req.min ? 'meets_benchmark' : 'in_progress',
        }
      }
    )

    // Include Unknown level band if any courses were unclassified
    const unknownCredits = bandCreditsMap.get('Unknown') || 0
    if (unknownCredits > 0) {
      levelBands.push({
        band: 'Unknown' as any,
        title: 'Unclassified / Non-Standard Level',
        registeredCredits: unknownCredits,
        earned: unknownCredits,
        minimum: 0,
        shortfall: 0,
        isMet: true,
        advisoryStatus: 'meets_benchmark',
      })
    }

    // 10. Aggregate Department Distribution
    const deptMap = new Map<string, { departmentId: string; departmentName: string; earned: number; count: number }>()
    for (const c of registeredCourses) {
      const key = c.departmentId || 'unknown'
      const existing = deptMap.get(key)
      if (existing) {
        existing.earned += c.credits
        existing.count += 1
      } else {
        deptMap.set(key, {
          departmentId: c.departmentId,
          departmentName: c.departmentName,
          earned: c.credits,
          count: 1,
        })
      }
    }

    const byDepartment = Array.from(deptMap.values()).sort((a, b) => b.earned - a.earned)

    // 11. Advisory Exit Benchmark Progress (F50, F52: Advisory, not certification)
    // 3-Year Exit Benchmark
    const unmetCat3Year: string[] = []
    for (const cat of categories) {
      if (cat.min3Year > 0 && !cat.isMet3Year) {
        unmetCat3Year.push(`${cat.category} (${cat.shortfall3Year} credits to benchmark)`)
      }
    }
    const unmetBands3Year: string[] = []
    for (const band of levelBands) {
      if (['100s', '200s', '300s'].includes(band.band) && !band.isMet) {
        unmetBands3Year.push(`${band.band} (${band.shortfall} credits to benchmark)`)
      }
    }
    const totalShortfall3Year = Math.max(0, ADVISORY_DEGREE_EXIT_TARGETS.THREE_YEAR_UG.targetCredits - totalCredits)
    const eligible3Year = totalShortfall3Year === 0 && unmetCat3Year.length === 0 && unmetBands3Year.length === 0

    // 4-Year Exit Benchmark
    const unmetCat4Year: string[] = []
    for (const cat of categories) {
      if (cat.min4Year > 0 && !cat.isMet4Year) {
        unmetCat4Year.push(`${cat.category} (${cat.shortfall4Year} credits to benchmark)`)
      }
    }
    const unmetBands4Year: string[] = []
    for (const band of levelBands) {
      if (['100s', '200s', '300s', '400s'].includes(band.band) && !band.isMet) {
        unmetBands4Year.push(`${band.band} (${band.shortfall} credits to benchmark)`)
      }
    }
    const totalShortfall4Year = Math.max(0, ADVISORY_DEGREE_EXIT_TARGETS.FOUR_YEAR_HONOURS.targetCredits - totalCredits)
    const eligible4Year = totalShortfall4Year === 0 && unmetCat4Year.length === 0 && unmetBands4Year.length === 0

    // 5-Year Integrated PG Exit Benchmark
    const unmetCat5Year = [...unmetCat4Year]
    const unmetBands5Year = [...unmetBands4Year]
    const band500 = levelBands.find((b) => b.band === '500s')
    if (band500 && !band500.isMet) {
      unmetBands5Year.push(`500s (${band500.shortfall} credits to benchmark)`)
    }
    const totalShortfall5Year = Math.max(0, ADVISORY_DEGREE_EXIT_TARGETS.FIVE_YEAR_INTEGRATED_PG.targetCredits - totalCredits)
    const eligible5Year = totalShortfall5Year === 0 && unmetCat5Year.length === 0 && unmetBands5Year.length === 0

    return {
      student: {
        id: student.id,
        fullName: student.full_name,
        capApplicationNumber: student.cap_application_number,
        currentSemester: student.current_semester,
        academicYearJoined: student.academic_year_joined,
        departmentName: (student.departments as any)?.name || 'Unknown',
        departmentCode: (student.departments as any)?.code || '',
        campusName: (student.campuses as any)?.name || 'Unknown',
      },
      advisoryMatrixVersion: ADVISORY_MATRIX_VERSION,
      disclaimer: ADVISORY_CREDIT_DISCLAIMER,
      unresolvedRequirementNote: UNRESOLVED_REQUIREMENT_NOTE,
      totalCredits,
      totalRegisteredCredits: totalCredits,
      coreCredits,
      additionalCredits,
      categories,
      levelBands,
      byDepartment,
      exitEligibility: {
        threeYear: {
          title: ADVISORY_DEGREE_EXIT_TARGETS.THREE_YEAR_UG.title,
          eligible: eligible3Year,
          advisoryEligible: eligible3Year,
          totalCredits,
          registeredCredits: totalCredits,
          requiredCredits: ADVISORY_DEGREE_EXIT_TARGETS.THREE_YEAR_UG.targetCredits,
          targetCredits: ADVISORY_DEGREE_EXIT_TARGETS.THREE_YEAR_UG.targetCredits,
          totalShortfall: totalShortfall3Year,
          unmetCategories: unmetCat3Year,
          unmetBands: unmetBands3Year,
          primaryShortfall: totalShortfall3Year > 0
            ? `${totalShortfall3Year} credits to benchmark`
            : unmetCat3Year.length > 0
              ? unmetCat3Year[0]
              : unmetBands3Year.length > 0
                ? unmetBands3Year[0]
                : 'Meets 3-Year UG Credit Benchmark (Advisory)',
          statusNote: 'Advisory assessment only. Final degree award requires University examination clearance.',
        },
        fourYear: {
          title: ADVISORY_DEGREE_EXIT_TARGETS.FOUR_YEAR_HONOURS.title,
          eligible: eligible4Year,
          advisoryEligible: eligible4Year,
          totalCredits,
          registeredCredits: totalCredits,
          requiredCredits: ADVISORY_DEGREE_EXIT_TARGETS.FOUR_YEAR_HONOURS.targetCredits,
          targetCredits: ADVISORY_DEGREE_EXIT_TARGETS.FOUR_YEAR_HONOURS.targetCredits,
          totalShortfall: totalShortfall4Year,
          unmetCategories: unmetCat4Year,
          unmetBands: unmetBands4Year,
          primaryShortfall: totalShortfall4Year > 0
            ? `${totalShortfall4Year} credits to benchmark`
            : unmetCat4Year.length > 0
              ? unmetCat4Year[0]
              : unmetBands4Year.length > 0
                ? unmetBands4Year[0]
                : 'Meets 4-Year Honours Credit Benchmark (Advisory)',
          statusNote: 'Advisory assessment only. Final degree award requires University examination clearance.',
        },
        fiveYear: {
          title: ADVISORY_DEGREE_EXIT_TARGETS.FIVE_YEAR_INTEGRATED_PG.title,
          eligible: eligible5Year,
          advisoryEligible: eligible5Year,
          totalCredits,
          registeredCredits: totalCredits,
          requiredCredits: ADVISORY_DEGREE_EXIT_TARGETS.FIVE_YEAR_INTEGRATED_PG.targetCredits,
          targetCredits: ADVISORY_DEGREE_EXIT_TARGETS.FIVE_YEAR_INTEGRATED_PG.targetCredits,
          totalShortfall: totalShortfall5Year,
          unmetCategories: unmetCat5Year,
          unmetBands: unmetBands5Year,
          primaryShortfall: totalShortfall5Year > 0
            ? `${totalShortfall5Year} credits to benchmark`
            : unmetCat5Year.length > 0
              ? unmetCat5Year[0]
              : unmetBands5Year.length > 0
                ? unmetBands5Year[0]
                : 'Meets 5-Year Integrated PG Credit Benchmark (Advisory)',
          statusNote: 'Advisory assessment only. Final degree award requires University examination clearance.',
        },
      },
      registeredCourses,
    }
  }
}
