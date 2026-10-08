'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import styles from './director-dashboard.module.css'
import { useBfcacheGuard } from '@/core/hooks/useBfcacheGuard'
import {
  utcIsoToKolkataInput,
  kolkataInputToUtcIso,
  formatKolkataDisplay,
  ASIA_KOLKATA_OFFSET_MS,
} from '@/core/utils/dateTime'

export default function DirectorDashboard() {
  useBfcacheGuard()
  const router = useRouter()

  const [activeTab, setActiveTab] = useState<'registration' | 'timetable' | 'promotion' | 'allocation'>('registration')

  const [directorName, setDirectorName] = useState('')
  const [campusName, setCampusName] = useState('')
  const [campusId, setCampusId] = useState('')
  const [loadingDirector, setLoadingDirector] = useState(true)

  // Window settings state
  const [currentDeadline, setCurrentDeadline] = useState<string | null>(null)
  const [deadline, setDeadline] = useState('')
  const [minCredits, setMinCredits] = useState(18)
  const [maxCredits, setMaxCredits] = useState(26)
  const [savingWindow, setSavingWindow] = useState(false)
  const [windowSuccess, setWindowSuccess] = useState('')
  const [windowError, setWindowError] = useState('')

  // Promotion state
  const [promoting, setPromoting] = useState(false)
  const [promoteSuccess, setPromoteSuccess] = useState('')
  const [promoteError, setPromoteError] = useState('')
  const [promoteStep, setPromoteStep] = useState<0 | 1 | 2>(0)
  const [loggingOut, setLoggingOut] = useState(false)
  const [lastPromotedAt, setLastPromotedAt] = useState<string | null>(null)

  // Auto-clear promotion success message after 5 s
  useEffect(() => {
    if (!promoteSuccess) return
    const t = setTimeout(() => setPromoteSuccess(''), 5000)
    return () => clearTimeout(t)
  }, [promoteSuccess])

  // Allocation state
  const [allocationSemester, setAllocationSemester] = useState<number>(1)
  const [allocationAcademicYear, setAllocationAcademicYear] = useState<string>('')
  const [allocationRun, setAllocationRun] = useState<any | null>(null)
  const [triggeringRun, setTriggeringRun] = useState(false)
  const [showRerunConfirm, setShowRerunConfirm] = useState(false)
  const [showWindowOpenWarning, setShowWindowOpenWarning] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [allocationError, setAllocationError] = useState('')
  const [allocationSuccess, setAllocationSuccess] = useState('')

  // Derived window status
  const windowIsOpen = currentDeadline !== null && new Date() < new Date(currentDeadline)

  function invalidateDirectorCache() {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem('fyimp_director_settings_cache')
      } catch {}
    }
  }

  const loadSettingsData = useCallback(async (isBackground = false) => {
    try {
      const response = await fetch('/api/director/settings')
      if (!response.ok) {
        if (!isBackground) router.push('/login')
        return
      }
      const data = await response.json()

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('fyimp_director_settings_cache', JSON.stringify(data))
      }

      setDirectorName(data.directorName || '')
      setCampusId(data.campusId || '')
      setCampusName(data.campusName || '')

      if (data.settings) {
        setCurrentDeadline(data.settings.deadline)
        setDeadline(utcIsoToKolkataInput(data.settings.deadline))
        setMinCredits(data.settings.min_credits ?? 18)
        setMaxCredits(data.settings.max_credits ?? 26)
        setLastPromotedAt(data.settings.last_promoted_at ?? null)
      }
    } catch {
      // In background refresh, ignore transient network drops
    } finally {
      setLoadingDirector(false)
    }
  }, [router])

  useEffect(() => {
    // Check sessionStorage cache for instant render, but revalidate in background (F59)
    const cached = typeof window !== 'undefined' ? sessionStorage.getItem('fyimp_director_settings_cache') : null
    if (cached) {
      try {
        const data = JSON.parse(cached)
        setDirectorName(data.directorName || '')
        setCampusId(data.campusId || '')
        setCampusName(data.campusName || '')

        if (data.settings) {
          setCurrentDeadline(data.settings.deadline)
          setDeadline(utcIsoToKolkataInput(data.settings.deadline))
          setMinCredits(data.settings.min_credits ?? 18)
          setMaxCredits(data.settings.max_credits ?? 26)
          setLastPromotedAt(data.settings.last_promoted_at ?? null)
        }
        setLoadingDirector(false)
      } catch {}
    }

    loadSettingsData()

    // Refresh settings on tab focus or reconnect (F59)
    const onFocus = () => { loadSettingsData(true) }
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('focus', onFocus) }
  }, [loadSettingsData])

  // Academic year helper
  function getAcademicYear(): string {
    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()
    if (month >= 6) return `${year}-${String(year + 1).slice(2)}`
    return `${year - 1}-${String(year).slice(2)}`
  }

  // Initialize allocation academic year
  useEffect(() => {
    if (!allocationAcademicYear) {
      setAllocationAcademicYear(getAcademicYear())
    }
  }, [])

  // Poll allocation status while running
  useEffect(() => {
    if (activeTab !== 'allocation') return
    const year = allocationAcademicYear || getAcademicYear()

    let timer: any = null
    async function checkStatus() {
      try {
        const res = await fetch(
          `/api/allocation/status?academicYear=${encodeURIComponent(year)}&semester=${allocationSemester}`,
        )
        const data = await res.json()
        if (res.ok) {
          setAllocationRun(data.run)
        }
      } catch {}
    }

    checkStatus()

    if (allocationRun?.status === 'running') {
      timer = setInterval(checkStatus, 2000)
    }

    return () => {
      if (timer) clearInterval(timer)
    }
  }, [activeTab, allocationSemester, allocationAcademicYear, allocationRun?.status])

  function handleSetPreset(days: number) {
    const nowUtcMs = Date.now()
    const kolkataNow = new Date(nowUtcMs + ASIA_KOLKATA_OFFSET_MS)
    kolkataNow.setUTCDate(kolkataNow.getUTCDate() + days)
    const y = kolkataNow.getUTCFullYear()
    const m = String(kolkataNow.getUTCMonth() + 1).padStart(2, '0')
    const d = String(kolkataNow.getUTCDate()).padStart(2, '0')
    setDeadline(`${y}-${m}-${d}T23:59`)
  }

  async function handleRunAllocation(forceRerun: boolean = false) {
    if (allocationRun?.status === 'completed') {
      setAllocationError(
        'Allocation for this semester has already been completed and locked. It can only be executed once per semester per academic year.',
      )
      return
    }

    if (windowIsOpen) {
      setShowWindowOpenWarning(true)
      return
    }

    await executeRunAllocation()
  }

  async function handleCloseAndRunAllocation() {
    setShowWindowOpenWarning(false)
    const nowIso = new Date().toISOString()
    try {
      await fetch('/api/director/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: nowIso }),
      })
      setCurrentDeadline(nowIso)
      setDeadline(nowIso.slice(0, 16))
      // Keep sessionStorage in sync so returning to the tab shows correct status
      if (typeof window !== 'undefined') {
        const cached = sessionStorage.getItem('fyimp_director_settings_cache')
        if (cached) {
          try {
            const parsed = JSON.parse(cached)
            parsed.settings = { ...(parsed.settings || {}), deadline: nowIso }
            sessionStorage.setItem('fyimp_director_settings_cache', JSON.stringify(parsed))
          } catch {}
        }
      }
    } catch {}
    await executeRunAllocation()
  }

  async function executeRunAllocation() {
    setTriggeringRun(true)
    setShowRerunConfirm(false)
    setShowWindowOpenWarning(false)
    setAllocationError('')
    setAllocationSuccess('')

    try {
      const year = allocationAcademicYear || getAcademicYear()
      const res = await fetch('/api/allocation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          academicYear: year,
          semester: allocationSemester,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start course allocation')
      }

      setAllocationSuccess('Course allocation run completed successfully!')
      setAllocationRun({ status: 'running', triggered_at: new Date().toISOString() })
    } catch (err: any) {
      setAllocationError(err.message || 'Error triggering allocation')
    } finally {
      setTriggeringRun(false)
    }
  }

  // Save window settings (F58, F59, F60)
  async function handleSaveWindow() {
    if (!deadline) {
      setWindowError('Please set a deadline')
      return
    }

    const utcIso = kolkataInputToUtcIso(deadline)
    if (!utcIso) {
      setWindowError('Invalid deadline date format')
      return
    }

    setSavingWindow(true)
    setWindowError('')
    setWindowSuccess('')

    try {
      const response = await fetch('/api/director/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deadline: utcIso,
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const msg = (typeof data.message === 'string' ? data.message : data.message?.error) || data.error || 'Failed to update settings.'
        setWindowError(msg)
        return
      }

      setCurrentDeadline(utcIso)
      setDeadline(utcIsoToKolkataInput(utcIso))
      setWindowSuccess(data.message || 'Registration window updated successfully.')
      invalidateDirectorCache()
    } catch (err: any) {
      setWindowError(err?.message || 'Network error: could not connect to server. Your input has been preserved; please retry.')
    } finally {
      setSavingWindow(false)
    }
  }

  function handleCloseImmediately() {
    setShowCloseConfirm(true)
  }

  async function executeCloseImmediately() {
    setShowCloseConfirm(false)
    const nowIso = new Date().toISOString()
    setSavingWindow(true)
    setWindowError('')
    setWindowSuccess('')

    try {
      const response = await fetch('/api/director/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deadline: nowIso }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        const msg = (typeof data.message === 'string' ? data.message : data.message?.error) || data.error || 'Failed to close registration window.'
        setWindowError(msg)
        return
      }

      setCurrentDeadline(nowIso)
      setDeadline(utcIsoToKolkataInput(nowIso))
      setWindowSuccess('Registration window closed successfully. Timetable generation is now unlocked.')
      invalidateDirectorCache()
    } catch (err: any) {
      setWindowError(err?.message || 'Network error: could not close registration window. Please retry.')
    } finally {
      setSavingWindow(false)
    }
  }

  // Promote students (F60)
  async function handlePromoteStudents() {
    setPromoting(true)
    setPromoteError('')
    setPromoteSuccess('')

    try {
      const response = await fetch('/api/admin/campus/promote-students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        const msg = (typeof data.message === 'string' ? data.message : data.message?.error) || data.error || 'Failed to promote students.'
        setPromoteError(msg)
        return
      }

      const nowIso = new Date().toISOString()
      const countDisplay = typeof data.promoted_count === 'number' ? data.promoted_count : ''
      const rawMsg = typeof data.message === 'string' && !data.message.includes('[object')
        ? data.message
        : `${countDisplay ? `${countDisplay} ` : ''}Students promoted to next semester successfully.`
      setPromoteSuccess(`${rawMsg}${data.graduated_count > 0 ? ` (${data.graduated_count} students graduated and removed)` : ''}`)
      setLastPromotedAt(nowIso)
      invalidateDirectorCache()
    } catch (err: any) {
      setPromoteError(err?.message || 'Network error during promotion. Please check connection and retry.')
    } finally {
      setPromoting(false)
      setPromoteStep(0)
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

      {/* Unified Executive Header Bar */}
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
              <p className={styles.topBarSubtitle}>Campus Director</p>
            </div>
          </div>

          {/* Vertical Divider */}
          <div className={styles.topBarDivider} />

          {/* 2. Director Details Block */}
          {loadingDirector ? (
            <div className={styles.topBarSkeleton} />
          ) : (
            <div className={styles.directorIdentity}>
              <p className={styles.directorName}>{directorName || 'Campus Director'}</p>
              <div className={styles.directorDetails}>
                <span className={styles.roleBadge}>Campus Director</span>
                {campusName && (
                  <span className={styles.campusBadge} title={campusName}>
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

      {/* Tab Bar */}
      <div className={styles.tabBar}>
        <button
          className={`${styles.tabBtn} ${activeTab === 'registration' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('registration')}
        >
          Registration Window
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === 'timetable' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('timetable')}
        >
          Timetable Generator
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === 'promotion' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('promotion')}
        >
          Semester Promotion
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === 'allocation' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('allocation')}
        >
          Course Allocation
        </button>
      </div>

      {/* Main Content */}
      <div className={styles.mainContent}>

        {/* ── TAB 1: REGISTRATION WINDOW ── */}
        {activeTab === 'registration' && (
          <div>
            <p className={styles.sectionTitle}>Registration Window Management</p>

            {windowError && <div className={styles.errorBanner}>{windowError}</div>}
            {windowSuccess && <div className={styles.successBanner}>✓ {windowSuccess}</div>}

            <div className={styles.windowCard}>

              {/* Live Status Banner */}
              <div className={windowIsOpen ? styles.Banner : styles.windowClosedBanner}>
                {windowIsOpen ? (
                  <>
                    <span className={styles.statusDot} />
                    🟢 Registration Window OPEN — closes {formatKolkataDisplay(currentDeadline)}
                  </>
                ) : (
                  <>
                    ⛔ Registration Window CLOSED
                    {currentDeadline
                      ? ` — deadline was ${formatKolkataDisplay(currentDeadline)}`
                      : ' — no deadline set yet'}
                  </>
                )}
              </div>

              <div className={styles.fieldGroup}>

                <div className={styles.field}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className={styles.label}>
                      Registration Deadline
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: '#64748b', fontWeight: 'normal' }}>
                        (Asia/Kolkata IST, UTC+05:30)
                      </span>
                    </label>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button
                        type="button"
                        onClick={() => handleSetPreset(7)}
                        style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', color: '#334155' }}
                      >
                        +7 Days
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetPreset(14)}
                        style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', color: '#334155' }}
                      >
                        +14 Days
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetPreset(30)}
                        style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', color: '#334155' }}
                      >
                        +30 Days
                      </button>
                    </div>
                  </div>
                  <input
                    type="datetime-local"
                    className={styles.input}
                    value={deadline}
                    onChange={e => setDeadline(e.target.value)}
                  />
                  <p className={styles.fieldHint}>
                    Students will be able to select and submit their ranked elective choices until this deadline (Indian Standard Time).
                  </p>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Academic Year</label>
                  <div className={styles.readOnlyField}>
                    {getAcademicYear()}
                    <span className={styles.autoLabel}>Auto</span>
                  </div>
                </div>

              </div>

              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  className={styles.primaryBtn}
                  onClick={handleSaveWindow}
                  disabled={savingWindow}
                  style={{
                    background: windowIsOpen ? '#0284c7' : '#059669',
                  }}
                >
                  {savingWindow
                    ? <><span className={styles.spinner} /> Saving...</>
                    : windowIsOpen
                    ? 'Update Registration Deadline →'
                    : 'Open Registration Window →'
                  }
                </button>
                {windowIsOpen && (
                  <button
                    type="button"
                    style={{
                      background: '#dc2626',
                      color: '#ffffff',
                      border: 'none',
                      padding: '0.65rem 1.25rem',
                      borderRadius: '0.375rem',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      cursor: savingWindow ? 'not-allowed' : 'pointer',
                    }}
                    onClick={handleCloseImmediately}
                    disabled={savingWindow}
                  >
                    🔒 Close Registration Immediately
                  </button>
                )}
              </div>

            </div>
          </div>
        )}

        {/* ── CLOSE REGISTRATION CONFIRMATION MODAL ── */}
        {showCloseConfirm && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.75)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: '1rem',
            }}
          >
            <div
              style={{
                background: '#0f172a',
                border: '1px solid #dc2626',
                borderRadius: '12px',
                padding: '1.75rem',
                maxWidth: '460px',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f87171', margin: 0 }}>
                🔒 Close Registration Window?
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
                This will <strong>immediately close</strong> course registration for this campus. Students will no longer be able to submit or change their elective preferences.
              </p>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
                Are you sure you want to proceed?
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.25rem' }}>
                <button
                  className={styles.primaryBtn}
                  onClick={() => setShowCloseConfirm(false)}
                  style={{ background: '#334155' }}
                >
                  Cancel
                </button>
                <button
                  className={styles.primaryBtn}
                  onClick={executeCloseImmediately}
                  style={{ background: '#dc2626' }}
                >
                  Yes, Close Registration →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: TIMETABLE GENERATOR ── */}
        {activeTab === 'timetable' && (
          <div>
            <p className={styles.sectionTitle}>Timetable Generation & Management</p>
            <div className={styles.windowCard}>
              <p style={{ fontSize: '0.85rem', color: '#44474e', margin: '0 0 1rem 0' }}>
                Generate, publish, and re-validate automated timetables for all departments in {campusName || 'this campus'}.
              </p>
              <button
                className={styles.primaryBtn}
                onClick={() => router.push('/dashboard/director/timetable')}
                style={{ background: '#002147' }}
              >
                Open Timetable Generator Dashboard →
              </button>
            </div>
          </div>
        )}

        {/* ── TAB 3: SEMESTER PROMOTION ── */}
        {activeTab === 'promotion' && (
          <div>
            <p className={styles.sectionTitle}>Semester Promotion</p>

            {promoteError && <div className={styles.errorBanner}>{promoteError}</div>}
            {promoteSuccess && <div className={styles.successBanner}>✓ {promoteSuccess}</div>}

            <div className={styles.windowCard}>
              <p style={{ fontSize: '0.82rem', color: '#44474e', margin: '0 0 1rem 0' }}>
                Promote all students in this campus to the next semester.
                Students in their final semester (10) will be removed from the system.
                This action cannot be undone.
              </p>

              {/* Step 0: Just show the button */}
              {promoteStep === 0 && (
                <button
                  className={styles.primaryBtn}
                  onClick={() => {
                    setPromoteStep(1)
                    setPromoteError('')
                    setPromoteSuccess('')
                  }}
                  style={{ background: '#c9a227', color: '#002147' }}
                >
                  Promote All Students →
                </button>
              )}

              {/* Step 1: Show last promotion time and ask to continue */}
              {promoteStep === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  <div style={{ background: '#fff8e6', border: '1px solid #f5d78c', borderRadius: '0.6rem', padding: '0.9rem 1rem' }}>
                    <p style={{ fontSize: '0.78rem', fontWeight: 700, color: '#8b6914', margin: '0 0 0.3rem' }}>
                      📅 Last Promotion
                    </p>
                    <p style={{ fontSize: '0.85rem', color: '#44474e', margin: 0 }}>
                      {lastPromotedAt
                        ? new Date(lastPromotedAt).toLocaleString('en-IN', {
                            day: 'numeric', month: 'long', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })
                        : 'Never promoted on this system'}
                    </p>
                  </div>
                  <p style={{ fontSize: '0.82rem', color: '#44474e', margin: 0 }}>
                    Please verify the date above before continuing. Only proceed if you intend to start a new semester now.
                  </p>
                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                    <button
                      className={styles.primaryBtn}
                      onClick={() => setPromoteStep(2)}
                      style={{ background: '#c9a227', color: '#002147' }}
                    >
                      Continue →
                    </button>
                    <button
                      className={styles.primaryBtn}
                      onClick={() => setPromoteStep(0)}
                      style={{ background: '#9ba1ab' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Explicit confirmation (or locked if within 90 days) */}
              {promoteStep === 2 && (() => {
                const isWithin90Days = lastPromotedAt
                  ? new Date(lastPromotedAt) > new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
                  : false

                if (isWithin90Days) {
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', alignItems: 'center' }}>
                      <div style={{
                        background: '#fdf2f2',
                        border: '2px solid #f5c6c6',
                        borderRadius: '0.75rem',
                        padding: '1.25rem 1.5rem',
                        width: '100%',
                        maxWidth: '30rem',
                        boxSizing: 'border-box',
                        textAlign: 'center',
                      }}>
                        <p style={{ fontSize: '1.5rem', margin: '0 0 0.5rem' }}>🔒</p>
                        <p style={{ fontSize: '0.92rem', fontWeight: 700, color: '#c0392b', margin: '0 0 0.5rem' }}>
                          Promotion Locked
                        </p>
                        <p style={{ fontSize: '0.8rem', color: '#44474e', margin: 0, lineHeight: 1.5 }}>
                          Students were last promoted on{' '}
                          <strong>{new Date(lastPromotedAt!).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong>.
                          <br />
                          A minimum of <strong>90 days</strong> must pass before the next promotion.
                        </p>
                      </div>
                      <button
                        className={styles.primaryBtn}
                        onClick={() => setPromoteStep(0)}
                        style={{ background: '#9ba1ab' }}
                      >
                        Back
                      </button>
                    </div>
                  )
                }

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', alignItems: 'center' }}>
                    <div style={{ background: '#fdf2f2', border: '1px solid #f5c6c6', borderRadius: '0.6rem', padding: '0.9rem 1rem', width: '100%', maxWidth: '28rem', boxSizing: 'border-box' }}>
                      <p style={{ fontSize: '0.85rem', fontWeight: 700, color: '#c0392b', margin: 0 }}>
                        ⚠️ Has the next semester officially started?
                      </p>
                      <p style={{ fontSize: '0.78rem', color: '#44474e', margin: '0.35rem 0 0' }}>
                        This will increment every student's semester by 1 and permanently remove Semester 10 graduates.
                      </p>
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                      <button
                        className={styles.primaryBtn}
                        onClick={handlePromoteStudents}
                        disabled={promoting}
                        style={{
                          background: '#c0392b',
                          cursor: promoting ? 'wait' : 'pointer',
                        }}
                      >
                        {promoting
                          ? <><span className={styles.spinner} /> Promoting...</>
                          : 'Yes, Start New Semester →'
                        }
                      </button>
                      <button
                        className={styles.primaryBtn}
                        onClick={() => setPromoteStep(0)}
                        disabled={promoting}
                        style={{ background: '#9ba1ab' }}
                      >
                        No, Cancel
                      </button>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        )}

        {/* ── TAB 4: COURSE ALLOCATION ── */}
        {activeTab === 'allocation' && (
          <div>
            <p className={styles.sectionTitle}>Scored Course Allocation System</p>

            {allocationError && <div className={styles.errorBanner}>{allocationError}</div>}
            {allocationSuccess && <div className={styles.successBanner}>✓ {allocationSuccess}</div>}

            <div className={styles.windowCard}>
              <p className={styles.windowDescription}>
                Trigger the 3-round allocation algorithm for this semester. The engine ranks student elective preferences based on prerequisite completion and semester proximity, taking into account fixed slot capacities.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1.25rem' }}>
                <div className={styles.field}>
                  <label className={styles.label}>Academic Year</label>
                  <select
                    className={styles.input}
                    value={allocationAcademicYear}
                    onChange={(e) => {
                      setAllocationAcademicYear(e.target.value)
                      setAllocationRun(null)
                      setAllocationError('')
                    }}
                  >
                    {(() => {
                      const now = new Date()
                      const month = now.getMonth() + 1
                      const baseYear = month >= 6 ? now.getFullYear() : now.getFullYear() - 1
                      return [baseYear - 1, baseYear, baseYear + 1].map((y) => {
                        const label = `${y}-${String(y + 1).slice(2)}`
                        return <option key={label} value={label}>{label}</option>
                      })
                    })()}
                  </select>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Semester</label>
                  <select
                    className={styles.input}
                    value={allocationSemester}
                    onChange={(e) => {
                      setAllocationSemester(Number(e.target.value))
                      setAllocationRun(null)
                      setAllocationError('')
                    }}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => (
                      <option key={s} value={s}>
                        Semester {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Status Display Card */}
              <div
                style={{
                  marginTop: '1.5rem',
                  padding: '1.25rem',
                  borderRadius: '10px',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1' }}>
                    Latest Run Status ({allocationAcademicYear || 'Current Year'} • Semester {allocationSemester}):
                  </span>

                  {!allocationRun ? (
                    <span
                      style={{
                        padding: '0.25rem 0.65rem',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        background: '#334155',
                        color: '#94a3b8',
                      }}
                    >
                      Not Started
                    </span>
                  ) : allocationRun.status === 'running' ? (
                    <span
                      style={{
                        padding: '0.25rem 0.65rem',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        background: 'rgba(245, 158, 11, 0.2)',
                        color: '#fbbf24',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                      }}
                    >
                      <span className={styles.spinner} style={{ width: 12, height: 12 }} />
                      Algorithm Running (Rounds 1–3)...
                    </span>
                  ) : allocationRun.status === 'completed' ? (
                    <span
                      style={{
                        padding: '0.25rem 0.65rem',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        background: 'rgba(34, 197, 94, 0.2)',
                        color: '#4ade80',
                        border: '1px solid rgba(34, 197, 94, 0.4)',
                      }}
                    >
                      ✓ Completed
                    </span>
                  ) : (
                    <span
                      style={{
                        padding: '0.25rem 0.65rem',
                        borderRadius: '999px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        background: 'rgba(239, 68, 68, 0.2)',
                        color: '#f87171',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                      }}
                    >
                      ✕ Failed
                    </span>
                  )}
                </div>

                {allocationRun && (
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div>
                      Triggered at: <strong>{new Date(allocationRun.triggered_at).toLocaleString()}</strong>
                    </div>
                    {allocationRun.completed_at && (
                      <div>
                        Completed at: <strong>{new Date(allocationRun.completed_at).toLocaleString()}</strong>
                      </div>
                    )}
                    {allocationRun.status === 'completed' && (
                      <div
                        style={{
                          marginTop: '0.5rem',
                          padding: '0.65rem 0.85rem',
                          borderRadius: '6px',
                          background: 'rgba(34, 197, 94, 0.08)',
                          border: '1px solid rgba(34, 197, 94, 0.25)',
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                          gap: '0.5rem',
                          color: '#f8fafc',
                        }}
                      >
                        <div>Total Students: <strong>{allocationRun.total_students ?? 0}</strong></div>
                        <div>Fully Allocated: <strong style={{ color: '#4ade80' }}>{allocationRun.fully_allocated ?? 0}</strong></div>
                        <div>Partially Allocated: <strong style={{ color: '#fbbf24' }}>{allocationRun.partially_allocated ?? 0}</strong></div>
                        <div>Unallocated: <strong style={{ color: '#f87171' }}>{allocationRun.unallocated ?? 0}</strong></div>
                      </div>
                    )}
                    {allocationRun.error_message && (
                      <div
                        style={{
                          color: '#f87171',
                          background: 'rgba(239,68,68,0.1)',
                          border: '1px solid rgba(239,68,68,0.25)',
                          padding: '0.65rem 0.85rem',
                          borderRadius: '6px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.75rem',
                        }}
                      >
                        <div>
                          <div><strong>Last Run Error:</strong> {allocationRun.error_message}</div>
                          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
                            Click &quot;Retry Course Allocation&quot; below to trigger a clean run with the current schema.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const runId = allocationRun?.id
                            if (runId) {
                              try {
                                await fetch(`/api/allocation/runs/${runId}`, { method: 'DELETE' })
                              } catch {
                                // best-effort — clear UI even if API fails
                              }
                            }
                            setAllocationRun(null)
                          }}
                          style={{
                            background: 'rgba(239,68,68,0.15)',
                            border: '1px solid rgba(239,68,68,0.4)',
                            color: '#f87171',
                            borderRadius: '4px',
                            padding: '0.3rem 0.6rem',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Dismiss ✕
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Registration Window Protocol Status Banner */}
              {windowIsOpen ? (
                <div
                  style={{
                    marginTop: '1.25rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    color: '#fbbf24',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                  }}
                >
                  <span style={{ fontSize: '1.1rem' }}>⚠️</span>
                  <div>
                    <strong>Registration Window is Currently Open</strong>
                    <div style={{ color: '#cbd5e1', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                      Student submissions are active (Deadline: {currentDeadline ? new Date(currentDeadline).toLocaleString() : 'Not configured'}). Academic protocol requires the registration window to close before course allocation can execute.
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    marginTop: '1.25rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '8px',
                    background: 'rgba(34, 197, 94, 0.1)',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    color: '#4ade80',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                  }}
                >
                  <span style={{ fontSize: '1.1rem' }}>✓</span>
                  <div>
                    <strong>Registration Window is Closed</strong>
                    <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                      Student preference submissions are frozen and locked. Ready for deterministic course allocation.
                    </div>
                  </div>
                </div>
              )}

              {/* Action Button */}
              <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <button
                    className={styles.primaryBtn}
                    onClick={() => handleRunAllocation(false)}
                    disabled={triggeringRun || allocationRun?.status === 'running' || allocationRun?.status === 'completed'}
                    style={{
                      background: allocationRun?.status === 'completed'
                        ? '#334155'
                        : allocationRun?.status === 'failed'
                        ? '#d97706'
                        : '#059669',
                      cursor: allocationRun?.status === 'completed' ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      opacity: allocationRun?.status === 'completed' ? 0.85 : 1,
                    }}
                  >
                    {triggeringRun || allocationRun?.status === 'running' ? (
                      <>
                        <span className={styles.spinner} />
                        Allocating Courses...
                      </>
                    ) : allocationRun?.status === 'completed' ? (
                      '✓ Allocation Completed (Locked for this semester)'
                    ) : allocationRun?.status === 'failed' ? (
                      'Retry Course Allocation →'
                    ) : (
                      'Run Course Allocation →'
                    )}
                  </button>
                </div>
                {allocationRun?.status === 'completed' && (
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ color: '#10b981', fontSize: '1rem' }}>🔒</span>
                    In production, allocation can only be executed once per semester per academic year. Students can now make direct slot changes for available seats.
                  </p>
                )}
              </div>
            </div>

            {/* Re-Run Warning Confirmation Modal */}
            {showRerunConfirm && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0, 0, 0, 0.8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                  padding: '1rem',
                }}
              >
                <div
                  style={{
                    background: '#0f172a',
                    border: '1px solid #ef4444',
                    borderRadius: '12px',
                    padding: '1.75rem',
                    maxWidth: '480px',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                  }}
                >
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#f87171', margin: 0 }}>
                    ⚠️ Re-Run Allocation Confirmation
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
                    This will reset all elective allocations including any manual HOD placements. Fixed slot assignments are preserved.
                  </p>
                  <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
                    Are you sure you want to proceed with re-running the allocation engine for Semester {allocationSemester}?
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <button
                      className={styles.primaryBtn}
                      onClick={() => setShowRerunConfirm(false)}
                      style={{ background: '#334155' }}
                    >
                      Cancel
                    </button>
                    <button
                      className={styles.primaryBtn}
                      onClick={() => handleRunAllocation(true)}
                      style={{ background: '#dc2626' }}
                    >
                      Yes, Re-Run Allocation →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Registration Window Open Warning Modal */}
            {showWindowOpenWarning && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0, 0, 0, 0.8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1000,
                  padding: '1rem',
                }}
              >
                <div
                  style={{
                    background: '#0f172a',
                    border: '1px solid #f59e0b',
                    borderRadius: '12px',
                    padding: '1.75rem',
                    maxWidth: '500px',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                  }}
                >
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#fbbf24', margin: 0 }}>
                    ⚠️ Registration Window Still Open
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
                    The course registration window is currently <strong>OPEN</strong>. According to academic protocol, student preference submissions must be closed and frozen before executing the course allocation engine.
                  </p>
                  <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
                    Would you like to close the registration window immediately and proceed with running course allocation?
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      className={styles.primaryBtn}
                      onClick={() => setShowWindowOpenWarning(false)}
                      style={{ background: '#334155' }}
                    >
                      Cancel
                    </button>
                    <button
                      className={styles.primaryBtn}
                      onClick={handleCloseAndRunAllocation}
                      style={{ background: '#d97706' }}
                    >
                      Close Window & Run Allocation →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
