'use client'

import { registrationSlotState } from '@/core/registration-display'
import LoadingState, { LoadingIndicator } from '@/components/LoadingState'

import { Check as UiCheck, ClipboardList as UiClipboardList, GraduationCap as UiGraduationCap, Info as UiInfo, RefreshCw as UiRefreshCw, TriangleAlert as UiTriangleAlert, X as UiX } from 'lucide-react'

import NavigationLink from '@/components/NavigationLink'
import { sessionRedirect } from '@/core/security/session-response'

import { logoutPortal } from '@/core/security/logout'

import { useState, useEffect, useEffectEvent, useRef } from 'react'
import { useRouter } from 'next/navigation'
import UniversityLogo from '@/components/UniversityLogo'
import styles from '../student-dashboard.module.css'
import { useBfcacheGuard } from '@/core/hooks/useBfcacheGuard'
import { useCurrentTime } from '@/core/hooks/useCurrentTime'
import CustomSelect, { Course } from './CourseSelect'
import AccessibleModal from '@/components/AccessibleModal'
import { createPrerequisiteAnswers, groupCoursePrerequisites, type PrerequisiteContext, type PrerequisiteReviewGroup } from '@/core/course-prerequisites'
interface BlueprintSlot {
  slot: number
  rule: string
  name: string
  course?: Course
  options?: Course[]
}

interface PathwaySummary {
  id: string
  name: string
}

interface BlueprintData {
  academicYear: string
  student?: { id: string; full_name: string; current_semester: number }
  window_status: 'OPEN' | 'CLOSED'
  windowOpen?: boolean
  deadline: string
  min_credits?: number
  max_credits?: number
  minCredits?: number
  maxCredits?: number
  slots?: BlueprintSlot[]
  minorCourses?: Course[]
  pathways?: PathwaySummary[]
  pathway_id?: string
  existingPreferences?: Record<string, { course_id: string; rank: number }[]>
  allocationMetadata?: Record<string, { status?: string; allocated_by?: string; reason?: string; allocated_course_id?: string; rank?: number }>
  allocationCompleted?: boolean
  allocationCompletedAt?: string | null
  submittedAt?: string | null
  availableSeats?: Record<string, number>
  existingSlots?: Record<string, string | null>
  allocatedCourses?: Record<string, Course>
  slotChangesRemaining?: number
  slotChangesNextReset?: string | null
}

interface StudentInfo {
  id: string
  full_name: string
  current_semester: number
}

interface SlotRankedPreferences {
  rank1: string
  rank2: string
  rank3: string
}

type PageState =
  | 'loading_blueprint'
  | 'closed'
  | 'error'
  | 'pathway_picker'
  | 'loading_slots'
  | 'ready'
  | 'submitting'
  | 'submitted'

export default function RegisterPage() {
  useBfcacheGuard()
  const router = useRouter()
  const [pageState, setPageState] = useState<PageState>('loading_blueprint')
  const [studentInfo, setStudentInfo] = useState<StudentInfo | null>(null)
  const [blueprint, setBlueprint] = useState<BlueprintData | null>(null)
  const currentTime = useCurrentTime(60000, blueprint?.deadline)
  const [resolvedSlots, setResolvedSlots] = useState<BlueprintSlot[]>([])
  const [selectedPathwayId, setSelectedPathwayId] = useState<string | null>(null)

  // Minor courses and optional papers state (up to 8 papers max)
  const [minorCourses, setMinorCourses] = useState<Course[]>([])
  const [extraSlotsCount, setExtraSlotsCount] = useState<number>(0)

  // Scored model preferences per slot
  const [rankedPreferences, setRankedPreferences] = useState<Record<number, SlotRankedPreferences>>({})
  const [existingSlots, setExistingSlots] = useState<Record<string, string | null>>({})
  const [allocationMetadata, setAllocationMetadata] = useState<Record<string, { status?: string; allocated_by?: string; reason?: string; allocated_course_id?: string; rank?: number }>>({})
  const [existingSubmission, setExistingSubmission] = useState<Record<string, unknown> | null>(null)
  const [serverWindowIsOpen, setWindowIsOpen] = useState<boolean>(true)

  // Post-allocation direct slot update states
  const [allocationCompleted, setAllocationCompleted] = useState<boolean>(false)
  const [availableSeats, setAvailableSeats] = useState<Record<string, number>>({})
  const [allocatedCourses, setAllocatedCourses] = useState<Record<string, Course>>({})
  const [editingSlot, setEditingSlot] = useState<number | null>(null)
  const [selectedCourseForSlot, setSelectedCourseForSlot] = useState<string>('')
  const [updatingSlot, setUpdatingSlot] = useState<boolean>(false)
  const [slotChangesRemaining, setSlotChangesRemaining] = useState<number>(3)
  const [slotChangesNextReset, setSlotChangesNextReset] = useState<string | null>(null)

  const hasSubmitted = !!blueprint?.submittedAt || pageState === 'submitted'
  const windowIsOpen = serverWindowIsOpen && !!blueprint?.deadline && currentTime < Date.parse(blueprint.deadline)

  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  const [prerequisiteAnswers] = useState(() => createPrerequisiteAnswers(() => window.sessionStorage))
  const [, refreshPrerequisiteAnswers] = useState(0)
  const [prerequisiteQuestion, setPrerequisiteQuestion] = useState<{ course: Course; accept: () => void } | null>(null)
  const [prerequisiteReview, setPrerequisiteReview] = useState<{ groups: PrerequisiteReviewGroup<Course>[]; fingerprint: string } | null>(null)
  const submissionPending = useRef(false)

  function prerequisiteContext(): PrerequisiteContext | undefined {
    const student = studentInfo || blueprint?.student
    if (!student?.id || !blueprint?.academicYear) return undefined
    return { studentId: student.id, academicYear: blueprint.academicYear, semester: student.current_semester }
  }

  function findCourse(courseId: string): Course | undefined {
    return allocatedCourses[courseId] || minorCourses.find(course => course.id === courseId)
      || resolvedSlots.flatMap(slot => [...(slot.options || []), ...(slot.course ? [slot.course] : [])]).find(course => course.id === courseId)
  }

  function prerequisiteUnavailable(course: Course): string | undefined {
    const context = prerequisiteContext()
    return context && prerequisiteAnswers.get(context, course) === false
      ? 'You answered No to this course’s prerequisites for this session.' : undefined
  }

  function confirmPrerequisites(courseId: string, accept: () => void, showOnSelection = false): boolean {
    if (!courseId) return true
    const course = findCourse(courseId)
    if (!course) { setError('Course details are unavailable. Refresh and try again.'); return false }
    if (!course.prerequisites?.length) return true
    const context = prerequisiteContext()
    if (!context) { setError('Registration context is unavailable. Refresh and try again.'); return false }
    const answer = prerequisiteAnswers.get(context, course)
    if (answer === true && !showOnSelection) return true
    if (answer === false) { setError(prerequisiteUnavailable(course) || 'This course cannot be selected in this session.'); return false }
    setPrerequisiteQuestion({ course, accept })
    return false
  }

  function answerPrerequisites(answer: boolean) {
    const question = prerequisiteQuestion
    const context = prerequisiteContext()
    if (!question || !context) return
    prerequisiteAnswers.set(context, question.course, answer)
    refreshPrerequisiteAnswers(value => value + 1)
    setPrerequisiteQuestion(null)
    if (answer) question.accept()
    else {
      // Clear only editable preferences, never confirmed allocations.
      if (!allocationCompleted) setRankedPreferences(previous => Object.fromEntries(Object.entries(previous).map(([slot, ranks]) => [slot, {
        rank1: ranks.rank1 === question.course.id ? '' : ranks.rank1,
        rank2: ranks.rank2 === question.course.id ? '' : ranks.rank2,
        rank3: ranks.rank3 === question.course.id ? '' : ranks.rank3,
      }])))
      setSelectedCourseForSlot(previous => previous === question.course.id ? '' : previous)
      setError('Choose another course. You answered No to the prerequisites for this course.')
    }
  }

  function chooseCourseForChange(courseId: string) {
    if (confirmPrerequisites(courseId, () => setSelectedCourseForSlot(courseId), true)) setSelectedCourseForSlot(courseId)
  }

  async function loadBlueprint() {
    try {
      const response = await fetch('/api/registrations/blueprint', { cache: 'no-store' })
      const data = await response.json()
      const destination = sessionRedirect(response.status, data)
      if (destination) { router.replace(destination); return }

      if (!response.ok) {
        const errMsg = data.message || data.error || 'Failed to load courses. Please try again.'
        setError(errMsg)
        setPageState('error')
        return
      }

      const rawBp = data.data ?? data
      const isOpen = rawBp.windowOpen !== undefined ? rawBp.windowOpen : rawBp.window_status !== 'CLOSED'
      setWindowIsOpen(isOpen)

      const isAllocCompleted = !!rawBp.allocationCompleted
      setAllocationCompleted(isAllocCompleted)
      if (rawBp.availableSeats) {
        setAvailableSeats(rawBp.availableSeats)
      }
      setAllocatedCourses(rawBp.allocatedCourses || {})

      setSlotChangesRemaining(rawBp.slotChangesRemaining !== undefined ? rawBp.slotChangesRemaining : 3)
      setSlotChangesNextReset(rawBp.slotChangesNextReset || null)

      if (data.student) {
        setStudentInfo({
          id: data.student.id,
          full_name: data.student.full_name,
          current_semester: data.student.current_semester,
        })
      }

      setBlueprint({
        ...rawBp,
        window_status: isOpen ? 'OPEN' : 'CLOSED',
      })

      const minors: Course[] = rawBp.minorCourses || []
      setMinorCourses(minors)

      setExistingSubmission(rawBp.submittedAt ? (rawBp.existingRegistration || {}) : null)

      setExistingSlots(rawBp.existingSlots || {})
      setAllocationMetadata(rawBp.allocationMetadata || {})

      // Hydrate preferences: In post-allocation mode, preferences have ZERO importance!
      // Active enrollments are driven exclusively by existingSlots from student_registrations.
      const existingPrefs = rawBp.existingPreferences || {}
      if (!isAllocCompleted) {
        const initialPrefs: Record<number, SlotRankedPreferences> = {}
        for (let i = 1; i <= 8; i++) {
          const list = existingPrefs[`slot_${i}`] || []
          const existingSlotCid = rawBp.existingSlots?.[`slot_${i}`] || ''
          initialPrefs[i] = {
            rank1: list.find((p: { rank: number; course_id: string }) => p.rank === 1)?.course_id || existingSlotCid || '',
            rank2: list.find((p: { rank: number; course_id: string }) => p.rank === 2)?.course_id || '',
            rank3: list.find((p: { rank: number; course_id: string }) => p.rank === 3)?.course_id || '',
          }
        }
        setRankedPreferences(initialPrefs)
      } else {
        const regSlots: Record<number, SlotRankedPreferences> = {}
        for (let i = 1; i <= 8; i++) {
          const slotCid = rawBp.existingSlots?.[`slot_${i}`] || ''
          regSlots[i] = { rank1: slotCid, rank2: '', rank3: '' }
        }
        setRankedPreferences(regSlots)
      }

      // Re-hydrate extraSlotsCount if slot 7 or 8 existed
      const configuredSlot7 = rawBp.slots?.some((slot: BlueprintSlot) => slot.slot === 7)
      const configuredSlot8 = rawBp.slots?.some((slot: BlueprintSlot) => slot.slot === 8)
      const hasSlot7 = !configuredSlot7 && (!!existingPrefs.slot_7?.length || !!rawBp.existingSlots?.slot_7)
      const hasSlot8 = !configuredSlot8 && (!!existingPrefs.slot_8?.length || !!rawBp.existingSlots?.slot_8)
      if (hasSlot8) {
        setExtraSlotsCount(configuredSlot7 ? 1 : 2)
      } else if (hasSlot7) {
        setExtraSlotsCount(1)
      } else {
        setExtraSlotsCount(0)
      }

      // Single pathway — slots already resolved
      if (rawBp.slots && rawBp.slots.length > 0) {
        setResolvedSlots(rawBp.slots)
        setSelectedPathwayId(rawBp.selectedPathwayId || rawBp.pathway_id || null)
        setPageState('ready')
        return
      }

      // Multiple pathways — show picker
      if (rawBp.pathways && rawBp.pathways.length > 1) {
        if (rawBp.selectedPathwayId) {
          setSelectedPathwayId(rawBp.selectedPathwayId)
        }
        setPageState('pathway_picker')
        return
      }

      if (!isOpen && !rawBp.existingSlots && !isAllocCompleted) {
        setPageState('closed')
        return
      }

      setPageState('ready')
    } catch {
      setError('Error loading registration blueprint. Please try again.')
      setPageState('error')
    }
  }

  const loadInitialBlueprint = useEffectEvent(() => { loadBlueprint() })
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Starts the registration API read for this mounted view.
    loadInitialBlueprint()
  }, [])

  async function handleUpdateSlot(slotNumber: number, courseId: string) {
    if (courseId !== existingSlots[`slot_${slotNumber}`]
      && !confirmPrerequisites(courseId, () => { void handleUpdateSlot(slotNumber, courseId) })) return
    if (!windowIsOpen || !blueprint?.deadline || Date.now() >= Date.parse(blueprint.deadline)) {
      setWindowIsOpen(false)
      setEditingSlot(null)
      setSelectedCourseForSlot('')
      setError('')
      return
    }
    if (!courseId) {
      setError('Please select an available paper from the list.')
      return
    }

    setUpdatingSlot(true)
    setError('')
    setSuccessMsg('')

    try {
      const res = await fetch('/api/registrations/update-slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot_key: `slot_${slotNumber}`,
          course_id: courseId,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        const message = typeof data.message === 'string' ? data.message : data.error || 'Failed to update course registration'
        if (res.status === 403 && /registration window.*closed|after the deadline/i.test(message)) {
          setWindowIsOpen(false)
          setEditingSlot(null)
          setSelectedCourseForSlot('')
          setError('')
          return
        }
        throw new Error(message)
      }

      if (data.slotChangesRemaining !== undefined) {
        setSlotChangesRemaining(data.slotChangesRemaining)
      }
      if (data.slotChangesNextReset !== undefined) {
        setSlotChangesNextReset(data.slotChangesNextReset)
      }

      // Optimistically update existingSlots and allocatedCourses immediately
      setExistingSlots((prev) => ({
        ...prev,
        [`slot_${slotNumber}`]: courseId,
      }))
      setRankedPreferences((prev) => ({
        ...prev,
        [slotNumber]: { rank1: courseId, rank2: '', rank3: '' },
      }))
      if (data.course) {
        setAllocatedCourses((prev) => ({
          ...prev,
          [courseId]: data.course,
        }))
      }

      setSuccessMsg(data.message || `Successfully assigned Paper ${slotNumber}!`)
      setEditingSlot(null)
      setSelectedCourseForSlot('')
      await loadBlueprint()
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : '') || 'Failed to update course registration')
    } finally {
      setUpdatingSlot(false)
    }
  }

  async function selectPathway(pathwayId: string) {
    setSelectedPathwayId(pathwayId)
    setPageState('loading_slots')
    setError('')

    try {
      const response = await fetch(
        `/api/registrations/pathway-slots?pathway_id=${encodeURIComponent(pathwayId)}`,
      )
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setError(data.error ?? data.message ?? 'Failed to load pathway courses.')
        setPageState('pathway_picker')
        return
      }

      const slots = data.data?.slots as BlueprintSlot[]
      setResolvedSlots(slots || [])
      setPageState('ready')
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : '') || 'Network error while loading pathway courses. Please try again.')
      setPageState('pathway_picker')
    }
  }

  // Configured slots always take precedence; extra minors use only unconfigured positions.
  const optionalMinorSlots = [7, 8].filter(number => !resolvedSlots.some(slot => slot.slot === number))
  const optionalMinorCount = Math.min(extraSlotsCount, optionalMinorSlots.length)
  const activeOptionalSlots = optionalMinorSlots.slice(0, optionalMinorCount)
  const isOptionalMinor = (number: number) => activeOptionalSlots.includes(number)
  const activeSlots: BlueprintSlot[] = [...resolvedSlots, ...activeOptionalSlots.map(number => ({
    slot: number, rule: 'EXCLUDE_DEPT', name: `Paper ${number} (Minor Elective)`, options: minorCourses,
  }))].sort((a, b) => a.slot - b.slot)

  function handleAddPaper() {
    if (!windowIsOpen || optionalMinorCount >= optionalMinorSlots.length) return
    setExtraSlotsCount(optionalMinorCount + 1)
    setError('')
  }

  function handleRemovePaper(slotNum: number) {
    if (!windowIsOpen || !isOptionalMinor(slotNum)) return
    setRankedPreferences(previous => {
      const next = { ...previous }
      const index = activeOptionalSlots.indexOf(slotNum)
      for (let i = index; i < activeOptionalSlots.length - 1; i++) {
        next[activeOptionalSlots[i]] = previous[activeOptionalSlots[i + 1]] || { rank1: '', rank2: '', rank3: '' }
      }
      delete next[activeOptionalSlots[activeOptionalSlots.length - 1]]
      return next
    })
    setExtraSlotsCount(Math.max(0, optionalMinorCount - 1))
    setError('')
  }

  function handlePreferenceChange(slotNumber: number, rank: 'rank1' | 'rank2' | 'rank3', courseId: string) {
    if (confirmPrerequisites(courseId, () => commitPreferenceChange(slotNumber, rank, courseId), true)) commitPreferenceChange(slotNumber, rank, courseId)
  }

  function commitPreferenceChange(
    slotNumber: number,
    rank: 'rank1' | 'rank2' | 'rank3',
    courseId: string,
  ) {
    setRankedPreferences((prev) => {
      const slotPrefs = { ...(prev[slotNumber] || { rank1: '', rank2: '', rank3: '' }) }
      slotPrefs[rank] = courseId

      // Auto-clear duplicates in other ranks of this slot
      if (courseId) {
        if (rank === 'rank1') {
          if (slotPrefs.rank2 === courseId) slotPrefs.rank2 = ''
          if (slotPrefs.rank3 === courseId) slotPrefs.rank3 = ''
        } else if (rank === 'rank2') {
          if (slotPrefs.rank1 === courseId) slotPrefs.rank1 = ''
          if (slotPrefs.rank3 === courseId) slotPrefs.rank3 = ''
        } else if (rank === 'rank3') {
          if (slotPrefs.rank1 === courseId) slotPrefs.rank1 = ''
          if (slotPrefs.rank2 === courseId) slotPrefs.rank2 = ''
        }
      }

      return {
        ...prev,
        [slotNumber]: slotPrefs,
      }
    })
    setError('')
  }

  // Helper to resolve the course metadata for a slot accurately
  function getCourseForSlot(slot: BlueprintSlot): Course | null {
    const slotNum = slot.slot
    const slotKey = `slot_${slotNum}`
    const existingCourseId = existingSlots[slotKey]

    // In post-allocation mode, the only authoritative paper is existingSlots[slotKey]
    const targetCourseId = allocationCompleted
      ? existingCourseId
      : (rankedPreferences[slotNum]?.rank1 || existingCourseId)

    if (!targetCourseId) {
      return !allocationCompleted && (slot.rule === 'FIXED' || slot.rule === 'CAMPUS_FIXED') ? (slot.course || null) : null
    }

    // 1. Direct course lookup in allocatedCourses map (from backend student_registrations)
    if (allocatedCourses[targetCourseId]) {
      return allocatedCourses[targetCourseId]
    }

    // 2. Look in this slot's blueprint options
    if (slot.options && slot.options.length > 0) {
      const found = slot.options.find((c) => c.id === targetCourseId)
      if (found) return found
    }

    // 3. Direct course attached to the slot (e.g. FIXED core papers)
    if (slot.course && slot.course.id === targetCourseId) {
      return slot.course
    }

    // 4. Look in minorCourses
    if (minorCourses.length > 0) {
      const inMinors = minorCourses.find((c) => c.id === targetCourseId)
      if (inMinors) return inMinors
    }

    // 5. Look across all slots in resolvedSlots (options or course)
    for (const s of resolvedSlots) {
      if (s.course && s.course.id === targetCourseId) return s.course
      if (s.options) {
        const found = s.options.find((c) => c.id === targetCourseId)
        if (found) return found
      }
    }

    // 6. Fallback only if fixed slot rule
    if (!allocationCompleted && (slot.rule === 'FIXED' || slot.rule === 'CAMPUS_FIXED')) {
      return slot.course || null
    }

    return null
  }

  // All configured blueprint papers contribute to the required pathway credits.
  function calculateBaseCredits(): number {
    if (!resolvedSlots.length) return 0
    let total = 0
    resolvedSlots.forEach((slot) => {
      const course = allocationCompleted && !existingSlots[`slot_${slot.slot}`] ? null : getCourseForSlot(slot)
      if (course && course.credits != null) {
        total += Number(course.credits) || 0
      }
    })
    return total
  }

  function calculateExtraCredits(): number {
    return activeOptionalSlots.reduce((total, number) => {
      const courseId = rankedPreferences[number]?.rank1 || existingSlots[`slot_${number}`]
      const course = minorCourses.find(item => item.id === courseId)
      return total + (Number(course?.credits) || 0)
    }, 0)
  }

  async function handleSubmit(reviewedFingerprint?: string) {
    if (submissionPending.current || !blueprint || !selectedPathwayId || !windowIsOpen) return
    if (Date.now() >= Date.parse(blueprint.deadline)) {
      setWindowIsOpen(false)
      setPrerequisiteReview(null)
      return
    }

    const preferencesPayload: Record<string, { course_id: string; rank: number }[]> = {}
    const chosenRank1Courses = new Map<string, number>()
    const reviewSelections: Array<{ course: Course; placement: string; informational: boolean }> = []

    for (const slot of activeSlots) {
      const isFixed =
        slot.rule === 'FIXED' ||
        slot.rule === 'CAMPUS_FIXED' ||
        slot.rule === 'AEC_ELECT' ||
        (!!slot.course && (!slot.options || slot.options.length === 0))

      if (isFixed && slot.course) {
        chosenRank1Courses.set(slot.course.id, slot.slot)
        reviewSelections.push({ course: slot.course, placement: `${slot.name} — Fixed paper (guidance)`, informational: true })
      } else {
        const slotKey = `slot_${slot.slot}`
        const currentPrefs = rankedPreferences[slot.slot] || { rank1: '', rank2: '', rank3: '' }
        const rank1Id = currentPrefs.rank1 || existingSlots[slotKey]

        if (!rank1Id) {
          setError(`Please select at least a 1st choice preference for "${slot.name}" (or click "Remove Paper" if not taking it).`)
          return
        }

        if (chosenRank1Courses.has(rank1Id)) {
          const prevSlot = chosenRank1Courses.get(rank1Id)
          setError(`Duplicate paper chosen: The paper selected in ${slot.name} is already selected in Paper ${prevSlot}. Each paper must be unique across all slots.`)
          return
        }
        chosenRank1Courses.set(rank1Id, slot.slot)

        const choices: { course_id: string; rank: number }[] = []
        choices.push({ course_id: rank1Id, rank: 1 })
        if (currentPrefs.rank2 && currentPrefs.rank2 !== rank1Id) {
          choices.push({ course_id: currentPrefs.rank2, rank: 2 })
        }
        if (
          currentPrefs.rank3 &&
          currentPrefs.rank3 !== rank1Id &&
          currentPrefs.rank3 !== currentPrefs.rank2
        ) {
          choices.push({ course_id: currentPrefs.rank3, rank: 3 })
        }

        for (const choice of choices) {
          if (!confirmPrerequisites(choice.course_id, () => { void handleSubmit() })) return
          const course = findCourse(choice.course_id)
          if (!course) { setError('Course details are unavailable. Refresh and try again.'); return }
          reviewSelections.push({ course, placement: `${slot.name} — Choice ${choice.rank}`, informational: false })
        }
        preferencesPayload[slotKey] = choices
      }
    }

    const groups = groupCoursePrerequisites(reviewSelections)
    const fingerprint = JSON.stringify([selectedPathwayId, blueprint.academicYear, studentInfo?.current_semester, preferencesPayload, groups])
    if (reviewedFingerprint !== fingerprint) {
      setError('')
      setPrerequisiteReview({ groups, fingerprint })
      return
    }

    submissionPending.current = true
    setPrerequisiteReview(null)
    setPageState('submitting')
    setError('')

    const idempotencyKey = crypto.randomUUID()

    try {
      const response = await fetch('/api/registrations/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          semester: Number(studentInfo?.current_semester || 1),
          pathway_id: selectedPathwayId,
          preferences: preferencesPayload,
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errMsg = data.message || data.error || `Submission failed (HTTP ${response.status}). Please try again.`
        setError(errMsg)
        if (response.status === 403 && (errMsg.toLowerCase().includes('closed') || errMsg.toLowerCase().includes('window'))) {
          setWindowIsOpen(false)
          setPageState('closed')
        } else {
          setPageState('ready')
        }
        return
      }

      if (typeof window !== 'undefined') {
        try {
          sessionStorage.removeItem('fyimp_student_summary')
        } catch {
          // Ignore storage error
        }
      }

      setSuccessMsg(data.message || 'Course preferences successfully saved!')
      setPageState('submitted')
      setTimeout(() => {
        router.push('/dashboard/student')
      }, 1500)
    } catch (err: unknown) {
      const msg = (err instanceof Error ? err.message : '') || 'Network connection failed. Your course preferences have been preserved. Please check your connection and click Submit again.'
      setError(msg)
      setPageState('ready')
    } finally {
      submissionPending.current = false
    }
  }

  async function handleLogout() {
    setLoggingOut(true)
    if (!await logoutPortal()) setLoggingOut(false)
  }

  function handleChangeTrack() {
    setResolvedSlots([])
    setPageState('pathway_picker')
  }

  const minCredits = blueprint?.minCredits ?? blueprint?.min_credits ?? 20
  const maxCredits = blueprint?.maxCredits ?? blueprint?.max_credits ?? 24
  const baseCredits = calculateBaseCredits()
  const extraCredits = calculateExtraCredits()
  const isValidCredits = blueprint
    ? baseCredits >= minCredits && baseCredits <= maxCredits
    : false

  return (
    <div className={styles.pageWrapper}>
      {/* Executive Top Bar */}
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <div className={styles.topBarBranding}>
            <div className={styles.logoSmall}>
              <UniversityLogo
                alt="KU"
                width={27}
                height={30}
                style={{ width: 'auto', height: '30px' }}
                priority
              />
            </div>
            <div className={styles.topBarTitles}>
              <p className={styles.topBarTitle}>FYIMP Portal</p>
              <p className={styles.topBarSubtitle}>Course Registration</p>
            </div>
          </div>
          <div className={styles.topBarDivider} />
          {studentInfo && (
            <div className={styles.studentIdentity}>
              <p className={styles.studentNameHeader}>{studentInfo.full_name}</p>
              <div className={styles.studentBadges}>
                <span className={styles.roleBadge}>FYIMP Student</span>
                <span className={styles.semBadgeTop}>Semester {studentInfo.current_semester ?? 1}</span>
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <NavigationLink
            href="/dashboard/student"
            className={styles.logoutBtn}
            style={{
              background: "var(--portal-info-bg,#f1f5f9)",
              color: "var(--portal-brand-text,#002147)",
              border: "1px solid var(--portal-strong-border,#cbd5e1)",
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            ← Back to Dashboard
          </NavigationLink>
          <button className={styles.logoutBtn} onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? <LoadingIndicator message="Logging out…" /> : 'Logout'}
          </button>
        </div>
      </header>

      {prerequisiteQuestion && (
        <AccessibleModal className={styles.prerequisiteOverlay} label="Course prerequisites" onClose={() => setPrerequisiteQuestion(null)}>
          <div className={styles.prerequisiteBackdrop}>
            <section className={styles.prerequisiteDialog}>
              <h2>Course prerequisites</h2>
              <p><strong>{prerequisiteQuestion.course.title}</strong> ({prerequisiteQuestion.course.course_code})</p>
              <ol>{prerequisiteQuestion.course.prerequisites?.map((point, index) => <li key={index}>{point}</li>)}</ol>
              <p>Do you meet all the prerequisites listed above?</p>
              <div className={styles.prerequisiteActions}>
                <button type="button" onClick={() => answerPrerequisites(true)}>Yes, I meet all</button>
                <button type="button" onClick={() => answerPrerequisites(false)}>No, I do not</button>
                <button type="button" onClick={() => setPrerequisiteQuestion(null)}>Cancel</button>
              </div>
            </section>
          </div>
        </AccessibleModal>
      )}

      {prerequisiteReview && (
        <AccessibleModal className={styles.prerequisiteOverlay} label="Review all course prerequisites" onClose={() => setPrerequisiteReview(null)}>
          <div className={styles.prerequisiteBackdrop}>
            <section className={`${styles.prerequisiteDialog} ${styles.prerequisiteReviewDialog}`}>
              <h2>Review all course prerequisites</h2>
              <p>Review the prerequisites for every ranked choice and fixed paper before submitting your preferences.</p>
              {prerequisiteReview.groups.map(group => (
                <section key={group.course.id} className={styles.prerequisiteReviewCourse} aria-label={`${group.course.course_code} prerequisites`}>
                  <h3>{group.course.title} ({group.course.course_code})</h3>
                  <p className={styles.prerequisiteReviewPlacement}>{group.placements.join(' · ')}</p>
                  {group.course.prerequisites?.length ? (
                    <ol>{group.course.prerequisites.map((point, index) => <li key={index}>{point}</li>)}</ol>
                  ) : <p>No prerequisites specified.</p>}
                  {group.informational && <p className={styles.prerequisiteReviewPlacement}>These points are guidance for a mandatory fixed paper.</p>}
                </section>
              ))}
              <div className={styles.prerequisiteActions}>
                <button type="button" disabled={!windowIsOpen || pageState === 'submitting'} onClick={() => {
                  const fingerprint = prerequisiteReview.fingerprint
                  setPrerequisiteReview(null)
                  void handleSubmit(fingerprint)
                }}>Confirm and submit preferences</button>
                <button type="button" onClick={() => setPrerequisiteReview(null)}>Back to preferences</button>
              </div>
            </section>
          </div>
        </AccessibleModal>
      )}

      <div className={styles.mainContent}>

        {/* Loading Blueprint */}
        {pageState === 'loading_blueprint' && (
          <LoadingState layout="cards" rows={3} message="Loading course registration…" />
        )}

        {/* Error / Blueprint Not Configured State */}
        {pageState === 'error' && (
          <div className={styles.closedState}>
            <div className={styles.closedIcon}><UiClipboardList size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></div>
            <p className={styles.closedTitle}>Registration Unavailable</p>
            <p className={styles.closedSubtitle}>
              {error || 'Your department course blueprint or campus registration settings are not currently available.'}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1rem' }}>
              <NavigationLink
                className={styles.closedBackBtn}
                href="/dashboard/student"
              >
                ← Back to Dashboard
              </NavigationLink>
              <button
                className={styles.closedBackBtn}
                style={{ background: '#0284c7', color: '#ffffff', borderColor: "var(--portal-info-border,#0284c7)" }}
                onClick={() => {
                  setError('')
                  setPageState('loading_blueprint')
                  window.location.reload()
                }}
              >
                ↻ Try Again
              </button>
            </div>
          </div>
        )}

        {/* Closed with no existing registration */}
        {pageState === 'closed' && (
          <div className={styles.closedState}>
            <div className={styles.closedIcon}><UiInfo size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></div>
            <p className={styles.closedTitle}>Registration Window is Closed</p>
            <p className={styles.closedSubtitle}>
              {error ||
                'The registration window for this semester is currently closed. Please check back when your Campus Director opens it.'}
            </p>
            {blueprint?.deadline && (
              <div className={styles.closedDeadline}>
                Last deadline was{' '}
                {new Date(blueprint.deadline).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            )}
            <NavigationLink
              className={styles.closedBackBtn}
              href="/dashboard/student"
            >
              ← Go Back
            </NavigationLink>
          </div>
        )}

        {/* Pathway Picker Hub */}
        {pageState === 'pathway_picker' && blueprint?.pathways && (
          <div className={styles.trackPickerContainer}>
            <div className={styles.trackHeader}>
              <span className={styles.trackCategoryTag}>
                <span><UiGraduationCap size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></span> ACADEMIC PATHWAY SELECTION
              </span>
              <h2 className={styles.trackTitle}>Select Your Academic Track</h2>
              <p className={styles.trackSubtitle}>
                Your department offers {blueprint.pathways.length} specialized course tracks for Semester{' '}
                {studentInfo?.current_semester ?? ''}. Choose your track to configure your paper preferences.
              </p>
            </div>

            <div className={styles.trackGrid}>
              {blueprint.pathways.map((pw, idx) => {
                const isSelected = selectedPathwayId === pw.id
                return (
                  <div
                    key={pw.id}
                    className={`${styles.trackCard} ${isSelected ? styles.trackCardSelected : ''}`}
                    onClick={() => selectPathway(pw.id)}
                  >
                    <div>
                      <div className={styles.trackCardHeader}>
                        <span className={styles.trackNumberBadge}>TRACK {idx + 1}</span>
                        <h3 className={styles.trackCardTitle}>{pw.name}</h3>
                        <span className={styles.trackMetaTag}>
                          Sem {studentInfo?.current_semester ?? ''}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className={styles.trackActionButton}
                      onClick={(e) => {
                        e.stopPropagation()
                        selectPathway(pw.id)
                      }}
                    >
                      {isSelected ? 'Continue with Selected Track →' : 'Select Track & Continue →'}
                    </button>
                  </div>
                )
              })}
            </div>

            {error && <div className={styles.errorBanner} style={{ marginTop: '1rem' }}>{error}</div>}
          </div>
        )}

        {/* Loading Pathway Slots */}
        {pageState === 'loading_slots' && (
          <LoadingState layout="cards" message="Loading track courses…" />
        )}

        {/* Ready / Submitting / Submitted */}
        {(pageState === 'ready' || pageState === 'submitting' || pageState === 'submitted') &&
          blueprint &&
          resolvedSlots.length > 0 && (
            <>
              {/* Window Status Banner */}
              {!windowIsOpen ? (
                <div role="status" className={`${styles.windowBanner} ${styles.closed}`}>
                  <div className={styles.windowDot} />
                  <div>
                    <strong>Registration window is closed — course changes are locked.</strong>
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem' }}>
                      {allocationCompleted ? 'Persisted allocations remain available to view. Course changes are locked.' : hasSubmitted ? 'Your preferences are submitted and awaiting allocation. Course changes are locked.' : 'No registration has been submitted. Blueprint courses below are not confirmed allocations. Contact your HOD for assistance.'}
                    </p>
                  </div>
                </div>
              ) : allocationCompleted ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1.25rem' }}>
                  <div
                    className={styles.windowBanner}
                    style={{
                      background: 'rgba(2, 132, 199, 0.08)',
                      borderColor: "var(--portal-info-border,#0284c7)",
                      color: "var(--portal-info-text,#0369a1)",
                      margin: 0,
                    }}
                  >
                    <div className={styles.windowDot} style={{ background: '#0284c7' }} />
                    Course Allocation Complete — Direct Seat Registration Mode (Seats update in real time; only papers with available seats can be chosen)
                  </div>

                  {/* 27-Hour Slot Change Quota Indicator */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '0.75rem',
                      padding: '0.8rem 1.1rem',
                      borderRadius: '0.5rem',
                      background: slotChangesRemaining > 0 ? "var(--portal-success-bg,#f0fdf4)" : "var(--portal-danger-bg,#fef2f2)",
                      border: `1px solid ${slotChangesRemaining > 0 ? "var(--portal-success-border,#bbf7d0)" : "var(--portal-danger-border,#fecaca)"}`,
                      color: slotChangesRemaining > 0 ? "var(--portal-success-text,#166534)" : "var(--portal-danger-text,#991b1b)",
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <span style={{ fontSize: '1.25rem' }}>
                        {slotChangesRemaining > 0 ? <UiRefreshCw size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /> : <UiInfo size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" />}
                      </span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>
                          Course Changes Remaining: {slotChangesRemaining} of 3
                        </div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.9, marginTop: '0.1rem' }}>
                          {slotChangesRemaining > 0
                            ? 'Policy: Maximum 3 course changes allowed within any rolling 27-hour period.'
                            : 'Rate limit reached: Maximum 3 changes used in the last 27 hours.'}
                        </div>
                      </div>
                    </div>
                    {slotChangesNextReset && (
                      <div
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          padding: '0.3rem 0.65rem',
                          borderRadius: '4px',
                          background: slotChangesRemaining > 0 ? "var(--portal-success-bg,#dcfce7)" : "var(--portal-danger-bg,#fee2e2)",
                          border: `1px solid ${slotChangesRemaining > 0 ? "var(--portal-success-border,#86efac)" : "var(--portal-danger-border,#fca5a5)"}`,
                        }}
                      >
                        {slotChangesRemaining === 0 ? 'Next change unlocks:' : 'Quota resets earliest:'}{' '}
                        {new Date(slotChangesNextReset).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        ({new Date(slotChangesNextReset).toLocaleDateString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                        })})
                      </div>
                    )}
                  </div>
                </div>
              ) : (() => {
                const isClosingSoon =
                  windowIsOpen && blueprint.deadline
                    ? new Date(blueprint.deadline).getTime() - currentTime <= 24 * 60 * 60 * 1000 &&
                      new Date(blueprint.deadline).getTime() > currentTime
                    : false
                const hoursLeft =
                  isClosingSoon && blueprint.deadline
                    ? Math.max(
                        0,
                        Math.floor((new Date(blueprint.deadline).getTime() - currentTime) / (1000 * 60 * 60)),
                      )
                    : null

                return (
                  <div
                    className={`${styles.windowBanner} ${
                      !windowIsOpen
                        ? styles.closed
                        : isClosingSoon
                        ? styles.closingSoon
                        : styles.open
                    }`}
                  >
                    <div className={styles.windowDot} />
                    {!windowIsOpen
                      ? 'Registration window is closed'
                      : isClosingSoon
                      ? `Closing Soon — Registration closes in ${hoursLeft} hour${
                          hoursLeft === 1 ? '' : 's'
                        } (${new Date(blueprint.deadline).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })})`
                      : `Registration open — closes ${new Date(blueprint.deadline).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`}
                  </div>
                )
              })()}

              {/* Change Track button (only for multi-pathway) */}
              {blueprint.pathways &&
                blueprint.pathways.length > 1 &&
                windowIsOpen &&
                !allocationCompleted &&
                pageState === 'ready' && (
                  <button
                    type="button"
                    onClick={handleChangeTrack}
                    style={{
                      background: "var(--portal-info-bg,#f8fafc)",
                      border: "1.5px solid var(--portal-border,#dde1e7)",
                      borderRadius: '0.4rem',
                      padding: '0.5rem 1rem',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      color: "var(--portal-brand-text,#002147)",
                      cursor: 'pointer',
                      marginBottom: '1rem',
                      width: '100%',
                      textAlign: 'center',
                    }}
                  >
                    ← Change Track
                  </button>
                )}

              {/* Credit Counter */}
              <div className={styles.creditCounter}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span className={styles.creditLabel}>
                      {allocationCompleted
                        ? 'Total Enrolled Credits:'
                        : windowIsOpen
                        ? 'Credits (Blueprint Papers):'
                        : 'Blueprint Credits (not confirmed allocations):'}
                    </span>
                    <span
                      className={`${styles.creditValue} ${
                        baseCredits === 0 ? '' : isValidCredits ? styles.valid : styles.invalid
                      }`}
                    >
                      {baseCredits}
                      <span className={styles.creditRange}>
                        &nbsp;(min {minCredits} — max {maxCredits})
                      </span>
                    </span>
                    {isValidCredits && (
                      <span style={{ fontSize: '0.72rem', background: "var(--portal-success-bg,#dcfce7)", color: "var(--portal-success-text,#15803d)", padding: '0.15rem 0.55rem', borderRadius: '9999px', fontWeight: 700 }}>
                        Valid Load
                      </span>
                    )}
                    {!isValidCredits && baseCredits > 0 && (
                      <span style={{ fontSize: '0.72rem', background: "var(--portal-danger-bg,#fee2e2)", color: "var(--portal-danger-text,#b91c1c)", padding: '0.15rem 0.55rem', borderRadius: '9999px', fontWeight: 700 }}>
                        <UiTriangleAlert size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /> {baseCredits < minCredits ? `Need ${minCredits - baseCredits} more cr` : `Exceeds max by ${baseCredits - maxCredits} cr`}
                      </span>
                    )}
                  </div>
                  {extraCredits > 0 && (
                    <span style={{ fontSize: '0.8rem', color: "var(--portal-info-text,#0284c7)", fontWeight: 600 }}>
                      + {extraCredits} optional minor credits ({optionalMinorCount} paper{optionalMinorCount > 1 ? 's' : ''} added)
                    </span>
                  )}
                </div>
              </div>

              <p className={styles.sectionTitle}>
                {allocationCompleted
                  ? windowIsOpen ? 'Your Course Allocations & Available Slots' : 'Course Allocation Status'
                  : windowIsOpen
                  ? 'Select Your Ranked Preferences'
                  : allocationCompleted ? 'Course Allocation Status' : 'Blueprint Courses & Registration Status'}
              </p>

              <div className={styles.slotsContainer}>
                {activeSlots.map((slot) => {
                  const isFixed =
                    slot.rule === 'FIXED' ||
                    slot.rule === 'CAMPUS_FIXED' ||
                    slot.rule === 'AEC_ELECT' ||
                    (!!slot.course && (!slot.options || slot.options.length === 0))
                  const slotKey = `slot_${slot.slot}`
                  const existingCourseId = existingSlots[slotKey]
                  const presentation = registrationSlotState({ allocationCompleted, submitted: hasSubmitted, windowOpen: windowIsOpen, persistedCourseId: existingCourseId, fixed: isFixed })
                  const isAllocated = presentation.confirmed
                  const slotAllocMeta = allocationMetadata[slotKey]
                  const isFixedSlot =
                    isFixed ||
                    slotAllocMeta?.allocated_by === 'fixed' ||
                    slot.rule === 'FIXED' ||
                    slot.rule === 'CAMPUS_FIXED' ||
                    slot.rule === 'AEC_ELECT'

                  // Find course metadata if allocated or fixed
                  const allocatedCourse = !allocationCompleted && isFixed ? (slot.course || getCourseForSlot(slot)) : getCourseForSlot(slot)

                  const isConfirmed = isAllocated
                  const showFixedBlueprint = isFixed && !!allocatedCourse
                  const isCurrentlyEditing = windowIsOpen && slotChangesRemaining > 0 && editingSlot === slot.slot

                  return (
                    <div
                      key={slot.slot}
                      className={`${styles.slotCard} ${isConfirmed ? styles.slotCardConfirmed : styles.active}`}
                    >
                      <div className={styles.slotHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <span className={styles.slotLabel}>
                          {slot.name}
                          {isOptionalMinor(slot.slot) && (
                            <span style={{ marginLeft: '0.6rem', fontSize: '0.68rem', padding: '0.15rem 0.45rem', borderRadius: '4px', background: "var(--portal-info-bg,#e0f2fe)", color: "var(--portal-info-text,#0369a1)", fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Minor Elective
                            </span>
                          )}
                        </span>
                        {isOptionalMinor(slot.slot) && windowIsOpen && !isConfirmed && (
                          <button
                            type="button"
                            onClick={() => handleRemovePaper(slot.slot)}
                            style={{
                              background: "var(--portal-danger-bg,#fef2f2)",
                              color: "var(--portal-danger-text,#dc2626)",
                              border: "1px solid var(--portal-danger-border,#fecaca)",
                              borderRadius: '0.375rem',
                              padding: '0.25rem 0.65rem',
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#fee2e2')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = '#fef2f2')}
                          >
                            Remove Paper
                          </button>
                        )}
                      </div>

                      {allocatedCourse?.prerequisites?.length ? (
                        <details style={{ margin: '0.5rem 0', fontSize: '0.8rem' }}>
                          <summary>Course prerequisites{isFixed ? ' (guidance)' : ''}</summary>
                          <ol style={{ listStyle: 'decimal', paddingLeft: '1.5rem' }}>{allocatedCourse.prerequisites.map((point, index) => <li key={index}>{point}</li>)}</ol>
                        </details>
                      ) : null}
                      {/* POST-ALLOCATION DIRECT REGISTRATION FLOW */}
                      {allocationCompleted ? (
                        isCurrentlyEditing ? (
                          /* Interactive Slot Editor Mode */
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                              <label style={{ fontSize: '0.75rem', color: "var(--portal-info-text,#0284c7)", fontWeight: 700, textTransform: 'uppercase' }}>
                                Select Open Course ({slot.name})
                              </label>
                              <span style={{ fontSize: '0.72rem', color: "var(--portal-muted,#64748b)" }}>
                                Showing papers with available seats
                              </span>
                            </div>

                            {(() => {
                              const rawOptions = isOptionalMinor(slot.slot) ? minorCourses : (slot.options ?? [])
                              const optionsWithSeats: Course[] = rawOptions
                                .map((c) => {
                                  const seats = availableSeats[c.id] ?? 0
                                  return {
                                    ...c,
                                    remaining_seats: seats,
                                  }
                                })
                                .filter((c) => (c.remaining_seats ?? 0) > 0 || c.id === existingCourseId)

                              return (
                                <>
                                  <CustomSelect
                                    unavailableReason={prerequisiteUnavailable}
                                    options={optionsWithSeats}
                                    value={selectedCourseForSlot || existingCourseId || ''}
                                    onChange={chooseCourseForChange}
                                    disabled={!windowIsOpen || updatingSlot}
                                    placeholder="— Select a course with open seats —"
                                  />

                                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.35rem' }}>
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateSlot(slot.slot, selectedCourseForSlot || existingCourseId || '')}
                                      disabled={!windowIsOpen || updatingSlot || slotChangesRemaining === 0 || (!selectedCourseForSlot && !existingCourseId)}
                                      style={{
                                        background: '#0284c7',
                                        color: '#ffffff',
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '0.5rem 1.1rem',
                                        fontSize: '0.8rem',
                                        fontWeight: 600,
                                        cursor: updatingSlot ? 'not-allowed' : 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.4rem',
                                      }}
                                    >
                                      {updatingSlot ? <LoadingIndicator message="Registering Seat…" /> : 'Confirm & Register Seat'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingSlot(null)
                                        setSelectedCourseForSlot('')
                                        setError('')
                                      }}
                                      disabled={updatingSlot}
                                      style={{
                                        background: "var(--portal-info-bg,#f1f5f9)",
                                        color: "var(--portal-info-text,#475569)",
                                        border: "1px solid var(--portal-strong-border,#cbd5e1)",
                                        borderRadius: '6px',
                                        padding: '0.5rem 0.9rem',
                                        fontSize: '0.8rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </>
                              )
                            })()}
                          </div>
                        ) : isConfirmed && allocatedCourse ? (
                          /* Confirmed Card with Change Option */
                          <div className={styles.confirmedCard}>
                            <div className={styles.confirmedCardBody}>
                              <div className={styles.confirmedBadgeRow} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                <span
                                  className={styles.confirmedBadge}
                                  style={{
                                    background: isFixedSlot ? "var(--portal-info-bg,#f1f5f9)" : "var(--portal-success-bg,#ecfdf5)",
                                    color: isFixedSlot ? "var(--portal-info-text,#475569)" : "var(--portal-success-text,#059669)",
                                    border: `1px solid ${isFixedSlot ? "var(--portal-strong-border,#cbd5e1)" : "var(--portal-success-border,#a7f3d0)"}`,
                                  }}
                                >
                                  {isFixedSlot ? 'Fixed Core Course' : 'Confirmed Allocation'}
                                </span>
                                {!isFixedSlot && windowIsOpen && (
                                  slotChangesRemaining > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingSlot(slot.slot)
                                        setSelectedCourseForSlot(existingCourseId || '')
                                        setError('')
                                      }}
                                      style={{
                                        background: "var(--portal-info-bg,#f0f9ff)",
                                        color: "var(--portal-info-text,#0284c7)",
                                        border: "1px solid var(--portal-info-border,#bae6fd)",
                                        borderRadius: '6px',
                                        padding: '0.3rem 0.75rem',
                                        fontSize: '0.76rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        transition: 'all 0.15s ease',
                                      }}
                                      onMouseEnter={(e) => (e.currentTarget.style.background = '#e0f2fe')}
                                      onMouseLeave={(e) => (e.currentTarget.style.background = '#f0f9ff')}
                                    >
                                      Change Course
                                    </button>
                                  ) : (
                                    <span
                                      title={slotChangesNextReset ? `Quota exhausted. Unlocks at ${new Date(slotChangesNextReset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Limit of 3 changes per 27 hours reached'}
                                      style={{
                                        fontSize: '0.72rem',
                                        padding: '0.25rem 0.55rem',
                                        borderRadius: '4px',
                                        background: "var(--portal-info-bg,#f1f5f9)",
                                        color: "var(--portal-muted,#64748b)",
                                        border: "1px solid var(--portal-strong-border,#cbd5e1)",
                                        fontWeight: 600,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.25rem',
                                        cursor: 'not-allowed',
                                      }}
                                    >
                                      Limit Reached (3/3)
                                    </span>
                                  )
                                )}
                              </div>

                              <h4 className={styles.confirmedTitle}>
                                {allocatedCourse.title || 'Allocated Paper'}
                              </h4>

                              <div className={styles.confirmedMeta}>
                                {allocatedCourse.course_code && (
                                  <span className={styles.confirmedCode}>
                                    {allocatedCourse.course_code}
                                  </span>
                                )}
                                <span className={styles.confirmedDept}>
                                  {allocatedCourse.department_name || 'General Department'}
                                </span>
                              </div>
                            </div>

                            {allocatedCourse.credits != null && (
                              <span className={styles.confirmedCreditPill}>
                                {allocatedCourse.credits} cr
                              </span>
                            )}
                          </div>
                        ) : (
                          /* Unallocated Slot in Post-Allocation Mode */
                          <div className={styles.unallocatedCard} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                            <div>
                              <p className={styles.unallocatedTitle} style={{ margin: 0 }}>
                                <span><UiTriangleAlert size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></span> Unassigned Paper Slot
                              </p>
                              <p className={styles.unallocatedText} style={{ margin: '0.25rem 0 0 0' }}>
                                {isFixedSlot ? 'This fixed paper is not assigned to your registration. Contact your HOD.' : windowIsOpen
                                  ? 'This slot is unassigned. Choose from courses with remaining seats.'
                                  : 'Registration is closed. Contact your department HOD about this unassigned slot.'}
                              </p>
                            </div>
                            {windowIsOpen && !isFixedSlot && <button
                              type="button"
                              onClick={() => {
                                setEditingSlot(slot.slot)
                                setSelectedCourseForSlot('')
                                setError('')
                              }}
                              disabled={slotChangesRemaining === 0}
                              style={{
                                background: slotChangesRemaining > 0 ? '#0284c7' : "var(--portal-info-bg,#94a3b8)",
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '0.4rem 0.9rem',
                                fontSize: '0.78rem',
                                fontWeight: 600,
                                cursor: slotChangesRemaining > 0 ? 'pointer' : 'not-allowed',
                              }}
                            >
                              {slotChangesRemaining > 0 ? 'Choose Course +' : 'Changes Locked'}
                            </button>}
                          </div>
                        )
                      ) : (
                        /* PRE-ALLOCATION MODE */
                        showFixedBlueprint && allocatedCourse ? (
                          <div className={`${styles.confirmedCard} ${styles.blueprintCourseCard}`}>
                            <div className={styles.confirmedCardBody}>
                              <div className={styles.confirmedBadgeRow}>
                                <span className={`${styles.confirmedBadge} ${styles.blueprintCourseBadge}`}>
                                  <UiInfo size="1em" aria-hidden="true" />
                                  Fixed blueprint course
                                </span>
                              </div>

                              <h4 className={styles.confirmedTitle}>
                                {allocatedCourse.title || 'Allocated Paper'}
                              </h4>

                              <div className={styles.confirmedMeta}>
                                {allocatedCourse.course_code && (
                                  <span className={styles.confirmedCode}>
                                    {allocatedCourse.course_code}
                                  </span>
                                )}
                                <span className={styles.confirmedDept}>
                                  {allocatedCourse.department_name || 'General Department'}
                                </span>
                              </div>
                            </div>

                            {allocatedCourse.credits != null && (
                              <span className={styles.confirmedCreditPill}>
                                {allocatedCourse.credits} cr
                              </span>
                            )}
                          </div>
                        ) : !windowIsOpen ? (
                          <div className={styles.unallocatedCard}>
                            <p className={styles.unallocatedTitle}>
                              <span><UiInfo size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></span> {presentation.pendingTitle}
                            </p>
                            <p className={styles.unallocatedText}>
                              {presentation.pendingText}
                            </p>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <p style={{ fontSize: '0.75rem', color: "var(--portal-muted,#64748b)", margin: 0 }}>
                              {isOptionalMinor(slot.slot)
                                ? 'Select an elective course offered by any department outside your own for this Minor Paper.'
                                : 'Rank your preferences for this paper. The algorithm allocates round-by-round based on capacity and ranking.'}
                            </p>

                            <div>
                              <div>
                                <label
                                  style={{
                                    fontSize: '0.72rem',
                                    color: "var(--portal-info-text,#0284c7)",
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    display: 'block',
                                    marginBottom: '0.25rem',
                                  }}
                                >
                                  1st Choice
                                </label>
                              </div>
                              <CustomSelect
                                    unavailableReason={prerequisiteUnavailable}
                                options={slot.options ?? []}
                                value={rankedPreferences[slot.slot]?.rank1 ?? ''}
                                onChange={(val) => handlePreferenceChange(slot.slot, 'rank1', val)}
                                disabled={pageState === 'submitting'}
                                placeholder="— Select 1st Choice Preference —"
                              />
                            </div>

                            {(slot.options?.length ?? 0) > 1 && (
                              <div>
                                <label
                                  style={{
                                    fontSize: '0.72rem',
                                    color: "var(--portal-muted,#64748b)",
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    display: 'block',
                                    marginBottom: '0.25rem',
                                  }}
                                >
                                  2nd Choice
                                </label>
                                <CustomSelect
                                    unavailableReason={prerequisiteUnavailable}
                                  options={(slot.options ?? []).filter(
                                    (c) => c.id !== rankedPreferences[slot.slot]?.rank1,
                                  )}
                                  value={rankedPreferences[slot.slot]?.rank2 ?? ''}
                                  onChange={(val) => handlePreferenceChange(slot.slot, 'rank2', val)}
                                  disabled={pageState === 'submitting'}
                                  placeholder="— Select 2nd Choice (Optional) —"
                                />
                              </div>
                            )}

                            {(slot.options?.length ?? 0) > 2 && (
                              <div>
                                <label
                                  style={{
                                    fontSize: '0.72rem',
                                    color: "var(--portal-muted,#64748b)",
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    display: 'block',
                                    marginBottom: '0.25rem',
                                  }}
                                >
                                  3rd Choice
                                </label>
                                <CustomSelect
                                    unavailableReason={prerequisiteUnavailable}
                                  options={(slot.options ?? []).filter(
                                    (c) =>
                                      c.id !== rankedPreferences[slot.slot]?.rank1 &&
                                      c.id !== rankedPreferences[slot.slot]?.rank2,
                                  )}
                                  value={rankedPreferences[slot.slot]?.rank3 ?? ''}
                                  onChange={(val) => handlePreferenceChange(slot.slot, 'rank3', val)}
                                  disabled={pageState === 'submitting'}
                                  placeholder="— Select 3rd Choice (Optional) —"
                                />
                              </div>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Add Paper Button for Minor Electives (Slots 7 & 8) */}
              {windowIsOpen && optionalMinorCount < optionalMinorSlots.length && pageState === 'ready' && (
                <div style={{ marginTop: '1.25rem', marginBottom: '1rem', textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={handleAddPaper}
                    style={{
                      background: "var(--portal-info-bg,#f8fafc)",
                      border: "1.5px dashed var(--portal-info-border,#0284c7)",
                      borderRadius: '0.625rem',
                      padding: '0.75rem 1.75rem',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: "var(--portal-info-text,#0284c7)",
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#e0f2fe')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  >
                    <span style={{ fontSize: '1.2rem', fontWeight: 700, lineHeight: 1 }}>+</span>
                    Add Paper {optionalMinorSlots[optionalMinorCount]} (Minor Elective)
                  </button>
                  <p style={{ fontSize: '0.75rem', color: "var(--portal-muted,#64748b)", marginTop: '0.4rem', marginBottom: 0 }}>
                    Optional Minor Paper ({optionalMinorCount}/{optionalMinorSlots.length} added) — Select an elective from outside your department
                  </p>
                </div>
              )}
              {activeSlots.length >= 8 && windowIsOpen && (
                <div style={{ marginTop: '1rem', marginBottom: '1rem', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: "var(--portal-info-text,#0369a1)", background: "var(--portal-info-bg,#f0f9ff)", padding: '0.35rem 0.85rem', borderRadius: '9999px', border: "1px solid var(--portal-info-border,#bae6fd)", fontWeight: 600 }}>
                    Maximum 8 papers reached
                  </span>
                </div>
              )}

              {error && <div className={styles.errorBanner}>{error}</div>}
              {successMsg && (
                <div className={styles.successModalOverlay} onClick={() => setSuccessMsg('')}>
                  <div className={styles.successModalContent} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.successModalIcon}><UiCheck size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></div>
                    <p className={styles.successModalText}>{successMsg}</p>
                    <button
                      className={styles.successModalClose}
                      onClick={() => setSuccessMsg('')}
                     aria-label="Close">
                      <UiX size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" />
                    </button>
                  </div>
                </div>
              )}

              {!allocationCompleted && windowIsOpen && (pageState === 'ready' || pageState === 'submitting') && (
                <button
                  className={styles.submitBtn}
                  onClick={() => { void handleSubmit() }}
                  disabled={pageState === 'submitting' || !isValidCredits}
                >
                  {pageState === 'submitting' ? (
                    <>
                      <span className={styles.smallSpinner} /> Submitting Preferences...
                    </>
                  ) : existingSubmission ? (
                    'Update Preferences →'
                  ) : (
                    'Submit Ranked Preferences →'
                  )}
                </button>
              )}
            </>
          )}
      </div>
    </div>
  )
}
