'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { campusSessionLabel, formatCampusTime, type CampusAttendanceStatus } from '@fyimp/contracts'

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
    <section aria-label="Campus sign-in" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '1rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>Campus Physical Sign-In</h3>
          <p style={{ color: '#64748b', fontSize: '.85rem' }}>{status?.campus.name || campusName} · Twice-daily GPS check</p>
        </div>
        <button type="button" onClick={() => void fetchStatus()} disabled={loading || locating}>Refresh status</button>
      </div>
      {statusError && <p role="alert" style={{ color: '#991b1b' }}>{statusError}</p>}
      {!studentId && <p role="alert">Your student profile is unavailable. Reload the page or contact your administrator.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.75rem', margin: '1rem 0' }}>
        {(['morning', 'evening'] as const).map(session => {
          const record = status?.[session]
          const completed = record?.state === 'completed'
          const onTime = record?.status === 'on_time'
          return <div key={session} style={{ padding: '.9rem', borderRadius: '.625rem', border: '1px solid #e2e8f0', background: completed ? onTime ? '#f0fdf4' : '#fffbeb' : '#f8fafc' }}>
            <strong>{session === 'morning' ? 'Morning arrival' : 'Evening departure'}</strong>
            <p aria-live="polite">{loading && !status ? 'Loading…' : campusSessionLabel(record)}</p>
            {status && <p style={{ fontSize: '.8rem', color: '#64748b' }}>
              {session === 'morning'
                ? `On time until ${formatCampusTime(status.campus.morning_cutoff)}; closes at ${formatCampusTime(status.campus.midday_split)} IST`
                : `On time from ${formatCampusTime(status.campus.evening_cutoff)}; closes at ${formatCampusTime(status.campus.day_end)} IST`}
            </p>}
            {record?.signed_in_at && <small>Recorded at {new Date(record.signed_in_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST</small>}
          </div>
        })}
      </div>
      {status?.unavailable_reason && <p role="status">{status.unavailable_reason}</p>}
      <button type="button" id="btn-campus-gps-signin" onClick={() => void handleGpsSignIn()}
        disabled={locating || loading || !studentId || !status?.can_sign_in}
        style={{ background: !status?.can_sign_in || locating || loading ? '#64748b' : '#0369a1', color: '#fff', border: 0, borderRadius: '.5rem', padding: '.8rem 1.25rem' }}>
        {locating ? 'Checking location and recording…' : 'Verify Campus Presence (GPS Sign-In)'}
      </button>
      {feedback && <p role={feedback.type === 'error' ? 'alert' : 'status'} style={{ color: feedback.type === 'error' ? '#991b1b' : '#065f46' }}>{feedback.message}</p>}
      {status && <p style={{ fontSize: '.8rem', color: '#64748b' }}>Sign in within {status.campus.radius_meters} metres of the campus centre, with location accuracy of 50 metres or better.</p>}
      <p style={{ fontSize: '.75rem', color: '#64748b' }}>Location coordinates are used for this check and are not saved. We retain the time, result, location accuracy and audit details. An internet connection is required.</p>
    </section>
  )
}
