'use client'

import LoadingState, { LoadingIndicator } from '@/components/LoadingState'

import { useEffect, useState, useCallback, useRef } from 'react'
import { campusSessionLabel, formatCampusTime, type CampusAttendanceStatus } from '@fyimp/contracts'
import { CheckCircle2, Clock3, Info, MapPin, RefreshCw } from 'lucide-react'
import styles from '@/components/campus-attendance/campus-attendance.module.css'

interface CampusSignInCardProps { studentId?: string; campusName: string }

export default function CampusSignInCard({ studentId, campusName }: CampusSignInCardProps) {
  const [status, setStatus] = useState<CampusAttendanceStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [statusError, setStatusError] = useState('')
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const requestSequence = useRef(0)
  const mounted = useRef(false)

  const fetchStatus = useCallback(async () => {
    if (!studentId || !mounted.current) return null
    const request = ++requestSequence.current
    setLoading(true)
    try {
      const res = await fetch(`/api/attendance/campus/status/${studentId}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Unable to load campus attendance.')
      if (mounted.current && request === requestSequence.current) {
        setStatus(data)
        setStatusError('')
      }
      return data as CampusAttendanceStatus
    } catch (err) {
      if (mounted.current && request === requestSequence.current) {
        setStatus(null)
        setStatusError(err instanceof Error ? err.message : 'Unable to load campus attendance. Please try again.')
      }
      return null
    } finally { if (mounted.current && request === requestSequence.current) setLoading(false) }
  }, [studentId])

  useEffect(() => {
    mounted.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize the live attendance view with the API.
    void fetchStatus()
    const timer = window.setInterval(() => void fetchStatus(), 30000)
    const refresh = () => void fetchStatus()
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => {
      mounted.current = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [fetchStatus])

  async function handleGpsSignIn() {
    setFeedback(null)
    if (!window.isSecureContext || !navigator.geolocation) {
      setFeedback({ type: 'error', message: 'Location access requires HTTPS and a browser that supports geolocation.' })
      return
    }
    if (!navigator.onLine) {
      setFeedback({ type: 'error', message: 'Connect to the internet before signing in. Campus sign-in cannot be saved offline.' })
      return
    }
    setLocating(true)
    try {
      const latest = await fetchStatus()
      if (!latest?.can_sign_in) return
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })
      })
      if (!mounted.current) return
      const { latitude, longitude, accuracy } = pos.coords
      if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 50) {
        throw new Error('Location accuracy must be 50 metres or better. Move to an open area and try again.')
      }
      const res = await fetch('/api/attendance/campus/sign-in', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ latitude, longitude, accuracy, client_timestamp: new Date(pos.timestamp).toISOString() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) throw new Error(typeof data.message === 'string' ? data.message : 'Campus sign-in failed. Refresh your status and try again.')
      setFeedback({ type: 'success', message: data.message || 'Campus sign-in recorded.' })
    } catch (err) {
      const error = err as { code?: number; message?: string }
      const message = error.code === 1 ? 'Allow location access in your browser to sign in.'
        : error.code === 2 ? 'Location is unavailable. Enable device location and try again.'
        : error.code === 3 ? 'Getting your location timed out. Move to an open area and try again.'
        : error.message || 'Campus sign-in failed. Please try again.'
      setFeedback({ type: 'error', message })
    } finally {
      if (mounted.current) {
        await fetchStatus()
        setLocating(false)
      }
    }
  }

  return (
    <section aria-labelledby="campus-signin-title" className={styles.card} aria-busy={loading || locating}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>Campus attendance</span>
          <h2 id="campus-signin-title" className={styles.title}>Campus sign-in</h2>
          <p className={styles.description}>{status?.campus.name || campusName} · Record your morning arrival and evening departure.</p>
          <span className={styles.timeBadge}><Clock3 size={13} aria-hidden="true" /> All times shown in IST</span>
        </div>
        <button type="button" className={styles.secondaryButton} onClick={() => void fetchStatus()} disabled={!studentId || loading || locating}>
          {loading ? <LoadingIndicator message="Refreshing…" /> : <><RefreshCw size={15} aria-hidden="true" /> Refresh status</>}
        </button>
      </div>
      {statusError && <p role="alert" className={`${styles.notice} ${styles.errorNotice}`}>{statusError}</p>}
      {!studentId && <p role="alert" className={`${styles.notice} ${styles.errorNotice}`}>Your student profile is unavailable. Reload the page or contact your administrator.</p>}
      {studentId && !status && !statusError ? <LoadingState layout="cards" rows={2} compact message="Loading campus sign-in status…" /> : <div className={styles.sessionGrid}>
        {(['morning', 'evening'] as const).map(session => {
          const record = status?.[session]
          const completed = record?.state === 'completed'
          const onTime = record?.status === 'on_time'
          return <article key={session} className={`${styles.sessionCard} ${completed ? onTime ? styles.sessionComplete : styles.sessionLate : ''}`}>
            <div className={styles.sessionHeader}>
              <span className={styles.iconBadge}><Clock3 size={17} aria-hidden="true" /></span>
              <h3>{session === 'morning' ? 'Morning arrival' : 'Evening departure'}</h3>
            </div>
            <p aria-live="polite" className={styles.sessionState}>
              {completed && <CheckCircle2 size={15} aria-hidden="true" />}
              {status ? campusSessionLabel(record) : 'Status unavailable'}
            </p>
            {status && <dl className={styles.sessionSchedule}>
              <div><dt>{session === 'morning' ? 'On time until' : 'On time from'}</dt><dd>{formatCampusTime(session === 'morning' ? status.campus.morning_cutoff : status.campus.evening_cutoff)}</dd></div>
              <div><dt>Checkpoint closes</dt><dd>{formatCampusTime(session === 'morning' ? status.campus.midday_split : status.campus.day_end)}</dd></div>
            </dl>}
            {record?.signed_in_at && <p className={styles.recordedAt}>Recorded at {new Date(record.signed_in_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST</p>}
          </article>
        })}
      </div>}
      {status?.unavailable_reason && <p role="status" className={styles.notice}>{status.unavailable_reason}</p>}
      <div className={styles.actionArea}>
        <button type="button" id="btn-campus-gps-signin" className={styles.primaryButton} onClick={() => void handleGpsSignIn()}
          disabled={locating || loading || !studentId || !status?.can_sign_in}>
          {locating ? <LoadingIndicator message="Verifying your location…" /> : <><MapPin size={17} aria-hidden="true" /> Verify location and sign in</>}
        </button>
        {status && <p className={styles.actionHint}>Be within {status.campus.radius_meters} metres of the campus centre. Location accuracy must be 50 metres or better.</p>}
      </div>
      {feedback && <p role={feedback.type === 'error' ? 'alert' : 'status'} className={`${styles.notice} ${feedback.type === 'error' ? styles.errorNotice : styles.successNotice}`}>{feedback.message}</p>}
      <p className={styles.privacyNote}><Info size={14} aria-hidden="true" /><span>Your coordinates are used to verify campus presence and are not saved. The time, result, accuracy and audit details are retained. An internet connection is required.</span></p>
    </section>
  )
}
