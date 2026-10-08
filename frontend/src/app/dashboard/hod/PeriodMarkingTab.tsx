'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Clock,
  Search,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RefreshCw,
  FileSpreadsheet,
  Calendar,
} from 'lucide-react'

interface DepartmentSlot {
  id: string
  course_id: string
  course_code: string
  course_title: string
  semester: number
  session_type: string
  is_lab_block: boolean
  day_of_week: number
  period_number: number
  start_time: string
  end_time: string
  attendance_date?: string
  is_marked: boolean
  present_count: number
  absent_count: number
}

interface StudentRosterItem {
  id: string
  full_name: string
  cap_application_number: string | null
  current_semester: number
  status: 'present' | 'absent' | 'unmarked'
  marked_at: string | null
}

interface SlotRosterResponse {
  slot: {
    id: string
    course_id: string
    course_code: string
    course_title: string
    period_number: number
    start_time: string
    end_time: string
  }
  attendance_date: string
  summary: {
    total_enrolled: number
    present_count: number
    absent_count: number
    unmarked_count: number
    is_marked: boolean
  }
  students: StudentRosterItem[]
}

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function getTodayIST(): string {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const istDate = new Date(now.getTime() + istOffset)
  const y = istDate.getUTCFullYear()
  const m = String(istDate.getUTCMonth() + 1).padStart(2, '0')
  const d = String(istDate.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export default function PeriodMarkingTab() {
  const [slots, setSlots] = useState<DepartmentSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)

  // Filters
  const [semesterFilter, setSemesterFilter] = useState<number | 'all'>('all')
  const [dayFilter, setDayFilter] = useState<number | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [attendanceDate, setAttendanceDate] = useState<string>(getTodayIST())

  // Roster view state
  const [rosterData, setRosterData] = useState<SlotRosterResponse | null>(null)
  const [loadingRoster, setLoadingRoster] = useState(false)
  const [studentSearch, setStudentSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'present' | 'absent' | 'unmarked'>('all')

  // Export State
  const [exporting, setExporting] = useState(false)

  // Banners
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // ── Fetch Slots (F46: Scoped to attendanceDate) ──
  const fetchSlots = useCallback(async () => {
    setLoadingSlots(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (semesterFilter !== 'all') params.append('semester', String(semesterFilter))
      if (dayFilter !== 'all') params.append('dayOfWeek', String(dayFilter))
      if (attendanceDate) params.append('date', attendanceDate)

      const res = await fetch(`/api/attendance/period/slots?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || 'Failed to fetch department timetable slots.')
        return
      }
      setSlots(data || [])
      // If selected slot is no longer in list, deselect
      if (selectedSlotId && !(data || []).some((s: DepartmentSlot) => s.id === selectedSlotId)) {
        setSelectedSlotId(null)
        setRosterData(null)
      }
    } catch (err: any) {
      setError(err.message || 'Network error while fetching slots.')
    } finally {
      setLoadingSlots(false)
    }
  }, [semesterFilter, dayFilter, attendanceDate, selectedSlotId])

  useEffect(() => {
    fetchSlots()
  }, [fetchSlots])

  // ── Fetch Roster for Selected Slot (F46) ──
  const fetchRoster = useCallback(async (slotId: string) => {
    setLoadingRoster(true)
    setError('')
    try {
      const res = await fetch(`/api/attendance/period/roster?slotId=${slotId}&date=${attendanceDate}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || 'Failed to fetch student attendance roster.')
        return
      }
      setRosterData(data)
    } catch (err: any) {
      setError(err.message || 'Network error while fetching roster.')
    } finally {
      setLoadingRoster(false)
    }
  }, [attendanceDate])

  useEffect(() => {
    if (selectedSlotId) {
      fetchRoster(selectedSlotId)
    } else {
      setRosterData(null)
    }
  }, [selectedSlotId, fetchRoster])

  // ── Export Statement ──
  async function handleExportStatement() {
    setExporting(true)
    setError('')
    try {
      const sem = semesterFilter === 'all' ? 1 : semesterFilter
      const res = await fetch(`/api/attendance/period/export/statement?semesterId=${sem}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.message || 'Failed to export attendance statement.')
        return
      }
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Attendance_Statement_Sem_${sem}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      setSuccess('Attendance statement downloaded successfully!')
      setTimeout(() => setSuccess(''), 4000)
    } catch (err: any) {
      setError(err.message || 'Network error during statement export.')
    } finally {
      setExporting(false)
    }
  }

  // Filtered slots list
  const filteredSlots = useMemo(() => {
    return slots.filter((s) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matches =
          s.course_code.toLowerCase().includes(q) ||
          s.course_title.toLowerCase().includes(q) ||
          `period ${s.period_number}`.includes(q)
        if (!matches) return false
      }
      return true
    })
  }, [slots, searchQuery])

  // Filtered students list in roster
  const filteredStudents = useMemo(() => {
    if (!rosterData) return []
    return rosterData.students.filter((st) => {
      if (statusFilter !== 'all' && st.status !== statusFilter) return false
      if (studentSearch.trim()) {
        const q = studentSearch.toLowerCase()
        const matches =
          st.full_name.toLowerCase().includes(q) ||
          (st.cap_application_number && st.cap_application_number.toLowerCase().includes(q))
        if (!matches) return false
      }
      return true
    })
  }, [rosterData, statusFilter, studentSearch])

  const activeSlot = slots.find((s) => s.id === selectedSlotId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
      {/* ── Top Header & Stats ── */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          padding: '1.25rem',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#002147', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={20} color="#c9a227" /> Period Attendance Monitoring
          </h2>
          <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '4px 0 0' }}>
            Monitor real-time lecture period attendance and track dated student rosters for your department.
          </p>
        </div>

        {/* Actions & Global Stats */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={handleExportStatement}
            disabled={exporting}
            style={{
              padding: '7px 14px',
              borderRadius: '8px',
              background: '#059669',
              color: '#ffffff',
              border: 'none',
              fontWeight: 600,
              fontSize: '12px',
              cursor: exporting ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            }}
            title="Export official department APC statement as styled XLSX"
          >
            <FileSpreadsheet size={15} />
            {exporting ? 'Generating Statement...' : `Export Sem ${semesterFilter === 'all' ? 1 : semesterFilter} Statement (XLSX)`}
          </button>

          <div style={{ padding: '6px 14px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: '12px' }}>
            <span style={{ color: '#64748b' }}>Total Slots: </span>
            <strong style={{ color: '#0f172a' }}>{slots.length}</strong>
          </div>
          <div style={{ padding: '6px 14px', borderRadius: '8px', background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: '12px' }}>
            <span style={{ color: '#15803d' }}>Marked: </span>
            <strong style={{ color: '#166534' }}>{slots.filter((s) => s.is_marked).length}</strong>
          </div>
          <div style={{ padding: '6px 14px', borderRadius: '8px', background: '#fffbeb', border: '1px solid #fde68a', fontSize: '12px' }}>
            <span style={{ color: '#b45309' }}>Pending: </span>
            <strong style={{ color: '#92400e' }}>{slots.filter((s) => !s.is_marked).length}</strong>
          </div>
        </div>
      </div>

      {/* ── Banners ── */}
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#fee2e2', border: '1px solid #f87171', color: '#b91c1c', fontSize: '13px' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#dcfce7', border: '1px solid #86efac', color: '#15803d', fontSize: '13px' }}>
          {success}
        </div>
      )}

      {/* ── Two-Column Layout: Slots List (Left) + Roster View (Right) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.25rem', alignItems: 'start' }}>
        {/* LEFT COLUMN: Timetable Slots Filter & List */}
        <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#002147', margin: 0 }}>Timetable Lecture Slots</h3>
            <button
              onClick={fetchSlots}
              disabled={loadingSlots}
              style={{
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: '#fff',
                cursor: 'pointer',
                fontSize: '11px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: '#475569',
              }}
            >
              <RefreshCw size={12} className={loadingSlots ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>

          {/* Filters: Date Picker, Semester, Day */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: '140px' }}>
              <Calendar size={14} color="#64748b" />
              <input
                type="date"
                value={attendanceDate}
                onChange={(e) => setAttendanceDate(e.target.value)}
                style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px', background: '#fff', width: '100%' }}
                title="Select academic date to inspect attendance marks"
              />
            </div>

            <select
              value={semesterFilter}
              onChange={(e) => setSemesterFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px', background: '#fff', flex: 1 }}
            >
              <option value="all">All Semesters</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => (
                <option key={s} value={s}>
                  Sem {s}
                </option>
              ))}
            </select>

            <select
              value={dayFilter}
              onChange={(e) => setDayFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px', background: '#fff', flex: 1 }}
            >
              <option value="all">All Days</option>
              {[1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {DAY_NAMES[d]}
                </option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div style={{ position: 'relative' }}>
            <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '9px' }} />
            <input
              type="text"
              placeholder="Search course code, title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px 6px 30px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Slots List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '560px', overflowY: 'auto' }}>
            {loadingSlots ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '13px' }}>Loading slots...</div>
            ) : filteredSlots.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '13px' }}>No timetable slots found.</div>
            ) : (
              filteredSlots.map((slot) => {
                const isSelected = slot.id === selectedSlotId
                return (
                  <div
                    key={slot.id}
                    onClick={() => setSelectedSlotId(slot.id)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: isSelected ? '2px solid #0284c7' : '1px solid #e2e8f0',
                      background: isSelected ? '#f0f9ff' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#002147' }}>
                        {slot.course_code} • P{slot.period_number}
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        {DAY_NAMES[slot.day_of_week]} {slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}
                      </span>
                    </div>

                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b' }}>{slot.course_title}</div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {slot.is_marked ? (
                          <span style={{ fontSize: '10px', background: '#dcfce7', color: '#15803d', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                            ✓ Marked ({slot.present_count} Pres, {slot.absent_count} Abs)
                          </span>
                        ) : (
                          <span style={{ fontSize: '10px', background: '#fef3c7', color: '#b45309', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                            ⏳ Pending / Unmarked
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Selected Slot Attendance Roster */}
        <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {activeSlot ? (
            <>
              {/* Header Info of Selected Slot */}
              <div style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: 700, background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '4px' }}>
                      {activeSlot.course_code} • Period {activeSlot.period_number}
                    </span>
                    <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#002147', margin: '6px 0 2px' }}>
                      {activeSlot.course_title}
                    </h3>
                    <p style={{ fontSize: '11px', color: '#64748b', margin: 0 }}>
                      {DAY_NAMES[activeSlot.day_of_week]} • {activeSlot.start_time?.slice(0, 5)} - {activeSlot.end_time?.slice(0, 5)} • Sem {activeSlot.semester} • Date: {attendanceDate}
                    </p>
                  </div>
                </div>

                {/* Status and Statistics Strip */}
                {rosterData?.summary && (
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ background: '#f8fafc', padding: '6px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '11px' }}>
                      <span style={{ color: '#64748b' }}>Enrolled: </span>
                      <strong>{rosterData.summary.total_enrolled}</strong>
                    </div>
                    <div style={{ background: '#f0fdf4', padding: '6px 12px', borderRadius: '6px', border: '1px solid #bbf7d0', fontSize: '11px' }}>
                      <span style={{ color: '#15803d' }}>Present: </span>
                      <strong style={{ color: '#166534' }}>{rosterData.summary.present_count}</strong>
                    </div>
                    <div style={{ background: '#fef2f2', padding: '6px 12px', borderRadius: '6px', border: '1px solid #fecaca', fontSize: '11px' }}>
                      <span style={{ color: '#b91c1c' }}>Absent: </span>
                      <strong style={{ color: '#991b1b' }}>{rosterData.summary.absent_count}</strong>
                    </div>
                    <div style={{ background: '#fefce8', padding: '6px 12px', borderRadius: '6px', border: '1px solid #fef08a', fontSize: '11px' }}>
                      <span style={{ color: '#a16207' }}>Unmarked: </span>
                      <strong style={{ color: '#854d0e' }}>{rosterData.summary.unmarked_count}</strong>
                    </div>
                  </div>
                )}
              </div>

              {/* Roster Controls: Search & Status Filter */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px', top: '9px' }} />
                  <input
                    type="text"
                    placeholder="Search enrolled students..."
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '6px 10px 6px 30px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '12px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '12px', background: '#fff' }}
                >
                  <option value="all">All Statuses</option>
                  <option value="present">Present Only</option>
                  <option value="absent">Absent Only</option>
                  <option value="unmarked">Unmarked Only</option>
                </select>
              </div>

              {/* Students Table */}
              <div style={{ maxHeight: '480px', overflowY: 'auto' }}>
                {loadingRoster ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '13px' }}>Loading student roster...</div>
                ) : filteredStudents.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '13px' }}>No students found matching filter.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                        <th style={{ padding: '8px', color: '#475569' }}>#</th>
                        <th style={{ padding: '8px', color: '#475569' }}>Student Name</th>
                        <th style={{ padding: '8px', color: '#475569' }}>CAP / ID</th>
                        <th style={{ padding: '8px', color: '#475569' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStudents.map((st, idx) => (
                        <tr key={st.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px', color: '#64748b' }}>{idx + 1}</td>
                          <td style={{ padding: '8px', fontWeight: 600, color: '#1e293b' }}>{st.full_name}</td>
                          <td style={{ padding: '8px', color: '#64748b' }}>{st.cap_application_number || '—'}</td>
                          <td style={{ padding: '8px' }}>
                            {st.status === 'present' ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#15803d', fontWeight: 600 }}>
                                <CheckCircle2 size={13} /> Present
                              </span>
                            ) : st.status === 'absent' ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#b91c1c', fontWeight: 600 }}>
                                <XCircle size={13} /> Absent
                              </span>
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#94a3b8', fontWeight: 500 }}>
                                <HelpCircle size={13} /> Unmarked
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#94a3b8', fontSize: '13px' }}>
              <Clock size={32} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
              <div>Select a timetable slot from the left to inspect student attendance for {attendanceDate}.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
