'use client'

import { useCallback, useEffect, useState } from 'react'
import styles from './director-dashboard.module.css'

type Candidate = { id: string; full_name: string; cap_application_number: string; departments?: { name: string } | null }

export default function GraduationPanel() {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [review, setReview] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/campus/graduation-candidates', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Unable to load graduating students.')
      setCandidates(data.candidates)
      setSelected(previous => previous.filter(id => data.candidates.some((c: Candidate) => c.id === id)))
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load graduating students.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  async function deleteSelected() {
    setDeleting(true); setError(''); setSuccess('')
    try {
      const response = await fetch('/api/admin/campus/graduate-students', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student_ids: selected }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Deletion was not completed.')
      setSuccess(`${data.deleted_count} graduating student account(s) deleted.`)
      setSelected([])
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'Connection lost.'} The list has been refreshed; verify the remaining accounts before retrying.`)
    } finally {
      await refresh(); setReview(false); setDeleting(false)
    }
  }

  return <section aria-labelledby="graduation-title">
    <h2 id="graduation-title" className={styles.sectionTitle}>Graduation deletion</h2>
    <p>Students in semester 11 have completed their programme. Review and delete their accounts separately from semester promotion.</p>
    {error && <div role="alert" className={styles.errorBanner}>{error}</div>}
    {success && <div role="status" className={styles.successBanner}>{success}</div>}
    <button className={styles.secondaryBtn} disabled={loading || deleting} onClick={() => { setError(''); void refresh() }}>Refresh list</button>
    {loading ? <p role="status">Loading graduating students…</p> : candidates.length === 0 ? <p>No semester-11 students are awaiting deletion.</p> : <>
      <p>{candidates.length} eligible student(s). Select up to 500 accounts.</p>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', textAlign: 'left', borderSpacing: '0 12px' }}>
        <thead><tr><th>Select</th><th>Admission number</th><th>Student</th><th>Department</th></tr></thead>
        <tbody>{candidates.map(candidate => <tr key={candidate.id}>
          <td><input type="checkbox" aria-label={`Select ${candidate.full_name}`} disabled={deleting || review || (!selected.includes(candidate.id) && selected.length >= 500)} checked={selected.includes(candidate.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, candidate.id] : previous.filter(id => id !== candidate.id))} /></td>
          <td>{candidate.cap_application_number}</td><td>{candidate.full_name}</td><td>{candidate.departments?.name || '—'}</td>
        </tr>)}</tbody>
      </table></div>
      {review ? <div className={styles.windowCard}>
        <p><strong>Permanently delete {selected.length} selected account(s)?</strong></p>
        <p>This removes their login accounts, profiles and registration/credit-ledger records. Institutional timetable and teacher-assignment history is preserved. This action cannot be undone.</p>
        <button className={styles.primaryBtn} disabled={deleting} onClick={deleteSelected}>{deleting ? 'Deleting…' : `Delete ${selected.length} account(s)`}</button>{' '}
        <button className={styles.secondaryBtn} disabled={deleting} onClick={() => setReview(false)}>Cancel</button>
      </div> : <button className={styles.primaryBtn} disabled={!selected.length || deleting} onClick={() => { setReview(true); setError(''); setSuccess('') }}>Review selected accounts</button>}
    </>}
  </section>
}
