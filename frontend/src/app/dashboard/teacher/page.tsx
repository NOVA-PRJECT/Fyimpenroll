'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import styles from './teacher-dashboard.module.css'
import { useBfcacheGuard } from '@/core/hooks/useBfcacheGuard'
import Image from 'next/image';

interface Course {
  id: string
  course_code: string
  title: string
  semester?: number
  department_id?: string
  enrolled_count?: number
}

interface Department {
  id: string
  name: string
  code: string
}

interface Student {
  id: string
  full_name: string
  department: string
  department_code: string
  cap_application_number?: string
}

interface RosterData {
  course: { id: string; title: string; course_code: string }
  total_students: number
  department_breakdown: Record<string, number>
  students: Student[]
}

interface DeptOption {
  key: string
  name: string
  code: string
  count: number
}

interface PeriodSlot {
  timetable_slot_id: string
  course_id: string
  course_code: string
  course_title: string
  course_category?: string
  course_semester?: number
  period_number: number
  start_time: string
  end_time: string
  is_marked: boolean
  total_enrolled: number
  present_count: number
  absent_count: number
  is_lab_block?: boolean
  session_type?: string
  adjacent_practical_slot_id?: string | null
}

interface WeeklyTimetableEntry {
  timetable_slot_id: string
  course_id: string
  course_code: string
  course_title: string
  course_category?: string
  course_semester?: number
  credits?: number
  is_lab_block?: boolean
  day_of_week: number
  period_number: number
  start_time: string
  end_time: string
}

interface TeacherScheduleResponse {
  teacherName: string
  departmentName: string
  campusName: string
  date: string
  dayOfWeek: number
  assignedCourses: Course[]
  periods: PeriodSlot[]
  weeklySchedule?: WeeklyTimetableEntry[]
  message?: string
}

const DAYS = [
  { num: 1, name: 'Monday', short: 'Mon' },
  { num: 2, name: 'Tuesday', short: 'Tue' },
  { num: 3, name: 'Wednesday', short: 'Wed' },
  { num: 4, name: 'Thursday', short: 'Thu' },
  { num: 5, name: 'Friday', short: 'Fri' },
  { num: 6, name: 'Saturday', short: 'Sat' },
]

const PERIODS = [
  { num: 1, label: 'Period 1', time: '09:30 - 10:30' },
  { num: 2, label: 'Period 2', time: '10:30 - 11:30' },
  { num: 3, label: 'Period 3', time: '11:30 - 12:30' },
  { num: 4, label: 'Period 4', time: '01:30 - 02:30' },
  { num: 5, label: 'Period 5', time: '02:30 - 03:30' },
  { num: 6, label: 'Period 6', time: '03:30 - 04:30' },
]

function getCurrentUserDay(): number {
  const day = new Date().getDay()
  if (day >= 1 && day <= 6) return day
  return 1
}

function CustomPaperSelect({
  courses,
  selectedCourseId,
  onSelect,
  disabled = false,
  placeholder = "— Select an Assigned Paper —"
}: {
  courses: Course[]
  selectedCourseId: string
  onSelect: (courseId: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedCourse = courses.find(c => c.id === selectedCourseId)

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
            <span className={styles.triggerTitle}>{selectedCourse.title} ({selectedCourse.course_code})</span>
            <span className={styles.triggerMeta}>
              {selectedCourse.semester ? `Sem ${selectedCourse.semester}` : 'Paper'} • {selectedCourse.enrolled_count ?? 0} registered
            </span>
          </div>
        ) : (
          <span className={styles.placeholderText}>{placeholder}</span>
        )}
        <span className={`${styles.triggerArrow} ${isOpen ? styles.triggerArrowOpen : ''}`} />
      </button>

      {isOpen && (
        <div className={styles.customSelectDropdown}>
          {courses.length === 0 ? (
            <div className={styles.customOptionNoData}>No assigned papers found</div>
          ) : (
            <>
              {placeholder && (
                <div
                  className={`${styles.customOption} ${!selectedCourseId ? styles.selected : ''}`}
                  onClick={() => {
                    onSelect('')
                    setIsOpen(false)
                  }}
                >
                  <span className={styles.placeholderOption}>{placeholder}</span>
                </div>
              )}
              {courses.map(course => (
                <div
                  key={course.id}
                  className={`${styles.customOption} ${selectedCourseId === course.id ? styles.selected : ''}`}
                  onClick={() => {
                    onSelect(course.id)
                    setIsOpen(false)
                  }}
                >
                  <div className={styles.optionUpper}>
                    <span className={styles.optionTitle}>{course.title}</span>
                    <span className={styles.optionCode}>({course.course_code})</span>
                  </div>
                  <div className={styles.optionLower}>
                    <span className={styles.optionSemTag}>
                      {course.semester ? `Semester ${course.semester}` : 'Paper'}
                    </span>
                    <span className={styles.optionCountBadge}>
                      👥 {course.enrolled_count ?? 0} registered
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

export default function TeacherDashboard() {
  useBfcacheGuard()
  const router = useRouter()

  // Tab State
  const [activeTab, setActiveTab] = useState<'schedule' | 'timetable' | 'rosters'>('schedule')

  // Teacher Profile State
  const [teacherName, setTeacherName] = useState('')
  const [departmentName, setDepartmentName] = useState('')
  const [campusName, setCampusName] = useState('')
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [loggingOut, setLoggingOut] = useState(false)
  const [globalError, setGlobalError] = useState('')
  const [globalSuccess, setGlobalSuccess] = useState('')

  // Tab 1: Schedule & Attendance State
  const [scheduleDate, setScheduleDate] = useState(() => new Date().toISOString().split('T')[0])
  const [loadingSchedule, setLoadingSchedule] = useState(false)
  const [schedulePeriods, setSchedulePeriods] = useState<PeriodSlot[]>([])
  const [scheduleMessage, setScheduleMessage] = useState('')

  // Tab 2: Weekly Timetable State
  const [weeklySchedule, setWeeklySchedule] = useState<WeeklyTimetableEntry[]>([])
  const [selectedTimetableDay, setSelectedTimetableDay] = useState<number | 'all'>('all')
  const [selectedTimetableSemester, setSelectedTimetableSemester] = useState<string>('all')

  // Attendance Marking Modal State
  const [activeSlotForMarking, setActiveSlotForMarking] = useState<PeriodSlot | null>(null)
  const [markingRoster, setMarkingRoster] = useState<Student[]>([])
  const [loadingMarkingRoster, setLoadingMarkingRoster] = useState(false)
  const [absentStudentIds, setAbsentStudentIds] = useState<Set<string>>(new Set())
  const [submittingAttendance, setSubmittingAttendance] = useState(false)
  const [markingError, setMarkingError] = useState('')
  const [lastMarkedAt, setLastMarkedAt] = useState<string | null>(null)
  const [copyingPractical, setCopyingPractical] = useState<string | null>(null)

  // Tab 2: Assigned Papers & Rosters State
  const [assignedCourses, setAssignedCourses] = useState<Course[]>([])
  const [selectedSemester, setSelectedSemester] = useState('all')
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [loadingRoster, setLoadingRoster] = useState(false)
  const [rosterData, setRosterData] = useState<RosterData | null>(null)
  const [tableDeptFilter, setTableDeptFilter] = useState('all')

  // PDF Export Modal State
  const [showPdfModal, setShowPdfModal] = useState(false)
  const [pdfDeptMode, setPdfDeptMode] = useState<'all' | 'custom'>('all')
  const [selectedPdfDepts, setSelectedPdfDepts] = useState<string[]>([])
  const [generatingPdf, setGeneratingPdf] = useState(false)

  // 1. Fetch Teacher Assigned Papers
  const fetchTeacherCourses = useCallback(async () => {
    try {
      const res = await fetch('/api/faculty/courses')
      const data = await res.json()
      if (!res.ok) {
        router.push('/login')
        return
      }
      setTeacherName(data.teacherName || '')
      setAssignedCourses(data.courses || [])
    } catch {
      setGlobalError('Failed to load assigned courses.')
    } finally {
      setLoadingProfile(false)
    }
  }, [router])

  // 2. Fetch Teacher Schedule for target date
  const fetchTeacherSchedule = useCallback(async (dateToFetch: string) => {
    setLoadingSchedule(true)
    setGlobalError('')
    try {
      const res = await fetch(`/api/attendance/period/teacher-schedule?date=${dateToFetch}`)
      const data: TeacherScheduleResponse = await res.json()
      if (res.ok) {
        if (data.teacherName) setTeacherName(data.teacherName)
        if (data.departmentName) setDepartmentName(data.departmentName)
        if (data.campusName) setCampusName(data.campusName)
        setSchedulePeriods(data.periods || [])
        setWeeklySchedule(data.weeklySchedule || [])
        setScheduleMessage(data.message || '')
      } else {
        setGlobalError((data as any).message || 'Failed to fetch schedule for the selected date.')
      }
    } catch {
      setGlobalError('Network error while fetching teacher schedule.')
    } finally {
      setLoadingSchedule(false)
    }
  }, [])

  useEffect(() => {
    fetchTeacherCourses()
    fetchTeacherSchedule(scheduleDate)
  }, [fetchTeacherCourses, fetchTeacherSchedule, scheduleDate])

  // Available semesters from assigned courses
  const availableSemesters = useMemo(() => {
    const sems = new Set<number>()
    assignedCourses.forEach(c => {
      if (c.semester) sems.add(c.semester)
    })
    return Array.from(sems).sort((a, b) => a - b)
  }, [assignedCourses])

  const filteredAssignedCourses = useMemo(() => {
    return assignedCourses.filter(c => {
      if (selectedSemester === 'all') return true
      return c.semester !== undefined && c.semester.toString() === selectedSemester
    })
  }, [assignedCourses, selectedSemester])

  // Reset selected course if filter changed
  useEffect(() => {
    if (selectedCourseId && !filteredAssignedCourses.some(c => c.id === selectedCourseId)) {
      setSelectedCourseId('')
      setRosterData(null)
    }
  }, [filteredAssignedCourses, selectedCourseId])

  // Memoized Weekly Timetable filtered by semester
  const filteredWeeklySchedule = useMemo(() => {
    return weeklySchedule.filter(slot => {
      if (selectedTimetableSemester === 'all') return true
      return slot.course_semester !== undefined && slot.course_semester.toString() === selectedTimetableSemester
    })
  }, [weeklySchedule, selectedTimetableSemester])

  // Fetch Class Roster for Tab 3
  async function handleFetchRoster(courseId: string) {
    if (!courseId) {
      setRosterData(null)
      return
    }
    setLoadingRoster(true)
    setGlobalError('')
    setTableDeptFilter('all')
    try {
      const res = await fetch(`/api/faculty/attendance?course_id=${courseId}`)
      const data = await res.json()
      if (res.ok) {
        setRosterData(data)
      } else {
        setGlobalError(data.error || 'Failed to fetch class roster.')
      }
    } catch {
      setGlobalError('Network error while fetching class roster.')
    } finally {
      setLoadingRoster(false)
    }
  }

  // Open Marking Modal for a slot (F47, F48: Loads persisted marks for scheduleDate)
  async function handleOpenMarkingModal(slot: PeriodSlot) {
    setActiveSlotForMarking(slot)
    setMarkingError('')
    setLoadingMarkingRoster(true)
    setAbsentStudentIds(new Set())
    setLastMarkedAt(null)

    try {
      const res = await fetch(`/api/attendance/period/slot-marks?slotId=${slot.timetable_slot_id}&date=${scheduleDate}`)
      const data = await res.json()
      if (res.ok && data.students) {
        setMarkingRoster(data.students)
        setLastMarkedAt(data.last_marked_at || null)

        // Preserve already marked absent students (F47)
        const absents = new Set<string>()
        for (const s of data.students) {
          if (s.status === 'absent') {
            absents.add(s.id)
          }
        }
        setAbsentStudentIds(absents)
      } else {
        setMarkingError(data.message || data.error || 'Failed to load enrolled students.')
      }
    } catch {
      setMarkingError('Network error while loading roster.')
    } finally {
      setLoadingMarkingRoster(false)
    }
  }

  // Toggle student Present vs Absent
  function handleToggleStudentStatus(studentId: string) {
    setAbsentStudentIds(prev => {
      const next = new Set(prev)
      if (next.has(studentId)) {
        next.delete(studentId) // Becomes Present
      } else {
        next.add(studentId) // Becomes Absent
      }
      return next
    })
  }

  function handleMarkAllPresent() {
    setAbsentStudentIds(new Set())
  }

  function handleMarkAllAbsent() {
    setAbsentStudentIds(new Set(markingRoster.map(s => s.id)))
  }

  // Submit Period Attendance (F48: Send explicit scheduleDate & lastMarkedAt for conflict check)
  async function handleSubmitAttendance() {
    if (!activeSlotForMarking) return
    setSubmittingAttendance(true)
    setMarkingError('')

    try {
      const res = await fetch('/api/attendance/period/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timetable_slot_id: activeSlotForMarking.timetable_slot_id,
          attendance_date: scheduleDate,
          absent_student_ids: Array.from(absentStudentIds),
          last_marked_at: lastMarkedAt || undefined,
          client_timestamp: new Date().toISOString(),
        }),
      })

      const result = await res.json()
      if (res.ok) {
        setGlobalSuccess(`✓ Period ${activeSlotForMarking.period_number} attendance for ${scheduleDate} saved successfully!`)
        setActiveSlotForMarking(null)
        // Refresh schedule to update marked badge and counts
        await fetchTeacherSchedule(scheduleDate)
        setTimeout(() => setGlobalSuccess(''), 4000)
      } else if (res.status === 409) {
        setMarkingError(result.message || 'Concurrent edit detected. Another teacher modified this record.')
      } else {
        setMarkingError(result.message || 'Failed to submit period attendance.')
      }
    } catch {
      setMarkingError('Network error while submitting attendance.')
    } finally {
      setSubmittingAttendance(false)
    }
  }

  // Copy Practical Attendance to Next Period (F49)
  async function handleCopyPractical(period: PeriodSlot) {
    if (!period.adjacent_practical_slot_id) return
    setCopyingPractical(period.timetable_slot_id)
    try {
      let res = await fetch('/api/attendance/period/copy-to-next-period', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_slot_id: period.timetable_slot_id,
          target_slot_id: period.adjacent_practical_slot_id,
          attendance_date: scheduleDate,
          overwrite: false,
        }),
      })

      if (res.status === 409) {
        const confirmed = window.confirm(
          `Next practical period already has attendance marks recorded for ${scheduleDate}. Overwrite existing marks?`
        )
        if (confirmed) {
          res = await fetch('/api/attendance/period/copy-to-next-period', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_slot_id: period.timetable_slot_id,
              target_slot_id: period.adjacent_practical_slot_id,
              attendance_date: scheduleDate,
              overwrite: true,
            }),
          })
        } else {
          setCopyingPractical(null)
          return
        }
      }

      const data = await res.json()
      if (res.ok) {
        setGlobalSuccess(`✓ Practical attendance copied to Period ${period.period_number + 1} for ${scheduleDate}!`)
        await fetchTeacherSchedule(scheduleDate)
        setTimeout(() => setGlobalSuccess(''), 4000)
      } else {
        setGlobalError(data.message || 'Failed to copy practical attendance.')
      }
    } catch {
      setGlobalError('Network error while copying practical attendance.')
    } finally {
      setCopyingPractical(null)
    }
  }

  // Department options for Tab 2
  const deptOptions: DeptOption[] = useMemo(() => {
    if (!rosterData || !rosterData.students) return []
    const map = new Map<string, DeptOption>()
    for (const s of rosterData.students) {
      const key = s.department || s.department_code || 'Unknown'
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: s.department || s.department_code || 'Unknown',
          code: s.department_code || s.department || '',
          count: 0,
        })
      }
      map.get(key)!.count++
    }
    return Array.from(map.values())
  }, [rosterData])

  const displayedStudents = useMemo(() => {
    if (!rosterData) return []
    if (tableDeptFilter === 'all') return rosterData.students
    return rosterData.students.filter(s => {
      const key = s.department || s.department_code || 'Unknown'
      return key === tableDeptFilter || s.department === tableDeptFilter || s.department_code === tableDeptFilter
    })
  }, [rosterData, tableDeptFilter])

  const pdfStudents = useMemo(() => {
    if (!rosterData) return []
    if (pdfDeptMode === 'all') return rosterData.students
    return rosterData.students.filter(s => {
      const key = s.department || s.department_code || 'Unknown'
      return selectedPdfDepts.includes(key) || selectedPdfDepts.includes(s.department) || selectedPdfDepts.includes(s.department_code)
    })
  }, [rosterData, pdfDeptMode, selectedPdfDepts])

  function handleOpenPdfModal() {
    if (!rosterData || rosterData.students.length === 0) return
    setPdfDeptMode('all')
    setSelectedPdfDepts(deptOptions.map(d => d.key))
    setShowPdfModal(true)
  }

  async function handleGeneratePDF() {
    if (!rosterData || pdfStudents.length === 0) return
    setGeneratingPdf(true)
    try {
      const { generateAttendanceSheet } = await import('@/core/utils/exportPdf')
      await generateAttendanceSheet({
        courseTitle: rosterData.course.title,
        courseCode: rosterData.course.course_code,
        students: pdfStudents.map(s => ({
          full_name: s.full_name,
          department_name: s.department,
          department_code: s.department_code,
        })),
      })
      setShowPdfModal(false)
    } catch (err) {
      console.error('Failed to generate PDF:', err)
      setGlobalError('Failed to generate PDF. Please try again.')
    } finally {
      setGeneratingPdf(false)
    }
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

  return (
    <div className={styles.pageWrapper}>
      {/* ── UNIFIED EXECUTIVE TOP BAR ── */}
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          {/* 1. Portal Branding Block */}
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
              <p className={styles.topBarSubtitle}>Teacher Dashboard</p>
            </div>
          </div>

          {/* Vertical Separator */}
          <div className={styles.topBarDivider} />

          {/* 2. Integrated Teacher Identity Block */}
          {loadingProfile ? (
            <div className={styles.topBarSkeleton} />
          ) : (
            <div className={styles.teacherIdentity}>
              <p className={styles.teacherNameHeader}>{teacherName || 'Course Teacher'}</p>
              <div className={styles.teacherBadges}>
                <span className={styles.roleBadge}>Course Teacher</span>
                <span className={styles.metaBadge}>
                  {assignedCourses.length} Assigned {assignedCourses.length === 1 ? 'Paper' : 'Papers'}
                </span>
                {departmentName && (
                  <span className={styles.metaBadge} title={departmentName}>
                    {departmentName}
                  </span>
                )}
                {campusName && (
                  <span className={styles.metaBadge} title={campusName}>
                    {campusName}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 3. Action Controls */}
        <div className={styles.topBarRight}>
          <button
            type="button"
            className={styles.logoutBtn}
            onClick={handleLogout}
            disabled={loggingOut}
            title="Log out of portal"
          >
            <LogOut size={14} />
            <span className={styles.logoutText}>{loggingOut ? 'Logging out...' : 'Logout'}</span>
          </button>
        </div>
      </header>

      {/* ── FULL VIEWPORT WIDTH TAB BAR (Matched to HOD & Director) ── */}
      <nav className={styles.tabBar} aria-label="Teacher Navigation">
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'schedule' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('schedule')}
        >
          <span>📅 Today&apos;s Schedule & Attendance</span>
          <span className={styles.tabCountBadge}>{schedulePeriods.length}</span>
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'timetable' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('timetable')}
        >
          <span>🗓️ Weekly Timetable</span>
          <span className={styles.tabCountBadge}>{weeklySchedule.length}</span>
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'rosters' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('rosters')}
        >
          <span>📚 My Assigned Papers & Class Rosters</span>
          <span className={styles.tabCountBadge}>{assignedCourses.length}</span>
        </button>
      </nav>

      {/* Main Content */}
      <div className={styles.mainContent}>
        {globalError && <div className={styles.errorBanner}>{globalError}</div>}
        {globalSuccess && (
          <div
            style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              color: '#15803d',
              padding: '0.75rem 1rem',
              borderRadius: '0.5rem',
              fontSize: '0.84rem',
              marginBottom: '1.25rem',
              fontWeight: 600,
            }}
          >
            {globalSuccess}
          </div>
        )}

        {/* TAB 1: SCHEDULE & ATTENDANCE */}
        {activeTab === 'schedule' && (
          <div>
            <div className={styles.scheduleHeaderCard}>
              <div className={styles.scheduleHeaderTop}>
                <h3 className={styles.scheduleTitle}>
                  <span>🕒 Lecture Timetable & Marking</span>
                </h3>
                <div className={styles.scheduleDateControls}>
                  <input
                    type="date"
                    className={styles.scheduleDateInput}
                    value={scheduleDate}
                    onChange={e => {
                      setScheduleDate(e.target.value)
                    }}
                  />
                  <button
                    type="button"
                    className={styles.todayQuickBtn}
                    onClick={() => {
                      const today = new Date().toISOString().split('T')[0]
                      setScheduleDate(today)
                    }}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    className={styles.refreshScheduleBtn}
                    onClick={() => fetchTeacherSchedule(scheduleDate)}
                    disabled={loadingSchedule}
                    title="Refresh schedule"
                  >
                    🔄
                  </button>
                </div>
              </div>

              <div className={styles.scheduleMetaSummary}>
                <span>Selected Date: <strong>{scheduleDate}</strong></span>
                <span>• Scheduled Lectures: <strong>{schedulePeriods.length}</strong></span>
                <span>
                  • Marked:{' '}
                  <strong style={{ color: '#16a34a' }}>
                    {schedulePeriods.filter(p => p.is_marked).length}
                  </strong>{' '}
                  /{' '}
                  Pending:{' '}
                  <strong style={{ color: '#b45309' }}>
                    {schedulePeriods.filter(p => !p.is_marked).length}
                  </strong>
                </span>
              </div>
            </div>

            {loadingSchedule ? (
              <div className={styles.loadingState}>
                <div className={styles.spinner} />
                <p className={styles.loadingText}>Loading scheduled periods...</p>
              </div>
            ) : schedulePeriods.length === 0 ? (
              <div className={styles.emptyPeriodBanner}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>☕</div>
                <h4 style={{ fontSize: '1rem', fontWeight: 700, color: '#002147', margin: '0 0 0.35rem' }}>
                  No Lectures Scheduled For This Day
                </h4>
                <p style={{ fontSize: '0.82rem', margin: 0 }}>
                  {scheduleMessage || 'No timetable entries were found for your assigned courses on this date.'}
                </p>
              </div>
            ) : (
              <div className={styles.periodGrid}>
                {schedulePeriods.map(period => {
                  return (
                    <div
                      key={period.timetable_slot_id}
                      className={`${styles.periodCard} ${
                        period.is_marked ? styles.periodCardMarked : styles.periodCardPending
                      }`}
                    >
                      <div>
                        <div className={styles.periodCardHeader}>
                          <span className={styles.periodTag}>PERIOD {period.period_number}</span>
                          <span className={styles.periodTimeBadge}>
                            ⏱️ {period.start_time.slice(0, 5)} - {period.end_time.slice(0, 5)}
                          </span>
                        </div>

                        <h4 className={styles.periodCourseTitle}>{period.course_title}</h4>
                        <p className={styles.periodCourseCode}>
                          {period.course_code}{' '}
                          {period.course_semester ? `• Semester ${period.course_semester}` : ''}
                        </p>

                        <div className={styles.periodStatusRow}>
                          {period.is_marked ? (
                            <>
                              <span className={styles.statusMarkedText}>✓ Attendance Marked</span>
                              <span className={styles.statusStatsText}>
                                Present: {period.present_count} | Absent: {period.absent_count}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className={styles.statusPendingText}>⏳ Attendance Pending</span>
                              <span className={styles.statusStatsText}>
                                {period.total_enrolled} Enrolled
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className={`${styles.markAttendanceBtn} ${
                            period.is_marked
                              ? styles.markAttendanceBtnMarked
                              : styles.markAttendanceBtnPending
                          }`}
                          onClick={() => handleOpenMarkingModal(period)}
                        >
                          {period.is_marked ? '✏️ Update Attendance' : '📝 Mark Attendance Now'}
                        </button>

                        {period.is_marked && period.adjacent_practical_slot_id && (
                          <button
                            type="button"
                            className={styles.markAttendanceBtn}
                            style={{
                              background: '#f0fdf4',
                              color: '#166534',
                              border: '1px solid #86efac',
                            }}
                            onClick={() => handleCopyPractical(period)}
                            disabled={copyingPractical === period.timetable_slot_id}
                          >
                            {copyingPractical === period.timetable_slot_id
                              ? 'Copying...'
                              : `📋 Copy to P${period.period_number + 1}`}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: WEEKLY TIMETABLE */}
        {activeTab === 'timetable' && (
          <div className={styles.timetableContainer}>
            {/* Header & Controls */}
            <div className={styles.timetableHeaderRow}>
              <h2 className={styles.timetableTitle}>
                <span>🗓️</span> Weekly Teaching Schedule (Periods 1 to 6)
              </h2>

              <div className={styles.timetableControlsGroup}>
                {/* Day Filter Pills */}
                <div className={styles.dayFilterGroup}>
                  <button
                    type="button"
                    className={`${styles.dayFilterBtn} ${selectedTimetableDay === 'all' ? styles.dayFilterBtnActive : ''}`}
                    onClick={() => setSelectedTimetableDay('all')}
                  >
                    All Days
                  </button>
                  {DAYS.map(d => (
                    <button
                      key={d.num}
                      type="button"
                      className={`${styles.dayFilterBtn} ${selectedTimetableDay === d.num ? styles.dayFilterBtnActive : ''}`}
                      onClick={() => setSelectedTimetableDay(d.num)}
                    >
                      {d.short}
                    </button>
                  ))}
                </div>

                {/* Semester Filter if multiple available */}
                {availableSemesters.length > 1 && (
                  <select
                    className={styles.tableFilterSelect}
                    value={selectedTimetableSemester}
                    onChange={e => setSelectedTimetableSemester(e.target.value)}
                  >
                    <option value="all">All Semesters</option>
                    {availableSemesters.map(sem => (
                      <option key={sem} value={sem.toString()}>
                        Semester {sem}
                      </option>
                    ))}
                  </select>
                )}

                {/* Total Teaching Hours / Periods Badge */}
                <span className={styles.timetableMetaPill}>
                  {filteredWeeklySchedule.length} Weekly {filteredWeeklySchedule.length === 1 ? 'Period' : 'Periods'}
                </span>
              </div>
            </div>

            {weeklySchedule.length === 0 && !loadingSchedule ? (
              <div
                style={{
                  background: '#ffffff',
                  border: '1.5px dashed #cbd5e1',
                  borderRadius: '12px',
                  padding: '2.5rem 1.5rem',
                  textAlign: 'center',
                  color: '#475569',
                }}
              >
                <div style={{ fontSize: '2.25rem', marginBottom: '0.5rem' }}>🗓️</div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#002147', margin: '0 0 0.5rem' }}>
                  No Timetable Entries Published Yet
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#64748b', maxWidth: '480px', margin: '0 auto', lineHeight: 1.5 }}>
                  Timetable entries for your assigned courses have not been scheduled or published yet by your department. Once published, your weekly class grid will appear here.
                </p>
              </div>
            ) : (
              <>
                {/* Desktop Grid View */}
                <div className={styles.timetableDesktop}>
                  <table className={styles.timetableTable}>
                    <thead>
                      <tr>
                        <th className={`${styles.timetableTh} ${styles.timetableThDay}`}>Day</th>
                        {PERIODS.map(p => (
                          <th key={p.num} className={styles.timetableTh}>
                            <div>{p.label}</div>
                            <div style={{ fontSize: '0.65rem', fontWeight: 500, color: '#64748b' }}>{p.time}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedTimetableDay === 'all'
                        ? DAYS
                        : DAYS.filter(d => d.num === selectedTimetableDay)
                      ).map(day => (
                        <tr key={day.num}>
                          <td className={styles.timetableDayCell}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span>{day.name}</span>
                              {day.num === getCurrentUserDay() && (
                                <span className={styles.todayBadge}>Today</span>
                              )}
                            </div>
                          </td>
                          {PERIODS.map(period => {
                            const matchingEntry = filteredWeeklySchedule.find(
                              e => e.day_of_week === day.num && e.period_number === period.num
                            )

                            return (
                              <td key={period.num} className={styles.timetableTd}>
                                {matchingEntry ? (
                                  <div
                                    className={`${styles.timetableSlotFilled} ${
                                      matchingEntry.is_lab_block ? styles.timetableSlotLab : ''
                                    }`}
                                  >
                                    <div>
                                      <div className={styles.timetableCourseCode}>
                                        {matchingEntry.course_code}
                                      </div>
                                      <div
                                        className={styles.timetableCourseTitle}
                                        title={matchingEntry.course_title}
                                      >
                                        {matchingEntry.course_title}
                                      </div>
                                    </div>
                                    <div className={styles.timetableMetaRow}>
                                      <span className={styles.timetableCategoryBadge}>
                                        {matchingEntry.course_category || (matchingEntry.course_semester ? `Sem ${matchingEntry.course_semester}` : 'Core')}
                                      </span>
                                      {matchingEntry.is_lab_block && (
                                        <span className={styles.timetableLabBadge}>Lab</span>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div className={styles.timetableSlotEmpty}>—</div>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Vertical Period View */}
                {(() => {
                  const activeMobileDayNum =
                    selectedTimetableDay === 'all' ? getCurrentUserDay() : selectedTimetableDay
                  const activeDayObj = DAYS.find(d => d.num === activeMobileDayNum) || DAYS[0]
                  const isToday = activeDayObj.num === getCurrentUserDay()

                  return (
                    <div className={styles.timetableMobile}>
                      <div className={styles.mobileDayHeader}>
                        <div className={styles.mobileDayTitle}>
                          <span>{activeDayObj.name}</span>
                          {isToday && <span className={styles.todayBadge}>Today</span>}
                        </div>
                        <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>
                          6 Scheduled Periods
                        </span>
                      </div>

                      <div className={styles.verticalPeriodList}>
                        {PERIODS.map(period => {
                          const matchingEntry = filteredWeeklySchedule.find(
                            e => e.day_of_week === activeDayObj.num && e.period_number === period.num
                          )

                          return (
                            <div key={period.num} className={styles.verticalPeriodCard}>
                              <div className={styles.verticalPeriodTimeCol}>
                                <span className={styles.verticalPeriodNum}>{period.label}</span>
                                <span className={styles.verticalPeriodTime}>{period.time}</span>
                              </div>

                              <div className={styles.verticalPeriodContent}>
                                {matchingEntry ? (
                                  <div className={styles.verticalPeriodFilled}>
                                    <div className={styles.verticalPeriodHeader}>
                                      <span className={styles.verticalCourseCode}>
                                        {matchingEntry.course_code}
                                      </span>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                        <span className={styles.timetableCategoryBadge}>
                                          {matchingEntry.course_category || (matchingEntry.course_semester ? `Sem ${matchingEntry.course_semester}` : 'Core')}
                                        </span>
                                        {matchingEntry.is_lab_block && (
                                          <span className={styles.timetableLabBadge}>Lab</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className={styles.verticalCourseTitle}>
                                      {matchingEntry.course_title}
                                    </div>
                                  </div>
                                ) : (
                                  <div className={styles.verticalPeriodEmpty}>
                                    <span>— Free Period / No Class —</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
              </>
            )}
          </div>
        )}

        {/* TAB 3: MY ASSIGNED PAPERS & CLASS ROSTERS */}
        {activeTab === 'rosters' && (
          <div>
            {assignedCourses.length === 0 && !loadingProfile && (
              <div
                style={{
                  background: '#ffffff',
                  border: '1.5px dashed #cbd5e1',
                  borderRadius: '12px',
                  padding: '2.5rem 1.5rem',
                  textAlign: 'center',
                  color: '#475569',
                  marginBottom: '1rem',
                }}
              >
                <div style={{ fontSize: '2.25rem', marginBottom: '0.5rem' }}>📚</div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#002147', margin: '0 0 0.5rem' }}>
                  No Courses Currently Assigned
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#64748b', maxWidth: '480px', margin: '0 auto', lineHeight: 1.5 }}>
                  Your Head of Department (HOD) has not assigned you to any courses yet. Once assigned, your papers, enrolled student lists, and downloadable attendance sheets will appear here.
                </p>
              </div>
            )}

            {/* Paper Selection Card */}
            <div className={styles.filterCard}>
              <div className={styles.filterCardHeader}>
                <p className={styles.filterCardTitle}>🔍 Assigned Papers & Course Selection</p>
              </div>

              <div className={styles.filterControlsGrid}>
                <div className={styles.filterGroup}>
                  <label className={styles.filterLabel}>Filter By Semester</label>
                  <select
                    className={styles.filterSelect}
                    value={selectedSemester}
                    onChange={e => setSelectedSemester(e.target.value)}
                  >
                    <option value="all">All Semesters</option>
                    {availableSemesters.map(sem => (
                      <option key={sem} value={sem.toString()}>
                        Semester {sem}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.paperSelectGroup}>
                  <label className={styles.filterLabel}>
                    Select Assigned Paper ({filteredAssignedCourses.length} available)
                  </label>
                  <CustomPaperSelect
                    courses={filteredAssignedCourses}
                    selectedCourseId={selectedCourseId}
                    onSelect={courseId => {
                      setSelectedCourseId(courseId)
                      handleFetchRoster(courseId)
                    }}
                    disabled={loadingRoster}
                  />
                </div>
              </div>
            </div>

            {loadingRoster && (
              <div className={styles.loadingState}>
                <div className={styles.spinner} />
                <p className={styles.loadingText}>Fetching enrolled student roster...</p>
              </div>
            )}

            {!loadingRoster && rosterData && (
              <div className={styles.detailsContainer}>
                <div className={styles.courseInfoBanner}>
                  <div>
                    <p className={styles.courseInfoName}>{rosterData.course.title}</p>
                    <p className={styles.courseInfoCode}>{rosterData.course.course_code}</p>
                  </div>
                </div>

                <div className={styles.statsRow}>
                  <div className={styles.statCard}>
                    <p className={styles.statValue}>{rosterData.total_students}</p>
                    <p className={styles.statLabel}>Enrolled Students</p>
                  </div>
                  <div className={styles.statCard}>
                    <p className={styles.statValue}>{Object.keys(rosterData.department_breakdown).length}</p>
                    <p className={styles.statLabel}>Departments</p>
                  </div>
                </div>

                {Object.keys(rosterData.department_breakdown).length > 0 && (
                  <div className={styles.breakdownCard}>
                    <p className={styles.breakdownTitle}>Department Breakdown</p>
                    {Object.entries(rosterData.department_breakdown).map(([dept, count]) => (
                      <div key={dept} className={styles.breakdownRow}>
                        <span className={styles.breakdownDept}>{dept}</span>
                        <span className={styles.breakdownCount}>{count} students</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className={styles.sectionHeader}>
                  <div className={styles.sectionHeaderLeft}>
                    <p className={styles.sectionTitle}>
                      Class Roster ({tableDeptFilter === 'all' ? rosterData.total_students : displayedStudents.length})
                    </p>
                    {deptOptions.length > 1 && (
                      <select
                        className={styles.tableFilterSelect}
                        value={tableDeptFilter}
                        onChange={e => setTableDeptFilter(e.target.value)}
                        title="Filter roster by student department"
                      >
                        <option value="all">All Departments ({rosterData.total_students})</option>
                        {deptOptions.map(d => (
                          <option key={d.key} value={d.key}>
                            {d.name} ({d.count})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {rosterData.total_students > 0 && (
                    <button className={styles.downloadBtn} onClick={handleOpenPdfModal}>
                      📄 Download Attendance Sheet (PDF)
                    </button>
                  )}
                </div>

                <div className={styles.tableWrapper}>
                  {rosterData.total_students === 0 ? (
                    <div className={styles.emptyState}>
                      <div className={styles.emptyIcon}>📭</div>
                      <p className={styles.emptyTitle}>No students enrolled</p>
                      <p className={styles.emptySubtitle}>No students have registered for this assigned paper yet.</p>
                    </div>
                  ) : displayedStudents.length === 0 ? (
                    <div className={styles.emptyState}>
                      <div className={styles.emptyIcon}>🔍</div>
                      <p className={styles.emptyTitle}>No matching students</p>
                      <p className={styles.emptySubtitle}>No students enrolled from the selected department.</p>
                    </div>
                  ) : (
                    <table className={styles.table}>
                      <thead className={styles.tableHead}>
                        <tr>
                          <th>#</th>
                          <th>Student Name</th>
                          <th>Department</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedStudents.map((student, index) => (
                          <tr key={student.id} className={styles.tableRow}>
                            <td>{index + 1}</td>
                            <td>{student.full_name}</td>
                            <td>
                              <span className={styles.deptBadge}>
                                {student.department_code || student.department}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ATTENDANCE MARKING MODAL */}
      {activeSlotForMarking && (
        <div className={styles.modalOverlay} onClick={() => setActiveSlotForMarking(null)}>
          <div className={styles.attendanceModal} onClick={e => e.stopPropagation()}>
            <div className={styles.attendanceModalHeader}>
              <div>
                <h3 className={styles.modalPeriodTitle}>
                  📝 Period {activeSlotForMarking.period_number} Attendance
                </h3>
                <p className={styles.modalPeriodSub}>
                  {activeSlotForMarking.course_title} ({activeSlotForMarking.course_code}) •{' '}
                  {activeSlotForMarking.start_time.slice(0, 5)} - {activeSlotForMarking.end_time.slice(0, 5)}
                </p>
              </div>
              <button
                type="button"
                className={styles.modalCloseWhiteBtn}
                onClick={() => setActiveSlotForMarking(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {markingError && <div className={styles.errorBanner} style={{ margin: '0.75rem 1.25rem 0' }}>{markingError}</div>}

            <div className={styles.attendanceModalControls}>
              <div className={styles.attendanceStatsLive}>
                <span>Total: <strong>{markingRoster.length}</strong></span>
                <span className={styles.statLivePresent}>
                  ✓ Present: <strong>{markingRoster.length - absentStudentIds.size}</strong>
                </span>
                <span className={styles.statLiveAbsent}>
                  ✗ Absent: <strong>{absentStudentIds.size}</strong>
                </span>
              </div>
              <div className={styles.quickActionGroup}>
                <button
                  type="button"
                  className={styles.quickBtn}
                  onClick={handleMarkAllPresent}
                >
                  All Present
                </button>
                <button
                  type="button"
                  className={styles.quickBtn}
                  onClick={handleMarkAllAbsent}
                >
                  All Absent
                </button>
              </div>
            </div>

            <div className={styles.attendanceStudentList}>
              {loadingMarkingRoster ? (
                <div className={styles.loadingState}>
                  <div className={styles.spinner} />
                  <p className={styles.loadingText}>Loading enrolled student roster...</p>
                </div>
              ) : markingRoster.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                  No students registered for this course.
                </div>
              ) : (
                markingRoster.map((student, idx) => {
                  const isAbsent = absentStudentIds.has(student.id)
                  return (
                    <div
                      key={student.id}
                      className={`${styles.studentAttendanceRow} ${
                        isAbsent ? styles.studentAttendanceRowAbsent : styles.studentAttendanceRowPresent
                      }`}
                    >
                      <div className={styles.studentInfoBlock}>
                        <span className={styles.studentRowName}>
                          {idx + 1}. {student.full_name}
                        </span>
                        <span className={styles.studentRowMeta}>
                          {student.department_code || student.department}
                          {student.cap_application_number ? ` • CAP: ${student.cap_application_number}` : ''}
                        </span>
                      </div>

                      <button
                        type="button"
                        className={`${styles.toggleStatusBtn} ${
                          isAbsent ? styles.toggleStatusAbsent : styles.toggleStatusPresent
                        }`}
                        onClick={() => handleToggleStudentStatus(student.id)}
                      >
                        {isAbsent ? '✗ ABSENT' : '✓ PRESENT'}
                      </button>
                    </div>
                  )
                })
              )}
            </div>

            <div className={styles.attendanceModalFooter}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                onClick={() => setActiveSlotForMarking(null)}
                disabled={submittingAttendance}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.submitAttendanceBtn}
                onClick={handleSubmitAttendance}
                disabled={submittingAttendance || loadingMarkingRoster}
              >
                {submittingAttendance
                  ? 'Submitting...'
                  : `Save & Submit (${markingRoster.length - absentStudentIds.size} Present, ${absentStudentIds.size} Absent)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF EXPORT MODAL */}
      {showPdfModal && rosterData && (
        <div className={styles.modalOverlay} onClick={() => setShowPdfModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>📄 Export Attendance Sheet (PDF)</h3>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setShowPdfModal(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <p className={styles.modalSubtitle}>
              Select department(s) to include in the generated attendance sheet for{' '}
              <strong>{rosterData.course.title}</strong> ({rosterData.course.course_code}).
            </p>

            <div className={styles.pdfOptionBlock}>
              <label className={`${styles.radioOption} ${pdfDeptMode === 'all' ? styles.radioOptionActive : ''}`}>
                <input
                  type="radio"
                  name="pdfDeptMode"
                  checked={pdfDeptMode === 'all'}
                  onChange={() => setPdfDeptMode('all')}
                  className={styles.radioInput}
                />
                <div className={styles.radioOptionContent}>
                  <span className={styles.radioOptionTitle}>🌐 All Departments</span>
                  <span className={styles.radioOptionDesc}>Includes all {rosterData.total_students} enrolled students</span>
                </div>
              </label>

              <label className={`${styles.radioOption} ${pdfDeptMode === 'custom' ? styles.radioOptionActive : ''}`}>
                <input
                  type="radio"
                  name="pdfDeptMode"
                  checked={pdfDeptMode === 'custom'}
                  onChange={() => {
                    setPdfDeptMode('custom')
                    if (selectedPdfDepts.length === 0) {
                      setSelectedPdfDepts(deptOptions.map(d => d.key))
                    }
                  }}
                  className={styles.radioInput}
                />
                <div className={styles.radioOptionContent}>
                  <span className={styles.radioOptionTitle}>🏷️ Select Specific Departments</span>
                  <span className={styles.radioOptionDesc}>Choose which department students to include</span>
                </div>
              </label>
            </div>

            {pdfDeptMode === 'custom' && (
              <div className={styles.customDeptContainer}>
                <div className={styles.deptQuickHeader}>
                  <span className={styles.deptQuickTitle}>Select Departments ({selectedPdfDepts.length}/{deptOptions.length})</span>
                  <div className={styles.deptQuickActions}>
                    <button
                      type="button"
                      className={styles.quickActionBtn}
                      onClick={() => setSelectedPdfDepts(deptOptions.map(d => d.key))}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      className={styles.quickActionBtn}
                      onClick={() => setSelectedPdfDepts([])}
                    >
                      Deselect All
                    </button>
                  </div>
                </div>

                <div className={styles.deptChecklist}>
                  {deptOptions.map(dept => {
                    const isChecked = selectedPdfDepts.includes(dept.key)
                    return (
                      <label
                        key={dept.key}
                        className={`${styles.deptCheckItem} ${isChecked ? styles.deptCheckItemActive : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedPdfDepts(prev => [...prev, dept.key])
                            } else {
                              setSelectedPdfDepts(prev => prev.filter(k => k !== dept.key))
                            }
                          }}
                          className={styles.checkboxInput}
                        />
                        <div className={styles.deptCheckText}>
                          <span className={styles.deptCheckName}>{dept.name}</span>
                          {dept.code && dept.code !== dept.name && (
                            <span className={styles.deptCheckCodeBadge}>{dept.code}</span>
                          )}
                        </div>
                        <span className={styles.deptCheckCount}>
                          {dept.count} {dept.count === 1 ? 'student' : 'students'}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            {pdfDeptMode === 'custom' && selectedPdfDepts.length === 0 && (
              <div className={styles.pdfWarningBanner}>
                ⚠️ Please select at least one department to export.
              </div>
            )}

            <div className={styles.pdfSummaryBox}>
              <span>Students included in PDF:</span>
              <strong className={styles.pdfSummaryCount}>
                {pdfStudents.length} of {rosterData.total_students}
              </strong>
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalCancelBtn}
                onClick={() => setShowPdfModal(false)}
                disabled={generatingPdf}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.modalConfirmBtn}
                onClick={handleGeneratePDF}
                disabled={generatingPdf || (pdfDeptMode === 'custom' && selectedPdfDepts.length === 0)}
              >
                {generatingPdf ? 'Generating PDF...' : `Download PDF (${pdfStudents.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
