function emptyReviewQuery(){const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:null})};return q}
/**
 * Test Suite for Follow-up Plan 06:
 * OR-Tools rule compilation, durable JSON file overrides, independent validation,
 * and atomic draft/publication transitions (R17, R18, R19, R20, R21, R22).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')

// Dist modules
const { runOrtoolsSolver } = require('../dist/modules/timetable/solver/ortools-runner')
const { detectParallelGroups, validatePreflightRules } = require('../dist/modules/timetable/solver/loader')
const { validateTimetable, violationsToText } = require('../dist/modules/timetable/solver/validator')
const { TimetableService } = require('../dist/modules/timetable/timetable.service')
const { FileConstraintStoreService } = require('../dist/modules/timetable/solver/file-constraint-store.service')

describe('Follow-up Plan 06: OR-Tools Rule Compilation & Atomic Timetable Publication', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 1. R17: Semester 1 AEC Feasibility & Soft Theory Spread
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. R17: Semester 1 AEC Feasibility & Soft Theory Spread', () => {
    it('spreads an AEC option without a fixed paper day within Tuesday/Wednesday P4-P6', async () => {
      const payload = {
        academic_year: '2025-2026',
        semester: 1,
        campus_id: 'campus-1',
        courses: [
          {
            courseId: 'aec-eng-101',
            courseCode: 'KU01AECENG103',
            courseTitle: 'English for Communication',
            departmentId: 'dept-eng',
            category: 'AEC',
            theoryHours: 3,
            practicalHours: 0,
            isCrossDept: true,
            studentIds: ['s1', 's2', 's3'],
          },
        ],
        parallel_groups: [],
        teacher_reservations: [],
        constraints: {},
        config: { max_time_in_seconds: 10, num_workers: 2 },
      }

      const result = await runOrtoolsSolver(payload)

      assert.ok(
        result.status === 'OPTIMAL' || result.status === 'FEASIBLE',
        `Expected OPTIMAL or FEASIBLE for 3h AEC, got ${result.status}. Diagnostics: ${result.diagnostics.join('; ')}`
      )
      assert.strictEqual(result.assignments.length, 3, 'Must schedule exactly 3 contact hours')

      // Verify all sessions are strictly Tuesday (2) or Wednesday (3) and Period 4, 5, or 6
      const dayCounts = { 2: 0, 3: 0 }
      for (const a of result.assignments) {
        assert.ok([2, 3].includes(a.day), `AEC slot day must be Tue (2) or Wed (3), got Day ${a.day}`)
        assert.ok([4, 5, 6].includes(a.period), `AEC slot period must be P4-P6, got Period ${a.period}`)
        dayCounts[a.day] = (dayCounts[a.day] || 0) + 1
      }

      // One day must have 2 hours, and the other 1 hour
      const counts = Object.values(dayCounts).sort()
      assert.deepStrictEqual(counts, [1, 2], 'AEC 3 theory hours must fit into allowed 2 days as 1+2 periods')

      // Independent validator verifies with 0 violations
      const courseNodes = [
        {
          courseId: 'aec-eng-101',
          courseCode: 'KU01AECENG103',
          departmentId: 'dept-eng',
          category: 'AEC',
          theoryHours: 3,
          practicalHours: 0,
          studentIds: new Set(['s1', 's2', 's3']),
        },
      ]
      const response = {
        assignments: [
          {
            courseId: 'aec-eng-101',
            slots: result.assignments.map((a) => ({
              day: a.day,
              period: a.period,
              sessionType: 'theory',
              isLabBlock: false,
            })),
          },
        ],
      }
      const violations = validateTimetable(response, courseNodes, new Map(), [], [], { semester: 1 })
      assert.strictEqual(violations.length, 0, `Validator reported violations: ${violationsToText(violations).join('; ')}`)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. R18: Semester 3 VAC Window Enforcement & Preflight Blocking
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. R18: Semester 3 VAC Window Enforcement & Preflight Blocking', () => {
    it('schedules a 2-hour Semester 3 VAC course strictly on Monday P5+P6 (both 1-hour and 2-hour session units)', async () => {
      const payload = {
        academic_year: '2025-2026',
        semester: 3,
        campus_id: 'campus-1',
        courses: [
          {
            courseId: 'vac-env-101',
            courseCode: 'KU03VACENV201',
            courseTitle: 'Environmental Studies',
            departmentId: 'dept-env',
            category: 'VAC',
            theoryHours: 2,
            practicalHours: 0,
            isCrossDept: true,
            studentIds: ['s10', 's11'],
          },
        ],
        parallel_groups: [],
        teacher_reservations: [],
        constraints: {},
        config: { max_time_in_seconds: 10, num_workers: 2 },
      }

      const result = await runOrtoolsSolver(payload)

      assert.ok(result.status === 'OPTIMAL' || result.status === 'FEASIBLE', `VAC solve status: ${result.status}`)
      assert.strictEqual(result.assignments.length, 2)

      for (const a of result.assignments) {
        assert.strictEqual(a.day, 1, 'VAC session must be on Monday (Day 1)')
        assert.ok([5, 6].includes(a.period), 'VAC session must be in Period 5 or 6')
      }

      // Verify validator confirms Monday P5+P6 for VAC
      const courseNodes = [
        {
          courseId: 'vac-env-101',
          courseCode: 'KU03VACENV201',
          departmentId: 'dept-env',
          category: 'VAC',
          theoryHours: 2,
          practicalHours: 0,
          studentIds: new Set(['s10', 's11']),
        },
      ]
      const response = {
        assignments: [
          {
            courseId: 'vac-env-101',
            slots: result.assignments.map((a) => ({
              day: a.day,
              period: a.period,
              sessionType: 'theory',
              isLabBlock: false,
            })),
          },
        ],
      }
      const violations = validateTimetable(response, courseNodes, new Map(), [], [], { semester: 3 })
      assert.strictEqual(violations.length, 0)
    })

    it('accepts catalogue VAC hours for the solver to report sessions outside its window', () => {
      const courses = [
        {
          courseId: 'vac-excess',
          courseCode: 'KU03VACEXC201',
          category: 'VAC',
          theoryHours: 3,
          practicalHours: 0,
        },
      ]

      assert.doesNotThrow(() => validatePreflightRules(courses, 3))
    })

    it('solver reports 3-hour Semester 3 VAC as INFEASIBLE if passed directly', async () => {
      const payload = {
        academic_year: '2025-2026',
        semester: 3,
        campus_id: 'campus-1',
        courses: [
          {
            courseId: 'vac-3h',
            courseCode: 'KU03VACEXC201',
            category: 'VAC',
            theoryHours: 3,
            practicalHours: 0,
            studentIds: ['s1'],
          },
        ],
        parallel_groups: [],
        teacher_reservations: [],
        constraints: {},
      }

      const result = await runOrtoolsSolver(payload)
      assert.strictEqual(result.status, 'INFEASIBLE')
      assert.ok(result.diagnostics.some((d) => d.includes('exceeds the mandatory Semester 3 Monday P5+P6')))
    })

    it('independent validator rejects VAC placed outside Monday P5+P6', () => {
      const courses = [
        {
          courseId: 'vac-1',
          courseCode: 'KU03VACENV201',
          category: 'VAC',
          theoryHours: 2,
          practicalHours: 0,
          studentIds: new Set(['s1']),
        },
      ]
      const response = {
        assignments: [
          {
            courseId: 'vac-1',
            slots: [
              { day: 1, period: 1, sessionType: 'theory', isLabBlock: false }, // Mon P1 (illegal)
              { day: 2, period: 3, sessionType: 'theory', isLabBlock: false }, // Tue P3 (illegal)
            ],
          },
        ],
      }
      const violations = validateTimetable(response, courses, new Map(), [], [], { semester: 3 })
      assert.strictEqual(violations.length, 2)
      assert.ok(violations.every((v) => v.type === 'invalid_window'))
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. R21: Strict Enforcement of Lab Blocks & Elimination of Odd Lab Exception
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. R21: Strict Lab Blocks & Elimination of Odd Practical Workarounds', () => {
    it('accepts odd practical catalogue hours for explicit unscheduled-session reporting', () => {
      const courses = [
        {
          courseId: 'bot-lab-1',
          courseCode: 'KU01DSCBOT101',
          category: 'DSC',
          theoryHours: 2,
          practicalHours: 1, // Odd practical hour!
        },
      ]

      assert.doesNotThrow(() => validatePreflightRules(courses, 1))
    })

    it('solver reports odd practical hours as INFEASIBLE without scheduling single-period workaround', async () => {
      const payload = {
        academic_year: '2025-2026',
        semester: 1,
        campus_id: 'campus-1',
        courses: [
          {
            courseId: 'c-odd',
            courseCode: 'KU01DSCBOT101',
            category: 'DSC',
            theoryHours: 2,
            practicalHours: 1,
            studentIds: ['s1'],
          },
        ],
        parallel_groups: [],
        teacher_reservations: [],
        constraints: {},
      }

      const result = await runOrtoolsSolver(payload)
      assert.strictEqual(result.status, 'INFEASIBLE')
      assert.ok(result.diagnostics.some((d) => d.includes('practicalHours=1 (odd number)')))
    })

    it('independent validator strictly rejects single practical periods or non-consecutive lab pairs', () => {
      const courses = [
        {
          courseId: 'c1',
          courseCode: 'KU01DSCPHY101',
          category: 'DSC',
          theoryHours: 2,
          practicalHours: 2,
          studentIds: new Set(['s1']),
        },
      ]

      // Case A: Practical crossing lunch (P3+P4)
      const responseLunch = {
        assignments: [
          {
            courseId: 'c1',
            slots: [
              { day: 1, period: 1, sessionType: 'theory', isLabBlock: false },
              { day: 2, period: 1, sessionType: 'theory', isLabBlock: false },
              { day: 3, period: 3, sessionType: 'practical', isLabBlock: true },
              { day: 3, period: 4, sessionType: 'practical', isLabBlock: true }, // Crosses lunch!
            ],
          },
        ],
      }
      const violationsLunch = validateTimetable(responseLunch, courses, new Map(), [])
      assert.ok(violationsLunch.some((v) => v.type === 'lunch_overlap'))

      // Case B: Non-consecutive lab periods (P1 and P3 on same day)
      const responseNonConsec = {
        assignments: [
          {
            courseId: 'c1',
            slots: [
              { day: 1, period: 1, sessionType: 'theory', isLabBlock: false },
              { day: 2, period: 1, sessionType: 'theory', isLabBlock: false },
              { day: 3, period: 1, sessionType: 'practical', isLabBlock: true },
              { day: 3, period: 3, sessionType: 'practical', isLabBlock: true }, // Gap!
            ],
          },
        ],
      }
      const violationsNonConsec = validateTimetable(responseNonConsec, courses, new Map(), [])
      assert.ok(violationsNonConsec.some((v) => v.type === 'invalid_lab_block'))
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 4. R19: Typed Rule Compilation, Dynamic Time Limits & Rule Hashing
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. R19: Typed Rule Compilation & Dynamic Time Limits', () => {
    it('restricts schedule to Friday P6 when configured via typed CAMPUS_TIME_LIMIT rule', async () => {
      const payload = {
        academic_year: '2025-2026',
        semester: 1,
        campus_id: 'campus-friday',
        courses: [
          {
            courseId: 'c-short',
            courseCode: 'KU01DSCSHO101',
            category: 'DSC',
            theoryHours: 1,
            practicalHours: 0,
            studentIds: ['s1'],
          },
        ],
        parallel_groups: [],
        teacher_reservations: [],
        rules: [
          {
            id: 'rule_only_fri_p6',
            kind: 'CAMPUS_TIME_LIMIT',
            scope: 'campus',
            isHard: true,
            version: 1,
            description: 'Limit campus schedule strictly to Friday P6',
            parameters: {
              days: [5], // Friday only
              periods: [6], // Period 6 only
            },
          },
        ],
        constraints: {},
        config: { max_time_in_seconds: 10, num_workers: 2 },
      }

      const result = await runOrtoolsSolver(payload)

      assert.ok(result.status === 'OPTIMAL' || result.status === 'FEASIBLE', `Status: ${result.status}`)
      assert.strictEqual(result.assignments.length, 1)
      assert.strictEqual(result.assignments[0].day, 5, 'Must be Friday (5)')
      assert.strictEqual(result.assignments[0].period, 6, 'Must be Period 6')
      assert.ok(result.stats.rule_hash, 'Must compute and return deterministic rule_hash')
    })

    it('rejects unsupported arbitrary text hard rules explicitly with MODEL_INVALID', async () => {
      const payload = {
        academic_year: '2025-2026',
        semester: 1,
        campus_id: 'campus-1',
        courses: [
          {
            courseId: 'c1',
            courseCode: 'KU01DSCMAT101',
            category: 'DSC',
            theoryHours: 1,
            practicalHours: 0,
            studentIds: ['s1'],
          },
        ],
        parallel_groups: [],
        teacher_reservations: [],
        rules: [
          {
            id: 'unsupported_magic_text',
            kind: 'NATURAL_LANGUAGE_AI_PROMPT', // Unknown/unsupported kind!
            scope: 'global',
            isHard: true,
            version: 1,
            description: 'Students prefer meditating on Wednesday afternoons',
          },
        ],
        constraints: {},
      }

      const result = await runOrtoolsSolver(payload)

      assert.strictEqual(result.status, 'MODEL_INVALID')
      assert.ok(result.diagnostics.some((d) => d.includes('Unsupported hard rule kind')))
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 5. R20: File-Store Persistence, Versioning & Cross-Campus Isolation
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. R20: File-Store Persistence, Versioning & Cross-Campus Isolation', () => {
    it('repository rules are read-only and browser edits never create campus override files', () => {
 const store=new FileConstraintStoreService();const first=store.getBaseConstraints();first.rules[0].description='Browser-only edit'
 assert.notEqual(store.getBaseConstraints().rules[0].description,'Browser-only edit');assert.equal(store.saveCampusOverrides,undefined)
})

    it('corrupt repository JSON stops rule loading', () => {
 const temporary=path.join(require('node:os').tmpdir(),'fyimp-rule-'+require('node:crypto').randomUUID()+'.json');fs.writeFileSync(temporary,'{broken')
 try { assert.throws(()=>new FileConstraintStoreService({baseFilePath:temporary}).getBaseConstraints(),/Cannot load repository/)} finally {fs.unlinkSync(temporary)}
})
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 6. R22: Atomic Draft Replacement, Publication Lock & Trigger Guard
  // ──────────────────────────────────────────────────────────────────────────
  describe('6. R22: Atomic Draft Replacement & Publication Immutability Guards', () => {
    it("rejects publication when an active generation job is running for the cohort", async () => {
 const service=new TimetableService({admin:{from:emptyReviewQuery,rpc:async(name)=>{assert.equal(name,'publish_timetable_cohort');return {error:{message:"Cannot publish while generation is active"}}}}},{log:async()=>{}},{warn:()=>{},error:()=>{}})
 await assert.rejects(service.publish('2026-27',1,{userId:'dir',role:'campus_director',campus_id:'host'},true),/Cannot publish while generation is active/)
})

    it("rejects publication when no draft entries exist for the cohort", async () => {
 const service=new TimetableService({admin:{from:emptyReviewQuery,rpc:async(name)=>{assert.equal(name,'publish_timetable_cohort');return {error:{message:"No verified current draft"}}}}},{log:async()=>{}},{warn:()=>{},error:()=>{}})
 await assert.rejects(service.publish('2026-27',1,{userId:'dir',role:'campus_director',campus_id:'host'},true),/No verified current draft/)
})

    it("disallows force publish from bypassing hard constraint violations", async () => {
 const service=new TimetableService({admin:{from:emptyReviewQuery,rpc:async(name)=>{assert.equal(name,'publish_timetable_cohort');return {error:{message:"Cannot publish with unresolved conflicts"}}}}},{log:async()=>{}},{warn:()=>{},error:()=>{}})
 await assert.rejects(service.publish('2026-27',1,{userId:'dir',role:'campus_director',campus_id:'host'},true),/Cannot publish with unresolved conflicts/)
})
  })
})
