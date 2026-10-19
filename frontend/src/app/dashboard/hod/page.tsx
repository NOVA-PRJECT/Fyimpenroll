'use client'

import { bulkUploadResult, type BulkUploadResult } from '@/core/bulk-upload-result'
import { apiErrorMessage } from '@/core/api-error'
import BulkUploadResults from './BulkUploadResults'
import LoadingState, { ProfilePlaceholder, LoadingIndicator } from '@/components/LoadingState'

import { Check as UiCheck, FolderOpen as UiFolderOpen, Pencil as UiPencil, Trash2 as UiTrash2, Users as UiUsers, X as UiX } from 'lucide-react'

import { useDashboardEntryFetch } from '@/core/security/useDashboardEntryFetch'

import { logoutPortal } from '@/core/security/logout'

import dynamic from 'next/dynamic'
import PageLoading from '@/components/PageLoading'
import { sessionRedirect } from '@/core/security/session-response'
const BlueprintTab = dynamic(() => import('./BlueprintTab'), { loading: () => <PageLoading layout="form" message="Loading course blueprint…" /> })
const CoursesTab = dynamic(() => import('./CoursesTab'), { loading: () => <LoadingState layout="form" message="Loading courses…" /> })
const TeacherAssignmentTab = dynamic(() => import('./TeacherAssignmentTab'), { loading: () => <PageLoading layout="cards" message="Loading teacher assignments…" /> })
const PeriodMarkingTab = dynamic(() => import('./PeriodMarkingTab'), { loading: () => <PageLoading layout="table" message="Loading period attendance…" /> })
const CampusAttendanceTab = dynamic(() => import('./CampusAttendanceTab'), { loading: () => <PageLoading layout="table" message="Loading campus attendance…" /> })
const ManualAllocationTab = dynamic(() => import('./ManualAllocationTab'), { loading: () => <PageLoading layout="table" message="Loading course allocations…" /> })
import { useState, useEffect, useEffectEvent, useRef } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import styles from './hod-dashboard.module.css'
import { useBfcacheGuard } from '@/core/hooks/useBfcacheGuard'
import { Eye, EyeOff, LogOut, Menu, ChevronDown } from 'lucide-react'
import { downloadBlob } from '@/core/utils/downloadFile'

// ── Types ──
interface HodInfo {
  full_name: string
  department_name: string
}

interface Student {
  id: string
  full_name: string
  current_semester: number
  cap_application_number: string | null
}

interface DeptStudent {
  id: string
  full_name: string
  current_semester: number
  submitted: boolean
}

interface DeptData {
  academic_year: string
  total_students: number
  submitted_count: number
  students: DeptStudent[]
}



type Tab = 'defaulters' | 'upload' | 'students' | 'blueprint' | 'courses' | 'assignments' | 'period-marking' | 'campus-attendance' | 'manual-allocation'

function getAcademicYearOptions(): string[] {
  const now = new Date()
  const currentYear = now.getFullYear()
  const years: string[] = []
  // Generate options from currentYear - 5 to currentYear + 2
  for (let i = currentYear - 5; i <= currentYear + 2; i++) {
    years.push(`${i}-${String(i + 1).slice(-2)}`)
  }
  return years
}

function getDefaultAcademicYear(): string {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  if (month >= 6) return `${year}-${String(year + 1).slice(-2)}`
  return `${year - 1}-${String(year).slice(-2)}`
}

export default function HodDashboard() {
  const entryFetch = useDashboardEntryFetch()
  useBfcacheGuard()
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [blueprintSemester, setBlueprintSemester] = useState(1)
  const [coursesSemester, setCoursesSemester] = useState(1)
  const [activeTab, setActiveTab] = useState<Tab>('defaulters')
  const [hodInfo, setHodInfo] = useState<HodInfo | null>(null)
  const [loadingHod, setLoadingHod] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [profileRetry, setProfileRetry] = useState(0)


  // ── Upload Tab State ──
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [batchPassword, setBatchPassword] = useState('')
  const [showBatchPassword, setShowBatchPassword] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<BulkUploadResult | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [uploadSuccess, setUploadSuccess] = useState('')

  // ── Students Tab State ──
  const [studentSemester, setStudentSemester] = useState(1)
  const [students, setStudents] = useState<Student[]>([])
  const [loadingStudents, setLoadingStudents] = useState(false)
  const [studentError, setStudentError] = useState('')
  const [studentSuccess, setStudentSuccess] = useState('')

  // Add student modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [addName, setAddName] = useState('')
  const [addCap, setAddCap] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addPassword, setAddPassword] = useState('')
  const [showAddPassword, setShowAddPassword] = useState(false)
  const [addYearJoined, setAddYearJoined] = useState(getDefaultAcademicYear())
  const [addSemester, setAddSemester] = useState(1)
  const [adding, setAdding] = useState(false)

  // Edit student modal
  const [editStudent, setEditStudent] = useState<Student | null>(null)
  const [editName, setEditName] = useState('')
  const [editCap, setEditCap] = useState('')
  const [editSemester, setEditSemester] = useState(1)
  const [updating, setUpdating] = useState(false)

  // Delete confirmation
  const [deleteStudent, setDeleteStudent] = useState<Student | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ── Defaulters Tab State ──
  const [defaulterSemester, setDefaulterSemester] = useState<number | 'all'>('all')
  const [loadingDefaulters, setLoadingDefaulters] = useState(false)
  const [deptData, setDeptData] = useState<DeptData | null>(null)
  const [defaulterError, setDefaulterError] = useState('')
  const [copied, setCopied] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  // ── Excel Export State & Function ──
  const [exportingExcel, setExportingExcel] = useState(false)

  async function handleExportExcel(sem?: number | 'all') {
    const targetSem = sem ?? (activeTab === 'students' ? studentSemester : defaulterSemester)
    setExportingExcel(true)
    try {
      const params = new URLSearchParams({ format: 'xlsx' })
      if (targetSem !== 'all') params.set('semester', String(targetSem))
      if (deptData?.academic_year) params.set('academic_year', deptData.academic_year)
      const response = await fetch(`/api/export/registrations?${params}`)
      if (!response.ok) throw new Error('Export failed')
      await downloadBlob(await response.blob(), `Registrations_${targetSem}.xlsx`)
    } catch {
      setStudentError('Failed to export Excel file')
    } finally {
      setExportingExcel(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    async function loadHodInfo() {
      try {
        const response = await entryFetch('/api/auth/profile', { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        const destination = sessionRedirect(response.status, data)
        if (destination) { router.replace(destination); return }
        if (!response.ok || !data.profile) throw new Error('Your profile couldn’t be loaded. Please try again.')
        setHodInfo({ full_name: data.profile.full_name, department_name: data.profile.departments?.name ?? 'Unknown' })
        setProfileError('')
      } catch (error) {
        if (!controller.signal.aborted) setProfileError(error instanceof Error ? error.message : 'Your profile couldn’t be loaded.')
      } finally {
        if (!controller.signal.aborted) setLoadingHod(false)
      }
    }
    loadHodInfo()
    return () => controller.abort()
  }, [router, profileRetry, entryFetch])

  // Load active tab from sessionStorage on mount (hydration-safe)
  useEffect(() => {
    const storedTab = sessionStorage.getItem('hod_active_tab') as Tab | null
    const validTabs: Tab[] = ['defaulters', 'upload', 'students', 'blueprint', 'courses', 'assignments', 'period-marking', 'campus-attendance', 'manual-allocation']
    if (storedTab && validTabs.includes(storedTab)) {

      // eslint-disable-next-line react-hooks/set-state-in-effect -- Restores browser view state after hydration or resets a changed cohort.
      setActiveTab(storedTab)
    }
  }, [])

  // Mobile / Lower-Screen Hamburger More Menu State
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setMobileMenuOpen(false)
      }
    }
    if (mobileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [mobileMenuOpen])

  // Navigation tab groups
  const primaryTabs: { id: Tab; label: string }[] = [
    { id: 'defaulters', label: 'Defaulters' },
    { id: 'students', label: 'Students' },
    { id: 'courses', label: 'Courses' },
  ]

  const moreTabs: { id: Tab; label: string }[] = [
    { id: 'upload', label: 'Bulk Upload' },
    { id: 'blueprint', label: 'Blueprint' },
    { id: 'assignments', label: 'Faculty Assignment' },
    { id: 'period-marking', label: 'Period Attendance' },
    { id: 'campus-attendance', label: 'Campus Attendance' },
    { id: 'manual-allocation', label: 'Manual Allocation' },
  ]

  const allTabs: { id: Tab; label: string }[] = [
    { id: 'defaulters', label: 'Defaulters' },
    { id: 'upload', label: 'Bulk Upload' },
    { id: 'students', label: 'Students' },
    { id: 'blueprint', label: 'Blueprint' },
    { id: 'courses', label: 'Courses' },
    { id: 'assignments', label: 'Faculty Assignment' },
    { id: 'period-marking', label: 'Period Attendance' },
    { id: 'campus-attendance', label: 'Campus Attendance' },
    { id: 'manual-allocation', label: 'Manual Allocation' },
  ]

  const isMoreTabActive = moreTabs.some(t => t.id === activeTab)
  const [isAssignmentTabDirty, setIsAssignmentTabDirty] = useState(false)

  function changeTab(tab: Tab) {
    if (tab === activeTab) return
    if (activeTab === 'assignments' && isAssignmentTabDirty) {
      if (!confirm('You have unsaved faculty assignments. Do you want to discard your changes and switch tabs?')) {
        return
      }
      setIsAssignmentTabDirty(false)
    }
    setActiveTab(tab)
    sessionStorage.setItem('hod_active_tab', tab)
  }

  // Use the latest filters without a changing function identity.
  const loadTab = useEffectEvent(() => {
    if (activeTab === 'defaulters') {
      handleFetch(defaulterSemester)
    } else if (activeTab === 'students') {
      fetchStudents(studentSemester)
    }
  })
  useEffect(() => { loadTab() }, [activeTab, defaulterSemester, studentSemester])

  // ── Upload Tab Functions ──
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.csv')) {
      setUploadError('Please upload a CSV file only')
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    Papa.parse(file, {
      header: true,
      preview: 1,
      complete: (results) => {
        const headers = results.meta.fields || []
        const requiredHeaders = ['full_name', 'cap_application_number', 'academic_year_joined', 'current_semester', 'email']
        const missing = requiredHeaders.filter(h => !headers.includes(h))

        if (missing.length > 0) {
          setUploadError(`Invalid CSV headers. Missing required columns: ${missing.join(', ')}`)
          setSelectedFile(null)
          if (fileInputRef.current) fileInputRef.current.value = ''
        } else {
          setSelectedFile(file)
          setUploadError('')
        }
      },
      error: () => {
        setUploadError('Failed to read CSV file')
        setSelectedFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    })
    setUploadResult(null)
    setUploadSuccess('')
  }

  async function handleUpload() {
    if (!selectedFile) { setUploadError('Please select a CSV file first'); return }
    if (!batchPassword || batchPassword.length < 8) {
      setUploadError('Batch password must be at least 8 characters')
      return
    }
    setUploading(true)
    setUploadError('')
    setUploadSuccess('')
    setUploadResult(null)

    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data
        if (!rows || rows.length === 0) {
          setUploadError('CSV file is empty')
          setUploading(false)
          return
        }
        if (rows.length > 100) {
          setUploadError('Maximum 100 students per upload. Please split larger files.')
          setUploading(false)
          return
        }
        try {
          const response = await fetch('/api/hod/bulk-students', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows, batch_default_password: batchPassword }),
          })
          const result = await response.json().catch(() => null)
          if (!response.ok) {
            setUploadError(apiErrorMessage(result, 'Upload failed. Please try again.', response.status))
            setUploading(false)
            return
          }
          const summary = bulkUploadResult(result)
          setUploadResult(summary)
          if (summary.error_count > 0) {
            setUploadError(`Upload finished: ${summary.inserted_count} created, ${summary.error_count} failed. See the row errors below.`)
          } else {
            setUploadSuccess(`Upload complete — ${summary.inserted_count} students created.`)
            setTimeout(() => setUploadSuccess(''), 1000)
          }
          setSelectedFile(null)
          setBatchPassword('')
          if (fileInputRef.current) fileInputRef.current.value = ''
        } catch (error) {
          setUploadError(error instanceof TypeError ? 'The upload could not be confirmed. Check your connection and refresh the student list before retrying.' : error instanceof Error ? error.message : 'Upload results could not be confirmed. Refresh the student list before retrying.')
        }
        setUploading(false)
      },
      error: () => {
        setUploadError('Failed to parse CSV.')
        setUploading(false)
      }
    })
  }

  // ── Students Tab Functions ──
  async function fetchStudents(sem: number = studentSemester) {
    setLoadingStudents(true)
    setStudentError('')
    setStudentSuccess('')
    const response = await fetch(`/api/hod/students?semester=${sem}`)
    const result = await response.json()
    if (!response.ok) {
      setStudentError(result.error ?? 'Failed to fetch students')
    } else {
      setStudents(result)
    }
    setLoadingStudents(false)
  }

  async function handleAddStudent() {
    if (!addName || !addCap || !addEmail || !addPassword || !addYearJoined) {
      setStudentError('All fields are required')
      return
    }
    if (addPassword.length < 8) {
      setStudentError('Password must be at least 8 characters')
      return
    }
    setAdding(true)
    setStudentError('')
    const response = await fetch('/api/hod/students/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: addName,
        cap_application_number: addCap,
        academic_year_joined: addYearJoined,
        current_semester: addSemester,
        email: addEmail,
        password: addPassword,
      }),
    })
    const result = await response.json()
    if (!response.ok) {
      setStudentError(result.error ?? 'Failed to add student')
    } else {
      setStudentSuccess('Student created successfully')
      setTimeout(() => setStudentSuccess(''), 1000)
      setShowAddModal(false)
      setAddName(''); setAddCap(''); setAddEmail(''); setAddPassword(''); setAddYearJoined(getDefaultAcademicYear()); setAddSemester(1)
      fetchStudents()
    }
    setAdding(false)
  }

  async function handleUpdateStudent() {
    if (!editStudent) return
    if (!editName.trim()) {
      setStudentError('Full name is required')
      return
    }
    if (!editCap.trim()) {
      setStudentError('CAP Application Number is required')
      return
    }
    setUpdating(true)
    setStudentError('')
    try {
      const response = await fetch('/api/hod/students/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editStudent.id,
          student_id: editStudent.id,
          full_name: editName.trim(),
          cap_application_number: editCap.trim(),
          current_semester: editSemester,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        setStudentError(result.error ?? result.message ?? 'Failed to update student')
      } else {
        setStudentSuccess('Student updated successfully')
        setTimeout(() => setStudentSuccess(''), 1000)
        setEditStudent(null)
        setEditCap('')
        setEditName('')
        fetchStudents()
      }
    } catch {
      setStudentError('Network error while saving student')
    } finally {
      setUpdating(false)
    }
  }

  async function handleDeleteStudent() {
    if (!deleteStudent) return
    setDeleting(true)
    const response = await fetch('/api/hod/students/remove', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: deleteStudent.id }),
    })
    const result = await response.json()
    if (!response.ok) {
      setStudentError(result.error ?? 'Failed to delete student')
    } else {
      setStudentSuccess('Student removed successfully')
      setTimeout(() => setStudentSuccess(''), 1000)
      setDeleteStudent(null)
      fetchStudents()
    }
    setDeleting(false)
  }

  // ── Defaulters Tab Functions ──
  async function handleFetch(sem: number | 'all' = defaulterSemester) {
    setLoadingDefaulters(true)
    setDefaulterError('')
    setCopied(false)
    const semParam = sem === 'all' ? '' : `?semester=${sem}`
    try {
      const response = await fetch(`/api/faculty/defaulters${semParam}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      })
      const result = await response.json()
      if (!response.ok) {
        setDefaulterError(result.error ?? 'Failed to fetch data.')
      } else {
        setDeptData(result)
      }
    } catch {
      setDefaulterError('Failed to fetch data. Please try again.')
    } finally {
      setLoadingDefaulters(false)
    }
  }

  function handleCopyWhatsApp() {
    if (!deptData || deptData.students.length === 0) return
    const notSubmitted = deptData.students.filter(s => !s.submitted)
    if (notSubmitted.length === 0) return
    const semesterTitle = defaulterSemester === 'all' ? '' : ` - Semester ${defaulterSemester}`
    const semesterBody = defaulterSemester === 'all' ? '' : ` of Semester ${defaulterSemester}`
    const lines = [
      `FYIMP Course Registration${semesterTitle}`,
      `Department: ${hodInfo?.department_name}`,
      ``,
      `The following students${semesterBody} have *not yet submitted* their course registration:`,
      ``,
      ...notSubmitted.map((s, i) => `${i + 1}. ${s.full_name} (Sem ${s.current_semester})`),
      ``,
      ``,
      `Please complete your registration immediately.`,
    ]
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    })
  }

  async function handleLogout() {
    setLoggingOut(true)
    if (!await logoutPortal()) setLoggingOut(false)
  }

  const notSubmittedStudents = deptData?.students.filter(s => !s.submitted) ?? []

  return (
    <div className={styles.pageWrapper}>

      {/* Unified Executive Header Bar with Preserved Hierarchy */}
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
              <p className={styles.topBarSubtitle}>HOD Dashboard</p>
            </div>
          </div>

          {/* Vertical Divider */}
          <div className={styles.topBarDivider} />

          {/* 2. HOD Details Block (Exact original hierarchy: Name on top, Badges below) */}
          {loadingHod ? (
            <ProfilePlaceholder />
          ) : (
            <div className={styles.hodIdentity}>
              <p className={styles.hodName}>{hodInfo?.full_name ?? 'HOD'}</p>
              <div className={styles.hodDetails}>
                <span className={styles.roleBadge}>HOD</span>
                {hodInfo?.department_name && (
                  <span className={styles.deptBadge} title={hodInfo.department_name}>
                    {hodInfo.department_name}
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
            <span className={styles.logoutText}>{loggingOut ? <LoadingIndicator message="Logging out…" /> : 'Logout'}</span>
          </button>
        </div>
      </header>

      {/* ── DESKTOP TAB BAR (>= 960px): Shows all 9 tabs ── */}
      <nav className={styles.desktopTabBar} aria-label="Desktop Navigation">
        {allTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`${styles.tabBtn} ${activeTab === tab.id ? styles.tabActive : ''}`}
            onClick={() => changeTab(tab.id)}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* ── MOBILE/TABLET TAB BAR (< 960px): Shows Defaulters, Students, Courses + Hamburger More Menu ── */}
      <nav className={styles.mobileTabBar} aria-label="Mobile Navigation" ref={mobileMenuRef}>
        {primaryTabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`${styles.mobileTabBtn} ${activeTab === tab.id ? styles.tabActive : ''}`}
            onClick={() => {
              changeTab(tab.id)
              setMobileMenuOpen(false)
            }}
          >
            <span className={styles.tabLabelText}>{tab.label}</span>
          </button>
        ))}

        {/* Hamburger / More Menu Toggle */}
        <div className={styles.moreMenuWrapper}>
          <button
            type="button"
            className={`${styles.moreMenuBtn} ${isMoreTabActive ? styles.tabActive : ''} ${mobileMenuOpen ? styles.moreMenuBtnOpen : ''}`}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-expanded={mobileMenuOpen}
            aria-label="More sections menu"
          >
            <Menu size={15} />
            <span className={styles.moreBtnLabel}>
              {isMoreTabActive
                ? moreTabs.find(t => t.id === activeTab)?.label ?? 'More'
                : 'More'}
            </span>
            <ChevronDown size={13} className={`${styles.chevron} ${mobileMenuOpen ? styles.chevronOpen : ''}`} />
          </button>

          {/* Dropdown Menu for Additional Tabs */}
          {mobileMenuOpen && (
            <div className={styles.moreDropdown}>
              <div className={styles.moreDropdownHeader}>Other Sections</div>
              {moreTabs.map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  className={`${styles.dropdownItem} ${activeTab === tab.id ? styles.dropdownItemActive : ''}`}
                  onClick={() => {
                    changeTab(tab.id)
                    setMobileMenuOpen(false)
                  }}
                >
                  <span className={styles.dropdownItemLabel}>{tab.label}</span>
                  {activeTab === tab.id && <span className={styles.activeCheck}><UiCheck size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <div className={styles.mainContent}>
        {profileError && <div role="alert" className={styles.errorBanner}>{profileError} <button onClick={() => { setLoadingHod(true); setProfileRetry(value => value + 1) }}>Try again</button></div>}

        {/* ══ BULK UPLOAD TAB ══ */}
        {activeTab === 'upload' && (
          <>
            <p className={styles.sectionTitle}>Bulk Upload Students</p>

            <div className={styles.uploadCard}>
              <p className={styles.uploadDescription}>
                Upload a CSV to create student accounts directly. Each student will receive a temporary password you set below and must change it on first login.
              </p>

              <div className={styles.formatHint}>
                <p className={styles.formatHintTitle}>Required CSV Columns</p>
                <p className={styles.formatHintCode}>
                  full_name, cap_application_number, academic_year_joined, current_semester, email
                </p>
                <p className={styles.formatHintCode} style={{ marginTop: '0.35rem', color: "var(--portal-subtle,#9ba1ab)" }}>
                  Example: Ahmed Ali, CAP2025001, 2025-26, 1, ahmed@email.com
                </p>
              </div>

              {/* Batch Password Field */}
              <div className={styles.field} style={{ marginBottom: '0.85rem' }}>
                <label className={styles.label}>Batch Default Password *</label>
                <div className="password-wrapper">
                  <input
                    type={showBatchPassword ? 'text' : 'password'}
                    className={`${styles.input} password-input`}
                    placeholder="Min. 8 characters — all students in this upload get this"
                    value={batchPassword}
                    onChange={e => setBatchPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowBatchPassword(!showBatchPassword)}
                    aria-label={showBatchPassword ? 'Hide password' : 'Show password'}
                  >
                    {showBatchPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p style={{ fontSize: '0.7rem', color: "var(--portal-subtle,#9ba1ab)", margin: '0.25rem 0 0' }}>
                  Students must change this password on first login.
                </p>
              </div>

              <div className={`${styles.dropzone} ${selectedFile ? styles.hasFile : ''}`}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className={styles.dropzoneInput}
                  onChange={handleFileChange}
                />
                {selectedFile ? (
                  <>
                    <div className={styles.dropzoneIcon}><UiCheck size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></div>
                    <p className={styles.dropzoneFileName}>{selectedFile.name}</p>
                    <p className={styles.dropzoneSubtext}>{(selectedFile.size / 1024).toFixed(1)} KB — Ready to upload</p>
                  </>
                ) : (
                  <>
                    <div className={styles.dropzoneIcon}><UiFolderOpen size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></div>
                    <p className={styles.dropzoneText}>Tap to select CSV file</p>
                    <p className={styles.dropzoneSubtext}>Only .csv files accepted</p>
                  </>
                )}
              </div>

              {selectedFile && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null)
                    setUploadError('')
                    setUploadSuccess('')
                    setUploadResult(null)
                    if (fileInputRef.current) {
                      fileInputRef.current.value = ''
                    }
                  }}
                  style={{
                    backgroundColor: "var(--portal-danger-bg,#fee2e2)",
                    color: "var(--portal-danger-text,#dc2626)",
                    border: "1px solid var(--portal-danger-border,#fca5a5)",
                    borderRadius: '0.4rem',
                    padding: '0.4rem 0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    marginBottom: '0.85rem',
                    display: 'block',
                    width: '100%',
                    textAlign: 'center',
                  }}
                >
                  Remove Selected File
                </button>
              )}

              {uploadError && <div className={styles.errorBanner} style={{ marginBottom: '1rem' }}>{uploadError}</div>}
              <button className={styles.uploadBtn} onClick={handleUpload} disabled={uploading || !selectedFile || !batchPassword}>
                {uploading ? <><span className={styles.spinner} /> Uploading...</> : 'Upload Students →'}
              </button>
            </div>

            {uploadResult && <BulkUploadResults result={uploadResult} />}
          </>
        )}

        {/* ══ STUDENTS CRUD TAB ══ */}
        {activeTab === 'students' && (
          <>

            <div className={styles.semesterRow}>
              <span className={styles.semesterLabel}>Semester:</span>
              <select className={styles.semesterSelect} value={studentSemester} onChange={e => {
                const nextSem = Number(e.target.value)
                setStudentSemester(nextSem)
                fetchStudents(nextSem)
              }}>
                {[1,2,3,4,5,6,7,8,9,10].map(s => <option key={s} value={s}>Semester {s}</option>)}
              </select>
              <button className={styles.addBtn} onClick={() => { setShowAddModal(true); setStudentError(''); setStudentSuccess('') }}>
                + Add Student
              </button>
              <button
                className={styles.exportBtn}
                onClick={() => handleExportExcel(studentSemester)}
                disabled={exportingExcel}
                title="Download Excel sheet with student details and all selected papers"
              >
                {exportingExcel ? <LoadingIndicator message="Exporting…" /> : 'Export Excel (Students & Papers)'}
              </button>
            </div>

            <div className={styles.tableWrapper}>
              {loadingStudents ? (
                <LoadingState layout="table" message="Loading students…" />
              ) : students.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}><UiUsers size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></div>
                  <p className={styles.emptyTitle}>No students found</p>
                  <p className={styles.emptySubtitle}>No students in Semester {studentSemester}. Click <b>+ Add Student</b> to create one.</p>
                </div>
              ) : (
                <table className={styles.table}>
                  <thead className={styles.tableHead}><tr><th>#</th><th>Name</th><th>Sem</th><th>Actions</th></tr></thead>
                  <tbody>
                    {students.map((student, index) => (
                      <tr key={student.id} className={styles.tableRow}>
                        <td>{index + 1}</td>
                        <td>{student.full_name}</td>
                        <td>{student.current_semester}</td>
                        <td>
                          <div className={styles.actionBtns}>
                            <button className={styles.approveBtn} onClick={() => { setEditStudent(student); setEditName(student.full_name); setEditCap(student.cap_application_number ?? ''); setEditSemester(student.current_semester); setStudentError(''); setStudentSuccess('') }} aria-label="Edit"><UiPencil size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></button>
                            <button className={styles.rejectBtn} onClick={() => { setDeleteStudent(student); setStudentError(''); setStudentSuccess('') }} aria-label="Delete"><UiTrash2 size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Add Student Modal */}
            {showAddModal && (
              <div className={styles.modalOverlay}>
                <div className={styles.modal}>
                  <h3 className={styles.modalTitle}>Add Student</h3>
                  <p className={styles.modalSubtitle}>Creates a Supabase Auth account + student record. Student must change password on first login.</p>
                  <div className={styles.fieldGroup}>
                    {[
                      { label: 'Full Name *', value: addName, set: setAddName, type: 'text', placeholder: 'Student full name' },
                      { label: 'CAP Number *', value: addCap, set: setAddCap, type: 'text', placeholder: 'e.g. CAP2025001' },
                      { label: 'Academic Year Joined *', value: addYearJoined, set: setAddYearJoined, type: 'select' },
                      { label: 'Email *', value: addEmail, set: setAddEmail, type: 'email', placeholder: 'student@email.com' },
                      { label: 'Password *', value: addPassword, set: setAddPassword, type: 'password', placeholder: 'Min. 8 characters' },
                    ].map(({ label, value, set, type, placeholder }) => (
                      <div key={label} className={styles.field}>
                        <label className={styles.label}>{label}</label>
                        {type === 'select' ? (
                          <select className={styles.input} value={value} onChange={e => set(e.target.value)}>
                            <option value="">Select Academic Year</option>
                            {getAcademicYearOptions().map(year => (
                              <option key={year} value={year}>{year}</option>
                            ))}
                          </select>
                        ) : type === 'password' ? (
                          <div className="password-wrapper">
                            <input
                              type={showAddPassword ? 'text' : 'password'}
                              className={`${styles.input} password-input`}
                              placeholder={placeholder}
                              value={value}
                              onChange={e => set(e.target.value)}
                            />
                            <button
                              type="button"
                              className="password-toggle-btn"
                              onClick={() => setShowAddPassword(!showAddPassword)}
                              aria-label={showAddPassword ? 'Hide password' : 'Show password'}
                            >
                              {showAddPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                        ) : (
                          <input type={type} className={styles.input} placeholder={placeholder} value={value} onChange={e => set(e.target.value)} />
                        )}
                      </div>
                    ))}
                    <div className={styles.field}>
                      <label className={styles.label}>Current Semester *</label>
                      <select className={styles.input} value={addSemester} onChange={e => setAddSemester(Number(e.target.value))}>
                        {[1,2,3,4,5,6,7,8,9,10].map(s => <option key={s} value={s}>Semester {s}</option>)}
                      </select>
                    </div>
                  </div>
                  {studentError && <div className={styles.errorBanner} style={{ marginBottom: '1rem' }}>{studentError}</div>}
                  <div className={styles.modalActions}>
                    <button className={styles.modalCancelBtn} onClick={() => { setShowAddModal(false); setAddName(''); setAddCap(''); setAddEmail(''); setAddPassword(''); setAddYearJoined(getDefaultAcademicYear()); setAddSemester(1); setStudentError('') }} disabled={adding}>Cancel</button>
                    <button className={styles.modalConfirmBtn} onClick={handleAddStudent} disabled={adding}>{adding ? <LoadingIndicator message="Creating…" /> : 'Create Student →'}</button>
                  </div>
                </div>
              </div>
            )}

            {/* Edit Student Modal */}
            {editStudent && (
              <div className={styles.modalOverlay}>
                <div className={styles.modal}>
                  <h3 className={styles.modalTitle}>Edit Student</h3>
                  <div className={styles.fieldGroup}>
                    <div className={styles.field}>
                      <label className={styles.label}>Full Name *</label>
                      <input type="text" className={styles.input} value={editName} onChange={e => setEditName(e.target.value)} />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>CAP Number *</label>
                      <input
                        type="text"
                        className={styles.input}
                        value={editCap}
                        onChange={e => setEditCap(e.target.value.toUpperCase())}
                        placeholder="e.g. CAP2025001"
                      />
                    </div>
                    <div className={styles.field}>
                      <label className={styles.label}>Current Semester *</label>
                      <select className={styles.input} value={editSemester} onChange={e => setEditSemester(Number(e.target.value))}>
                        {[1,2,3,4,5,6,7,8,9,10].map(s => <option key={s} value={s}>Semester {s}</option>)}
                      </select>
                    </div>
                  </div>
                  {studentError && <div className={styles.errorBanner} style={{ marginBottom: '1rem' }}>{studentError}</div>}
                  <div className={styles.modalActions}>
                    <button className={styles.modalCancelBtn} onClick={() => { setEditStudent(null); setEditCap(''); setEditName(''); setStudentError('') }} disabled={updating}>Cancel</button>
                    <button className={styles.modalConfirmBtn} onClick={handleUpdateStudent} disabled={updating}>{updating ? <LoadingIndicator message="Saving…" /> : 'Save Changes →'}</button>
                  </div>
                </div>
              </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteStudent && (
              <div className={styles.modalOverlay}>
                <div className={styles.modal}>
                  <h3 className={styles.modalTitle}>Remove Student</h3>
                  <p className={styles.modalSubtitle}>
                    Are you sure you want to permanently remove <strong>{deleteStudent.full_name}</strong>?
                    This will delete their account, all registration history, and attendance records. This cannot be undone.
                  </p>
                  {studentError && <div className={styles.errorBanner} style={{ marginBottom: '1rem' }}>{studentError}</div>}
                  <div className={styles.modalActions}>
                    <button className={styles.modalCancelBtn} onClick={() => { setDeleteStudent(null); setStudentError('') }} disabled={deleting}>Cancel</button>
                    <button className={styles.modalDeleteBtn} onClick={handleDeleteStudent} disabled={deleting}>{deleting ? <LoadingIndicator message="Removing…" /> : 'Yes, Remove'}</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'blueprint' && <BlueprintTab semester={blueprintSemester} onSemesterChange={setBlueprintSemester} />}
        {activeTab === 'courses' && <CoursesTab semester={coursesSemester} onSemesterChange={setCoursesSemester} />}
        {activeTab === 'assignments' && <TeacherAssignmentTab onDirtyChange={setIsAssignmentTabDirty} />}
        {activeTab === 'period-marking' && <PeriodMarkingTab />}
        {activeTab === 'campus-attendance' && <CampusAttendanceTab />}

        {/* ══ DEFAULTERS TAB ══ */}
        {activeTab === 'defaulters' && (
          <>
            {defaulterError && <div className={styles.errorBanner}>{defaulterError}</div>}

            {/* Optional semester filter + fetch */}
            <div className={styles.semesterRow}>
              <span className={styles.semesterLabel}>Filter:</span>
              <select
                className={styles.semesterSelect}
                value={defaulterSemester}
                onChange={e => {
                  const nextVal = e.target.value === 'all' ? 'all' : Number(e.target.value)
                  setDefaulterSemester(nextVal)
                  handleFetch(nextVal)
                }}
              >
                <option value="all">All Semesters</option>
                {[1,2,3,4,5,6,7,8,9,10].map(s => <option key={s} value={s}>Semester {s}</option>)}
              </select>
              <button
                className={styles.exportBtn}
                onClick={() => handleExportExcel(defaulterSemester)}
                disabled={exportingExcel}
                title="Download Excel sheet with student details and all selected papers"
              >
                {exportingExcel ? <LoadingIndicator message="Exporting…" /> : 'Export Excel'}
              </button>
              <button
                className={styles.exportBtn}
                onClick={() => handleFetch(defaulterSemester)}
                disabled={loadingDefaulters}
                style={{ background: "var(--portal-info-bg,#f8fafc)", color: "var(--portal-info-text,#334155)", border: "1px solid var(--portal-strong-border,#cbd5e1)" }}
                title="Refresh live student registration status from server"
              >
                {loadingDefaulters ? <LoadingIndicator message="Refreshing…" /> : 'Refresh Status'}
              </button>
            </div>

            {loadingDefaulters && (
              <LoadingState layout="table" message="Fetching student data…" />
            )}

            {!loadingDefaulters && deptData && (
              <>
                <div className={styles.statsRow}>
                  <div className={styles.statCard}>
                    <p className={styles.statValue}>{deptData.total_students}</p>
                    <p className={styles.statLabel}>Total</p>
                  </div>
                  <div className={styles.statCard}>
                    <p className={`${styles.statValue} ${styles.success}`}>{deptData.submitted_count}</p>
                    <p className={styles.statLabel}>Submitted</p>
                  </div>
                  <div className={styles.statCard}>
                    <p className={`${styles.statValue} ${notSubmittedStudents.length > 0 ? styles.danger : styles.success}`}>{notSubmittedStudents.length}</p>
                    <p className={styles.statLabel}>Pending</p>
                  </div>
                </div>

                <div className={styles.sectionHeader}>
                  <p className={styles.sectionTitle}>
                    All Students ({deptData.total_students})
                    {defaulterSemester !== 'all' && ` — Semester ${defaulterSemester}`}
                  </p>
                  {notSubmittedStudents.length > 0 && (
                    copied
                      ? <span className={styles.copiedMsg}>Copied!</span>
                      : <button className={styles.whatsappBtn} onClick={handleCopyWhatsApp}>Copy Pending for WhatsApp</button>
                  )}
                </div>

                <div className={styles.tableWrapper}>
                  {deptData.total_students === 0 ? (
                    <div className={styles.emptyState}>
                      <div className={styles.emptyIcon}><UiUsers size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></div>
                      <p className={styles.emptyTitle}>No students found</p>
                      <p className={styles.emptySubtitle}>No students in your department{defaulterSemester !== 'all' ? ` for Semester ${defaulterSemester}` : ''}.</p>
                    </div>
                  ) : (
                    <table className={styles.table}>
                      <thead className={styles.tableHead}>
                        <tr><th>#</th><th>Name</th><th>Sem</th><th>Status</th></tr>
                      </thead>
                      <tbody>
                        {deptData.students.map((student, index) => (
                          <tr key={student.id} className={styles.tableRow}>
                            <td>{index + 1}</td>
                            <td>{student.full_name}</td>
                            <td>Sem {student.current_semester}</td>
                            <td>
                              <span style={{
                                display: 'inline-block',
                                padding: '0.15rem 0.5rem',
                                borderRadius: '2rem',
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                background: student.submitted ? "var(--portal-success-bg,#dcfce7)" : "var(--portal-danger-bg,#fee2e2)",
                                color: student.submitted ? "var(--portal-success-text,#16a34a)" : "var(--portal-danger-text,#dc2626)",
                              }}>
                                {student.submitted ? 'Submitted' : 'Pending'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ══ MANUAL ALLOCATION TAB ══ */}
        {activeTab === 'manual-allocation' && <ManualAllocationTab />}
      </div>

      {/* Unified Success Modal Overlay */}
      {(uploadSuccess || studentSuccess) && (
        <div className={styles.successModalOverlay} onClick={() => { setUploadSuccess(''); setStudentSuccess('') }}>
          <div className={styles.successModalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.successModalIcon}><UiCheck size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></div>
            <p className={styles.successModalText}>{uploadSuccess || studentSuccess}</p>
            <button className={styles.successModalClose} onClick={() => { setUploadSuccess(''); setStudentSuccess('') }} aria-label="Close"><UiX size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></button>
          </div>
        </div>
      )}
    </div>
  )
}
