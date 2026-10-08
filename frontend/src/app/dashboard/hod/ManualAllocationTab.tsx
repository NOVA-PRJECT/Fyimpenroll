'use client'

import React, { useState, useEffect } from 'react'
import { CheckCircle, AlertTriangle, UserCheck, BookOpen, RefreshCw } from 'lucide-react'

interface PreferenceChoice {
  rank: number
  course_id: string
  course_code: string
  course_title: string
}

interface UnresolvedSlot {
  slot_key: string
  slot_number: number
  submitted_preferences: PreferenceChoice[]
}

interface UnresolvedStudent {
  registration_id: string
  student_id: string
  full_name: string
  cap_application_number: string
  current_semester: number
  unresolved_slots: UnresolvedSlot[]
}

interface RemainingCourse {
  id: string
  course_code: string
  title: string
  category: string
  credits: number
  seat_limit: number
  total_allocated: number
  remaining_seats: number
}

export default function ManualAllocationTab() {
  const [selectedSemester, setSelectedSemester] = useState<number>(1)
  const [unresolvedStudents, setUnresolvedStudents] = useState<UnresolvedStudent[]>([])
  const [remainingCourses, setRemainingCourses] = useState<RemainingCourse[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState<string>('')

  // Allocation modal state
  const [allocatingTarget, setAllocatingTarget] = useState<{
    student: UnresolvedStudent
    slot: UnresolvedSlot
  } | null>(null)
  const [selectedCourseId, setSelectedCourseId] = useState<string>('')
  const [submitting, setSubmitting] = useState<boolean>(false)

  useEffect(() => {
    fetchData(selectedSemester)
  }, [selectedSemester])

  async function fetchData(semester: number) {
    setLoading(true)
    setError('')
    try {
      const [unresolvedRes, remainingRes] = await Promise.all([
        fetch(`/api/allocation/unresolved?semesterId=${semester}`),
        fetch(`/api/allocation/remaining-seats?semesterId=${semester}`),
      ])

      const unresolvedData = await unresolvedRes.json()
      const remainingData = await remainingRes.json()

      if (!unresolvedRes.ok) {
        throw new Error(unresolvedData.error || 'Failed to fetch unresolved students')
      }
      if (!remainingRes.ok) {
        throw new Error(remainingData.error || 'Failed to fetch course capacities')
      }

      setUnresolvedStudents(unresolvedData.unresolvedStudents || [])
      setRemainingCourses(remainingData.courses || [])
    } catch (err: any) {
      setError(err.message || 'Error loading manual allocation data')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmAllocation() {
    if (!allocatingTarget || !selectedCourseId) return

    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/allocation/manual-allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: allocatingTarget.student.student_id,
          slot_key: allocatingTarget.slot.slot_key,
          course_id: selectedCourseId,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to manually allocate course')
      }

      setSuccess(data.message || 'Course allocated successfully')
      setTimeout(() => setSuccess(''), 4000)
      setAllocatingTarget(null)
      setSelectedCourseId('')
      // Refresh list
      fetchData(selectedSemester)
    } catch (err: any) {
      setError(err.message || 'Failed to allocate course')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%' }}>
      {/* Header controls */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          padding: '1.25rem',
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#002147', margin: 0 }}>
            Reactive Manual Allocation
          </h2>
          <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0.25rem 0 0 0' }}>
            Resolve unplaced elective slots upon student contact with remaining departmental seats.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <label style={{ fontSize: '0.82rem', color: '#475569', fontWeight: 500 }}>Semester:</label>
          <select
            value={selectedSemester}
            onChange={(e) => setSelectedSemester(Number(e.target.value))}
            style={{
              padding: '0.5rem 0.85rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#0f172a',
              fontSize: '0.85rem',
              fontWeight: 500,
            }}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => (
              <option key={s} value={s}>
                Semester {s}
              </option>
            ))}
          </select>

          <button
            onClick={() => fetchData(selectedSemester)}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.5rem 0.85rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#475569',
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: '8px',
            background: '#fee2e2',
            border: '1px solid #f87171',
            color: '#b91c1c',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            padding: '0.85rem 1.25rem',
            borderRadius: '8px',
            background: '#dcfce7',
            border: '1px solid #86efac',
            color: '#15803d',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <CheckCircle size={16} />
          {success}
        </div>
      )}

      {/* Main Grid: Section 1 (Unresolved Students) & Section 2 (Remaining Capacity) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1.2fr)',
          gap: '1.5rem',
        }}
      >
        {/* Section 1: Unresolved Students */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#002147', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={18} color="#d97706" />
              Unresolved Students ({unresolvedStudents.length})
            </h3>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
              Contacted students requiring placement
            </span>
          </div>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
              Loading unresolved students...
            </div>
          ) : unresolvedStudents.length === 0 ? (
            <div
              style={{
                padding: '3rem 1rem',
                textAlign: 'center',
                color: '#64748b',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <CheckCircle size={32} color="#22c55e" />
              <p style={{ margin: 0, fontWeight: 600, color: '#0f172a' }}>
                All student elective slots are fully resolved!
              </p>
              <span style={{ fontSize: '0.78rem' }}>
                No students currently have empty or unresolved elective papers in Semester {selectedSemester}.
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {unresolvedStudents.map((st) => (
                <div
                  key={st.student_id}
                  style={{
                    background: '#f8fafc',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: '0.92rem', color: '#0f172a' }}>
                        {st.full_name}
                      </p>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.75rem', color: '#64748b', fontFamily: 'monospace' }}>
                        CAP: {st.cap_application_number}
                      </p>
                    </div>
                    <span
                      style={{
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        background: '#fef3c7',
                        color: '#b45309',
                        border: '1px solid #fde68a',
                      }}
                    >
                      {st.unresolved_slots.length} Unresolved Slot(s)
                    </span>
                  </div>

                  {/* Slots list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {st.unresolved_slots.map((slot) => (
                      <div
                        key={slot.slot_key}
                        style={{
                          background: '#ffffff',
                          borderRadius: '6px',
                          padding: '0.65rem 0.85rem',
                          border: '1px solid #e2e8f0',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '1rem',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1e40af' }}>
                            Paper {slot.slot_number} ({slot.slot_key})
                          </span>
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Submitted choices:</span>
                            {slot.submitted_preferences.length === 0 ? (
                              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>None</span>
                            ) : (
                              slot.submitted_preferences.map((p) => (
                                <span
                                  key={p.course_id}
                                  style={{
                                    fontSize: '0.7rem',
                                    background: '#f1f5f9',
                                    border: '1px solid #e2e8f0',
                                    padding: '0.1rem 0.35rem',
                                    borderRadius: '4px',
                                    color: '#475569',
                                  }}
                                >
                                  <strong>#{p.rank}</strong> {p.course_code}
                                </span>
                              ))
                            )}
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            setAllocatingTarget({ student: st, slot })
                            setSelectedCourseId('')
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            padding: '0.4rem 0.75rem',
                            borderRadius: '6px',
                            background: '#1e40af',
                            border: 'none',
                            color: '#ffffff',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <UserCheck size={14} />
                          Allocate
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 2: Remaining Department Capacity */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#002147', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <BookOpen size={18} color="#1e40af" />
              Department Course Capacity
            </h3>
          </div>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
              Loading capacities...
            </div>
          ) : remainingCourses.length === 0 ? (
            <p style={{ fontSize: '0.82rem', color: '#64748b', margin: 0 }}>
              No departmental courses configured for Semester {selectedSemester}.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {remainingCourses.map((c) => {
                const isFull = c.remaining_seats <= 0
                return (
                  <div
                    key={c.id}
                    style={{
                      background: '#f8fafc',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      padding: '0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#1e40af' }}>
                          {c.course_code}
                        </span>
                        <p style={{ margin: '0.1rem 0 0 0', fontSize: '0.82rem', fontWeight: 600, color: '#0f172a' }}>
                          {c.title}
                        </p>
                      </div>
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          background: isFull ? '#fee2e2' : '#dcfce7',
                          color: isFull ? '#dc2626' : '#15803d',
                          border: `1px solid ${isFull ? '#fecaca' : '#bbf7d0'}`,
                        }}
                      >
                        {c.remaining_seats} seat{c.remaining_seats === 1 ? '' : 's'} left
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#64748b' }}>
                      <span>
                        Allocated: {c.total_allocated} / {c.seat_limit}
                      </span>
                      <span>
                        {c.category} • {c.credits} cr
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div
                      style={{
                        width: '100%',
                        height: '5px',
                        borderRadius: '999px',
                        background: '#e2e8f0',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, Math.round((c.total_allocated / (c.seat_limit || 1)) * 100))}%`,
                          height: '100%',
                          background: isFull ? '#ef4444' : '#1e40af',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Allocation Action Modal */}
      {allocatingTarget && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '1.5rem',
              maxWidth: '520px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
            }}
          >
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#002147', margin: 0 }}>
                Manual Course Placement
              </h3>
              <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.25rem 0 0 0' }}>
                Assign an available departmental course to resolve this student&apos;s paper slot.
              </p>
            </div>

            <div
              style={{
                background: '#f8fafc',
                padding: '0.85rem',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
                fontSize: '0.82rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Student:</span>
                <strong style={{ color: '#0f172a' }}>{allocatingTarget.student.full_name}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>CAP Register:</span>
                <span style={{ fontFamily: 'monospace', color: '#0f172a' }}>
                  {allocatingTarget.student.cap_application_number}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Target Paper:</span>
                <strong style={{ color: '#1e40af' }}>
                  Paper {allocatingTarget.slot.slot_number} ({allocatingTarget.slot.slot_key})
                </strong>
              </div>
            </div>

            {/* Course Selector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569' }}>
                Select Course with Remaining Seats:
              </label>
              <select
                value={selectedCourseId}
                onChange={(e) => setSelectedCourseId(e.target.value)}
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#0f172a',
                  fontSize: '0.85rem',
                }}
              >
                <option value="">— Select an available course —</option>
                {remainingCourses
                  .filter((c) => c.remaining_seats > 0)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.course_code} — {c.title} ({c.remaining_seats} seats remaining)
                    </option>
                  ))}
              </select>
            </div>

            {error && (
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: '6px',
                  background: '#fee2e2',
                  border: '1px solid #f87171',
                  color: '#b91c1c',
                  fontSize: '0.8rem',
                }}
              >
                {error}
              </div>
            )}

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setAllocatingTarget(null)}
                disabled={submitting}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  color: '#475569',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAllocation}
                disabled={submitting || !selectedCourseId}
                style={{
                  padding: '0.5rem 1.25rem',
                  borderRadius: '8px',
                  background: '#1e40af',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: submitting || !selectedCourseId ? 'not-allowed' : 'pointer',
                  opacity: submitting || !selectedCourseId ? 0.6 : 1,
                }}
              >
                {submitting ? 'Allocating...' : 'Confirm Allocation →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
