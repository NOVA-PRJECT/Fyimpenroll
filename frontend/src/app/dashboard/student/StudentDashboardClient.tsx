'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import {
  LogOut,
  LayoutDashboard,
  Bell,
  Calendar,
  MapPin,
  BookOpen,
  Award
} from 'lucide-react'

import styles from './student-dashboard.module.css'
import { useBfcacheGuard } from '@/core/hooks/useBfcacheGuard'
import CampusSignInCard from './CampusSignInCard'
import CreditLedgerView from '@/components/credit-ledger/CreditLedgerView'
import { RegistrationWindow } from './page'

interface StudentInfo {
  id?: string
  full_name: string
  current_semester: number
  academic_year_joined: string
  department_name: string
  campus_name: string
}

export interface EnrolledCourse {
  slotNumber: number
  id: string
  courseCode: string
  title: string
  credits: number
  category: string
  departmentName: string
  status: string
  isConfirmed: boolean
}

interface StudentDashboardClientProps {
  studentInfo: StudentInfo
  hasSubmission: boolean
  hasRegistration?: boolean
  allocationCompleted?: boolean
  enrolledCourses?: EnrolledCourse[]
  totalRegisteredCredits?: number
  registrationWindow?: RegistrationWindow | null
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
  { num: 1, label: 'P1', time: '09:30 - 10:30' },
  { num: 2, label: 'P2', time: '10:30 - 11:30' },
  { num: 3, label: 'P3', time: '11:30 - 12:30' },
  { num: 4, label: 'P4', time: '13:30 - 14:30' },
  { num: 5, label: 'P5', time: '14:30 - 15:30' },
  { num: 6, label: 'P6', time: '15:30 - 16:30' },
]

function getCurrentUserDay(): number {
  const day = new Date().getDay() // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
  if (day >= 1 && day <= 6) return day
  return 1 // Default to Monday on Sunday
}

type StudentTab = 'overview' | 'notifications' | 'courses' | 'timetable' | 'campus-signin' | 'credits'

export default function StudentDashboardClient({
  studentInfo,
  hasSubmission,
  hasRegistration = false,
  allocationCompleted = false,
  enrolledCourses = [],
  totalRegisteredCredits = 0,
  registrationWindow,
}: StudentDashboardClientProps) {
  useBfcacheGuard()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<StudentTab>('overview')
  const [selectedDay, setSelectedDay] = useState<number | 'all'>('all')
  const [loggingOut, setLoggingOut] = useState(false)
  const [timetableEntries, setTimetableEntries] = useState<any[]>([])
  const [loadingTimetable, setLoadingTimetable] = useState(false)

  // Fetch timetable entries when switching to timetable tab
  useEffect(() => {
    if (activeTab === 'timetable' && timetableEntries.length === 0 && studentInfo) {
      async function loadTimetable() {
        setLoadingTimetable(true)
        try {
          const ay = registrationWindow?.academicYear || '2026-27'
          const sem = studentInfo.current_semester || 1
          const res = await fetch(`/api/timetable/entries?academicYear=${encodeURIComponent(ay)}&semester=${sem}`)
          if (res.ok) {
            const data = await res.json()
            setTimetableEntries(data.entries || [])
          }
        } catch (err) {
          console.error('Failed to load timetable entries:', err)
        } finally {
          setLoadingTimetable(false)
        }
      }
      loadTimetable()
    }
  }, [activeTab, timetableEntries.length, studentInfo, registrationWindow?.academicYear])

  async function handleLogout() {
    setLoggingOut(true)
    if (typeof window !== 'undefined') {
      sessionStorage.clear()
      localStorage.clear()
    }
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  // Set of enrolled course IDs & codes for timetable filtering
  const enrolledCourseIds = new Set(enrolledCourses.map((c) => c.id))
  const enrolledCodes = new Set(enrolledCourses.map((c) => (c.courseCode || '').trim().toUpperCase()))

  const deadlineFormatted = registrationWindow?.deadline
    ? new Date(registrationWindow.deadline).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  // Contextual registration status state machine
  const isWindowOpen = registrationWindow?.isOpen ?? false
  const isRegistered = hasRegistration || (enrolledCourses && enrolledCourses.length > 0) || hasSubmission

  let regStatusBadge = '● Action Required'
  let regStatusClass = styles.regStatusPending
  let regDescription =
    'Review your semester blueprint, curriculum pathway, and select your ranked elective course choices for this semester.'
  let regCtaText = 'Enter Course Registration →'
  let regNotificationStatus = '⏳ Pending Submission'
  let regNotificationColor = '#ea580c'

  if (!isWindowOpen) {
    if (isRegistered) {
      regStatusBadge = '✓ Registration Successful'
      regStatusClass = styles.regStatusSuccessful
      regDescription = `Your course registration for Semester ${studentInfo.current_semester} has been successfully completed and confirmed. Official papers are locked for this term.`
      regCtaText = 'View Registered Courses →'
      regNotificationStatus = '✓ Registration Successful'
      regNotificationColor = '#059669'
    } else {
      regStatusBadge = '🔒 Window Closed'
      regStatusClass = styles.regStatusClosed
      regDescription = `The course registration window for Semester ${studentInfo.current_semester} is currently closed. You did not submit course preferences for this term.`
      regCtaText = 'View Registration Status →'
      regNotificationStatus = '🔒 Window Closed (Incomplete)'
      regNotificationColor = '#dc2626'
    }
  } else {
    // Window is open
    if (allocationCompleted) {
      regStatusBadge = '✓ Courses Allocated & Confirmed'
      regStatusClass = styles.regStatusSubmitted
      regDescription =
        'Official course allocation is complete. Direct slot adjustment is open (subject to the maximum 3 changes per 27 hours policy).'
      regCtaText = 'Adjust Course Slots →'
      regNotificationStatus = '✓ Courses Allocated & Confirmed'
      regNotificationColor = '#16a34a'
    } else if (hasSubmission) {
      regStatusBadge = '✓ Preferences Submitted'
      regStatusClass = styles.regStatusSubmitted
      regDescription =
        'Your course preferences for this semester are recorded. You can review or modify your elective rankings anytime while the registration window remains open.'
      regCtaText = 'Review & Update Course Preferences →'
      regNotificationStatus = '✓ Preferences Submitted'
      regNotificationColor = '#16a34a'
    }
  }

  return (
    <div className={styles.pageWrapper}>
      {/* ── UNIFIED EXECUTIVE TOP BAR (Matched to Director & HOD) ── */}
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
              <p className={styles.topBarSubtitle}>Student Portal</p>
            </div>
          </div>

          {/* Vertical Separator */}
          <div className={styles.topBarDivider} />

          {/* 2. Student Details Block (Desktop) */}
          {studentInfo && (
            <div className={styles.studentIdentity}>
              <p className={styles.studentNameHeader}>{studentInfo.full_name}</p>
              <div className={styles.studentBadges}>
                <span className={styles.metaBadge}>FYIMP Student</span>
                {studentInfo.campus_name && (
                  <span className={styles.metaBadge} title={studentInfo.campus_name}>
                    {studentInfo.campus_name}
                  </span>
                )}
                {studentInfo.department_name && (
                  <span className={styles.metaBadge} title={studentInfo.department_name}>
                    {studentInfo.department_name}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 3. Action Controls */}
        <div className={styles.topBarRight}>
          {studentInfo && (
            <div className={styles.mobileStudentPill}>
              <span className={styles.mobileAvatar}>
                {studentInfo.full_name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <button
            type="button"
            className={styles.logoutBtn}
            onClick={handleLogout}
            disabled={loggingOut}
            title="Log out of portal"
          >
            <LogOut size={16} />
            <span className={styles.logoutText}>{loggingOut ? 'Logging out...' : 'Logout'}</span>
          </button>
        </div>
      </header>

      {/* ── RESPONSIVE TAB BAR (Top on Desktop, Fixed Bottom on Mobile) ── */}
      <nav className={styles.tabBar} aria-label="Student Navigation">
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'overview' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <div className={styles.tabIconWrapper}>
            <LayoutDashboard size={18} className={styles.tabIcon} />
          </div>
          <span className={styles.tabText}>Overview</span>
        </button>

        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'notifications' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('notifications')}
        >
          <div className={styles.tabIconWrapper}>
            <Bell size={18} className={styles.tabIcon} />
            {registrationWindow?.isOpen && (
              <span className={`${styles.tabBadgeDot} ${registrationWindow.isClosingSoon ? styles.tabBadgeDotAlert : ''}`} />
            )}
          </div>
          <span className={styles.tabText}>Notices</span>
          {registrationWindow?.isOpen && (
            <span
              className={`${styles.tabBadge} ${
                registrationWindow.isClosingSoon ? styles.tabBadgeAlert : styles.tabBadgeOpen
              }`}
            >
              {registrationWindow.isClosingSoon ? 'Closing' : 'Open'}
            </span>
          )}
        </button>

        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'courses' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('courses')}
        >
          <div className={styles.tabIconWrapper}>
            <BookOpen size={18} className={styles.tabIcon} />
            {enrolledCourses.length > 0 && (
              <span className={styles.tabBadgeCountMobile}>{enrolledCourses.length}</span>
            )}
          </div>
          <span className={styles.tabText}>Enrolled</span>
          {enrolledCourses.length > 0 && (
            <span className={`${styles.tabBadge} ${styles.tabBadgeOpen}`}>
              {enrolledCourses.length}
            </span>
          )}
        </button>

        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'timetable' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('timetable')}
        >
          <div className={styles.tabIconWrapper}>
            <Calendar size={18} className={styles.tabIcon} />
          </div>
          <span className={styles.tabText}>Timetable</span>
        </button>

        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'campus-signin' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('campus-signin')}
        >
          <div className={styles.tabIconWrapper}>
            <MapPin size={18} className={styles.tabIcon} />
          </div>
          <span className={styles.tabText}>Sign-In</span>
        </button>

        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'credits' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('credits')}
        >
          <div className={styles.tabIconWrapper}>
            <Award size={18} className={styles.tabIcon} />
          </div>
          <span className={styles.tabText}>Ledger</span>
        </button>
      </nav>

      {/* ── TAB CONTENT PANES ── */}
      <main className={styles.tabContentWrapper}>

        {/* ── TAB 1: OVERVIEW (Student Academic Profile & Course Registration CTA) ── */}
        {activeTab === 'overview' && (
          <>
            {studentInfo ? (
              <>
                {/* 1. Hero Profile Card */}
                <div className={styles.heroProfileCard}>
                  <div className={styles.heroAvatar}>
                    {studentInfo.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className={styles.heroMeta}>
                    <h1 className={styles.heroName}>{studentInfo.full_name}</h1>
                    <p className={styles.heroRole}>Five-Year Integrated Master&apos;s Programme (FYIMP)</p>
                    <div className={styles.heroChips}>
                      <span className={styles.heroChipSem}>Semester {studentInfo.current_semester}</span>
                      {studentInfo.department_name && (
                        <span className={styles.heroChip}>{studentInfo.department_name}</span>
                      )}
                      {studentInfo.campus_name && (
                        <span className={styles.heroChip}>{studentInfo.campus_name}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. Responsive 2-Column Dashboard Grid */}
                <div className={styles.dashboardGrid}>
                  {/* Left Main Column: Primary Actions & Academic Profile */}
                  <div className={styles.mainCol}>
                    {/* Course Registration Action Card */}
                    <div className={styles.registrationCard}>
                      <div className={styles.regCardHeader}>
                        <h2 className={styles.regCardTitle}>Course Registration</h2>
                        <span className={`${styles.regStatusBadge} ${regStatusClass}`}>
                          {regStatusBadge}
                        </span>
                      </div>

                      <p className={styles.regDescription}>{regDescription}</p>

                      <Link
                        href="/dashboard/student/register"
                        className={styles.regCtaBtn}
                      >
                        {regCtaText}
                      </Link>

                      <p className={styles.regHintText}>
                        {isWindowOpen
                          ? 'Registration window is currently open. Ensure your final preferences or slot choices are saved before the deadline.'
                          : 'Registration window is closed. Official courses for this semester are confirmed and locked.'}
                      </p>
                    </div>

                    {/* Academic Information Card */}
                    <div className={styles.academicCard}>
                      <h3 className={styles.academicCardTitle}>Academic Information</h3>
                      <div className={styles.detailGrid}>
                        <div className={styles.detailBox}>
                          <span className={styles.detailBoxLabel}>Department</span>
                          <span className={styles.detailBoxValue}>{studentInfo.department_name || '—'}</span>
                        </div>
                        <div className={styles.detailBox}>
                          <span className={styles.detailBoxLabel}>Campus</span>
                          <span className={styles.detailBoxValue}>{studentInfo.campus_name || '—'}</span>
                        </div>
                        <div className={styles.detailBox}>
                          <span className={styles.detailBoxLabel}>Current Semester</span>
                          <span className={styles.detailBoxValue}>Semester {studentInfo.current_semester}</span>
                        </div>
                        <div className={styles.detailBox}>
                          <span className={styles.detailBoxLabel}>Academic Year Joined</span>
                          <span className={styles.detailBoxValue}>{studentInfo.academic_year_joined || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Sidebar Column: Navigation Shortcuts & Study Hub */}
                  <div className={styles.sidebarCol}>
                    {/* Quick Navigation Card */}
                    <div className={styles.quickNavCard}>
                      <h3 className={styles.quickNavTitle}>Quick Navigation</h3>
                      <div className={styles.quickNavList}>
                        <button
                          type="button"
                          className={styles.quickNavItem}
                          onClick={() => setActiveTab('courses')}
                        >
                          <span>📚 Enrolled Courses</span>
                          <span className={styles.quickNavPill}>{enrolledCourses.length}</span>
                        </button>
                        <button
                          type="button"
                          className={styles.quickNavItem}
                          onClick={() => setActiveTab('timetable')}
                        >
                          <span>🗓️ Weekly Timetable</span>
                          <span>→</span>
                        </button>
                        <button
                          type="button"
                          className={styles.quickNavItem}
                          onClick={() => setActiveTab('campus-signin')}
                        >
                          <span>📍 Campus Sign-In</span>
                          <span>→</span>
                        </button>
                        <button
                          type="button"
                          className={styles.quickNavItem}
                          onClick={() => setActiveTab('credits')}
                        >
                          <span>📊 Degree Credit Ledger</span>
                          <span>→</span>
                        </button>
                        <button
                          type="button"
                          className={styles.quickNavItem}
                          onClick={() => setActiveTab('notifications')}
                        >
                          <span>🔔 Notifications & Deadlines</span>
                          <span>→</span>
                        </button>
                      </div>
                    </div>

                    {/* FYIMP Study Hub Card (Clean institutional style, no gold) */}
                    <div className={styles.studyCard}>
                      <div className={styles.studyCardHeader}>
                        <span className={styles.studyBadge}>Academic Resource</span>
                      </div>
                      <h3 className={styles.studyTitle}>FYIMP Study Hub</h3>
                      <p className={styles.studyDesc}>
                        Access syllabus copies, learning materials, notes, and semester-wise question pools curated by KUC Mangattuparamba FYIMP students.
                      </p>
                      <a
                        href="https://fyimphub.vercel.app"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.studyBtn}
                      >
                        Visit Study Hub ↗
                      </a>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className={styles.profileError}>Unable to load student profile. Please refresh the page.</p>
            )}
          </>
        )}

        {/* ── TAB 2: NOTIFICATIONS (Window Status & Academic Deadlines) ── */}
        {activeTab === 'notifications' && (
          <div className={styles.notificationSection}>
            {/* Main Window Status Banner */}
            {registrationWindow && (
              <div
                className={`${styles.windowBanner} ${
                  !registrationWindow.isOpen
                    ? styles.closed
                    : registrationWindow.isClosingSoon
                    ? styles.closingSoon
                    : styles.open
                }`}
                style={{ borderRadius: '0.75rem', padding: '1rem 1.25rem' }}
              >
                <div className={styles.windowDot} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <span>
                    {!registrationWindow.isOpen ? (
                      <>🔒 <strong>Registration Window Closed:</strong> Course registration is currently closed for Semester {studentInfo?.current_semester ?? 1}.</>
                    ) : registrationWindow.isClosingSoon ? (
                      <>⚠️ <strong>Closing Soon:</strong> Course registration closes in <strong>{registrationWindow.hoursRemaining ?? 0} hour{registrationWindow.hoursRemaining === 1 ? '' : 's'}</strong>!</>
                    ) : (
                      <>✓ <strong>Registration Open:</strong> You can submit or adjust course preferences for Semester {studentInfo?.current_semester ?? 1}.</>
                    )}
                  </span>
                  {registrationWindow.isOpen && (
                    <Link
                      href="/dashboard/student/register"
                      style={{
                        background: registrationWindow.isClosingSoon ? '#e11d48' : '#002147',
                        color: '#ffffff',
                        padding: '0.4rem 0.85rem',
                        borderRadius: '0.4rem',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        textDecoration: 'none',
                        display: 'inline-block',
                      }}
                    >
                      {hasSubmission ? 'Update Preferences →' : 'Register Electives Now →'}
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* Registration Window Parameters Card */}
            <div className={styles.notificationCard}>
              <div className={styles.notificationCardHeader}>
                <h3 className={styles.notificationCardTitle}>
                  <span>📅</span> Registration Window & Deadline Settings
                </h3>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '0.2rem 0.6rem',
                    borderRadius: '9999px',
                    background: registrationWindow?.isOpen ? '#dcfce7' : '#fee2e2',
                    color: registrationWindow?.isOpen ? '#15803d' : '#b91c1c',
                  }}
                >
                  {registrationWindow?.isOpen ? 'WINDOW OPEN' : 'WINDOW CLOSED'}
                </span>
              </div>

              <div className={styles.notificationGrid}>
                <div className={styles.notificationItem}>
                  <span className={styles.notificationItemLabel}>Scheduled Deadline</span>
                  <span className={styles.notificationItemValue}>{deadlineFormatted || 'Not Scheduled'}</span>
                </div>

                <div className={styles.notificationItem}>
                  <span className={styles.notificationItemLabel}>Credit Requirement</span>
                  <span className={styles.notificationItemValue}>
                    {registrationWindow?.minCredits ?? 20} to {registrationWindow?.maxCredits ?? 24} Credits
                  </span>
                </div>

                <div className={styles.notificationItem}>
                  <span className={styles.notificationItemLabel}>Academic Year</span>
                  <span className={styles.notificationItemValue}>
                    {registrationWindow?.academicYear || '2026-27'}
                  </span>
                </div>

                <div className={styles.notificationItem}>
                  <span className={styles.notificationItemLabel}>Your Current Status</span>
                  <span className={styles.notificationItemValue} style={{ color: regNotificationColor }}>
                    {regNotificationStatus}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 3: ENROLLED COURSES ── */}
        {activeTab === 'courses' && (
          <div className={styles.enrolledSection} style={{ marginTop: 0 }}>
            <div className={styles.enrolledHeader}>
              <div className={styles.enrolledTitleGroup}>
                <h2 className={styles.enrolledTitle}>
                   My Enrolled Courses — Semester {studentInfo?.current_semester ?? 1}
                </h2>
                <p className={styles.enrolledSubtitle}>
                  Official papers registered and allocated for your current semester
                </p>
              </div>
              {totalRegisteredCredits > 0 && (
                <div className={styles.creditsTotalBadge}>
                  {totalRegisteredCredits} Total Credits Enrolled
                </div>
              )}
            </div>

            {enrolledCourses && enrolledCourses.length > 0 ? (
              <div className={styles.courseGrid}>
                {enrolledCourses.map((c) => {
                  const catUpper = (c.category || '').toUpperCase()
                  let catClass = styles.catGeneral
                  if (catUpper.includes('DSC') || catUpper.includes('DSE')) catClass = styles.catDsc
                  else if (catUpper.includes('AEC')) catClass = styles.catAec
                  else if (catUpper.includes('SEC')) catClass = styles.catSec
                  else if (catUpper.includes('VAC')) catClass = styles.catVac
                  else if (catUpper.includes('MDC')) catClass = styles.catMdc

                  return (
                    <div key={c.id || c.courseCode} className={styles.courseCard}>
                      <div className={styles.cardTopRow}>
                        <span className={styles.slotBadge}>Paper {c.slotNumber}</span>
                        <span className={`${styles.categoryBadge} ${catClass}`}>
                          {c.category}
                        </span>
                      </div>

                      <div className={styles.cardMainBody}>
                        <span className={styles.cardCourseCode}>{c.courseCode}</span>
                        <h3 className={styles.cardCourseTitle}>{c.title}</h3>
                      </div>

                      <div className={styles.cardFooter}>
                        <span className={styles.cardDeptName} title={c.departmentName}>
                          {c.departmentName}
                        </span>
                        <span className={styles.cardCreditPill}>
                          {c.credits} cr
                        </span>
                      </div>

                      <div>
                        {c.isConfirmed ? (
                          <span className={styles.statusPillConfirmed}>
                            ✓ {c.status}
                          </span>
                        ) : (
                          <span className={styles.statusPillPending}>
                            ⏳ {c.status}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className={styles.emptyCoursesCard}>
                <div className={styles.emptyCoursesIcon}>📝</div>
                <h3 className={styles.emptyCoursesTitle}>
                  {hasSubmission
                    ? 'Preferences Submitted — Allocation in Progress'
                    : 'No Courses Registered Yet'}
                </h3>
                <p className={styles.emptyCoursesText}>
                  {hasSubmission
                    ? `Your course preferences for Semester ${studentInfo?.current_semester ?? 1} have been received. Official course allocations will appear here once finalized by the administration.`
                    : `You have not submitted course preferences for Semester ${studentInfo?.current_semester ?? 1}. Please select your academic track and submit your ranked choices.`}
                </p>
                <Link
                  href="/dashboard/student/register"
                  className={styles.registerLink}
                  style={{ display: 'inline-flex', padding: '0.65rem 1.25rem', marginTop: '0.25rem' }}
                >
                  {hasSubmission ? 'Review / Update Preferences →' : 'Select Track & Register Courses →'}
                </Link>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 4: TIMETABLE ── */}
        {activeTab === 'timetable' && (
          <div className={styles.enrolledSection} style={{ marginTop: 0 }}>
            <div className={styles.enrolledHeader}>
              <div className={styles.enrolledTitleGroup}>
                <h2 className={styles.enrolledTitle}>
                  <span>🗓️</span> Weekly Academic Schedule — Semester {studentInfo?.current_semester ?? 1}
                </h2>
                <p className={styles.enrolledSubtitle}>
                  Assigned lecture and lab blocks across Periods 1 to 6 (Monday to Saturday)
                </p>
              </div>
            </div>

            {/* Day Selector Bar */}
            <div className={styles.daySelectorBar}>
              <button
                type="button"
                className={`${styles.daySelectBtn} ${styles.fullWeekBtn} ${selectedDay === 'all' ? styles.daySelectBtnActive : ''}`}
                onClick={() => setSelectedDay('all')}
              >
                Full Week
              </button>
              {DAYS.map((d) => (
                <button
                  key={d.num}
                  type="button"
                  className={`${styles.daySelectBtn} ${selectedDay === d.num ? styles.daySelectBtnActive : ''}`}
                  onClick={() => setSelectedDay(d.num)}
                >
                  {d.short}
                </button>
              ))}
            </div>

            <div className={styles.mobileScrollHint}>
              <span>⇄ Swipe horizontally to explore full daily schedule</span>
            </div>

            <div className={styles.timetableContainer}>
              {loadingTimetable ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                  Loading your weekly class schedule...
                </div>
              ) : (
                <>
                  {/* Desktop Grid View */}
                  <div className={styles.desktopTimetable}>
                    <table className={styles.timetableTable}>
                      <thead>
                        <tr>
                          <th className={`${styles.timetableTh} ${styles.timetableThDay}`}>Day</th>
                          {PERIODS.map((p) => (
                            <th key={p.num} className={styles.timetableTh}>
                              <div>{p.label}</div>
                              <div style={{ fontSize: '0.62rem', fontWeight: 500, color: '#64748b' }}>{p.time}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedDay === 'all' ? DAYS : DAYS.filter((d) => d.num === selectedDay)).map((day) => (
                          <tr key={day.num}>
                            <td className={styles.timetableDayCell}>{day.name}</td>
                            {PERIODS.map((period) => {
                              const matchingEntry = timetableEntries.find(
                                (e) =>
                                  e.day === day.num &&
                                  e.period === period.num &&
                                  (enrolledCourseIds.has(e.courseId) ||
                                    enrolledCodes.has((e.courseCode || '').trim().toUpperCase())),
                              )

                              return (
                                <td key={period.num} className={styles.timetableTd}>
                                  {matchingEntry ? (
                                    <div
                                      className={`${styles.timetableSlotFilled} ${
                                        matchingEntry.isLabBlock ? styles.timetableSlotLab : ''
                                      }`}
                                    >
                                      <div>
                                        <div className={styles.timetableCourseCode}>{matchingEntry.courseCode}</div>
                                        <div className={styles.timetableCourseTitle} title={matchingEntry.courseName}>
                                          {matchingEntry.courseName}
                                        </div>
                                      </div>
                                      <div className={styles.timetableMetaRow}>
                                        <span>{matchingEntry.category || 'Core'}</span>
                                        {matchingEntry.isLabBlock && (
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

                  {/* Mobile Vertical Period Schedule */}
                  {(() => {
                    const activeMobileDayNum = selectedDay === 'all' ? getCurrentUserDay() : selectedDay
                    const activeDayObj = DAYS.find((d) => d.num === activeMobileDayNum) || DAYS[0]
                    const currentTodayNum = getCurrentUserDay()
                    const isToday = activeDayObj.num === currentTodayNum

                    return (
                      <div className={styles.mobileTimetable}>
                        <div className={styles.mobileDayHeader}>
                          <div className={styles.mobileDayTitle}>
                            <span>{activeDayObj.name}</span>
                            {isToday && <span className={styles.todayBadge}>Today</span>}
                          </div>
                          <span className={styles.mobileDaySub}>6 Scheduled Periods</span>
                        </div>

                        <div className={styles.verticalPeriodList}>
                          {PERIODS.map((period) => {
                            const matchingEntry = timetableEntries.find(
                              (e) =>
                                e.day === activeDayObj.num &&
                                e.period === period.num &&
                                (enrolledCourseIds.has(e.courseId) ||
                                  enrolledCodes.has((e.courseCode || '').trim().toUpperCase())),
                            )

                            return (
                              <div key={period.num} className={styles.verticalPeriodCard}>
                                <div className={styles.verticalPeriodTimeCol}>
                                  <span className={styles.verticalPeriodNum}>{period.label}</span>
                                  <span className={styles.verticalPeriodTime}>{period.time}</span>
                                </div>

                                <div className={styles.verticalPeriodContent}>
                                  {matchingEntry ? (
                                    <div
                                      className={`${styles.verticalPeriodFilled} ${
                                        matchingEntry.isLabBlock ? styles.verticalPeriodLab : ''
                                      }`}
                                    >
                                      <div className={styles.verticalPeriodHeader}>
                                        <span className={styles.verticalCourseCode}>{matchingEntry.courseCode}</span>
                                        <div className={styles.verticalBadgeGroup}>
                                          <span className={styles.verticalCategoryBadge}>
                                            {matchingEntry.category || 'Core'}
                                          </span>
                                          {matchingEntry.isLabBlock && (
                                            <span className={styles.timetableLabBadge}>Lab</span>
                                          )}
                                        </div>
                                      </div>
                                      <div className={styles.verticalCourseTitle}>
                                        {matchingEntry.courseName}
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
          </div>
        )}

        {/* ── TAB 5: CAMPUS SIGN-IN ── */}
        {activeTab === 'campus-signin' && (
          <div style={{ width: '100%', margin: '0 auto' }}>
            <CampusSignInCard
              studentId={studentInfo?.id}
              campusName={studentInfo?.campus_name || 'Campus'}
            />
          </div>
        )}

        {/* ── TAB 6: CREDIT LEDGER ── */}
        {activeTab === 'credits' && (
          <div style={{ width: '100%' }}>
            <CreditLedgerView studentId="me" />
          </div>
        )}

      </main>
    </div>
  )
}
