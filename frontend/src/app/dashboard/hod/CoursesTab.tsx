'use client'

import { apiErrorMessage } from '@/core/api-error'
import { createSemesterCatalogue, type CatalogueSnapshot } from '@/core/semester-catalogue'
import AccessibleModal from '@/components/AccessibleModal'
import LoadingState, { LoadingIndicator } from '@/components/LoadingState'
import PrerequisitePoint from './PrerequisitePoint'

import { BookOpen as UiBookOpen, Check as UiCheck, Pencil as UiPencil, Trash2 as UiTrash2, X as UiX } from 'lucide-react'

import { useState, useEffect } from 'react'
import { HOD_COURSE_CATEGORIES } from '@fyimp/contracts'
import styles from './hod-dashboard.module.css'

interface CatalogueCourse { is_own_campus?: boolean; is_own_dept?: boolean; department_name?: string; theory_hours_per_week: number; practical_hours_per_week: number; id: string; course_code: string; title: string; credits: number; category: string; semester: number; seat_limit: number; theory_hours: number; practical_hours: number; department_id: string; prerequisites?: string[]; departments?: { name: string; code: string } }
export default function CoursesTab({ semester, onSemesterChange: setSemester }: { semester: number; onSemesterChange: (semester: number) => void }) {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
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

  const [savingCourse, setSavingCourse] = useState(false)
  const [deletingCourse, setDeletingCourse] = useState(false)
  useEffect(() => { void catalogueLoader.start(semester) }, [semester, catalogueLoader])
  useEffect(() => () => catalogueLoader.dispose(), [catalogueLoader])

  async function handleSaveCourse() {
    if (!courseCode.trim()) { setError('Course code is required'); return }
    if (!courseTitle.trim()) { setError('Course title is required'); return }
    if (courseCredits === null || courseCredits === '') { setError('Credits are required'); return }
    if (!courseCategory) { setError('Category is required'); return }
    if (coursePrereqs.length > 20 || coursePrereqs.some(point => !point.trim() || point.trim().length > 500)) {
      setError('Use up to 20 prerequisite points, each between 1 and 500 characters.'); return
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
      prerequisites: coursePrereqs.map(point => point.trim()),
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
        setSuccess(editCourse && editCourse.semester !== courseSemester ? `Course moved to Semester ${courseSemester}. Course code is unchanged.` : data.message)
        setShowAddCourse(false)
        setEditCourse(null)
        setCourseCode(''); setCourseTitle(''); setCourseCredits(null); setCourseTheoryHours(null); setCoursePracticalHours(null); setCourseCategory(null)
        setCourseSeatLimit(60); setCoursePrereqs([])
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
                                  setCoursePrereqs(course.prerequisites ?? [])
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

                    <div className={styles.courseModalRightCol}>
                      <div className={styles.courseModalSectionTitle}>Prerequisites</div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--portal-muted,#64748b)', lineHeight: 1.5 }}>
                        Describe the knowledge or skills students should have. Students confirm they meet all points before choosing this course. Leave empty for no prerequisites.
                      </p>
                      {coursePrereqs.length === 0 && <p>No prerequisites configured.</p>}
                      {coursePrereqs.map((point, index) => (
                        <PrerequisitePoint key={index} value={point} index={index} count={coursePrereqs.length} disabled={savingCourse}
                          onChange={value => setCoursePrereqs(points => points.map((current, i) => i === index ? value : current))}
                          onMove={direction => setCoursePrereqs(points => {
                            const next = [...points]
                            const target = index + direction
                            if (target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]]
                            return next
                          })}
                          onRemove={() => setCoursePrereqs(points => points.filter((_, i) => i !== index))} />
                      ))}
                      <button type="button" className={styles.modalCancelBtn} disabled={savingCourse || coursePrereqs.length >= 20}
                        onClick={() => setCoursePrereqs(points => [...points, ''])}>+ Add prerequisite point</button>
                      <p style={{ fontSize: '0.75rem' }}>Changes are saved with the course. Answers stay in the student's browser.</p>
                      <p className={styles.prerequisitePointHint}>Hover over a point, or press and hold on mobile, to reorder or remove it.</p>
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
