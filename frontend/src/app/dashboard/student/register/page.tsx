'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import styles from '../student-dashboard.module.css'
import ResourceBanner from '@/components/ResourceBanner'
import { useBfcacheGuard } from '@/core/hooks/useBfcacheGuard'
import { Link } from 'lucide-react'
interface Course {
  id: string
  course_code: string
  title: string
  credits: number
  department_name?: string
  remaining_seats?: number
  seat_limit?: number
}

function CustomSelect({
  options,
  value,
  onChange,
  disabled,
  placeholder = '— Select a paper —',
}: {
  options: Course[]
  value: string
  onChange: (val: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedCourse = options.find((c) => c.id === value)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div ref={containerRef} className={styles.customSelectWrapper}>
      <button
        type="button"
        className={styles.customSelectTrigger}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        {selectedCourse ? (
          <div className={styles.triggerContent}>
            <span className={styles.triggerTitle}>{selectedCourse.title}</span>
            <span className={styles.triggerMeta}>
              {selectedCourse.course_code ? `${selectedCourse.course_code} • ` : ''}
              {selectedCourse.department_name || 'General'} • {selectedCourse.credits} cr
              {selectedCourse.remaining_seats !== undefined && (
                <> • <strong style={{ color: selectedCourse.remaining_seats > 5 ? '#059669' : '#d97706' }}>{selectedCourse.remaining_seats} seats left</strong></>
              )}
            </span>
          </div>
        ) : (
          <span className={styles.placeholderText}>{placeholder}</span>
        )}
        <span className={styles.triggerArrow} />
      </button>

      {isOpen && (
        <div className={styles.customSelectDropdown}>
          {options.length === 0 ? (
            <div className={styles.customOptionNoData}>No options available</div>
          ) : (
            <>
              {placeholder && (
                <div
                  className={`${styles.customOption} ${!value ? styles.selected : ''}`}
                  onClick={() => {
                    onChange('')
                    setIsOpen(false)
                  }}
                >
                  <span className={styles.placeholderOption}>{placeholder}</span>
                </div>
              )}
              {options.map((course) => (
                <div
                  key={course.id}
                  className={`${styles.customOption} ${value === course.id ? styles.selected : ''}`}
                  onClick={() => {
                    onChange(course.id)
                    setIsOpen(false)
                  }}
                >
                  <div className={styles.optionUpper}>{course.title}</div>
                  <div className={styles.optionLower} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className={styles.optionDept}>
                      {course.course_code ? `${course.course_code} • ` : ''}
                      {course.department_name || 'General'}
                    </span>
                    <span className={styles.optionCredits} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {course.credits} cr
                      {course.remaining_seats !== undefined && (
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '0.1rem 0.4rem',
                            borderRadius: '4px',
                            background: course.remaining_seats > 5 ? '#ecfdf5' : '#fffbeb',
                            color: course.remaining_seats > 5 ? '#059669' : '#d97706',
                            border: `1px solid ${course.remaining_seats > 5 ? '#a7f3d0' : '#fde68a'}`,
                          }}
                        >
                          {course.remaining_seats} seat{course.remaining_seats === 1 ? '' : 's'} left
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

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
  allocationMetadata?: Record<string, any>
  allocationCompleted?: boolean
  allocationCompletedAt?: string | null
  availableSeats?: Record<string, number>
  existingSlots?: Record<string, string | null>
  allocatedCourses?: Record<string, Course>
  slotChangesRemaining?: number
  slotChangesNextReset?: string | null
}

interface StudentInfo {
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
  const [resolvedSlots, setResolvedSlots] = useState<BlueprintSlot[]>([])
  const [selectedPathwayId, setSelectedPathwayId] = useState<string | null>(null)

  // Minor courses and optional papers state (up to 8 papers max)
  const [minorCourses, setMinorCourses] = useState<Course[]>([])
  const [extraSlotsCount, setExtraSlotsCount] = useState<number>(0)

  // Scored model preferences per slot
  const [rankedPreferences, setRankedPreferences] = useState<Record<number, SlotRankedPreferences>>({})
  const [existingSlots, setExistingSlots] = useState<Record<string, string | null>>({})
  const [allocationMetadata, setAllocationMetadata] = useState<Record<string, any>>({})
  const [existingSubmission, setExistingSubmission] = useState<any | null>(null)
  const [windowIsOpen, setWindowIsOpen] = useState<boolean>(true)

  // Post-allocation direct slot update states
  const [allocationCompleted, setAllocationCompleted] = useState<boolean>(false)
  const [allocationCompletedAt, setAllocationCompletedAt] = useState<string | null>(null)
  const [availableSeats, setAvailableSeats] = useState<Record<string, number>>({})
  const [allocatedCourses, setAllocatedCourses] = useState<Record<string, Course>>({})
  const [editingSlot, setEditingSlot] = useState<number | null>(null)
  const [selectedCourseForSlot, setSelectedCourseForSlot] = useState<string>('')
  const [updatingSlot, setUpdatingSlot] = useState<boolean>(false)
  const [slotChangesRemaining, setSlotChangesRemaining] = useState<number>(3)
  const [slotChangesNextReset, setSlotChangesNextReset] = useState<string | null>(null)

  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  async function loadBlueprint() {
    try {
      const response = await fetch('/api/registrations/blueprint')
      const data = await response.json()

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
      setAllocationCompletedAt(rawBp.allocationCompletedAt || null)
      if (rawBp.availableSeats) {
        setAvailableSeats(rawBp.availableSeats)
      }
      if (rawBp.allocatedCourses) {
        setAllocatedCourses(rawBp.allocatedCourses)
      }

      setSlotChangesRemaining(rawBp.slotChangesRemaining !== undefined ? rawBp.slotChangesRemaining : 3)
      setSlotChangesNextReset(rawBp.slotChangesNextReset || null)

      if (data.student) {
        setStudentInfo({
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

      if (rawBp.existingRegistration || rawBp.existingSlots) {
        setExistingSubmission(rawBp.existingRegistration || {})
      }

      if (rawBp.existingSlots) {
        setExistingSlots(rawBp.existingSlots)
      }
      if (rawBp.allocationMetadata) {
        setAllocationMetadata(rawBp.allocationMetadata)
      }

      // Hydrate preferences: In post-allocation mode, preferences have ZERO importance!
      // Active enrollments are driven exclusively by existingSlots from student_registrations.
      const existingPrefs = rawBp.existingPreferences || {}
      if (!isAllocCompleted) {
        const initialPrefs: Record<number, SlotRankedPreferences> = {}
        for (let i = 1; i <= 8; i++) {
          const list = existingPrefs[`slot_${i}`] || []
          const existingSlotCid = rawBp.existingSlots?.[`slot_${i}`] || ''
          initialPrefs[i] = {
            rank1: list.find((p: any) => p.rank === 1)?.course_id || existingSlotCid || '',
            rank2: list.find((p: any) => p.rank === 2)?.course_id || '',
            rank3: list.find((p: any) => p.rank === 3)?.course_id || '',
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
      const hasSlot7 = (existingPrefs.slot_7 && existingPrefs.slot_7.length > 0) || !!rawBp.existingSlots?.slot_7
      const hasSlot8 = (existingPrefs.slot_8 && existingPrefs.slot_8.length > 0) || !!rawBp.existingSlots?.slot_8
      if (hasSlot8) {
        setExtraSlotsCount(2)
      } else if (hasSlot7) {
        setExtraSlotsCount(1)
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
    } catch (err) {
      setError('Error loading registration blueprint. Please try again.')
      setPageState('error')
    }
  }

  useEffect(() => {
    loadBlueprint()
  }, [])

  async function handleUpdateSlot(slotNumber: number, courseId: string) {
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
        throw new Error(data.message || data.error || 'Failed to update course registration')
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
    } catch (err: any) {
      setError(err.message || 'Failed to update course registration')
    } finally {
      setUpdatingSlot(false)
    }
  }

  async function selectPathway(pathwayId: string) {
    setSelectedPathwayId(pathwayId)
    setPageState('loading_slots')
    setError('')

    const response = await fetch(
      `/api/registrations/pathway-slots?pathway_id=${encodeURIComponent(pathwayId)}`,
    )
    const data = await response.json()

    if (!response.ok) {
      setError(data.error ?? 'Failed to load pathway courses.')
      setPageState('pathway_picker')
      return
    }

    const slots = data.data.slots as BlueprintSlot[]
    setResolvedSlots(slots)
    setPageState('ready')
  }

  // Build active slots list: base blueprint slots (1-6) + optional minor slots (7, 8)
  const activeSlots: BlueprintSlot[] = [...resolvedSlots]
  if (extraSlotsCount >= 1) {
    activeSlots.push({
      slot: 7,
      rule: 'EXCLUDE_DEPT',
      name: 'Paper 7 (Minor Elective)',
      options: minorCourses,
    })
  }
  if (extraSlotsCount >= 2) {
    activeSlots.push({
      slot: 8,
      rule: 'EXCLUDE_DEPT',
      name: 'Paper 8 (Minor Elective)',
      options: minorCourses,
    })
  }

  function handleAddPaper() {
    if (extraSlotsCount < 2) {
      setExtraSlotsCount((prev) => prev + 1)
      setError('')
    }
  }

  function handleRemovePaper(slotNum: number) {
    if (slotNum === 8 && extraSlotsCount === 2) {
      setExtraSlotsCount(1)
      setRankedPreferences((prev) => {
        const next = { ...prev }
        delete next[8]
        return next
      })
    } else if (slotNum === 7) {
      if (extraSlotsCount === 2) {
        setExtraSlotsCount(1)
        setRankedPreferences((prev) => {
          const next = { ...prev }
          next[7] = prev[8] || { rank1: '', rank2: '', rank3: '' }
          delete next[8]
          return next
        })
      } else {
        setExtraSlotsCount(0)
        setRankedPreferences((prev) => {
          const next = { ...prev }
          delete next[7]
          return next
        })
      }
    }
    setError('')
  }

  function handlePreferenceChange(
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
      return (slot.rule === 'FIXED' || slot.rule === 'CAMPUS_FIXED') ? (slot.course || null) : null
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
    if (slot.rule === 'FIXED' || slot.rule === 'CAMPUS_FIXED') {
      return slot.course || null
    }

    return null
  }

  // Calculate credits strictly for the base 6 papers (per user instruction)
  function calculateBaseCredits(): number {
    if (!resolvedSlots.length) return 0
    let total = 0
    resolvedSlots.slice(0, 6).forEach((slot) => {
      const course = getCourseForSlot(slot)
      if (course && course.credits != null) {
        total += Number(course.credits) || 0
      }
    })
    return total
  }

  // Calculate optional extra credits from minor papers (slot 7 & 8)
  function calculateExtraCredits(): number {
    let total = 0
    if (extraSlotsCount >= 1) {
      const p7 = rankedPreferences[7]?.rank1 || existingSlots['slot_7']
      if (p7) {
        const c =
          minorCourses.find((x) => x.id === p7) ||
          resolvedSlots.flatMap((s) => s.options || []).find((x) => x.id === p7)
        if (c && c.credits != null) total += Number(c.credits) || 0
      }
    }
    if (extraSlotsCount >= 2) {
      const p8 = rankedPreferences[8]?.rank1 || existingSlots['slot_8']
      if (p8) {
        const c =
          minorCourses.find((x) => x.id === p8) ||
          resolvedSlots.flatMap((s) => s.options || []).find((x) => x.id === p8)
        if (c && c.credits != null) total += Number(c.credits) || 0
      }
    }
    return total
  }

  async function handleSubmit() {
    if (!blueprint || !selectedPathwayId) return

    const preferencesPayload: Record<string, { course_id: string; rank: number }[]> = {}
    const chosenRank1Courses = new Map<string, number>()

    for (const slot of activeSlots) {
      const isFixed =
        slot.rule === 'FIXED' ||
        slot.rule === 'CAMPUS_FIXED' ||
        slot.rule === 'AEC_ELECT' ||
        (!!slot.course && (!slot.options || slot.options.length === 0))

      if (isFixed && slot.course) {
        chosenRank1Courses.set(slot.course.id, slot.slot)
      } else {
        const slotKey = `slot_${slot.slot}`
        const currentPrefs = rankedPreferences[slot.slot] || { rank1: '', rank2: '', rank3: '' }
        const rank1Id = currentPrefs.rank1 || existingSlots[slotKey]

        if (!rank1Id) {
          setError(`Please select at least a 1st choice preference for "${slot.name}" (or click "✕ Remove Paper" if not taking it).`)
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

        preferencesPayload[slotKey] = choices
      }
    }

    setPageState('submitting')
    setError('')

    const response = await fetch('/api/registrations/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        semester: Number(studentInfo?.current_semester || 1),
        pathway_id: selectedPathwayId,
        preferences: preferencesPayload,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      const errMsg = data.message || data.error || 'Submission failed. Please try again.'
      setError(errMsg)
      setPageState('ready')
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
  }

  async function handleLogout() {
    setLoggingOut(true)
    if (typeof window !== 'undefined') {
      sessionStorage.clear()
      localStorage.clear()
    }
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
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
              <Image
                src="/knrunilogo.png"
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
          <Link
            href="/dashboard/student"
            className={styles.logoutBtn}
            style={{
              background: '#f1f5f9',
              color: '#002147',
              border: '1px solid #cbd5e1',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            ← Back to Dashboard
          </Link>
          <button className={styles.logoutBtn} onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? 'Logging out...' : 'Logout'}
          </button>
        </div>
      </header>

      <div className={styles.mainContent}>

        {/* Loading Blueprint */}
        {pageState === 'loading_blueprint' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
            <div style={{ height: '3.5rem', borderRadius: '0.75rem' }} className={styles.skeletonLightPulse} />
            <div style={{ height: '10rem', borderRadius: '0.75rem' }} className={styles.skeletonLightPulse} />
            <div style={{ height: '10rem', borderRadius: '0.75rem' }} className={styles.skeletonLightPulse} />
          </div>
        )}

        {/* Error / Blueprint Not Configured State */}
        {pageState === 'error' && (
          <div className={styles.closedState}>
            <div className={styles.closedIcon}>📋</div>
            <p className={styles.closedTitle}>Registration Unavailable</p>
            <p className={styles.closedSubtitle}>
              {error || 'Your department course blueprint or campus registration settings are not currently available.'}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '1rem' }}>
              <button
                className={styles.closedBackBtn}
                onClick={() => router.push('/dashboard/student')}
              >
                ← Back to Dashboard
              </button>
              <button
                className={styles.closedBackBtn}
                style={{ background: '#0284c7', color: '#ffffff', borderColor: '#0284c7' }}
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
            <div className={styles.closedIcon}>🔒</div>
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
            <button
              className={styles.closedBackBtn}
              onClick={() => router.push('/dashboard/student')}
            >
              ← Go Back
            </button>
          </div>
        )}

        {/* Pathway Picker Hub */}
        {pageState === 'pathway_picker' && blueprint?.pathways && (
          <div className={styles.trackPickerContainer}>
            <div className={styles.trackHeader}>
              <span className={styles.trackCategoryTag}>
                <span>🎓</span> ACADEMIC PATHWAY SELECTION
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
          <div className={styles.loadingState}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>Loading track courses...</p>
          </div>
        )}

        {/* Ready / Submitting / Submitted */}
        {(pageState === 'ready' || pageState === 'submitting' || pageState === 'submitted') &&
          blueprint &&
          resolvedSlots.length > 0 && (
            <>
              {/* Window Status Banner */}
              {allocationCompleted ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '1.25rem' }}>
                  <div
                    className={styles.windowBanner}
                    style={{
                      background: 'rgba(2, 132, 199, 0.08)',
                      borderColor: '#0284c7',
                      color: '#0369a1',
                      margin: 0,
                    }}
                  >
                    <div className={styles.windowDot} style={{ background: '#0284c7' }} />
                    ✓ Course Allocation Complete — Direct Seat Registration Mode (Seats update in real time; only papers with available seats can be chosen)
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
                      background: slotChangesRemaining > 0 ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${slotChangesRemaining > 0 ? '#bbf7d0' : '#fecaca'}`,
                      color: slotChangesRemaining > 0 ? '#166534' : '#991b1b',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <span style={{ fontSize: '1.25rem' }}>
                        {slotChangesRemaining > 0 ? '🔄' : '🔒'}
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
                          background: slotChangesRemaining > 0 ? '#dcfce7' : '#fee2e2',
                          border: `1px solid ${slotChangesRemaining > 0 ? '#86efac' : '#fca5a5'}`,
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
                    ? new Date(blueprint.deadline).getTime() - Date.now() <= 24 * 60 * 60 * 1000 &&
                      new Date(blueprint.deadline).getTime() > Date.now()
                    : false
                const hoursLeft =
                  isClosingSoon && blueprint.deadline
                    ? Math.max(
                        0,
                        Math.floor((new Date(blueprint.deadline).getTime() - Date.now()) / (1000 * 60 * 60)),
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
                      ? `⚠️ Closing Soon — Registration closes in ${hoursLeft} hour${
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
                      background: '#f8fafc',
                      border: '1.5px solid #dde1e7',
                      borderRadius: '0.4rem',
                      padding: '0.5rem 1rem',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      color: '#002147',
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
                        ? 'Credits (Base 6 Papers):'
                        : 'Total Confirmed Credits (Base 6 Papers):'}
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
                      <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#15803d', padding: '0.15rem 0.55rem', borderRadius: '9999px', fontWeight: 700 }}>
                        ✓ Valid Load
                      </span>
                    )}
                    {!isValidCredits && baseCredits > 0 && (
                      <span style={{ fontSize: '0.72rem', background: '#fee2e2', color: '#b91c1c', padding: '0.15rem 0.55rem', borderRadius: '9999px', fontWeight: 700 }}>
                        ⚠️ {baseCredits < minCredits ? `Need ${minCredits - baseCredits} more cr` : `Exceeds max by ${baseCredits - maxCredits} cr`}
                      </span>
                    )}
                  </div>
                  {extraCredits > 0 && (
                    <span style={{ fontSize: '0.8rem', color: '#0284c7', fontWeight: 600 }}>
                      + {extraCredits} optional minor credits ({extraSlotsCount} paper{extraSlotsCount > 1 ? 's' : ''} added)
                    </span>
                  )}
                </div>
              </div>

              <p className={styles.sectionTitle}>
                {allocationCompleted
                  ? 'Your Course Allocations & Available Slots'
                  : windowIsOpen
                  ? 'Select Your Ranked Preferences'
                  : 'Course Allocation Status'}
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
                  const isAllocated = !!existingCourseId
                  const slotAllocMeta = allocationMetadata[slotKey]
                  const isFixedSlot =
                    isFixed ||
                    slotAllocMeta?.allocated_by === 'fixed' ||
                    slot.rule === 'FIXED' ||
                    slot.rule === 'CAMPUS_FIXED' ||
                    slot.rule === 'AEC_ELECT'

                  // Find course metadata if allocated or fixed
                  const allocatedCourse = isFixed
                    ? (slot.course || getCourseForSlot(slot))
                    : getCourseForSlot(slot)

                  const isConfirmed = isAllocated || (isFixed && !!slot.course)
                  const isCurrentlyEditing = editingSlot === slot.slot

                  return (
                    <div
                      key={slot.slot}
                      className={`${styles.slotCard} ${isConfirmed ? styles.slotCardConfirmed : styles.active}`}
                    >
                      <div className={styles.slotHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <span className={styles.slotLabel}>
                          {slot.name}
                          {slot.slot > 6 && (
                            <span style={{ marginLeft: '0.6rem', fontSize: '0.68rem', padding: '0.15rem 0.45rem', borderRadius: '4px', background: '#e0f2fe', color: '#0369a1', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Minor Elective
                            </span>
                          )}
                        </span>
                        {slot.slot > 6 && (windowIsOpen || allocationCompleted) && !isConfirmed && (
                          <button
                            type="button"
                            onClick={() => handleRemovePaper(slot.slot)}
                            style={{
                              background: '#fef2f2',
                              color: '#dc2626',
                              border: '1px solid #fecaca',
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
                            ✕ Remove Paper
                          </button>
                        )}
                      </div>

                      {/* POST-ALLOCATION DIRECT REGISTRATION FLOW */}
                      {allocationCompleted ? (
                        isCurrentlyEditing ? (
                          /* Interactive Slot Editor Mode */
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                              <label style={{ fontSize: '0.75rem', color: '#0284c7', fontWeight: 700, textTransform: 'uppercase' }}>
                                Select Open Course ({slot.name})
                              </label>
                              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                Showing papers with available seats
                              </span>
                            </div>

                            {(() => {
                              const rawOptions = slot.slot > 6 ? minorCourses : (slot.options ?? [])
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
                                    options={optionsWithSeats}
                                    value={selectedCourseForSlot || existingCourseId || ''}
                                    onChange={(val) => setSelectedCourseForSlot(val)}
                                    disabled={updatingSlot}
                                    placeholder="— Select a course with open seats —"
                                  />

                                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.35rem' }}>
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateSlot(slot.slot, selectedCourseForSlot || existingCourseId || '')}
                                      disabled={updatingSlot || (!selectedCourseForSlot && !existingCourseId)}
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
                                      {updatingSlot ? 'Registering Seat...' : '✓ Confirm & Register Seat'}
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
                                        background: '#f1f5f9',
                                        color: '#475569',
                                        border: '1px solid #cbd5e1',
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
                                    background: isFixedSlot ? '#f1f5f9' : '#ecfdf5',
                                    color: isFixedSlot ? '#475569' : '#059669',
                                    border: `1px solid ${isFixedSlot ? '#cbd5e1' : '#a7f3d0'}`,
                                  }}
                                >
                                  {isFixedSlot ? '🔒 Fixed Core Course' : '✓ Confirmed Allocation'}
                                </span>
                                {!isFixedSlot && (
                                  slotChangesRemaining > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingSlot(slot.slot)
                                        setSelectedCourseForSlot(existingCourseId || '')
                                        setError('')
                                      }}
                                      style={{
                                        background: '#f0f9ff',
                                        color: '#0284c7',
                                        border: '1px solid #bae6fd',
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
                                      Change Course ✎
                                    </button>
                                  ) : (
                                    <span
                                      title={slotChangesNextReset ? `Quota exhausted. Unlocks at ${new Date(slotChangesNextReset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Limit of 3 changes per 27 hours reached'}
                                      style={{
                                        fontSize: '0.72rem',
                                        padding: '0.25rem 0.55rem',
                                        borderRadius: '4px',
                                        background: '#f1f5f9',
                                        color: '#64748b',
                                        border: '1px solid #cbd5e1',
                                        fontWeight: 600,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '0.25rem',
                                        cursor: 'not-allowed',
                                      }}
                                    >
                                      🔒 Limit Reached (3/3)
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
                                <span>⚠️</span> Unassigned Paper Slot
                              </p>
                              <p className={styles.unallocatedText} style={{ margin: '0.25rem 0 0 0' }}>
                                This slot is unassigned. Choose from courses with remaining seats.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSlot(slot.slot)
                                setSelectedCourseForSlot('')
                                setError('')
                              }}
                              disabled={slotChangesRemaining === 0}
                              style={{
                                background: slotChangesRemaining > 0 ? '#0284c7' : '#94a3b8',
                                color: '#ffffff',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '0.4rem 0.9rem',
                                fontSize: '0.78rem',
                                fontWeight: 600,
                                cursor: slotChangesRemaining > 0 ? 'pointer' : 'not-allowed',
                              }}
                            >
                              {slotChangesRemaining > 0 ? 'Choose Course +' : '🔒 Changes Locked'}
                            </button>
                          </div>
                        )
                      ) : (
                        /* PRE-ALLOCATION MODE */
                        isConfirmed && allocatedCourse ? (
                          <div className={styles.confirmedCard}>
                            <div className={styles.confirmedCardBody}>
                              <div className={styles.confirmedBadgeRow}>
                                <span className={styles.confirmedBadge}>
                                  <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                  Confirmed Allocation
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
                              <span>⚠️</span> Not yet allocated — contact your HOD
                            </p>
                            <p className={styles.unallocatedText}>
                              Your submitted preferences could not be resolved during automated rounds.
                              Please contact your department HOD for manual placement.
                            </p>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                              {slot.slot > 6
                                ? 'Select an elective course offered by any department outside your own for this Minor Paper.'
                                : 'Rank your preferences for this paper. The algorithm allocates round-by-round based on capacity and prerequisites.'}
                            </p>

                            <div>
                              <div>
                                <label
                                  style={{
                                    fontSize: '0.72rem',
                                    color: '#0284c7',
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
                                    color: '#64748b',
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    display: 'block',
                                    marginBottom: '0.25rem',
                                  }}
                                >
                                  2nd Choice
                                </label>
                                <CustomSelect
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
                                    color: '#64748b',
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    display: 'block',
                                    marginBottom: '0.25rem',
                                  }}
                                >
                                  3rd Choice
                                </label>
                                <CustomSelect
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
              {windowIsOpen && extraSlotsCount < 2 && pageState === 'ready' && (
                <div style={{ marginTop: '1.25rem', marginBottom: '1rem', textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={handleAddPaper}
                    style={{
                      background: '#f8fafc',
                      border: '1.5px dashed #0284c7',
                      borderRadius: '0.625rem',
                      padding: '0.75rem 1.75rem',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: '#0284c7',
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
                    Add Paper {extraSlotsCount === 0 ? '7' : '8'} (Minor Elective)
                  </button>
                  <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.4rem', marginBottom: 0 }}>
                    Optional Minor Paper ({extraSlotsCount}/2 added) — Select an elective from outside your department
                  </p>
                </div>
              )}
              {extraSlotsCount === 2 && windowIsOpen && (
                <div style={{ marginTop: '1rem', marginBottom: '1rem', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: '#0369a1', background: '#f0f9ff', padding: '0.35rem 0.85rem', borderRadius: '9999px', border: '1px solid #bae6fd', fontWeight: 600 }}>
                    ✓ Maximum 8 papers reached (6 blueprint + 2 minor electives)
                  </span>
                </div>
              )}

              {error && <div className={styles.errorBanner}>{error}</div>}
              {successMsg && (
                <div className={styles.successModalOverlay} onClick={() => setSuccessMsg('')}>
                  <div className={styles.successModalContent} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.successModalIcon}>✓</div>
                    <p className={styles.successModalText}>{successMsg}</p>
                    <button
                      className={styles.successModalClose}
                      onClick={() => setSuccessMsg('')}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {!allocationCompleted && windowIsOpen && (pageState === 'ready' || pageState === 'submitting') && (
                <button
                  className={styles.submitBtn}
                  onClick={handleSubmit}
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
