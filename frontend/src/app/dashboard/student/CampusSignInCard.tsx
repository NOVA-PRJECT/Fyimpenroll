'use client'

import { useEffect, useState, useCallback } from 'react'

interface CampusStatusResponse {
  student_id: string
  student_name: string
  campus_name: string
  date: string
  active_session: 'morning' | 'evening' | 'closed'
  morning: {
    status: 'present' | 'absent' | 'pending'
    signed_in_at: string | null
    time_window: string
  }
  evening: {
    status: 'present' | 'absent' | 'pending'
    signed_in_at: string | null
    time_window: string
  }
}

interface CampusSignInCardProps {
  studentId?: string
  campusName: string
}

export default function CampusSignInCard({ studentId, campusName }: CampusSignInCardProps) {
  const [status, setStatus] = useState<CampusStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)

  const fetchStatus = useCallback(async () => {
    if (!studentId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/attendance/campus/status/${studentId}`)
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
      }
    } catch {
      // Non-blocking
    } finally {
      setLoading(false)
    }
  }, [studentId])

  useEffect(() => {

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Starts synchronization with the remote API for this mounted view.
    fetchStatus()
  }, [fetchStatus])

  async function handleGpsSignIn() {
    setFeedback(null)

    if (!navigator.geolocation) {
      setFeedback({
        type: 'error',
        message: 'Geolocation is not supported by your browser.',
      })
      return
    }

    setLocating(true)

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude, accuracy } = pos.coords
          const res = await fetch('/api/attendance/campus/sign-in', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude, longitude, accuracy }),
          })

          const data = await res.json().catch(() => ({}))

          if (res.ok && data.success) {
            setFeedback({
              type: 'success',
              message: `✓ Signed in successfully for ${data.session_type.toUpperCase()} session at ${data.campus_name || campusName}! (Distance: ${Math.round(data.distance_meters)}m from campus center).`,
            })
            await fetchStatus()
          } else {
            setFeedback({
              type: 'error',
              message: data.message || 'GPS check-in failed. Please verify you are within the campus boundary.',
            })
          }
        } catch (err: unknown) {
          setFeedback({
            type: 'error',
            message: (err instanceof Error ? err.message : '') || 'Network error while recording campus check-in.',
          })
        } finally {
          setLocating(false)
        }
      },
      (err) => {
        setLocating(false)
        let msg = 'Unable to retrieve your location.'
        if (err.code === err.PERMISSION_DENIED) {
          msg = 'Location permission denied. Please allow location access in your browser to sign in.'
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = 'GPS signal unavailable. Please ensure your device location is enabled.'
        } else if (err.code === err.TIMEOUT) {
          msg = 'GPS acquisition timed out. Please try again.'
        }
        setFeedback({ type: 'error', message: msg })
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    )
  }

  return (
    <div style={{
      background: '#ffffff',
      border: '1px solid #e2e8f0',
      borderRadius: '1rem',
      padding: '1.25rem',
      boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.05)',
      marginBottom: '1.5rem',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Header Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '1.25rem' }}>📍</span>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
              Campus Physical Sign-In (GPS Geofence)
            </h3>
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
            Official twice-daily physical presence verification at <strong>{campusName}</strong>
          </p>
        </div>

        <button
          onClick={fetchStatus}
          disabled={loading}
          style={{
            background: '#f1f5f9',
            border: '1px solid #cbd5e1',
            borderRadius: '0.375rem',
            padding: '0.25rem 0.6rem',
            fontSize: '0.72rem',
            fontWeight: 600,
            color: '#475569',
            cursor: 'pointer',
          }}
        >
          {loading ? 'Refreshing...' : '↻ Refresh Status'}
        </button>
      </div>

      {/* Session Status Pills */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        {/* Morning Session */}
        <div style={{
          background: status?.morning?.status === 'present' ? '#f0fdf4' : '#f8fafc',
          border: `1px solid ${status?.morning?.status === 'present' ? '#86efac' : '#e2e8f0'}`,
          borderRadius: '0.625rem',
          padding: '0.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>
              🌅 Morning Session
            </span>
            <span style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              padding: '0.15rem 0.45rem',
              borderRadius: '9999px',
              background: status?.morning?.status === 'present' ? '#22c55e' : '#94a3b8',
              color: '#ffffff',
            }}>
              {status?.morning?.status === 'present' ? '✓ Present' : 'Pending'}
            </span>
          </div>
          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
            {status?.morning?.time_window ? `Window: ${status.morning.time_window}` : 'Before midday split'}
          </span>
          {status?.morning?.signed_in_at && (
            <span style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 600 }}>
              Logged at: {new Date(status.morning.signed_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {/* Evening Session */}
        <div style={{
          background: status?.evening?.status === 'present' ? '#f0fdf4' : '#f8fafc',
          border: `1px solid ${status?.evening?.status === 'present' ? '#86efac' : '#e2e8f0'}`,
          borderRadius: '0.625rem',
          padding: '0.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>
              🌆 Evening Session
            </span>
            <span style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              padding: '0.15rem 0.45rem',
              borderRadius: '9999px',
              background: status?.evening?.status === 'present' ? '#22c55e' : '#94a3b8',
              color: '#ffffff',
            }}>
              {status?.evening?.status === 'present' ? '✓ Present' : 'Pending'}
            </span>
          </div>
          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
            {status?.evening?.time_window ? `Window: ${status.evening.time_window}` : 'Midday to day end'}
          </span>
          {status?.evening?.signed_in_at && (
            <span style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 600 }}>
              Logged at: {new Date(status.evening.signed_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {/* Action Button & GPS Prompt */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <button
          onClick={handleGpsSignIn}
          disabled={locating}
          id="btn-campus-gps-signin"
          style={{
            background: locating
              ? '#94a3b8'
              : 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '0.5rem',
            padding: '0.75rem 1.25rem',
            fontSize: '0.9rem',
            fontWeight: 700,
            cursor: locating ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            boxShadow: '0 2px 6px rgba(2, 132, 199, 0.3)',
            transition: 'all 0.15s ease',
          }}
        >
          {locating ? (
            <>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span>
              Acquiring GPS Coordinates & Verifying Campus Geofence...
            </>
          ) : (
            <>
              <span>📍</span>
              Verify Campus Presence (GPS Sign-In)
            </>
          )}
        </button>

        {/* Feedback Messages */}
        {feedback && (
          <div style={{
            padding: '0.75rem 1rem',
            borderRadius: '0.5rem',
            fontSize: '0.82rem',
            lineHeight: 1.4,
            fontWeight: 600,
            background: feedback.type === 'success' ? '#ecfdf5' : '#fef2f2',
            color: feedback.type === 'success' ? '#065f46' : '#991b1b',
            border: `1px solid ${feedback.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
          }}>
            {feedback.message}
          </div>
        )}

        <p style={{ margin: 0, fontSize: '0.72rem', color: '#94a3b8', textAlign: 'center' }}>
          🔒 Privacy Notice: Raw GPS coordinates are strictly used in real-time to compute distance to campus and are discarded immediately. Only the binary verification result is saved.
        </p>
      </div>
    </div>
  )
}
