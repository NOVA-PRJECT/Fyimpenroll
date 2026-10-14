'use client'

import { useState } from 'react'

export interface SchedulingRule {
  id: string; kind: string; scope: string; description: string; isHard: boolean
  weight?: number; version?: number; targetSemester?: number; targetCategory?: string
  parameters?: Record<string, unknown>
}

export default function BrowserRulesEditor({ rules, onSave, onClose, onReset }: {
  rules: SchedulingRule[]; onSave: (rules: SchedulingRule[]) => void; onClose: () => void; onReset: () => void
}) {
  const [draft, setDraft] = useState(() => structuredClone(rules))
  const patch = (index: number, values: Partial<SchedulingRule>) => setDraft(old => old.map((rule, i) => i === index ? { ...rule, ...values } : rule))
  const validationError = draft.length > 100 ? 'Use at most 100 rules.' : draft.some(rule =>
    !rule.description.trim() || (rule.weight !== undefined && (!Number.isFinite(rule.weight) || rule.weight < 0 || rule.weight > 1000)) ||
    ['days', 'periods', 'allowed_days', 'allowed_periods'].some(key => Array.isArray(rule.parameters?.[key]) && (rule.parameters![key] as number[]).length === 0)
  ) ? 'Each rule needs a description, a valid weight, and at least one selected day and period.' : ''
  return <div role="dialog" aria-modal="true" aria-label="Scheduling rules" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0009', display: 'grid', placeItems: 'center' }}>
    <section style={{ background: "var(--portal-surface,white)", color: "var(--portal-brand-text,#172033)", padding: 24, width: 'min(800px, 95vw)', maxHeight: '90vh', overflow: 'auto', borderRadius: 12 }}>
      <h2>Scheduling rules</h2>
      <p>Edits are saved in this browser for your campus and sent with generation requests. The shared rule file stays unchanged. Descriptions are labels; the controls below change scheduling behavior.</p>
      {draft.map((rule, index) => <fieldset key={rule.id} style={{ marginBottom: 16, padding: 12 }}>
        <legend>{rule.kind.replaceAll('_', ' ')}{rule.targetSemester ? ` · Semester ${rule.targetSemester}` : ''}{rule.targetCategory ? ` · ${rule.targetCategory}` : ''}</legend>
        <label>Description <input style={{ width: '100%' }} value={rule.description} maxLength={500} onChange={e => patch(index, { description: e.target.value })} /></label>
        {!rule.isHard && <label>Preference weight <input type="number" min={0} max={1000} value={rule.weight ?? 1} onChange={e => patch(index, { weight: Number(e.target.value) })} /></label>}
        {['DAY_WINDOW', 'CAMPUS_TIME_LIMIT', 'CATEGORY_WINDOW'].includes(rule.kind) && <>
          <p>Allowed days</p>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, i) => {
            const selected = ((rule.parameters?.days ?? rule.parameters?.allowed_days) as number[] | undefined) ?? [1, 2, 3, 4, 5]
            return <label key={day} style={{ marginRight: 12 }}><input type="checkbox" checked={selected.includes(i + 1)} onChange={e => patch(index, { parameters: { ...rule.parameters, days: e.target.checked ? [...selected, i + 1] : selected.filter(n => n !== i + 1) } })} />{day}</label>
          })}
          <p>Allowed periods</p>
          {[1, 2, 3, 4, 5, 6].map(period => {
            const selected = ((rule.parameters?.periods ?? rule.parameters?.allowed_periods) as number[] | undefined) ?? [1, 2, 3, 4, 5, 6]
            return <label key={period} style={{ marginRight: 12 }}><input type="checkbox" checked={selected.includes(period)} onChange={e => patch(index, { parameters: { ...rule.parameters, periods: e.target.checked ? [...selected, period] : selected.filter(n => n !== period) } })} />P{period}</label>
          })}
        </>}
        {rule.isHard && <small style={{ display: 'block', marginTop: 8 }}>Required rule. Core overlap, contact-hour and practical-block checks always apply.</small>}
      </fieldset>)}
      <button disabled={draft.length >= 100} onClick={() => setDraft(old => [...old, { id: crypto.randomUUID(), kind: 'DAY_WINDOW', scope: 'campus', isHard: true, description: 'Campus availability', parameters: { days: [1, 2, 3, 4, 5], periods: [1, 2, 3, 4, 5, 6] } }])}>Add availability rule</button>{' '}
      <button onClick={onReset}>Restore repository rules</button>{' '}<button onClick={onClose}>Cancel</button>{' '}
      {validationError && <p role="alert">{validationError}</p>}
      <button disabled={!!validationError} onClick={() => onSave(draft)}>Save in this browser</button>
    </section>
  </div>
}
