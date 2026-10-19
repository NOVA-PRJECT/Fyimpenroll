'use client'

import { useDashboardEntryFetch } from '@/core/security/useDashboardEntryFetch'

import { useEffect, useState } from 'react'
import UniversityLogo from '@/components/UniversityLogo'
import { useRouter } from 'next/navigation'
import StudentDashboardClient from './StudentDashboardClient'
import styles from './student-dashboard.module.css'
import NavigationLink from '@/components/NavigationLink'
import LoadingState, { ProfilePlaceholder } from '@/components/LoadingState'
import { sessionRedirect } from '@/core/security/session-response'

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

export interface RegistrationWindow {
  isOpen: boolean
  deadline: string | null
  isClosingSoon: boolean
  hoursRemaining: number | null
  academicYear: string | null
  minCredits: number
  maxCredits: number
}

export default function StudentDashboardPage() {
  const entryFetch = useDashboardEntryFetch()
  const router = useRouter()
  const [studentInfo, setStudentInfo] = useState<StudentInfo | null>(null)
  const [hasSubmission, setHasSubmission] = useState(false)
  const [hasRegistration, setHasRegistration] = useState(false)
  const [allocationCompleted, setAllocationCompleted] = useState(false)
  const [enrolledCourses, setEnrolledCourses] = useState<EnrolledCourse[]>([])
  const [totalRegisteredCredits, setTotalRegisteredCredits] = useState(0)
  const [registrationWindow, setRegistrationWindow] = useState<RegistrationWindow | null>(null)
  const [loading, setLoading] = useState(true)

  const [summaryError, setSummaryError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    // 1. Instant hydration from sessionStorage for zero-flash page back/forth transitions
    if (typeof window !== 'undefined') {
      try {
        const cached = sessionStorage.getItem('fyimp_student_summary')
        if (cached) {
          const parsed = JSON.parse(cached)
          if (parsed?.studentInfo) {

            // eslint-disable-next-line react-hooks/set-state-in-effect -- Restores browser view state after hydration or resets a changed cohort.
            setStudentInfo(parsed.studentInfo)
            setHasSubmission(parsed.hasSubmission ?? false)
            setHasRegistration(parsed.hasRegistration ?? false)
            setAllocationCompleted(parsed.allocationCompleted ?? false)
            setEnrolledCourses(parsed.enrolledCourses || [])
            setTotalRegisteredCredits(parsed.totalRegisteredCredits || 0)
            if (parsed.registrationWindow) setRegistrationWindow(parsed.registrationWindow)
            setLoading(false)
          }
        }
      } catch {
        // Ignore session parse error
      }
    }

    // 2. Background fresh revalidation
    async function loadSummary() {
      try {
        const res = await entryFetch('/api/student/dashboard-summary', { signal: controller.signal })
        const data = await res.json().catch(() => ({}))
        const destination = sessionRedirect(res.status, data)
        if (destination) { router.replace(destination); return }
        if (!res.ok || !data.studentInfo) throw new Error('Your dashboard data couldn’t be loaded. Please try again.')
        setSummaryError('')
        setStudentInfo(data.studentInfo)
        setHasSubmission(data.hasSubmission)
        setHasRegistration(data.hasRegistration ?? false)
        setAllocationCompleted(data.allocationCompleted ?? false)
        setEnrolledCourses(data.enrolledCourses || [])
        setTotalRegisteredCredits(data.totalRegisteredCredits || 0)
        setRegistrationWindow(data.registrationWindow || null)

        // Cache for subsequent instant transitions
        try {
          sessionStorage.setItem('fyimp_student_summary', JSON.stringify(data))
        } catch {
          // Ignore storage quota error
        }
      } catch (error) {
        if (!controller.signal.aborted) setSummaryError(error instanceof Error ? error.message : 'Your dashboard data couldn’t be loaded. Please try again.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    loadSummary()
    return () => controller.abort()
  }, [router, retry, entryFetch])

  function retrySummary() {
    setSummaryError('')
    setLoading(true)
    setRetry(value => value + 1)
  }

  // Keep the portal shell visible while the student summary loads.
  if (!studentInfo && (loading || summaryError)) {
    return (
      <div className={styles.pageWrapper}>
        {/* Executive Top Bar Skeleton */}
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
                <p className={styles.topBarSubtitle}>Student Portal</p>
              </div>
            </div>
            <div className={styles.topBarDivider} />
            {loading && <ProfilePlaceholder message="Loading student profile…" />}
          </div>
        </header>

        <main className={styles.tabContentWrapper}>
          {summaryError ? <div className="flex flex-wrap items-center justify-between gap-3 p-4" role="alert">
            <p>{summaryError}</p>
            <button onClick={retrySummary} className="rounded-lg bg-[color:var(--portal-primary,#002147)] px-4 py-2 text-white">Try again</button>
            <NavigationLink href="/dashboard/student/register" className={styles.regCtaBtn}>Open course registration →</NavigationLink>
          </div> : <LoadingState layout="dashboard" message="Loading your dashboard…" />}
        </main>
      </div>
    )
  }

  if (!studentInfo) {
    return null
  }

  return (
    <>
      {summaryError && <div role="alert" className="flex items-center gap-3 bg-[color:var(--portal-warning-bg,#fffbeb)] p-4">
        <p>{summaryError}</p><button onClick={retrySummary}>Try again</button>
      </div>}
    <StudentDashboardClient
      studentInfo={studentInfo}
      hasSubmission={hasSubmission}
      hasRegistration={hasRegistration}
      allocationCompleted={allocationCompleted}
      enrolledCourses={enrolledCourses}
      totalRegisteredCredits={totalRegisteredCredits}
      registrationWindow={registrationWindow}
    />
    </>
  )
}
