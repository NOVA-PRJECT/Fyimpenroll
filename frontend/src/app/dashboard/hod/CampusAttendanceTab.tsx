'use client'

import LoadingState from '@/components/LoadingState'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  MapPin,
  Calendar,
  Search,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  HelpCircle,
} from 'lucide-react'

interface SessionInfo {
  status: 'on_time' | 'late' | 'early_leave' | 'absent' | 'pending'
  signed_in_at: string | null
}

interface StudentAttendanceRow {
  id: string
  full_name: string
  cap_application_number: string | null
  current_semester: number
  morning: SessionInfo
  evening: SessionInfo
  urgency_score: number
}

interface CampusRosterResponse {
  department: {
    id: string
    name: string
    campus_name: string
  }
  date: string
  summary: {
    total_students: number
    morning: {
      on_time: number
      late: number
      absent: number
      pending: number
    }
    evening: {
      on_time: number
      early_leave: number
      absent: number
      pending: number
    }
  }
  roster: StudentAttendanceRow[]
}

export default function CampusAttendanceTab() {
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [data, setData] = useState<CampusRosterResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [semesterFilter, setSemesterFilter] = useState<number | 'all'>('all')
  const [error, setError] = useState('')

  const fetchRoster = useCallback(async (date: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/attendance/campus/roster?date=${date}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.message || 'Failed to fetch campus attendance roster.')
        setLoading(false)
        return
      }
      setData(json)
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : '') || 'Network error fetching campus attendance.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Starts synchronization with the remote API for this mounted view.
    fetchRoster(selectedDate)
  }, [selectedDate, fetchRoster])

  // Filtered Students
  const filteredStudents = useMemo(() => {
    if (!data?.roster) return []
    return data.roster.filter((st) => {
      const matchSem = semesterFilter === 'all' || st.current_semester === semesterFilter
      const q = searchQuery.toLowerCase().trim()
      const matchQuery =
        !q ||
        st.full_name.toLowerCase().includes(q) ||
        (st.cap_application_number && st.cap_application_number.toLowerCase().includes(q))
      return matchSem && matchQuery
    })
  }, [data, semesterFilter, searchQuery])

  // Status Badge Component
  function renderStatusBadge(session: SessionInfo) {
    const timeDisplay = session.signed_in_at
      ? new Date(session.signed_in_at).toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null

    switch (session.status) {
      case 'on_time':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '6px',
              background: "var(--portal-success-bg,#dcfce7)",
              color: "var(--portal-success-text,#15803d)",
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            <CheckCircle2 size={12} />
            On Time {timeDisplay && `(${timeDisplay})`}
          </span>
        )
      case 'late':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '6px',
              background: "var(--portal-warning-bg,#fef3c7)",
              color: "var(--portal-warning-text,#b45309)",
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            <Clock size={12} />
            Late {timeDisplay && `(${timeDisplay})`}
          </span>
        )
      case 'early_leave':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '6px',
              background: "var(--portal-warning-bg,#fef3c7)",
              color: "var(--portal-warning-text,#b45309)",
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            <AlertTriangle size={12} />
            Early Leave {timeDisplay && `(${timeDisplay})`}
          </span>
        )
      case 'pending':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '6px',
              background: "var(--portal-info-bg,#f1f5f9)",
              color: "var(--portal-muted,#64748b)",
              fontSize: '11px',
              fontWeight: 500,
            }}
          >
            <HelpCircle size={12} />
            Pending Check
          </span>
        )
      case 'absent':
      default:
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '6px',
              background: "var(--portal-danger-bg,#fee2e2)",
              color: "var(--portal-danger-text,#b91c1c)",
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            <XCircle size={12} />
            Absent
          </span>
        )
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
      {/* ── Top Header & Campus Info ── */}
      <div
        style={{
          background: "var(--portal-surface,#ffffff)",
          borderRadius: '12px',
          padding: '1.25rem',
          border: "1px solid var(--portal-strong-border,#e2e8f0)",
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h2
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: "var(--portal-brand-text,#002147)",
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <MapPin size={20} color="#c9a227" /> Campus Attendance Monitoring
          </h2>
          <p style={{ fontSize: '0.8rem', color: "var(--portal-muted,#64748b)", margin: '4px 0 0' }}>
            Daily physical presence verification (Morning arrival and Evening departure) across university campus boundaries.
          </p>
        </div>

        {/* Date Selector & Controls */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Calendar size={16} color="#64748b" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: '8px',
                border: "1px solid var(--portal-strong-border,#cbd5e1)",
                fontSize: '13px',
                background: "var(--portal-surface,#fff)",
                outline: 'none',
              }}
            />
          </div>

          <button
            onClick={() => fetchRoster(selectedDate)}
            disabled={loading}
            style={{
              padding: '7px 12px',
              borderRadius: '8px',
              border: "1px solid var(--portal-strong-border,#cbd5e1)",
              background: "var(--portal-surface,#fff)",
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: "var(--portal-info-text,#475569)",
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: "var(--portal-danger-bg,#fee2e2)",
            border: "1px solid var(--portal-danger-border,#f87171)",
            color: "var(--portal-danger-text,#b91c1c)",
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {/* ── Summary Cards Strip ── */}
      {data?.summary && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1rem',
          }}
        >
          {/* Morning Session Card */}
          <div
            style={{
              background: "var(--portal-surface,#ffffff)",
              borderRadius: '12px',
              border: "1px solid var(--portal-strong-border,#e2e8f0)",
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: "var(--portal-brand-text,#002147)" }}>
                MORNING ARRIVAL (Cutoff: 09:30 AM)
              </span>
              <span style={{ fontSize: '11px', color: "var(--portal-muted,#64748b)" }}>Window closes 01:30 PM</span>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <div style={{ flex: 1, background: "var(--portal-success-bg,#f0fdf4)", padding: '6px 8px', borderRadius: '8px', border: "1px solid var(--portal-success-border,#bbf7d0)", textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: "var(--portal-success-text,#166534)", fontWeight: 600 }}>On Time</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: "var(--portal-success-text,#15803d)" }}>{data.summary.morning.on_time}</div>
              </div>
              <div style={{ flex: 1, background: "var(--portal-warning-bg,#fffbeb)", padding: '6px 8px', borderRadius: '8px', border: "1px solid var(--portal-warning-border,#fde68a)", textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: "var(--portal-warning-text,#854d0e)", fontWeight: 600 }}>Late</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: "var(--portal-warning-text,#b45309)" }}>{data.summary.morning.late}</div>
              </div>
              <div style={{ flex: 1, background: "var(--portal-danger-bg,#fef2f2)", padding: '6px 8px', borderRadius: '8px', border: "1px solid var(--portal-danger-border,#fecaca)", textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: "var(--portal-danger-text,#991b1b)", fontWeight: 600 }}>Absent</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: "var(--portal-danger-text,#dc2626)" }}>{data.summary.morning.absent}</div>
              </div>
              <div style={{ flex: 1, background: "var(--portal-info-bg,#f8fafc)", padding: '6px 8px', borderRadius: '8px', border: "1px solid var(--portal-strong-border,#e2e8f0)", textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: "var(--portal-info-text,#475569)", fontWeight: 600 }}>Pending</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: "var(--portal-muted,#64748b)" }}>{data.summary.morning.pending}</div>
              </div>
            </div>
          </div>

          {/* Evening Session Card */}
          <div
            style={{
              background: "var(--portal-surface,#ffffff)",
              borderRadius: '12px',
              border: "1px solid var(--portal-strong-border,#e2e8f0)",
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: "var(--portal-brand-text,#002147)" }}>
                EVENING CHECKPOINT (Cutoff: 03:30 PM)
              </span>
              <span style={{ fontSize: '11px', color: "var(--portal-muted,#64748b)" }}>Day closes 05:00 PM</span>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
              <div style={{ flex: 1, background: "var(--portal-success-bg,#f0fdf4)", padding: '6px 8px', borderRadius: '8px', border: "1px solid var(--portal-success-border,#bbf7d0)", textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: "var(--portal-success-text,#166534)", fontWeight: 600 }}>On Time</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: "var(--portal-success-text,#15803d)" }}>{data.summary.evening.on_time}</div>
              </div>
              <div style={{ flex: 1, background: "var(--portal-warning-bg,#fffbeb)", padding: '6px 8px', borderRadius: '8px', border: "1px solid var(--portal-warning-border,#fde68a)", textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: "var(--portal-warning-text,#854d0e)", fontWeight: 600 }}>Early Leave</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: "var(--portal-warning-text,#b45309)" }}>{data.summary.evening.early_leave}</div>
              </div>
              <div style={{ flex: 1, background: "var(--portal-danger-bg,#fef2f2)", padding: '6px 8px', borderRadius: '8px', border: "1px solid var(--portal-danger-border,#fecaca)", textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: "var(--portal-danger-text,#991b1b)", fontWeight: 600 }}>Absent</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: "var(--portal-danger-text,#dc2626)" }}>{data.summary.evening.absent}</div>
              </div>
              <div style={{ flex: 1, background: "var(--portal-info-bg,#f8fafc)", padding: '6px 8px', borderRadius: '8px', border: "1px solid var(--portal-strong-border,#e2e8f0)", textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: "var(--portal-info-text,#475569)", fontWeight: 600 }}>Pending</div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: "var(--portal-muted,#64748b)" }}>{data.summary.evening.pending}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Filters and Search ── */}
      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '10px' }} />
            <input
              type="text"
              placeholder="Search student or CAP number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: '8px 12px 8px 34px',
                borderRadius: '8px',
                border: "1px solid var(--portal-strong-border,#cbd5e1)",
                fontSize: '13px',
                minWidth: '260px',
                outline: 'none',
              }}
            />
          </div>

          <select
            value={semesterFilter}
            onChange={(e) => setSemesterFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: "1px solid var(--portal-strong-border,#cbd5e1)",
              fontSize: '13px',
              background: "var(--portal-surface,#fff)",
              outline: 'none',
            }}
          >
            <option value="all">All Semesters</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => (
              <option key={s} value={s}>
                Semester {s}
              </option>
            ))}
          </select>
        </div>

        <div style={{ fontSize: '12px', color: "var(--portal-muted,#64748b)" }}>
          Sorted by urgency (absent students surfaced first) • Total: <strong>{filteredStudents.length}</strong>
        </div>
      </div>

      {/* ── Student Roster Table ── */}
      <div
        style={{
          background: "var(--portal-surface,#ffffff)",
          borderRadius: '12px',
          border: "1px solid var(--portal-strong-border,#e2e8f0)",
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <LoadingState layout="table" message="Loading campus attendance roster…" />
        ) : filteredStudents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: "var(--portal-info-text,#94a3b8)", fontSize: '13px' }}>
            No students found for this filter.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: "var(--portal-info-bg,#f8fafc)", borderBottom: "1.5px solid var(--portal-strong-border,#e2e8f0)", textAlign: 'left', color: "var(--portal-info-text,#475569)" }}>
                  <th style={{ padding: '10px 14px', width: '40px' }}>#</th>
                  <th style={{ padding: '10px 14px' }}>Student Name</th>

                  <th style={{ padding: '10px 14px' }}>Sem</th>
                  <th style={{ padding: '10px 14px' }}>Morning Checkpoint</th>
                  <th style={{ padding: '10px 14px' }}>Evening Checkpoint</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.map((st, idx) => (
                  <tr
                    key={st.id}
                    style={{
                      borderBottom: "1px solid var(--portal-strong-border,#f1f5f9)",
                      background:
                        st.morning.status === 'absent' && st.evening.status === 'absent'
                          ? "var(--portal-danger-bg,#fffbfb)"
                          : "var(--portal-surface,#ffffff)",
                    }}
                  >
                    <td style={{ padding: '10px 14px', color: "var(--portal-info-text,#94a3b8)" }}>{idx + 1}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: "var(--portal-brand-text,#0f172a)" }}>
                      {st.full_name}
                    </td>

                    <td style={{ padding: '10px 14px', color: "var(--portal-muted,#64748b)" }}>Sem {st.current_semester}</td>
                    <td style={{ padding: '10px 14px' }}>{renderStatusBadge(st.morning)}</td>
                    <td style={{ padding: '10px 14px' }}>{renderStatusBadge(st.evening)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
