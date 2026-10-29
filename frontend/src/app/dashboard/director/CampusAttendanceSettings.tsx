'use client'

import { useDataRevision } from '@/core/hooks/useDataRevision'
import SectionRefreshButton from '@/components/SectionRefreshButton'

import LoadingState, { LoadingIndicator } from '@/components/LoadingState'

import { useEffect, useState } from 'react'
import styles from '@/components/campus-attendance/campus-attendance.module.css'

const fields = [
  ['center_latitude', 'Campus centre latitude', 'number'],
  ['center_longitude', 'Campus centre longitude', 'number'],
  ['radius_meters', 'Allowed radius (metres)', 'number'],
  ['morning_cutoff_time', 'Morning on-time cutoff (IST)', 'time'],
  ['midday_split_time', 'Evening session starts (IST)', 'time'],
  ['evening_cutoff_time', 'Evening on-time cutoff (IST)', 'time'],
  ['day_end_time', 'Checkpoints close (IST)', 'time'],
] as const
type Field = typeof fields[number][0]

export default function CampusAttendanceSettings() {
  const dataRevision = useDataRevision(["settings"])
  const [values, setValues] = useState<Partial<Record<Field, string>>>({})
  const [savedValues, setSavedValues] = useState('{}')
  useDataRevision([], JSON.stringify(values) !== savedValues)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setReady(false)
      setError('')
      try {
        const res = await fetch('/api/director/attendance-settings', { cache: 'no-store', signal: controller.signal })
        const data = await res.json()
        if (!res.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Unable to load campus attendance settings.')
        const loaded = Object.fromEntries(fields.map(([key]) => [key, data.settings[key] == null ? '' : String(data.settings[key])]))
        setValues(loaded)
        setSavedValues(JSON.stringify(loaded))
        setReady(true)
        setError(data.setup_error || '')
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load settings.')
      }
    }
    void load()
    return () => controller.abort()
  }, [retry, dataRevision])

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError(''); setSuccess('')
    try {
      const payload = Object.fromEntries(fields.map(([key, , type]) => [key, type === 'number' ? Number(values[key]) : values[key]]))
      const res = await fetch('/api/director/attendance-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Unable to save settings.')
      setSuccess('Campus location and attendance timings saved.')
      setSavedValues(JSON.stringify(values))
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save settings.') }
    finally { setSaving(false) }
  }

  function renderField([key, label, type]: typeof fields[number]) {
    return <label key={key} className={styles.field}>
      {label}
      <input required type={type} value={values[key] ?? ''} className={styles.input}
        step={type === 'time' || key === 'radius_meters' ? 1 : 'any'}
        min={key === 'center_latitude' ? -90 : key === 'center_longitude' ? -180 : key === 'radius_meters' ? 1 : undefined}
        max={key === 'center_latitude' ? 90 : key === 'center_longitude' ? 180 : undefined}
        onChange={event => { setSuccess(''); setValues(previous => ({ ...previous, [key]: event.target.value })) }} />
    </label>
  }

  return <section className={styles.card} aria-labelledby="campus-settings-title">
    <span className={styles.eyebrow}>Attendance configuration</span>
    <h2 id="campus-settings-title" className={styles.title}>Campus sign-in settings</h2>
    <SectionRefreshButton className={styles.secondaryButton} label="Refresh attendance settings"
      endpoints={['/api/director/attendance-settings']} onRefresh={() => setRetry(value => value + 1)}
      disabled={saving || JSON.stringify(values) !== savedValues} />
    <p className={styles.description}>Manage the campus location and daily sign-in checkpoints. These settings are separate from course registration.</p>
    {error && <p role="alert" className={`${styles.notice} ${styles.errorNotice}`}>{error} {!ready && <button type="button" className={styles.secondaryButton} onClick={() => setRetry(value => value + 1)}>Retry</button>}</p>}
    {!ready && !error && <LoadingState layout="form" rows={7} compact message="Loading attendance settings…" />}
    {success && <p role="status" className={`${styles.notice} ${styles.successNotice}`}>{success}</p>}
    <form hidden={!ready} onSubmit={save}>
      <fieldset disabled={!ready || saving} className={styles.fieldset}>
        <div className={styles.formSection}>
          <h3 className={styles.sectionTitle}>Campus location</h3>
          <p className={styles.sectionDescription}>Use a verified centre point and a radius that covers the campus.</p>
          <div className={styles.settingsGrid}>{fields.slice(0, 3).map(renderField)}</div>
        </div>
        <div className={styles.formSection}>
          <h3 className={styles.sectionTitle}>Daily checkpoints</h3>
          <p className={styles.sectionDescription}>All checkpoint times use Indian Standard Time (IST).</p>
          <div className={styles.settingsGrid}>{fields.slice(3).map(renderField)}</div>
        </div>
        <button type="submit" className={styles.primaryButton}>{saving ? <LoadingIndicator message="Saving…" /> : 'Save campus sign-in settings'}</button>
      </fieldset>
    </form>
  </section>
}
