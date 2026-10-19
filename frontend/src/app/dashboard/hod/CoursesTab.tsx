'use client'

import { apiErrorMessage } from '@/core/api-error'
import { createSemesterCatalogue, type CatalogueSnapshot } from '@/core/semester-catalogue'
import AccessibleModal from '@/components/AccessibleModal'
import LoadingState, { LoadingIndicator } from '@/components/LoadingState'

import { BookOpen as UiBookOpen, Check as UiCheck, Info as UiInfo, Pencil as UiPencil, Trash2 as UiTrash2, TriangleAlert as UiTriangleAlert, X as UiX } from 'lucide-react'

import { useState, useEffect, useEffectEvent } from 'react'
import { HOD_COURSE_CATEGORIES } from '@fyimp/contracts'
import { ChevronDown } from 'lucide-react'
import styles from './hod-dashboard.module.css'

interface CatalogueCourse { is_own_campus?: boolean; is_own_dept?: boolean; department_name?: string; theory_hours_per_week: number; practical_hours_per_week: number; prerequisite_course_ids?: string[]; id: string; course_code: string; title: string; credits: number; category: string; semester: number; seat_limit: number; theory_hours: number; practical_hours: number; department_id: string; prerequisites?: string[]; departments?: { name: string; code: string } }
export default function CoursesTab({ semester, onSemesterChange: setSemester }: { semester: number; onSemesterChange: (semester: number) => void }) {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [departments, setDepartments] = useState<{ id: string; name: string; code: string }[]>([])
  const [courseSemester, setCourseSemester] = useState(semester)
  // Courses state
  const [catalogue, setCatalogue] = useState<CatalogueSnapshot<CatalogueCourse>>({ semester, rows: undefined, loading: true, error: '' })
  const [catalogueLoader] = useState(() => createSemesterCatalogue<CatalogueCourse>(async (sem, signal) => {
    let res: Response
    try { res = await fetch(`/api/hod/courses?semester=${sem}&own=true`, { signal }) }
    catch { throw new Error('Unable to load courses. Check your connection and retry.') }
    const data = await res.json().catch(() => null)
    if (!res.ok || !Array.isArray(data)) throw new Error(apiErrorMessage(data, 'Unable to load courses. Please retry.', res.status))
    return data
  }, setCatalogue))
  const currentCatalogue = catalogue.semester === semester ? catalogue : { semester, rows: undefined, loading: true, error: '' }
  const courses = currentCatalogue.rows ?? []
  const loadingCourses = currentCatalogue.loading && !currentCatalogue.rows
  const [showAddCourse, setShowAddCourse] = useState(false)
  const [editCourse, setEditCourse] = useState<CatalogueCourse | null>(null)
  const [deleteCourse, setDeleteCourse] = useState<CatalogueCourse | null>(null)
  const [courseCode, setCourseCode] = useState('')
  const [courseTitle, setCourseTitle] = useState('')
  const [courseCredits, setCourseCredits] = useState<number | '' | null>(null)
  const [courseTheoryHours, setCourseTheoryHours] = useState<number | '' | null>(null)
  const [coursePracticalHours, setCoursePracticalHours] = useState<number | '' | null>(null)
  const [courseCategory, setCourseCategory] = useState<string | null>(null)
  const [courseSeatLimit, setCourseSeatLimit] = useState<number | ''>(60)
  const [coursePrereqs, setCoursePrereqs] = useState<string[]>([])

  // Prerequisite Rule Engine state (Only DEPARTMENT and COMPLETED_COURSE)
  interface PrerequisiteRuleItem {
    id?: string
    course_id?: string
    rule: 'COMPLETED_COURSE' | 'DEPARTMENT'
    target: string
  }
  const [courseRules, setCourseRules] = useState<PrerequisiteRuleItem[]>([])
  const [loadingRules, setLoadingRules] = useState(false)
  const [newRuleType, setNewRuleType] = useState<'COMPLETED_COURSE' | 'DEPARTMENT'>('DEPARTMENT')
  const [newRuleTarget, setNewRuleTarget] = useState('')

  // Prior courses selector for COMPLETED_COURSE
  const [priorCourses, setPriorCourses] = useState<CatalogueCourse[]>([])
  const [loadingPriorCourses, setLoadingPriorCourses] = useState(false)
  const [priorCourseSemesterFilter, setPriorCourseSemesterFilter] = useState<number | null>(null)
  const [priorCourseSearch, setPriorCourseSearch] = useState('')
  const [priorCourseOpen, setPriorCourseOpen] = useState(false)

  const [savingCourse, setSavingCourse] = useState(false)
  const [deletingCourse, setDeletingCourse] = useState(false)
  const loadRules = useEffectEvent((id: string, signal: AbortSignal) => { void loadCourseRules(id, signal) })
  useEffect(() => {
    if (!editCourse?.id) return
    const controller = new AbortController()
    loadRules(editCourse.id, controller.signal)
    return () => controller.abort()
  }, [editCourse?.id])

  useEffect(() => { void catalogueLoader.start(semester) }, [semester, catalogueLoader])
  useEffect(() => () => catalogueLoader.dispose(), [catalogueLoader])
  useEffect(() => { void fetchDepartmentsList() }, [])

  async function fetchDepartmentsList() {
    try {
      const res = await fetch('/api/hod/departments')
      const data = await res.json().catch(() => [])
      if (res.ok && Array.isArray(data)) {
        setDepartments(data)
      }
    } catch (err) {
      console.error('Failed to fetch departments:', err)
    }
  }

  async function loadPriorCourses(maxSem: number, signal?: AbortSignal) {
    if (maxSem <= 1) {
      setPriorCourses([])
      return
    }
    setLoadingPriorCourses(true)
    try {
      const res = await fetch(`/api/hod/courses?max_semester=${maxSem}`, { signal })
      const data = await res.json().catch(() => [])
      if (signal?.aborted) return
      if (res.ok && Array.isArray(data)) {
        setPriorCourses(data)
      } else {
        setPriorCourses([])
      }
    } catch (err) {
      console.error('Failed to fetch prior courses:', err)
      if (!signal?.aborted) setPriorCourses([])
    } finally {
      if (!signal?.aborted) setLoadingPriorCourses(false)
    }
  }

  // Load prior courses when Add/Edit Course modal opens
  useEffect(() => {
    if (showAddCourse || editCourse) {
      const targetSem = courseSemester

      // eslint-disable-next-line react-hooks/set-state-in-effect -- Starts synchronization with the remote API for this mounted view.
      const controller = new AbortController()
      loadPriorCourses(targetSem, controller.signal)
      setPriorCourseSemesterFilter(null)
      setPriorCourseSearch('')
      setPriorCourseOpen(false)
      if (newRuleType === 'COMPLETED_COURSE') setNewRuleTarget('')
      return () => controller.abort()
    }
  }, [showAddCourse, editCourse, courseSemester])

  async function loadCourseRules(courseId: string, signal?: AbortSignal) {
    setLoadingRules(true)
    try {
      const res = await fetch(`/api/allocation/config/prerequisites/${courseId}`, { signal })
      const data = await res.json().catch(() => ({}))
      if (signal?.aborted) return
      if (res.ok && data.rules) {
        setCourseRules(data.rules)
        const deptRule = data.rules.find((r: {rule: string; target: string}) => r.rule === 'DEPARTMENT')
        if (deptRule) {
          setNewRuleTarget(deptRule.target)
        }
      } else {
        setCourseRules([])
      }
    } catch {
      if (!signal?.aborted) setCourseRules([])
    } finally {
      if (!signal?.aborted) setLoadingRules(false)
    }
  }

  async function handleAddRule() {
    const trimmed = newRuleTarget.trim()
    if (!trimmed) {
      setError(newRuleType === 'DEPARTMENT' ? 'Please select at least one department' : 'Please specify or select a prerequisite course')
      return
    }
    setError('')
    if (newRuleType === 'COMPLETED_COURSE' && !trimmed.split(',').every(code => priorCourses.some(c => c.course_code.toUpperCase() === code.trim().toUpperCase() && c.semester < courseSemester))) {
      setError('Prerequisites must be from an earlier semester'); return
    }

    if (editCourse?.id) {
      try {
        const res = await fetch(`/api/allocation/config/prerequisites/${editCourse.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rule: newRuleType, target: trimmed }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.rule) {
          const existsIdx = courseRules.findIndex(r => r.id === data.rule.id || (r.rule === 'DEPARTMENT' && data.rule.rule === 'DEPARTMENT'))
          if (existsIdx >= 0) {
            const updated = [...courseRules]
            updated[existsIdx] = data.rule
            setCourseRules(updated)
          } else {
            setCourseRules([...courseRules, data.rule])
          }
          if (newRuleType !== 'DEPARTMENT') {
            setNewRuleTarget('')
          }
        } else {
          setError(data.error || data.message || 'Failed to add prerequisite rule')
        }
      } catch (err: unknown) {
        setError((err instanceof Error ? err.message : '') || 'Failed to add prerequisite rule')
      }
    } else {
      if (newRuleType === 'DEPARTMENT') {
        const existsIdx = courseRules.findIndex(r => r.rule === 'DEPARTMENT')
        if (existsIdx >= 0) {
          const updated = [...courseRules]
          updated[existsIdx] = { rule: 'DEPARTMENT', target: trimmed }
          setCourseRules(updated)
        } else {
          setCourseRules([...courseRules, { rule: 'DEPARTMENT', target: trimmed }])
        }
      } else {
        const exists = courseRules.some(
          (r) => r.rule === newRuleType && r.target.toUpperCase() === trimmed.toUpperCase(),
        )
        if (exists) {
          setError('This prerequisite course is already added')
          return
        }
        setCourseRules([...courseRules, { rule: newRuleType, target: trimmed }])
        setNewRuleTarget('')
      }
    }
  }

  async function handleDeleteRule(rule: PrerequisiteRuleItem, idx: number) {
    setError('')
    if (rule.id) {
      try {
        const res = await fetch(`/api/allocation/config/prerequisites/${rule.id}`, {
          method: 'DELETE',
        })
        if (res.ok) {
          setCourseRules(courseRules.filter((r) => r.id !== rule.id))
          if (rule.rule === 'DEPARTMENT') {
            setNewRuleTarget('')
          }
        } else {
          const data = await res.json().catch(() => ({}))
          setError(data.error || data.message || 'Failed to delete prerequisite rule')
        }
      } catch (err: unknown) {
        setError((err instanceof Error ? err.message : '') || 'Failed to delete prerequisite rule')
      }
    } else {
      setCourseRules(courseRules.filter((_, i) => i !== idx))
      if (rule.rule === 'DEPARTMENT') {
        setNewRuleTarget('')
      }
    }
  }

  async function updateDepartmentCodes(newCodes: string[]) {
    setError('')
    const deptRule = courseRules.find(r => r.rule === 'DEPARTMENT')
    const newTarget = newCodes.filter(Boolean).join(',')

    if (!newTarget) {
      if (deptRule) {
        handleDeleteRule(deptRule, courseRules.indexOf(deptRule))
      }
      return
    }

    if (editCourse?.id) {
      try {
        const res = await fetch(`/api/allocation/config/prerequisites/${editCourse.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rule: 'DEPARTMENT', target: newTarget }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.rule) {
          const existsIdx = courseRules.findIndex(r => r.rule === 'DEPARTMENT')
          if (existsIdx >= 0) {
            const updated = [...courseRules]
            updated[existsIdx] = data.rule
            setCourseRules(updated)
          } else {
            setCourseRules([...courseRules, data.rule])
          }
        } else {
          setError(data.error || data.message || 'Failed to update department constraint')
        }
      } catch (err: unknown) {
        setError((err instanceof Error ? err.message : '') || 'Failed to update department constraint')
      }
    } else {
      const existsIdx = courseRules.findIndex(r => r.rule === 'DEPARTMENT')
      if (existsIdx >= 0) {
        const updated = [...courseRules]
        updated[existsIdx] = { rule: 'DEPARTMENT', target: newTarget }
        setCourseRules(updated)
      } else {
        setCourseRules([...courseRules, { rule: 'DEPARTMENT', target: newTarget }])
      }
    }
  }

  function handleDepartmentToggle(deptCode: string, isChecked: boolean) {
    const deptRule = courseRules.find(r => r.rule === 'DEPARTMENT')
    const currentCodes = deptRule?.target ? deptRule.target.split(',').map(c => c.trim()).filter(Boolean) : []
    const newCodes = isChecked
      ? (currentCodes.includes(deptCode) ? currentCodes : [...currentCodes, deptCode])
      : currentCodes.filter(c => c !== deptCode)
    updateDepartmentCodes(newCodes)
  }

  async function handleSaveCourse() {
    if (!courseCode.trim()) { setError('Course code is required'); return }
    if (!courseTitle.trim()) { setError('Course title is required'); return }
    if (courseCredits === null || courseCredits === '') { setError('Credits are required'); return }
    if (!courseCategory) { setError('Category is required'); return }
    if (loadingPriorCourses || coursePrereqs.some(id => !priorCourses.some(c => c.id === id && c.semester < courseSemester)) || courseRules.some(rule => rule.rule === 'COMPLETED_COURSE' && !rule.target.split(',').every(code => priorCourses.some(c => c.course_code === code.trim() && c.semester < courseSemester)))) {
      setError('Prerequisites must be from an earlier semester. Remove invalid prerequisites before saving.'); return
    }

    setSavingCourse(true)
    setError('')

    const finalTheory = courseTheoryHours !== null && courseTheoryHours !== '' ? Number(courseTheoryHours) : Number(courseCredits ?? 0)
    const finalPractical = coursePracticalHours !== null && coursePracticalHours !== '' ? Number(coursePracticalHours) : 0

    const isEdit = !!editCourse
    const bodyPayload: Record<string, unknown> = {
      course_code: courseCode.trim().toUpperCase(),
      title: courseTitle.trim(),
      credits: courseCredits,
      theory_hours_per_week: finalTheory,
      practical_hours_per_week: finalPractical,
      category: courseCategory,
      seat_limit: courseSeatLimit !== '' ? Number(courseSeatLimit) : 60,
      prerequisite_course_ids: coursePrereqs,
    }
    bodyPayload.semester = courseSemester
    if (editCourse) bodyPayload.id = editCourse.id

    try {
      const res = await fetch('/api/hod/courses', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) { setError(data.message || data.error || 'Failed to save course') }
      else {
        // If newly created course had staged rules, persist them
        if (!isEdit && data.id && courseRules.length > 0) {
          for (const rule of courseRules) {
            try {
              await fetch(`/api/allocation/config/prerequisites/${data.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rule: rule.rule, target: rule.target }),
              })
            } catch {
              // best effort
            }
          }
        }
        setSuccess(editCourse && editCourse.semester !== courseSemester ? `Course moved to Semester ${courseSemester}. Course code is unchanged.` : data.message)
        setShowAddCourse(false)
        setEditCourse(null)
        setCourseCode(''); setCourseTitle(''); setCourseCredits(null); setCourseTheoryHours(null); setCoursePracticalHours(null); setCourseCategory(null)
        setCourseSeatLimit(60); setCoursePrereqs([]); setCourseRules([]); setNewRuleTarget('')
        setNewRuleType('DEPARTMENT'); setPriorCourseOpen(false); setPriorCourseSearch(''); setPriorCourseSemesterFilter(null)
        void catalogueLoader.invalidate()
      }
    } catch { setError('Unable to save course. Check your connection and retry.') }
    finally { setSavingCourse(false) }
  }

  async function handleDeleteCourse() {
    if (!deleteCourse) return
    setDeletingCourse(true)
    try {
      const res = await fetch('/api/hod/courses', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ course_id: deleteCourse.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Failed to delete course') }
      else {
        setSuccess(data.message)
        setTimeout(() => setSuccess(''), 1000)
        setDeleteCourse(null)
        void catalogueLoader.invalidate()
      }
    } catch { setError('Unable to delete course. Check your connection and retry.') }
    finally { setDeletingCourse(false) }
  }

  return (
    <div className={styles.blueprintContainer}>
      {success && (
        <div className={styles.successModalOverlay} onClick={() => setSuccess('')}>
          <div className={styles.successModalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.successModalIcon}><UiCheck size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></div>
            <p className={styles.successModalText}>{success}</p>
            <button className={styles.successModalClose} onClick={() => setSuccess('')} aria-label="Close"><UiX size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></button>
          </div>
        </div>
      )}

      {error && !showAddCourse && !editCourse && !deleteCourse && <div role="alert" className={styles.errorBanner}>{error}</div>}
      {currentCatalogue.error && <div role="alert" className={styles.errorBanner}>
        {currentCatalogue.rows ? 'Showing saved courses. ' : ''}{currentCatalogue.error}{' '}
        <button type="button" onClick={() => void catalogueLoader.refresh()}>Retry</button>
      </div>}
      {currentCatalogue.loading && currentCatalogue.rows && <div role="status"><LoadingIndicator message="Updating courses…" /></div>}
      {/* Semester Selector */}
      <div className={styles.semesterRow}>
        <span className={styles.semesterLabel}><b>Courses for semester:</b></span>
        <select className={styles.semesterSelect} value={semester}
          onChange={e => {
            const nextSem = Number(e.target.value)
            void catalogueLoader.select(nextSem)
            setSemester(nextSem)
          }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => (
            <option key={s} value={s}>Semester {s}</option>
          ))}
        </select>
      </div>

          {/* ── COURSES ── */}
          {true && (
            <>
              <div className={styles.sectionHeader}>
                <p className={styles.sectionTitle}>Courses — Semester {semester}</p>
                <button className={styles.addBtn} onClick={() => {
                  setCourseCode('')
                  setCourseTitle('')
                  setCourseCredits(null)
                  setCourseTheoryHours(null)
                  setCoursePracticalHours(null)
                  setCourseCategory(null)
                  setCourseSeatLimit(60)
                  setCoursePrereqs([])
                  setCourseRules([])
                  setNewRuleTarget('')
                  setEditCourse(null)
                  setCourseSemester(semester)
                  setShowAddCourse(true)
                  setError('')
                  setSuccess('')
                }}>+ Add Course</button>
              </div>

              <div className={styles.tableWrapper}>
                {loadingCourses ? (
                  <LoadingState layout="cards" message={`Loading Semester ${semester} courses…`} />
                ) : currentCatalogue.error && !currentCatalogue.rows ? null : courses.length === 0 ? (
                  <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}><UiBookOpen size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" /></div>
                    <p className={styles.emptyTitle}>No courses yet</p>
                    <p className={styles.emptySubtitle}>Add courses for Semester {semester}.</p>
                  </div>
                ) : (
                  <table className={styles.table}>
                    <thead className={styles.tableHead}>
                      <tr>
                        <th>Code</th>
                        <th>Title</th>
                        <th>Cr</th>
                        <th>Seats</th>
                        <th>Theory Hrs</th>
                        <th>Practical Hrs</th>
                        <th>Cat</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {courses.map(course => (
                        <tr key={course.id} className={styles.tableRow}>
                          <td style={{ fontSize: '0.68rem', fontFamily: 'monospace' }}>{course.course_code}</td>
                          <td style={{ fontSize: '0.78rem' }}>{course.title}</td>
                          <td>{course.credits}</td>
                          <td><strong>{course.seat_limit ?? 60}</strong></td>
                          <td>{course.theory_hours_per_week ?? course.credits}</td>
                          <td>{course.practical_hours_per_week ?? 0}</td>
                          <td><span className={styles.codeBadge}>{course.category}</span></td>
                          <td>
                            <div className={styles.actionBtns}>
                              <button
                                className={styles.editBtn}
                                title="Edit Course"
                                aria-label="Edit Course"
                                onClick={() => {
                                  setCourseSemester(course.semester)
                                  setEditCourse(course)
                                  setCourseCode(course.course_code)
                                  setCourseTitle(course.title)
                                  setCourseCredits(course.credits)
                                  setCourseTheoryHours(course.theory_hours_per_week ?? course.credits)
                                  setCoursePracticalHours(course.practical_hours_per_week ?? 0)
                                  setCourseCategory(course.category)
                                  setCourseSeatLimit(course.seat_limit ?? 60)
                                  setCoursePrereqs(course.prerequisite_course_ids ?? [])
                                  setError(''); setSuccess('')
                                }}
                              >
                                <UiPencil size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" />
                              </button>
                              <button
                                className={styles.deleteBtn}
                                title="Delete Course"
                                aria-label="Delete Course"
                                onClick={() => {
                                  setDeleteCourse(course); setError(''); setSuccess('')
                                }}
                              >
                                <UiTrash2 size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" />
                              </button>
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

      {true && (
        <>
          {/* Add/Edit Course Modal */}
          {(showAddCourse || editCourse) && (
            <AccessibleModal className={styles.modalOverlay} label={editCourse ? 'Edit Course' : 'Add Course'} busy={savingCourse} onClose={() => { setShowAddCourse(false); setEditCourse(null); setError('') }}>
              <div className={styles.courseModalDialog}>
                {/* Sticky Header */}
                <div className={styles.courseModalHeader}>
                  <h3 className={styles.modalTitle}>{editCourse ? 'Edit Course' : 'Add Course'}</h3>
                  <button
                    type="button"
                    className={styles.courseModalCloseBtn}
                    disabled={savingCourse}
                    onClick={() => {
                      setShowAddCourse(false)
                      setEditCourse(null)
                      setCourseCode('')
                      setCourseTitle('')
                      setCourseCredits(null)
                      setCourseTheoryHours(null)
                      setCoursePracticalHours(null)
                      setCourseCategory(null)
                      setCourseSeatLimit(60)
                      setCoursePrereqs([])
                      setCourseRules([])
                      setNewRuleTarget('')
                      setError('')
                    }}
                    title="Close"
                    aria-label="Close"
                  >
                    <UiX size="1em" aria-hidden="true" className="inline-block shrink-0 align-[-0.125em]" />
                  </button>
                </div>

                {/* Scrollable Body with 2-Column Responsive Layout */}
                <div className={styles.courseModalBody}>
                  <div className={styles.courseModalGrid}>
                    {/* Left Column: Course Details */}
                    <div className={styles.courseModalCol}>
                      <div className={styles.courseModalSectionTitle}>
                        <span>Course Details</span>
                      </div>

                      <div className={styles.field}>
                        <label className={styles.label} htmlFor="course-semester">Semester</label>
                        <select id="course-semester" className={styles.input} value={courseSemester} onChange={e => setCourseSemester(Number(e.target.value))} disabled={savingCourse}>
                          {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>Semester {i + 1}</option>)}
                        </select>
                        {editCourse && <p className={styles.modalSubtitle}>Only unused courses can change semester. The course code stays unchanged.</p>}
                      </div>
                      <div className={styles.field}>
                        <label className={styles.label}>Course Code</label>
                        <input
                          type="text"
                          className={styles.input}
                          placeholder="e.g. KU01DSCMAT101"
                          value={courseCode}
                          onChange={e => setCourseCode(e.target.value.toUpperCase())}
                        />
                      </div>

                      <div className={styles.field}>
                        <label className={styles.label}>Title</label>
                        <input
                          type="text"
                          className={styles.input}
                          placeholder="e.g. Differential Calculus"
                          value={courseTitle}
                          onChange={e => setCourseTitle(e.target.value)}
                        />
                      </div>

                      <div className={styles.courseModalTwoCol}>
                        <div className={styles.field}>
                          <label className={styles.label}>Credits</label>
                          <input
                            type="number"
                            className={styles.input}
                            min={1}
                            max={10}
                            value={courseCredits ?? ''}
                            onKeyDown={e => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault() }}
                            onChange={e => {
                              const val = e.target.value.replace(/[^0-9]/g, '')
                              setCourseCredits(val === '' ? null : Number(val))
                            }}
                          />
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label}>Seat Limit</label>
                          <input
                            type="number"
                            className={styles.input}
                            min={1}
                            max={500}
                            placeholder="e.g. 60"
                            value={courseSeatLimit ?? ''}
                            onKeyDown={e => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault() }}
                            onChange={e => {
                              const val = e.target.value.replace(/[^0-9]/g, '')
                              setCourseSeatLimit(val === '' ? '' : Number(val))
                            }}
                          />
                        </div>
                      </div>

                      <div className={styles.courseModalTwoCol}>
                        <div className={styles.field}>
                          <label className={styles.label}>Category</label>
                          <select
                            className={styles.input}
                            value={courseCategory ?? ''}
                            onChange={e => setCourseCategory(e.target.value || null)}
                          >
                            <option value="">— Select Category —</option>
                            {HOD_COURSE_CATEGORIES.map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className={styles.courseModalTwoCol}>
                        <div className={styles.field}>
                          <label className={styles.label}>Theory Hours / Wk</label>
                          <input
                            type="number"
                            className={styles.input}
                            min={0}
                            max={20}
                            placeholder={courseCredits ? `${courseCredits} (Default)` : 'e.g. 3'}
                            value={courseTheoryHours ?? ''}
                            onKeyDown={e => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault() }}
                            onChange={e => {
                              const val = e.target.value.replace(/[^0-9]/g, '')
                              setCourseTheoryHours(val === '' ? null : Number(val))
                            }}
                          />
                        </div>
                        <div className={styles.field}>
                          <label className={styles.label}>Practical Hours / Wk</label>
                          <input
                            type="number"
                            className={styles.input}
                            min={0}
                            max={20}
                            placeholder="e.g. 2"
                            value={coursePracticalHours ?? ''}
                            onKeyDown={e => { if (['e', 'E', '+', '-', '.'].includes(e.key)) e.preventDefault() }}
                            onChange={e => {
                              const val = e.target.value.replace(/[^0-9]/g, '')
                              setCoursePracticalHours(val === '' ? null : Number(val))
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Constraints & Eligibility (Hard Constraints) */}
                    <div className={styles.courseModalRightCol}>
                      <div className={styles.courseModalSectionTitle}>
                        <span>Constraints &amp; Eligibility</span>
                        <span style={{ fontSize: '0.7rem', color: "var(--portal-brand-text,#002147)", fontWeight: 600, background: "var(--portal-info-bg,#e0f2fe)", padding: '0.15rem 0.45rem', borderRadius: '4px' }}>
                          Hard Eligibility
                        </span>
                      </div>

                      <div style={{ fontSize: '0.74rem', color: "var(--portal-muted,#64748b)", lineHeight: 1.45 }}>
                        Define eligibility checks for allocation. Students register using the blueprint; allocation applies these constraints.
                      </div>

                      {/* Active Constraints List (Light University Theme) */}
                      <div style={{
                        background: "var(--portal-info-bg,#f8fafc)",
                        border: "1.5px solid var(--portal-strong-border,#e2e8f0)",
                        borderRadius: '8px',
                        padding: '0.65rem',
                        minHeight: '110px',
                        maxHeight: '190px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.45rem'
                      }}>
                        {loadingRules ? (
                          <LoadingState layout="list" rows={2} compact message="Loading constraints…" />
                        ) : courseRules.length === 0 ? (
                          <div style={{
                            fontSize: '0.75rem',
                            color: "var(--portal-muted,#64748b)",
                            fontStyle: 'italic',
                            padding: '1rem',
                            textAlign: 'center',
                            lineHeight: 1.5
                          }}>
                            No constraints configured.<br />
                            <span style={{ fontSize: '0.7rem', color: "var(--portal-info-text,#94a3b8)" }}>
                              All eligible students matching the blueprint can register.
                            </span>
                          </div>
                        ) : (
                          courseRules.map((rule, idx) => {
                            if (rule.rule === 'DEPARTMENT') {
                              const codes = rule.target.split(',').map(c => c.trim()).filter(Boolean)
                              return (
                                <div key={rule.id ?? `rule-${idx}`} className={styles.constraintCardLight}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, paddingRight: '0.5rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <span style={{
                                        fontSize: '0.65rem',
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        padding: '0.15rem 0.45rem',
                                        borderRadius: '3px',
                                        background: "var(--portal-info-bg,#e0f2fe)",
                                        color: "var(--portal-info-text,#0369a1)",
                                        letterSpacing: '0.04em'
                                      }}>
                                        Department Match
                                      </span>
                                      <span style={{ fontSize: '0.74rem', color: "var(--portal-info-text,#475569)", fontWeight: 500 }}>
                                        ({codes.length} department{codes.length === 1 ? '' : 's'} allowed)
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                                      {codes.map(c => {
                                        const dept = departments.find(d => d.code === c)
                                        return (
                                          <span
                                            key={c}
                                            style={{
                                              fontSize: '0.7rem',
                                              fontWeight: 600,
                                              background: "var(--portal-info-bg,#f1f5f9)",
                                              color: "var(--portal-brand-text,#0f172a)",
                                              padding: '0.1rem 0.4rem',
                                              borderRadius: '3px',
                                              border: "1px solid var(--portal-strong-border,#cbd5e1)"
                                            }}
                                            title={dept ? dept.name : c}
                                          >
                                            {c}
                                          </span>
                                        )
                                      })}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteRule(rule, idx)}
                                    style={{
                                      background: "var(--portal-danger-bg,#fee2e2)",
                                      border: 'none',
                                      color: "var(--portal-danger-text,#dc2626)",
                                      cursor: 'pointer',
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                      borderRadius: '4px',
                                      padding: '0.25rem 0.5rem',
                                      flexShrink: 0
                                    }}
                                    title="Remove department constraint"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )
                            } else {
                              const match = courses.find(c => c.course_code === rule.target) || priorCourses.find(c => c.course_code === rule.target)
                              return (
                                <div key={rule.id ?? `rule-${idx}`} className={styles.constraintCardLight}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, paddingRight: '0.5rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <span style={{
                                        fontSize: '0.65rem',
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        padding: '0.15rem 0.45rem',
                                        borderRadius: '3px',
                                        background: "var(--portal-purple-bg,#f3e8ff)",
                                        color: "var(--portal-purple-text,#7e22ce)",
                                        letterSpacing: '0.04em'
                                      }}>
                                        Completed Course
                                      </span>
                                    </div>
                                    <div style={{ fontSize: '0.76rem', color: "var(--portal-brand-text,#1e293b)", fontWeight: 600 }}>
                                      {rule.target} {match ? `— ${match.title} (Sem ${match.semester})` : ''}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteRule(rule, idx)}
                                    style={{
                                      background: "var(--portal-danger-bg,#fee2e2)",
                                      border: 'none',
                                      color: "var(--portal-danger-text,#dc2626)",
                                      cursor: 'pointer',
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                      borderRadius: '4px',
                                      padding: '0.25rem 0.5rem',
                                      flexShrink: 0
                                    }}
                                    title="Remove course prerequisite"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )
                            }
                          })
                        )}
                      </div>

                      {/* Constraint Configuration Panel (Light University Theme) */}
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem',
                        background: "var(--portal-surface,#ffffff)",
                        padding: '0.85rem',
                        borderRadius: '8px',
                        border: "1.5px solid var(--portal-border,#dde1e7)"
                      }}>
                        {/* Rule Type Tabs */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          borderBottom: "1.5px solid var(--portal-strong-border,#f1f5f9)",
                          paddingBottom: '0.6rem'
                        }}>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button
                              type="button"
                              onClick={() => {
                                setNewRuleType('DEPARTMENT')
                                setPriorCourseOpen(false)
                              }}
                              style={{
                                background: newRuleType === 'DEPARTMENT' ? "var(--portal-primary,#002147)" : "var(--portal-info-bg,#f1f5f9)",
                                color: newRuleType === 'DEPARTMENT' ? '#ffffff' : "var(--portal-info-text,#475569)",
                                border: 'none',
                                borderRadius: '5px',
                                padding: '0.35rem 0.75rem',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              Department Match
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setNewRuleType('COMPLETED_COURSE')
                                setPriorCourseOpen(false)
                              }}
                              style={{
                                background: newRuleType === 'COMPLETED_COURSE' ? "var(--portal-primary,#002147)" : "var(--portal-info-bg,#f1f5f9)",
                                color: newRuleType === 'COMPLETED_COURSE' ? '#ffffff' : "var(--portal-info-text,#475569)",
                                border: 'none',
                                borderRadius: '5px',
                                padding: '0.35rem 0.75rem',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              Completed Course Prerequisite
                            </button>
                          </div>
                        </div>

                        {/* DEPARTMENT Constraint View */}
                        {newRuleType === 'DEPARTMENT' && (() => {
                          const deptRule = courseRules.find(r => r.rule === 'DEPARTMENT')
                          const selectedDeptCodes = deptRule?.target ? deptRule.target.split(',').map(c => c.trim()).filter(Boolean) : []
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <label style={{ fontSize: '0.74rem', fontWeight: 600, color: "var(--portal-info-text,#334155)" }}>
                                  Select Allowed Departments ({selectedDeptCodes.length} selected):
                                </label>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                  <button
                                    type="button"
                                    onClick={() => updateDepartmentCodes(departments.map(d => d.code))}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: "var(--portal-info-text,#0284c7)",
                                      cursor: 'pointer',
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                      padding: 0
                                    }}
                                  >
                                    Select All
                                  </button>
                                  <span style={{ color: "var(--portal-info-text,#cbd5e1)", fontSize: '0.7rem' }}>•</span>
                                  <button
                                    type="button"
                                    onClick={() => updateDepartmentCodes([])}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: "var(--portal-danger-text,#dc2626)",
                                      cursor: 'pointer',
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                      padding: 0
                                    }}
                                  >
                                    Clear All
                                  </button>
                                </div>
                              </div>

                              <div className={styles.constraintDeptGrid}>
                                {departments.map(d => {
                                  const isChecked = selectedDeptCodes.includes(d.code)
                                  return (
                                    <label
                                      key={d.id}
                                      className={`${styles.constraintDeptLabel} ${isChecked ? styles.constraintDeptLabelActive : ''}`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={(e) => handleDepartmentToggle(d.code, e.target.checked)}
                                      />
                                      <span>{d.code}</span>
                                      <span style={{ color: "var(--portal-muted,#64748b)", fontSize: '0.7rem' }}>({d.name})</span>
                                    </label>
                                  )
                                })}
                              </div>

                              <div style={{ fontSize: '0.7rem', color: "var(--portal-muted,#64748b)", lineHeight: 1.4 }}>
                                Tip: Matches Blueprint slot rules (`DEPT_RESTRICTED`). Department restrictions apply during allocation. Registration follows the blueprint. Clear all departments to remove this allocation restriction.
                              </div>
                            </div>
                          )
                        })()}

                        {/* COMPLETED_COURSE Constraint View */}
                        {newRuleType === 'COMPLETED_COURSE' && (() => {
                          const activeCourseSem = courseSemester
                          if (activeCourseSem <= 1) {
                            return (
                              <div style={{
                                padding: '0.85rem',
                                background: "var(--portal-info-bg,#f8fafc)",
                                border: "1px solid var(--portal-strong-border,#e2e8f0)",
                                borderRadius: '6px',
                                color: "var(--portal-muted,#64748b)",
                                fontSize: '0.76rem',
                                lineHeight: 1.45,
                                textAlign: 'center'
                              }}>
                                Semester 1 courses cannot have completed course prerequisites because there are no prior semesters.
                              </div>
                            )
                          }

                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                              <label style={{ fontSize: '0.74rem', fontWeight: 600, color: "var(--portal-info-text,#334155)" }}>
                                Select Prerequisite Course (Prior Semesters Only):
                              </label>

                              {/* Custom Dropdown Trigger */}
                              <div className={styles.priorCourseDropdownWrapper}>
                                <button
                                  type="button"
                                  className={styles.priorCourseTrigger}
                                  onClick={() => setPriorCourseOpen(prev => !prev)}
                                >
                                  <span>
                                    {newRuleTarget ? (
                                      (() => {
                                        const match = priorCourses.find(c => c.course_code === newRuleTarget)
                                        return match
                                          ? `${match.course_code} — ${match.title} (Sem ${match.semester})`
                                          : newRuleTarget
                                      })()
                                    ) : (
                                      <span style={{ color: "var(--portal-info-text,#94a3b8)" }}>-- Select Prior Course --</span>
                                    )}
                                  </span>
                                  <ChevronDown size={16} style={{ color: "var(--portal-muted,#64748b)", transform: priorCourseOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
                                </button>

                                {priorCourseOpen && (
                                  <div className={styles.priorCourseMenu}>
                                    {/* Semester Filter Pills */}
                                    <div className={styles.priorCourseSemFilterRow}>
                                      <button
                                        type="button"
                                        className={`${styles.priorCourseSemPill} ${priorCourseSemesterFilter === null ? styles.priorCourseSemPillActive : ''}`}
                                        onClick={() => setPriorCourseSemesterFilter(null)}
                                      >
                                        All Prior
                                      </button>
                                      {Array.from({ length: Math.max(0, activeCourseSem - 1) }, (_, i) => i + 1).map(semNum => (
                                        <button
                                          key={semNum}
                                          type="button"
                                          className={`${styles.priorCourseSemPill} ${priorCourseSemesterFilter === semNum ? styles.priorCourseSemPillActive : ''}`}
                                          onClick={() => setPriorCourseSemesterFilter(semNum)}
                                        >
                                          Sem {semNum}
                                        </button>
                                      ))}
                                    </div>

                                    {/* Search Input inside Dropdown */}
                                    <input
                                      type="text"
                                      className={styles.priorCourseSearchInput}
                                      placeholder="Filter by course code or title..."
                                      value={priorCourseSearch}
                                      onChange={(e) => setPriorCourseSearch(e.target.value)}
                                      autoFocus
                                    />

                                    {/* Courses List */}
                                    <div className={styles.priorCourseList}>
                                      {loadingPriorCourses ? (
                                        <LoadingState layout="list" rows={2} compact message="Loading prior courses…" />
                                      ) : (
                                        (() => {
                                          const filtered = priorCourses.filter(c => {
                                            if (editCourse?.id && c.id === editCourse.id) return false
                                            if (c.semester >= activeCourseSem) return false
                                            if (priorCourseSemesterFilter !== null && c.semester !== priorCourseSemesterFilter) return false
                                            if (priorCourseSearch.trim()) {
                                              const q = priorCourseSearch.trim().toLowerCase()
                                              const matchCode = c.course_code?.toLowerCase().includes(q)
                                              const matchTitle = c.title?.toLowerCase().includes(q)
                                              if (!matchCode && !matchTitle) return false
                                            }
                                            return true
                                          })

                                          if (filtered.length === 0) {
                                            return (
                                              <div style={{ padding: '0.6rem', textAlign: 'center', fontSize: '0.75rem', color: "var(--portal-info-text,#94a3b8)", fontStyle: 'italic' }}>
                                                No prior courses found
                                              </div>
                                            )
                                          }

                                          return filtered.map(c => {
                                            const isAlreadyAdded = courseRules.some(r => r.rule === 'COMPLETED_COURSE' && r.target === c.course_code)
                                            const isSelected = newRuleTarget === c.course_code

                                            return (
                                              <div
                                                key={c.id}
                                                className={styles.priorCourseOption}
                                                style={{
                                                  opacity: isAlreadyAdded ? 0.6 : 1,
                                                  background: isSelected ? "var(--portal-info-bg,#e0f2fe)" : undefined,
                                                }}
                                                onClick={() => {
                                                  setNewRuleTarget(c.course_code)
                                                  setPriorCourseOpen(false)
                                                }}
                                              >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                  <span style={{ fontWeight: 600, color: "var(--portal-brand-text,#002147)" }}>
                                                    {c.course_code} — {c.title}
                                                  </span>
                                                  {isAlreadyAdded && (
                                                    <span style={{ fontSize: '0.68rem', color: "var(--portal-info-text,#0284c7)", fontWeight: 600 }}>
                                                      (Already Added)
                                                    </span>
                                                  )}
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: "var(--portal-muted,#64748b)" }}>
                                                  Semester {c.semester} • {c.credits} Credits • {c.category || 'General'}
                                                </div>
                                              </div>
                                            )
                                          })
                                        })()
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>

                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between' }}>
                                <input
                                  type="text"
                                  placeholder="Or enter course code manually"
                                  className={styles.input}
                                  style={{ margin: 0, fontSize: '0.75rem', padding: '0.45rem 0.6rem', flex: 1, textTransform: 'uppercase' }}
                                  value={newRuleTarget}
                                  onChange={(e) => setNewRuleTarget(e.target.value.toUpperCase())}
                                />
                                <button
                                  type="button"
                                  onClick={handleAddRule}
                                  disabled={!newRuleTarget.trim()}
                                  style={{
                                    background: !newRuleTarget.trim() ? "var(--portal-info-bg,#94a3b8)" : "var(--portal-primary,#002147)",
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '0.45rem 0.85rem',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    cursor: !newRuleTarget.trim() ? 'not-allowed' : 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.35rem',
                                    whiteSpace: 'nowrap',
                                    transition: 'background 0.15s ease'
                                  }}
                                >
                                  + Add Prerequisite
                                </button>
                              </div>
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sticky Footer */}
                <div className={styles.courseModalFooter}>
                  {error && (
                    <div className={styles.errorBanner} style={{ margin: 0, flex: 1, padding: '0.4rem 0.75rem', fontSize: '0.78rem' }}>
                      {error}
                    </div>
                  )}
                  <button
                    type="button"
                    className={styles.modalCancelBtn}
                    style={{ maxWidth: '140px' }}
                    onClick={() => {
                      setShowAddCourse(false)
                      setEditCourse(null)
                      setCourseCode('')
                      setCourseTitle('')
                      setCourseCredits(null)
                      setCourseTheoryHours(null)
                      setCoursePracticalHours(null)
                      setCourseCategory(null)
                      setCourseSeatLimit(60)
                      setCoursePrereqs([])
                      setCourseRules([])
                      setNewRuleTarget('')
                      setError('')
                    }}
                    disabled={savingCourse}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.modalConfirmBtn}
                    style={{ maxWidth: '180px' }}
                    onClick={handleSaveCourse}
                    disabled={savingCourse}
                  >
                    {savingCourse ? <LoadingIndicator message="Saving…" /> : editCourse ? 'Save Changes →' : 'Add Course →'}
                  </button>
                </div>
              </div>
            </AccessibleModal>
          )}

          {/* Delete Course Confirmation */}
          {deleteCourse && (
            <AccessibleModal className={styles.modalOverlay} label="Delete Course" busy={deletingCourse} onClose={() => { setDeleteCourse(null); setError('') }}>
              <div className={styles.modal}>
                <h3 className={styles.modalTitle}>Delete Course</h3>
                <p className={styles.modalSubtitle}>
                  Are you sure you want to delete <strong>{deleteCourse.title}</strong>?
                </p>
                {error && <div className={styles.errorBanner} style={{ marginBottom: '1rem' }}>{error}</div>}
                <div className={styles.modalActions}>
                  <button className={styles.modalCancelBtn} onClick={() => { setDeleteCourse(null); setError('') }} disabled={deletingCourse}>Cancel</button>
                  <button className={styles.modalDeleteBtn} onClick={handleDeleteCourse} disabled={deletingCourse}>
                    {deletingCourse ? <LoadingIndicator message="Deleting…" /> : 'Yes, Delete'}
                  </button>
                </div>
              </div>
            </AccessibleModal>
          )}
        </>
      )}

    </div>
  )
}
