'use client'

import { useEffect, useState } from 'react'

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
  const [values, setValues] = useState<Partial<Record<Field, string>>>({})
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setReady(false)
      try {
        const res = await fetch('/api/director/attendance-settings', { cache: 'no-store', signal: controller.signal })
        const data = await res.json()
        if (!res.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Unable to load campus attendance settings.')
        setValues(Object.fromEntries(fields.map(([key]) => [key, data.settings[key] == null ? '' : String(data.settings[key])])))
        setReady(true)
        setError(data.setup_error || '')
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unable to load settings.')
      }
    }
    void load()
    return () => controller.abort()
  }, [retry])

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
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save settings.') }
    finally { setSaving(false) }
  }

  return <section style={{ background: "var(--portal-surface,#fff)", border: "1px solid var(--portal-strong-border,#e2e8f0)", borderRadius: 12, padding: 24, marginBottom: 24 }}>
    <h2 style={{ marginTop: 0 }}>Campus sign-in settings</h2>
    <p>Use a verified campus centre and a radius that covers the campus. All attendance times are in IST.</p>
    {error && <p role="alert" style={{ color: "var(--portal-danger-text,#991b1b)" }}>{error} {!ready && <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button>}</p>}
    {!ready && !error && <p role="status">Loading attendance settings…</p>}
    {success && <p role="status" style={{ color: "var(--portal-success-text,#065f46)" }}>{success}</p>}
    <form onSubmit={save}>
      <fieldset disabled={!ready || saving} style={{ border: 0, padding: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          {fields.map(([key, label, type]) => <label key={key} style={{ display: 'grid', gap: 6 }}>
            {label}
            <input required type={type} value={values[key] ?? ''}
              step={type === 'time' || key === 'radius_meters' ? 1 : 'any'}
              min={key === 'center_latitude' ? -90 : key === 'center_longitude' ? -180 : key === 'radius_meters' ? 1 : undefined}
              max={key === 'center_latitude' ? 90 : key === 'center_longitude' ? 180 : undefined}
              onChange={event => { setSuccess(''); setValues(previous => ({ ...previous, [key]: event.target.value })) }}
              style={{ padding: 10, border: "1px solid var(--portal-strong-border,#94a3b8)", borderRadius: 6 }} />
          </label>)}
        </div>
        <button type="submit" style={{ marginTop: 16, padding: '10px 16px' }}>{saving ? 'Saving…' : 'Save campus sign-in settings'}</button>
      </fieldset>
    </form>
  </section>
}
