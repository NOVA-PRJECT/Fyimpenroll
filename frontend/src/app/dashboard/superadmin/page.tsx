'use client'

import { useDashboardEntryFetch } from '@/core/security/useDashboardEntryFetch'

import { logoutPortal } from '@/core/security/logout'

import { useState, useEffect, useEffectEvent } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import styles from './superadmin-dashboard.module.css'
import { useBfcacheGuard } from '@/core/hooks/useBfcacheGuard'

type Tab = 'campuses' | 'departments' | 'faculty' | 'logs'

interface SystemLog {
  id: string
  log_type: string
  event_type: string
  user_id?: string
  campus_id?: string
  status: string
  action?: string
  error_message?: string
  metadata?: Record<string, unknown>
  created_at: string
}

interface Campus {
  id: string
  name: string
  code: string
}

interface Department {
  id: string
  name: string
  code: string
  campus_id: string
  campuses?: { name: string } | null
}

interface Faculty {
  id: string
  full_name: string
  email: string
  role: string
  campus_id: string
  departments: { name: string } | null
  campuses: { name: string }
}

export default function SuperAdminDashboard() {
  const entryFetch = useDashboardEntryFetch()
  useBfcacheGuard()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('campuses')
  const [adminName, setAdminName] = useState('')
  const [loadingAdmin, setLoadingAdmin] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Campuses state
  const [campuses, setCampuses] = useState<Campus[]>([])
  const [loadingCampuses, setLoadingCampuses] = useState(false)
  const [showAddCampus, setShowAddCampus] = useState(false)
  const [editCampus, setEditCampus] = useState<Campus | null>(null)
  const [deleteCampus, setDeleteCampus] = useState<Campus | null>(null)
  const [campusName, setCampusName] = useState('')
  const [campusCode, setCampusCode] = useState('')
  const [savingCampus, setSavingCampus] = useState(false)
  const [deletingCampus, setDeletingCampus] = useState(false)

  // Departments state
  const [departments, setDepartments] = useState<Department[]>([])
  const [deptSearch, setDeptSearch] = useState('')
  const [loadingDepts, setLoadingDepts] = useState(false)
  const [showAddDept, setShowAddDept] = useState(false)
  const [editDept, setEditDept] = useState<Department | null>(null)
  const [deleteDept, setDeleteDept] = useState<Department | null>(null)
  const [deptName, setDeptName] = useState('')
  const [deptCode, setDeptCode] = useState('')
  const [deptCampusId, setDeptCampusId] = useState('')
  const [savingDept, setSavingDept] = useState(false)
  const [deletingDept, setDeletingDept] = useState(false)

  // Faculty state
  const [faculty, setFaculty] = useState<Faculty[]>([])
  const [loadingFaculty, setLoadingFaculty] = useState(false)
  const [showAddFaculty, setShowAddFaculty] = useState(false)
  const [editFaculty, setEditFaculty] = useState<Faculty | null>(null)   // ← NEW
  const [deleteFaculty, setDeleteFaculty] = useState<Faculty | null>(null)
  const [facultyName, setFacultyName] = useState('')
  const [facultyEmail, setFacultyEmail] = useState('')
  const [facultyPassword, setFacultyPassword] = useState('')
  const [showFacultyPassword, setShowFacultyPassword] = useState(false)
  const [facultyRole, setFacultyRole] = useState<'hod' | 'campus_director' | 'teaching_staff'>('hod')
  const [facultyDeptId, setFacultyDeptId] = useState('')
  const [facultyCampusId, setFacultyCampusId] = useState('')
  const [savingFaculty, setSavingFaculty] = useState(false)
  const [deletingFaculty, setDeletingFaculty] = useState(false)

  // Edit faculty form state (separate from add form)  ← NEW
  const [editFacultyName, setEditFacultyName] = useState('')
  const [editFacultyRole, setEditFacultyRole] = useState<'hod' | 'campus_director' | 'teaching_staff'>('hod')
  const [editFacultyDeptId, setEditFacultyDeptId] = useState('')
  const [editFacultyCampusId, setEditFacultyCampusId] = useState('')
  const [updatingFaculty, setUpdatingFaculty] = useState(false)          // ← NEW
  const [loggingOut, setLoggingOut] = useState(false)

  // ── Logs state ──
  const [logs, setLogs] = useState<SystemLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [logTypeFilter, setLogTypeFilter] = useState('all')
  const [logStatusFilter, setLogStatusFilter] = useState('all')
  const [logSearch, setLogSearch] = useState('')
  const [selectedLog, setSelectedLog] = useState<SystemLog | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const tabParam = params.get('tab')
      if (tabParam === 'logs' || tabParam === 'campuses' || tabParam === 'departments' || tabParam === 'faculty') {

        // eslint-disable-next-line react-hooks/set-state-in-effect -- Restores browser view state after hydration or resets a changed cohort.
        setActiveTab(tabParam as Tab)
      }
    }
  }, [])

  useEffect(() => {
    async function loadAdmin() {
      const response = await entryFetch('/api/auth/profile')
      const data = await response.json()
      if (!response.ok) { router.push('/login'); return }
      if (data.profile) setAdminName(data.profile.full_name)
      setLoadingAdmin(false)
    }
    loadAdmin()
  }, [router, entryFetch])

  const loadActiveTab = useEffectEvent(() => {
    if (activeTab === 'campuses') fetchCampuses()
    else if (activeTab === 'departments') { fetchDepartments(); fetchCampuses() }
    else if (activeTab === 'faculty') { fetchFaculty(); fetchCampuses(); fetchDepartments() }
    else if (activeTab === 'logs') { fetchLogs() }
  })
  useEffect(() => { loadActiveTab() }, [activeTab, logTypeFilter, logStatusFilter])

  function clearMessages() { setError(''); setSuccess('') }

  // ── Logs Functions ──
  async function fetchLogs() {
    setLoadingLogs(true)
    const params = new URLSearchParams()
    if (logTypeFilter !== 'all') params.append('log_type', logTypeFilter)
    if (logStatusFilter !== 'all') params.append('status', logStatusFilter)
    if (logSearch.trim()) params.append('search', logSearch.trim())
    try {
      const res = await fetch(`/api/admin/logs?${params.toString()}`)
      const data = await res.json()
      if (res.ok) setLogs(data.logs || [])
    } catch {
      setError('Failed to fetch system logs')
    } finally {
      setLoadingLogs(false)
    }
  }

  // ── Campus Functions ──
  async function fetchCampuses() {
    setLoadingCampuses(true)
    const res = await fetch('/api/admin/campuses')
    const data = await res.json()
    if (res.ok) setCampuses(data)
    setLoadingCampuses(false)
  }

  async function handleSaveCampus() {
    if (!campusName || !campusCode) { setError('Name and code are required'); return }
    setSavingCampus(true)
    clearMessages()
    const isEdit = !!editCampus
    const res = await fetch('/api/admin/campuses', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isEdit
        ? { id: editCampus.id, name: campusName, code: campusCode }
        : { name: campusName, code: campusCode }
      ),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to save campus') }
    else {
      setSuccess(data.message)
      setShowAddCampus(false)
      setEditCampus(null)
      setCampusName(''); setCampusCode('')
      fetchCampuses()
    }
    setSavingCampus(false)
  }

  async function handleDeleteCampus() {
    if (!deleteCampus) return
    setDeletingCampus(true)
    const res = await fetch('/api/admin/campuses', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campus_id: deleteCampus.id }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to delete campus') }
    else { setSuccess(data.message); setDeleteCampus(null); fetchCampuses() }
    setDeletingCampus(false)
  }

  // ── Department Functions ──
  async function fetchDepartments() {
    setLoadingDepts(true)
    const res = await fetch('/api/admin/departments')
    const data = await res.json()
    if (res.ok) setDepartments(data)
    setLoadingDepts(false)
  }

  async function handleSaveDept() {
    if (!deptName || !deptCode || !deptCampusId) { setError('All fields are required'); return }
    setSavingDept(true)
    clearMessages()
    const isEdit = !!editDept
    const res = await fetch('/api/admin/departments', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isEdit
        ? { id: editDept.id, name: deptName, code: deptCode }
        : { name: deptName, code: deptCode, campus_id: deptCampusId }
      ),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to save department') }
    else {
      setSuccess(data.message)
      setShowAddDept(false)
      setEditDept(null)
      setDeptName(''); setDeptCode(''); setDeptCampusId('')
      fetchDepartments()
    }
    setSavingDept(false)
  }

  async function handleDeleteDept() {
    if (!deleteDept) return
    setDeletingDept(true)
    const res = await fetch('/api/admin/departments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department_id: deleteDept.id }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to delete department') }
    else { setSuccess(data.message); setDeleteDept(null); fetchDepartments() }
    setDeletingDept(false)
  }

  // ── Faculty Functions ──
  async function fetchFaculty() {
    setLoadingFaculty(true)
    const res = await fetch('/api/admin/faculty-list')
    const data = await res.json()
    if (res.ok) setFaculty(data)
    setLoadingFaculty(false)
  }

  async function handleAddFaculty() {
    if (!facultyName || !facultyEmail || !facultyPassword || !facultyCampusId) {
      setError('All required fields must be filled')
      return
    }
    if (facultyRole === 'hod' && !facultyDeptId) {
      setError('Department is required for HOD')
      return
    }
    setSavingFaculty(true)
    clearMessages()
    const res = await fetch('/api/admin/faculty-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: facultyName,
        email: facultyEmail,
        password: facultyPassword,
        role: facultyRole,
        department_id: facultyRole === 'hod' ? facultyDeptId : undefined,
        campus_id: facultyCampusId,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.details && typeof data.details === 'object') {
        const fieldErrors = data.details.fieldErrors || {}
        const formatted = Object.entries(fieldErrors)
          .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(', ')}`)
          .join('; ')
        setError(formatted || data.error || 'Failed to add faculty')
      } else {
        setError(data.details ?? data.error ?? 'Failed to add faculty')
      }
    }
    else {
      setSuccess(data.message)
      setShowAddFaculty(false)
      setFacultyName(''); setFacultyEmail(''); setFacultyPassword('')
      setFacultyDeptId(''); setFacultyCampusId('')
      fetchFaculty()
    }
    setSavingFaculty(false)
  }

  // ── NEW: Edit Faculty ──
  function openEditFaculty(f: Faculty) {
    setEditFaculty(f)
    setEditFacultyName(f.full_name)
    setEditFacultyRole(f.role as 'hod' | 'campus_director' | 'teaching_staff')
    // L6 fix: Use campus_id directly instead of reverse-lookup by name
    setEditFacultyCampusId(f.campus_id ?? '')
    // Find the dept_id from departments list by matching dept name
    const matchedDept = departments.find(d => d.name === f.departments?.name)
    setEditFacultyDeptId(matchedDept?.id ?? '')
    clearMessages()
  }

  async function handleUpdateFaculty() {
    if (!editFaculty) return
    if (!editFacultyName) { setError('Name is required'); return }
    if (editFacultyRole === 'hod' && !editFacultyDeptId) {
      setError('Department is required for HOD')
      return
    }
    setUpdatingFaculty(true)
    clearMessages()
    const res = await fetch('/api/admin/faculty-list', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editFaculty.id,
        full_name: editFacultyName,
        role: editFacultyRole,
        department_id: editFacultyRole === 'hod' ? editFacultyDeptId : null,
        campus_id: editFacultyCampusId || editFaculty.campus_id,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to update faculty') }
    else {
      setSuccess(data.message)
      setEditFaculty(null)
      setEditFacultyName(''); setEditFacultyRole('hod')
      setEditFacultyDeptId(''); setEditFacultyCampusId('')
      fetchFaculty()
    }
    setUpdatingFaculty(false)
  }

  async function handleDeleteFaculty() {
    if (!deleteFaculty) return
    setDeletingFaculty(true)
    const res = await fetch('/api/admin/faculty-list', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ faculty_id: deleteFaculty.id }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to delete faculty') }
    else { setSuccess(data.message); setDeleteFaculty(null); fetchFaculty() }
    setDeletingFaculty(false)
  }

  async function handleLogout() {
    setLoggingOut(true)
    if (!await logoutPortal()) setLoggingOut(false)
  }


  return (
    <div className={styles.pageWrapper}>

      {/* Top Bar */}
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <div className={styles.logoSmall}>
            <Image
              src="/knrunilogo.png"
              alt="KU"
              width={26}
              height={28}
              style={{ width: 'auto', height: '28px' }}
            />
          </div>
          <div>
            <p className={styles.topBarTitle}>FYIMP Portal</p>
            <p className={styles.topBarSubtitle}>Super Admin</p>
          </div>
        </div>
        <button className={styles.logoutBtn} onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? 'Logging out...' : 'Logout'}
        </button>
      </div>

      {/* Info Card */}
      <div className={styles.infoCard}>
        {loadingAdmin ? <div style={{ height: '2.5rem' }} /> : (
          <>
            <p className={styles.adminName}>{adminName || 'Super Admin'}</p>
            <div className={styles.adminDetails}>
              <span className={styles.detailBadge}>⚡ Super Admin</span>
            </div>
          </>
        )}
      </div>

      {/* Tab Bar */}
      <div className={styles.tabBar}>
        {(['campuses', 'departments', 'faculty', 'logs'] as Tab[]).map(tab => (
          <button
            key={tab}
            className={`${styles.tabBtn} ${activeTab === tab ? styles.tabActive : ''}`}
            onClick={() => { setActiveTab(tab); clearMessages() }}
          >
            {tab === 'campuses'
              ? '🏛️ Campuses'
              : tab === 'departments'
              ? '🏫 Departments'
              : tab === 'faculty'
              ? '👤 Faculty'
              : '📜 System & Audit Logs'}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div className={styles.mainContent}>

        {error && <div className={styles.errorBanner}>{error}</div>}
        {success && <div className={styles.successBanner}>✓ {success}</div>}

        {/* ══ CAMPUSES TAB ══ */}
        {activeTab === 'campuses' && (
          <>
            <div className={styles.sectionHeader}>
              <p className={styles.sectionTitle}>Campuses</p>
              <button className={styles.addBtn} onClick={() => { setShowAddCampus(true); clearMessages() }}>
                + Add Campus
              </button>
            </div>

            <div className={styles.tableWrapper}>
              {loadingCampuses ? (
                <div className={styles.loadingState}>
                  <div className={styles.spinner} />
                  <p className={styles.loadingText}>Loading campuses...</p>
                </div>
              ) : campuses.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>🏛️</div>
                  <p className={styles.emptyTitle}>No campuses yet</p>
                  <p className={styles.emptySubtitle}>Add your first campus to get started.</p>
                </div>
              ) : (
                <table className={styles.table}>
                  <thead className={styles.tableHead}>
                    <tr><th>#</th><th>Name</th><th>Code</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {campuses.map((campus, i) => (
                      <tr key={campus.id} className={styles.tableRow}>
                        <td>{i + 1}</td>
                        <td>{campus.name}</td>
                        <td><span className={styles.codeBadge}>{campus.code}</span></td>
                        <td>
                          <div className={styles.actionBtns}>
                            <button className={styles.editBtn} onClick={() => {
                              setEditCampus(campus)
                              setCampusName(campus.name)
                              setCampusCode(campus.code)
                              clearMessages()
                            }}>✏️</button>
                            <button className={styles.deleteBtn} onClick={() => {
                              setDeleteCampus(campus); clearMessages()
                            }}>🗑️</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* ══ DEPARTMENTS TAB ══ */}
        {activeTab === 'departments' && (
          <>
            <div className={styles.sectionHeader}>
              <p className={styles.sectionTitle}>Departments</p>
              <button className={styles.addBtn} onClick={() => { setShowAddDept(true); clearMessages() }}>
                + Add Department
              </button>
            </div>

            <div className={styles.searchBarWrapper}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="🔍 Search department..."
                value={deptSearch}
                onChange={e => setDeptSearch(e.target.value)}
              />
            </div>

            <div className={styles.tableWrapper}>
              {loadingDepts ? (
                <div className={styles.loadingState}>
                  <div className={styles.spinner} />
                  <p className={styles.loadingText}>Loading departments...</p>
                </div>
              ) : departments.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>🏫</div>
                  <p className={styles.emptyTitle}>No departments yet</p>
                  <p className={styles.emptySubtitle}>Add campuses first, then add departments.</p>
                </div>
              ) : (() => {
                const filteredDepts = departments.filter(d =>
                  d.name.toLowerCase().includes(deptSearch.toLowerCase()) ||
                  d.code.toLowerCase().includes(deptSearch.toLowerCase())
                )

                if (filteredDepts.length === 0) {
                  return (
                    <div className={styles.emptyState}>
                      <div className={styles.emptyIcon}>🔍</div>
                      <p className={styles.emptyTitle}>No matching departments</p>
                      <p className={styles.emptySubtitle}>No department found matching &quot;{deptSearch}&quot;.</p>
                    </div>
                  )
                }

                return (
                  <table className={styles.table}>
                    <thead className={styles.tableHead}>
                      <tr><th>#</th><th>Name</th><th>Code</th><th>Campus</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                      {filteredDepts.map((dept, i) => (
                        <tr key={dept.id} className={styles.tableRow}>
                          <td>{i + 1}</td>
                          <td>{dept.name}</td>
                          <td><span className={styles.codeBadge}>{dept.code}</span></td>
                          <td>{dept.campuses?.name ?? '—'}</td>
                          <td>
                            <div className={styles.actionBtns}>
                              <button className={styles.editBtn} onClick={() => {
                                setEditDept(dept)
                                setDeptName(dept.name)
                                setDeptCode(dept.code)
                                setDeptCampusId(dept.campus_id)
                                clearMessages()
                              }}>✏️</button>
                              <button className={styles.deleteBtn} onClick={() => {
                                setDeleteDept(dept); clearMessages()
                              }}>🗑️</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              })()}
            </div>
          </>
        )}

        {/* ══ FACULTY TAB ══ */}
        {activeTab === 'faculty' && (
          <>
            <div className={styles.sectionHeader}>
              <p className={styles.sectionTitle}>Faculty Management</p>
              <button className={styles.addBtn} onClick={() => { setShowAddFaculty(true); clearMessages() }}>
                + Add Faculty
              </button>
            </div>

            {loadingFaculty ? (
              <div className={styles.tableWrapper}>
                <div className={styles.loadingState}>
                  <div className={styles.spinner} />
                  <p className={styles.loadingText}>Loading faculty...</p>
                </div>
              </div>
            ) : faculty.length === 0 ? (
              <div className={styles.tableWrapper}>
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>👤</div>
                  <p className={styles.emptyTitle}>No faculty yet</p>
                  <p className={styles.emptySubtitle}>Add faculty members to manage the portal.</p>
                </div>
              </div>
            ) : (
              <>
                {/* Group 1: Campus Directors */}
                {(() => {
                  const directors = faculty.filter(f => f.role === 'campus_director')
                  return (
                    <div className={styles.facultyGroup}>
                      <div className={styles.facultyGroupHeader}>
                        <h4 className={styles.facultyGroupTitle}>
                          🏢 Campus Directors
                        </h4>
                        <span className={styles.countBadge}>{directors.length}</span>
                      </div>
                      <div className={styles.facultyTableWrapper}>
                        {directors.length === 0 ? (
                          <p style={{ padding: '1.25rem 1rem', color: '#9ba1ab', textAlign: 'center', fontSize: '0.8rem', margin: 0 }}>
                            No Campus Directors assigned yet.
                          </p>
                        ) : (
                          <table className={styles.table}>
                            <thead className={styles.tableHead}>
                              <tr>
                                <th>#</th>
                                <th>Name & Email</th>
                                <th>Campus</th>
                                <th>Role</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {directors.map((f, i) => (
                                <tr key={f.id} className={styles.tableRow}>
                                  <td>{i + 1}</td>
                                  <td>
                                    <p style={{ margin: 0, fontWeight: 600, fontSize: '0.82rem' }}>{f.full_name}</p>
                                    <p style={{ margin: 0, fontSize: '0.68rem', color: '#9ba1ab' }}>{f.email}</p>
                                  </td>
                                  <td>{f.campuses?.name ?? '—'}</td>
                                  <td><span className={styles.rolePillDirector}>Campus Director</span></td>
                                  <td>
                                    <div className={styles.actionBtns}>
                                      <button className={styles.editBtn} onClick={() => openEditFaculty(f)}>✏️</button>
                                      <button className={styles.deleteBtn} onClick={() => { setDeleteFaculty(f); clearMessages() }}>🗑️</button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* Group 2: Heads of Department (HODs) */}
                {(() => {
                  const hods = faculty.filter(f => f.role === 'hod')
                  return (
                    <div className={styles.facultyGroup}>
                      <div className={styles.facultyGroupHeader}>
                        <h4 className={styles.facultyGroupTitle}>
                          🎓 Heads of Department (HODs)
                        </h4>
                        <span className={styles.countBadge}>{hods.length}</span>
                      </div>
                      <div className={styles.facultyTableWrapper}>
                        {hods.length === 0 ? (
                          <p style={{ padding: '1.25rem 1rem', color: '#9ba1ab', textAlign: 'center', fontSize: '0.8rem', margin: 0 }}>
                            No Heads of Department (HODs) assigned yet.
                          </p>
                        ) : (
                          <table className={styles.table}>
                            <thead className={styles.tableHead}>
                              <tr>
                                <th>#</th>
                                <th>Name & Email</th>
                                <th>Campus</th>
                                <th>Department</th>
                                <th>Role</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {hods.map((f, i) => (
                                <tr key={f.id} className={styles.tableRow}>
                                  <td>{i + 1}</td>
                                  <td>
                                    <p style={{ margin: 0, fontWeight: 600, fontSize: '0.82rem' }}>{f.full_name}</p>
                                    <p style={{ margin: 0, fontSize: '0.68rem', color: '#9ba1ab' }}>{f.email}</p>
                                  </td>
                                  <td>{f.campuses?.name ?? '—'}</td>
                                  <td>{f.departments?.name ?? '—'}</td>
                                  <td><span className={styles.rolePillHod}>HOD</span></td>
                                  <td>
                                    <div className={styles.actionBtns}>
                                      <button className={styles.editBtn} onClick={() => openEditFaculty(f)}>✏️</button>
                                      <button className={styles.deleteBtn} onClick={() => { setDeleteFaculty(f); clearMessages() }}>🗑️</button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* Group 3: Teaching Staff */}
                {(() => {
                  const staff = faculty.filter(f => f.role === 'teaching_staff' || (f.role !== 'campus_director' && f.role !== 'hod'))
                  return (
                    <div className={styles.facultyGroup}>
                      <div className={styles.facultyGroupHeader}>
                        <h4 className={styles.facultyGroupTitle}>
                          👨‍🏫 Teaching Staff
                        </h4>
                        <span className={styles.countBadge}>{staff.length}</span>
                      </div>
                      <div className={styles.facultyTableWrapper}>
                        {staff.length === 0 ? (
                          <p style={{ padding: '1.25rem 1rem', color: '#9ba1ab', textAlign: 'center', fontSize: '0.8rem', margin: 0 }}>
                            No Teaching Staff members assigned yet.
                          </p>
                        ) : (
                          <table className={styles.table}>
                            <thead className={styles.tableHead}>
                              <tr>
                                <th>#</th>
                                <th>Name & Email</th>
                                <th>Campus</th>
                                <th>Department</th>
                                <th>Role</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {staff.map((f, i) => (
                                <tr key={f.id} className={styles.tableRow}>
                                  <td>{i + 1}</td>
                                  <td>
                                    <p style={{ margin: 0, fontWeight: 600, fontSize: '0.82rem' }}>{f.full_name}</p>
                                    <p style={{ margin: 0, fontSize: '0.68rem', color: '#9ba1ab' }}>{f.email}</p>
                                  </td>
                                  <td>{f.campuses?.name ?? '—'}</td>
                                  <td>{f.departments?.name ?? '—'}</td>
                                  <td><span className={styles.rolePillStaff}>Teaching Staff</span></td>
                                  <td>
                                    <div className={styles.actionBtns}>
                                      <button className={styles.editBtn} onClick={() => openEditFaculty(f)}>✏️</button>
                                      <button className={styles.deleteBtn} onClick={() => { setDeleteFaculty(f); clearMessages() }}>🗑️</button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </>
            )}
          </>
        )}

        {/* ════════ LOGS TAB ════════ */}
        {activeTab === 'logs' && (
          <div>
            <div className={styles.tabHeader}>
              <div>
                <h2 className={styles.tabTitle}>System &amp; Audit Logs</h2>
                <p className={styles.tabSubtitle}>
                  Real-time consolidated operational logs: audit trails, course allocations, and timetable solver jobs.
                </p>
              </div>
              <button
                className={styles.addBtn}
                onClick={fetchLogs}
                disabled={loadingLogs}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                🔄 Refresh Logs
              </button>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '220px' }}>
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="🔍 Search actions, events, errors..."
                  value={logSearch}
                  onChange={e => setLogSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && fetchLogs()}
                />
              </div>

              <select
                className={styles.input}
                style={{ width: 'auto', minWidth: '160px', padding: '0.45rem 0.75rem', fontSize: '0.8rem' }}
                value={logTypeFilter}
                onChange={e => setLogTypeFilter(e.target.value)}
              >
                <option value="all">All Log Types</option>
                <option value="audit_event">Audit Events</option>
                <option value="allocation_run">Course Allocation</option>
                <option value="timetable_job">Timetable Solver</option>
              </select>

              <select
                className={styles.input}
                style={{ width: 'auto', minWidth: '150px', padding: '0.45rem 0.75rem', fontSize: '0.8rem' }}
                value={logStatusFilter}
                onChange={e => setLogStatusFilter(e.target.value)}
              >
                <option value="all">All Statuses</option>
                <option value="success">Success / Completed</option>
                <option value="completed">Completed</option>
                <option value="failure">Failure / Error</option>
                <option value="failed">Failed</option>
                <option value="running">Running</option>
              </select>
            </div>

            {/* Table */}
            <div className={styles.tableWrapper}>
              {loadingLogs ? (
                <div className={styles.loadingState}>
                  <div className={styles.spinner} />
                  <p className={styles.loadingText}>Loading system logs...</p>
                </div>
              ) : logs.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>📜</div>
                  <p className={styles.emptyTitle}>No system logs found</p>
                  <p className={styles.emptySubtitle}>No records match your selected filters.</p>
                </div>
              ) : (
                <table className={styles.table}>
                  <thead className={styles.tableHead}>
                    <tr>
                      <th style={{ width: '150px' }}>Timestamp</th>
                      <th style={{ width: '130px' }}>Type</th>
                      <th>Event / Action</th>
                      <th style={{ width: '110px' }}>Status</th>
                      <th style={{ width: '90px' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => {
                      const isErr = log.status === 'failure' || log.status === 'failed' || !!log.error_message
                      const isSuccess = log.status === 'success' || log.status === 'completed'
                      const isRunning = log.status === 'running' || log.status === 'in_progress'

                      return (
                        <tr key={log.id} className={styles.tableRow}>
                          <td style={{ fontSize: '0.75rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                            {new Date(log.created_at).toLocaleString('en-IN', {
                              dateStyle: 'short',
                              timeStyle: 'medium',
                            })}
                          </td>
                          <td>
                            <span
                              className={`${styles.logBadge} ${
                                log.log_type === 'allocation_run'
                                  ? styles.logBadgeAlloc
                                  : log.log_type === 'timetable_job'
                                  ? styles.logBadgeTimetable
                                  : styles.logBadgeAudit
                              }`}
                            >
                              {log.log_type}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#0f172a' }}>
                              {log.action || log.event_type || 'System Event'}
                            </div>
                            {log.error_message && (
                              <div style={{ fontSize: '0.72rem', color: '#dc2626', marginTop: '2px' }}>
                                ⚠️ {log.error_message}
                              </div>
                            )}
                          </td>
                          <td>
                            <span
                              className={`${styles.logBadge} ${
                                isErr
                                  ? styles.logBadgeFailed
                                  : isSuccess
                                  ? styles.logBadgeSuccess
                                  : isRunning
                                  ? styles.logBadgeRunning
                                  : styles.logBadgeAudit
                              }`}
                            >
                              {log.status}
                            </span>
                          </td>
                          <td>
                            <button
                              className={styles.editBtn}
                              style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem' }}
                              onClick={() => setSelectedLog(log)}
                            >
                              🔍 View
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

      </div>

      {/* ══ MODALS ══ */}

      {/* Add/Edit Campus Modal */}
      {(showAddCampus || editCampus) && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>{editCampus ? 'Edit Campus' : 'Add Campus'}</h3>
            <div className={styles.fieldGroup}>
              <div className={styles.field}>
                <label className={styles.label}>Campus Name</label>
                <input type="text" className={styles.input} placeholder="e.g. Kannur University Main Campus"
                  value={campusName} onChange={e => setCampusName(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Campus Code</label>
                <input type="text" className={styles.input} placeholder="e.g. KU"
                  value={campusCode} onChange={e => setCampusCode(e.target.value)} />
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn}
                onClick={() => { setShowAddCampus(false); setEditCampus(null); setCampusName(''); setCampusCode('') }}
                disabled={savingCampus}>Cancel</button>
              <button className={styles.modalConfirmBtn} onClick={handleSaveCampus} disabled={savingCampus}>
                {savingCampus ? 'Saving...' : editCampus ? 'Save Changes →' : 'Add Campus →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Department Modal */}
      {(showAddDept || editDept) && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>{editDept ? 'Edit Department' : 'Add Department'}</h3>
            <div className={styles.fieldGroup}>
              <div className={styles.field}>
                <label className={styles.label}>Department Name</label>
                <input type="text" className={styles.input} placeholder="e.g. Mathematical Sciences"
                  value={deptName} onChange={e => setDeptName(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Department Code</label>
                <input type="text" className={styles.input} placeholder="e.g. MAT"
                  value={deptCode} onChange={e => setDeptCode(e.target.value)} />
              </div>
              {!editDept && (
                <div className={styles.field}>
                  <label className={styles.label}>Campus</label>
                  <select className={styles.input} value={deptCampusId} onChange={e => setDeptCampusId(e.target.value)}>
                    <option value="">— Select Campus —</option>
                    {campuses.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn}
                onClick={() => { setShowAddDept(false); setEditDept(null); setDeptName(''); setDeptCode(''); setDeptCampusId('') }}
                disabled={savingDept}>Cancel</button>
              <button className={styles.modalConfirmBtn} onClick={handleSaveDept} disabled={savingDept}>
                {savingDept ? 'Saving...' : editDept ? 'Save Changes →' : 'Add Department →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Faculty Modal */}
      {showAddFaculty && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Add Faculty</h3>
            <div className={styles.fieldGroup}>
              <div className={styles.field}>
                <label className={styles.label}>Full Name</label>
                <input type="text" className={styles.input} placeholder="Dr. Name"
                  value={facultyName} onChange={e => setFacultyName(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Email</label>
                <input type="email" className={styles.input} placeholder="name@ku.ac.in"
                  value={facultyEmail} onChange={e => setFacultyEmail(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Password</label>
                <div className="password-wrapper">
                  <input
                    type={showFacultyPassword ? 'text' : 'password'}
                    className={`${styles.input} password-input`}
                    placeholder="Min. 8 characters"
                    value={facultyPassword}
                    onChange={e => setFacultyPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowFacultyPassword(!showFacultyPassword)}
                    aria-label={showFacultyPassword ? 'Hide password' : 'Show password'}
                  >
                    {showFacultyPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Role</label>
                <select className={styles.input} value={facultyRole}
                  onChange={e => setFacultyRole(e.target.value as 'hod' | 'campus_director' | 'teaching_staff')}>
                  <option value="hod">HOD</option>
                  <option value="campus_director">Campus Director</option>
                  <option value="teaching_staff">Teaching Staff</option>
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Campus</label>
                <select className={styles.input} value={facultyCampusId} onChange={e => setFacultyCampusId(e.target.value)}>
                  <option value="">— Select Campus —</option>
                  {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {facultyRole === 'hod' && (
                <div className={styles.field}>
                  <label className={styles.label}>Department</label>
                  <select className={styles.input} value={facultyDeptId} onChange={e => setFacultyDeptId(e.target.value)}>
                    <option value="">— Select Department —</option>
                    {departments
                      .filter(d => !facultyCampusId || d.campus_id === facultyCampusId)
                      .map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn}
                onClick={() => {
                  setShowAddFaculty(false)
                  setFacultyName(''); setFacultyEmail(''); setFacultyPassword('')
                  setFacultyDeptId(''); setFacultyCampusId('')
                }}
                disabled={savingFaculty}>Cancel</button>
              <button className={styles.modalConfirmBtn} onClick={handleAddFaculty} disabled={savingFaculty}>
                {savingFaculty ? 'Creating...' : 'Create Account →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── NEW: Edit Faculty Modal ── */}
      {editFaculty && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Edit Faculty</h3>
            <div className={styles.fieldGroup}>
              <div className={styles.field}>
                <label className={styles.label}>Full Name</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Dr. Name"
                  value={editFacultyName}
                  onChange={e => setEditFacultyName(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Email</label>
                {/* Email is read-only — Supabase auth email change needs a separate flow */}
                <input
                  type="email"
                  className={styles.input}
                  value={editFaculty.email}
                  disabled
                  style={{ opacity: 0.5, cursor: 'not-allowed' }}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Role</label>
                <select
                  className={styles.input}
                  value={editFacultyRole}
                  onChange={e => {
                    setEditFacultyRole(e.target.value as 'hod' | 'campus_director' | 'teaching_staff')
                    // Clear dept if switching away from HOD
                    if (e.target.value !== 'hod') setEditFacultyDeptId('')
                  }}
                >
                  <option value="hod">HOD</option>
                  <option value="campus_director">Campus Director</option>
                  <option value="teaching_staff">Teaching Staff</option>
                </select>
              </div>
              {(editFacultyRole === 'hod' )&& (
                <div className={styles.field}>
                  <label className={styles.label}>Department</label>
                  <select
                    className={styles.input}
                    value={editFacultyDeptId}
                    onChange={e => setEditFacultyDeptId(e.target.value)}
                  >
                    <option value="">— Select Department —</option>
                    {departments
                      .filter(d => !editFacultyCampusId || d.campus_id === editFacultyCampusId)
                      .map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className={styles.modalActions}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => {
                  setEditFaculty(null)
                  setEditFacultyName(''); setEditFacultyRole('hod')
                  setEditFacultyDeptId(''); setEditFacultyCampusId('')
                }}
                disabled={updatingFaculty}
              >Cancel</button>
              <button
                className={styles.modalConfirmBtn}
                onClick={handleUpdateFaculty}
                disabled={updatingFaculty}
              >
                {updatingFaculty ? 'Saving...' : 'Save Changes →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Campus Confirmation */}
      {deleteCampus && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Delete Campus</h3>
            <p className={styles.modalSubtitle}>
              ⚠️ This will permanently delete <strong>{deleteCampus.name}</strong> and ALL data under it —
              departments, students, faculty, courses, blueprints and registrations.
              This cannot be undone.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setDeleteCampus(null)} disabled={deletingCampus}>Cancel</button>
              <button className={styles.modalDeleteBtn} onClick={handleDeleteCampus} disabled={deletingCampus}>
                {deletingCampus ? 'Deleting...' : 'Yes, Delete Everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Department Confirmation */}
      {deleteDept && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Delete Department</h3>
            <p className={styles.modalSubtitle}>
              ⚠️ This will permanently delete <strong>{deleteDept.name}</strong> and all its students,
              courses, blueprints and registrations. This cannot be undone.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setDeleteDept(null)} disabled={deletingDept}>Cancel</button>
              <button className={styles.modalDeleteBtn} onClick={handleDeleteDept} disabled={deletingDept}>
                {deletingDept ? 'Deleting...' : 'Yes, Delete Everything'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Faculty Confirmation */}
      {deleteFaculty && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Remove Faculty</h3>
            <p className={styles.modalSubtitle}>
              Are you sure you want to remove <strong>{deleteFaculty.full_name}</strong>?
              Their account will be permanently deleted.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setDeleteFaculty(null)} disabled={deletingFaculty}>Cancel</button>
              <button className={styles.modalDeleteBtn} onClick={handleDeleteFaculty} disabled={deletingFaculty}>
                {deletingFaculty ? 'Removing...' : 'Yes, Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log Detail Modal */}
      {selectedLog && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal} style={{ maxWidth: '640px', width: '90%' }}>
            <h3 className={styles.modalTitle}>System Log Detail</h3>
            <p className={styles.modalSubtitle} style={{ marginBottom: '1rem' }}>
              Recorded on {new Date(selectedLog.created_at).toLocaleString()}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem', fontSize: '0.8rem' }}>
              <div><strong>Log Type:</strong> <span className={styles.codeBadge}>{selectedLog.log_type}</span></div>
              <div><strong>Status:</strong> <span className={styles.codeBadge}>{selectedLog.status}</span></div>
              <div><strong>Event:</strong> {selectedLog.event_type || '—'}</div>
              <div><strong>User ID:</strong> {selectedLog.user_id ? `${selectedLog.user_id.slice(0, 8)}...` : 'System'}</div>
            </div>

            {selectedLog.action && (
              <div style={{ marginBottom: '0.75rem', fontSize: '0.8rem' }}>
                <strong>Action:</strong> {selectedLog.action}
              </div>
            )}

            {selectedLog.error_message && (
              <div style={{ marginBottom: '0.75rem', color: '#dc2626', fontSize: '0.8rem' }}>
                <strong>Error:</strong> {selectedLog.error_message}
              </div>
            )}

            <div style={{ marginBottom: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
              Recorded Metadata:
            </div>
            <pre className={styles.metaBox}>
              {selectedLog.metadata ? JSON.stringify(selectedLog.metadata, null, 2) : 'No metadata recorded'}
            </pre>

            <div className={styles.modalActions} style={{ marginTop: '1.25rem' }}>
              <button className={styles.modalCancelBtn} onClick={() => setSelectedLog(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

