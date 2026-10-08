'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import styles from './teaching-staff.module.css'
import { useBfcacheGuard } from '@/core/hooks/useBfcacheGuard'

interface Course {
  id: string
  course_code: string
  title: string
  semester?: number
  department_id?: string
  enrolled_count?: number
}

interface Department {
  id: string
  name: string
  code: string
}

interface Student {
  id: string
  full_name: string
  department: string
  department_code: string
}

interface RosterData {
  course: { id: string; title: string; course_code: string }
  total_students: number
  department_breakdown: Record<string, number>
  students: Student[]
}

interface DeptOption {
  key: string
  name: string
  code: string
  count: number
}

function CustomPaperSelect({
  courses,
  selectedCourseId,
  onSelect,
  disabled = false,
  placeholder = "— Select a Paper / Course —"
}: {
  courses: Course[]
  selectedCourseId: string
  onSelect: (courseId: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedCourse = courses.find(c => c.id === selectedCourseId)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div ref={containerRef} className={styles.customSelectWrapper}>
      <button
        type="button"
        className={styles.customSelectTrigger}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        {selectedCourse ? (
          <div className={styles.triggerContent}>
            <span className={styles.triggerTitle}>{selectedCourse.title} ({selectedCourse.course_code})</span>
            <span className={styles.triggerMeta}>
              {selectedCourse.semester ? `Sem ${selectedCourse.semester}` : 'Paper'} • {selectedCourse.enrolled_count ?? 0} registered
            </span>
          </div>
        ) : (
          <span className={styles.placeholderText}>{placeholder}</span>
        )}
        <span className={`${styles.triggerArrow} ${isOpen ? styles.triggerArrowOpen : ''}`} />
      </button>

      {isOpen && (
        <div className={styles.customSelectDropdown}>
          {courses.length === 0 ? (
            <div className={styles.customOptionNoData}>No papers available for selected filters</div>
          ) : (
            <>
              {placeholder && (
                <div
                  className={`${styles.customOption} ${!selectedCourseId ? styles.selected : ''}`}
                  onClick={() => {
                    onSelect('')
                    setIsOpen(false)
                  }}
                >
                  <span className={styles.placeholderOption}>{placeholder}</span>
                </div>
              )}
              {courses.map(course => (
                <div
                  key={course.id}
                  className={`${styles.customOption} ${selectedCourseId === course.id ? styles.selected : ''}`}
                  onClick={() => {
                    onSelect(course.id)
                    setIsOpen(false)
                  }}
                >
                  <div className={styles.optionUpper}>
                    <span className={styles.optionTitle}>{course.title}</span>
                    <span className={styles.optionCode}>({course.course_code})</span>
                  </div>
                  <div className={styles.optionLower}>
                    <span className={styles.optionSemTag}>
                      {course.semester ? `Semester ${course.semester}` : 'Paper'}
                    </span>
                    <span className={styles.optionCountBadge}>
                      👥 {course.enrolled_count ?? 0} registered
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function TeachingStaffDashboard() {
  useBfcacheGuard()
  const router = useRouter()
  const [facultyName, setFacultyName] = useState('')
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [departments, setDepartments] = useState<Department[]>([])
  const [courses, setCourses] = useState<Course[]>([])

  // Filter States
  const [selectedSemester, setSelectedSemester] = useState('all')
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('all')
  const [selectedCourseId, setSelectedCourseId] = useState('')

  const [loading, setLoading] = useState(false)
  const [rosterData, setRosterData] = useState<RosterData | null>(null)
  const [error, setError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  // Table Department Filter State
  const [tableDeptFilter, setTableDeptFilter] = useState('all')

  useEffect(() => {
    async function loadData() {
      try {
        const response = await fetch('/api/faculty/courses')
        const data = await response.json()
        if (!response.ok) {
          router.push('/login')
          return
        }

        setFacultyName(data.teacherName)
        setDepartments(data.departments ?? [])
        setCourses(data.courses ?? [])
      } catch {
        setError('Failed to load departmental courses. Please try again.')
      } finally {
        setLoadingProfile(false)
      }
    }
    loadData()
  }, [router])

  // Derive unique semesters present in fetched courses
  const availableSemesters = useMemo(() => {
    const sems = new Set<number>()
    courses.forEach(c => {
      if (c.semester) sems.add(c.semester)
    })
    if (sems.size === 0) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    return Array.from(sems).sort((a, b) => a - b)
  }, [courses])

  // Filter courses by selected semester first, then department
  const filteredCourses = useMemo(() => {
    return courses.filter(c => {
      const matchSem = selectedSemester === 'all' || (c.semester !== undefined && c.semester.toString() === selectedSemester)
      const matchDept = selectedDepartmentId === 'all' || c.department_id === selectedDepartmentId
      return matchSem && matchDept
    })
  }, [courses, selectedSemester, selectedDepartmentId])

  // Reset selected paper if it is no longer valid under new filters
  useEffect(() => {
    if (selectedCourseId && !filteredCourses.some(c => c.id === selectedCourseId)) {
      setSelectedCourseId('')
      setRosterData(null)
    }
  }, [filteredCourses, selectedCourseId])

  // Derive unique departments from roster data
  const deptOptions: DeptOption[] = useMemo(() => {
    if (!rosterData || !rosterData.students) return []
    const map = new Map<string, DeptOption>()
    for (const s of rosterData.students) {
      const key = s.department || s.department_code || 'Unknown'
      if (!map.has(key)) {
        map.set(key, {
          key,
          name: s.department || s.department_code || 'Unknown',
          code: s.department_code || s.department || '',
          count: 0,
        })
      }
      map.get(key)!.count++
    }
    return Array.from(map.values())
  }, [rosterData])

  // Compute displayed students for table view on screen
  const displayedStudents = useMemo(() => {
    if (!rosterData) return []
    if (tableDeptFilter === 'all') return rosterData.students
    return rosterData.students.filter(s => {
      const key = s.department || s.department_code || 'Unknown'
      return (
        key === tableDeptFilter ||
        s.department === tableDeptFilter ||
        s.department_code === tableDeptFilter
      )
    })
  }, [rosterData, tableDeptFilter])

  async function handleFetchCourse(targetCourseId?: string) {
    const courseIdToFetch = targetCourseId ?? selectedCourseId
    if (!courseIdToFetch) {
      setError('Please select a paper first')
      return
    }

    setLoading(true)
    setError('')
    setRosterData(null)
    setTableDeptFilter('all')

    try {
      const response = await fetch(`/api/faculty/attendance?course_id=${courseIdToFetch}`)
      const result = await response.json()

      if (!response.ok) {
        setError(result.error ?? 'Failed to fetch roster. Please try again.')
        setLoading(false)
        return
      }

      setRosterData(result)
    } catch {
      setError('Network error while fetching roster.')
    } finally {
      setLoading(false)
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
      {/* ── UNIFIED EXECUTIVE TOP BAR ── */}
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
              <p className={styles.topBarSubtitle}>Teaching Staff Dashboard</p>
            </div>
          </div>

          {/* Vertical Separator */}
          <div className={styles.topBarDivider} />

          {/* 2. Integrated Faculty Identity Block */}
          {loadingProfile ? (
            <div className={styles.topBarSkeleton} />
          ) : (
            <div className={styles.teacherIdentity}>
              <p className={styles.teacherNameHeader}>{facultyName || 'Teaching Staff Member'}</p>
              <div className={styles.teacherBadges}>
                <span className={styles.roleBadge}>Teaching Staff</span>
                <span className={styles.metaBadge}>Departmental Course Inspection</span>
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

      {/* Main Content */}
      <div className={styles.mainContent}>
        {error && <div className={styles.errorBanner}>{error}</div>}

        {/* Paper Filter & Custom Select Card */}
        <div className={styles.filterCard}>
          <div className={styles.filterCardHeader}>
            <p className={styles.filterCardTitle}>🔍 Department Course Catalog & Student Inspection</p>
          </div>

          <div className={styles.filterControlsGrid}>
            {/* 1. Semester Filter */}
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>1. Semester</label>
              <select
                className={styles.filterSelect}
                value={selectedSemester}
                onChange={e => {
                  setSelectedSemester(e.target.value)
                  setError('')
                }}
              >
                <option value="all">All Semesters</option>
                {availableSemesters.map(sem => (
                  <option key={sem} value={sem.toString()}>
                    Semester {sem}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Department Filter */}
            <div className={styles.filterGroup}>
              <label className={styles.filterLabel}>2. Department</label>
              <select
                className={styles.filterSelect}
                value={selectedDepartmentId}
                onChange={e => {
                  setSelectedDepartmentId(e.target.value)
                  setError('')
                }}
              >
                <option value="all">All Departments</option>
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name} ({dept.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 3. Paper / Course Custom Dropdown */}
          <div className={styles.paperSelectGroup}>
            <label className={styles.filterLabel}>
              3. Paper / Course ({filteredCourses.length} available)
            </label>
            <CustomPaperSelect
              courses={filteredCourses}
              selectedCourseId={selectedCourseId}
              onSelect={courseId => {
                setSelectedCourseId(courseId)
                setError('')
                if (courseId) {
                  handleFetchCourse(courseId)
                } else {
                  setRosterData(null)
                }
              }}
              disabled={loading}
            />
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className={styles.loadingState}>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>Fetching enrolled students...</p>
          </div>
        )}

        {/* Course Details & Enrolled Students Table (Read-Only) */}
        {!loading && rosterData && (
          <div className={styles.detailsContainer}>
            {/* Course Info Banner */}
            <div className={styles.courseInfoBanner}>
              <p className={styles.courseInfoName}>{rosterData.course.title}</p>
              <p className={styles.courseInfoCode}>{rosterData.course.course_code}</p>
            </div>

            <div className={styles.statsRow}>
              <div className={styles.statCard}>
                <p className={styles.statValue}>{rosterData.total_students}</p>
                <p className={styles.statLabel}>Enrolled Students</p>
              </div>
              <div className={styles.statCard}>
                <p className={styles.statValue}>{Object.keys(rosterData.department_breakdown).length}</p>
                <p className={styles.statLabel}>Departments</p>
              </div>
            </div>

            {Object.keys(rosterData.department_breakdown).length > 0 && (
              <div className={styles.breakdownCard}>
                <p className={styles.breakdownTitle}>Department Breakdown</p>
                {Object.entries(rosterData.department_breakdown).map(([dept, count]) => (
                  <div key={dept} className={styles.breakdownRow}>
                    <span className={styles.breakdownDept}>{dept}</span>
                    <span className={styles.breakdownCount}>{count} students</span>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.sectionHeader}>
              <div className={styles.sectionHeaderLeft}>
                <p className={styles.sectionTitle}>
                  Enrolled Students ({tableDeptFilter === 'all' ? rosterData.total_students : displayedStudents.length})
                </p>
                {deptOptions.length > 1 && (
                  <select
                    className={styles.tableFilterSelect}
                    value={tableDeptFilter}
                    onChange={e => setTableDeptFilter(e.target.value)}
                    title="Filter table display by department"
                  >
                    <option value="all">All Departments ({rosterData.total_students})</option>
                    {deptOptions.map(d => (
                      <option key={d.key} value={d.key}>
                        {d.name} ({d.count})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className={styles.tableWrapper}>
              {rosterData.total_students === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>📭</div>
                  <p className={styles.emptyTitle}>No students enrolled</p>
                  <p className={styles.emptySubtitle}>No students have registered for this paper yet.</p>
                </div>
              ) : displayedStudents.length === 0 ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIcon}>🔍</div>
                  <p className={styles.emptyTitle}>No matching students</p>
                  <p className={styles.emptySubtitle}>No students enrolled from the selected department.</p>
                </div>
              ) : (
                <table className={styles.table}>
                  <thead className={styles.tableHead}>
                    <tr>
                      <th>#</th>
                      <th>Student Name</th>
                      <th>Department</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedStudents.map((student, index) => (
                      <tr key={student.id} className={styles.tableRow}>
                        <td>{index + 1}</td>
                        <td>{student.full_name}</td>
                        <td>
                          <span className={styles.deptBadge}>
                            {student.department_code || student.department}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
