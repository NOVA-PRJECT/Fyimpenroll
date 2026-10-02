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
                  <div className={styles.optionLower}>
                    <span className={styles.optionDept}>
                      {course.course_code ? `${course.course_code} • ` : ''}
                      {course.department_name || 'General'}
                    </span>
                    <span className={styles.optionCredits}>{course.credits} cr</span>
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
  existingSlots?: Record<string, string | null>
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

  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
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

        // Hydrate preferences for up to 8 slots
        const existingPrefs = rawBp.existingPreferences || {}
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

        // Re-hydrate extraSlotsCount if slot 7 or 8 existed
        const hasSlot7 = (existingPrefs.slot_7 && existingPrefs.slot_7.length > 0) || !!rawBp.existingSlots?.slot_7
        const hasSlot8 = (existingPrefs.slot_8 && existingPrefs.slot_8.length > 0) || !!rawBp.existingSlots?.slot_8
        if (hasSlot8) {
          setExtraSlotsCount(2)
        } else if (hasSlot7) {
          setExtraSlotsCount(1)
        }

        setRankedPreferences(initialPrefs)

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

        if (!isOpen && !rawBp.existingSlots) {
          setPageState('closed')
          return
        }

        setPageState('ready')
      } catch (err) {
        setError('Error loading registration blueprint. Please try again.')
        setPageState('error')
      }
    }

    loadBlueprint()
  }, [])

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
    const prefCourseId = rankedPreferences[slotNum]?.rank1

    const targetCourseId = prefCourseId || existingCourseId

    // 1. Direct course attached to the slot (e.g. FIXED core papers)
    if (slot.course) {
      if (!targetCourseId || slot.course.id === targetCourseId) {
        return slot.course
      }
    }

    // 2. Look in this slot's options
    if (targetCourseId && slot.options && slot.options.length > 0) {
      const found = slot.options.find((c) => c.id === targetCourseId)
      if (found) return found
    }

    // 3. Look in minorCourses
    if (targetCourseId && minorCourses.length > 0) {
      const inMinors = minorCourses.find((c) => c.id === targetCourseId)
      if (inMinors) return inMinors
    }

    // 4. Look across all slots in resolvedSlots (options or course)
    if (targetCourseId) {
      for (const s of resolvedSlots) {
        if (s.course && s.course.id === targetCourseId) return s.course
        if (s.options) {
          const found = s.options.find((c) => c.id === targetCourseId)
          if (found) return found
        }
      }
    }

    // 5. Fallback: if slot has a course, return it
    if (slot.course) {
      return slot.course
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
              {(() => {
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
                      {windowIsOpen ? 'Credits (Base 6 Papers):' : 'Total Confirmed Credits (Base 6 Papers):'}
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
                {windowIsOpen ? 'Select Your Ranked Preferences' : 'Course Allocation Status'}
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

                  // Find course metadata if allocated or fixed
                  const allocatedCourse = isFixed
                    ? (slot.course || getCourseForSlot(slot))
                    : getCourseForSlot(slot)

                  const isConfirmed = isAllocated || (isFixed && !!slot.course)

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
                        {slot.slot > 6 && windowIsOpen && (
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

                      {/* Case 1: Confirmed Allocation (Unified for Core/Fixed & Allocated Electives) */}
                      {isConfirmed && allocatedCourse ? (
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
                        /* Case 2: Window Closed & Not Allocated */
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
                        /* Case 3: Elective Slot — Window Open (Student Picking Preferences) */
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

                          {/* 2nd Choice (Backup Round 2) — only if more than 1 option exists */}
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

                          {/* 3rd Choice (Backup Round 3) — only if more than 2 options exist */}
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

              {windowIsOpen && (pageState === 'ready' || pageState === 'submitting') && (
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
