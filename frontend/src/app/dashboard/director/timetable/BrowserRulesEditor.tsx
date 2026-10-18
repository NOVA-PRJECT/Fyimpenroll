'use client'

import { useEffect, useId, useRef, useState } from 'react'
import styles from './BrowserRulesEditor.module.css'
import {
  appliesToSemester, createWindowRule, SCHEDULING_CATEGORIES, validateSchedulingRules, WINDOW_RULE_KINDS,
  type SchedulingRule,
} from '@/core/utils/schedulingRules'
export type { SchedulingRule } from '@/core/utils/schedulingRules'

const ICONS = {
  close: 'm6 6 12 12M6 18 18 6',
  plus: 'M12 5v14M5 12h14',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  clock: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  reset: 'M3 4v6h6M3 10a9 9 0 1 1 0 5',
  check: 'm5 12 4 4L19 6',
  chevron: 'm6 9 6 6 6-6',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3m-4 9 3 3 5-5',
}
function Icon({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={ICONS[name]} /></svg>
}
const PERIOD_TIMES = ['09:30–10:30', '10:30–11:30', '11:30–12:30', '13:30–14:30', '14:30–15:30', '15:30–16:30']

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const SEMESTERS = Array.from({ length: 10 }, (_, i) => i + 1)

export default function BrowserRulesEditor({ rules, semester, repositoryRuleIds, onSave, onClose, onReset }: {
  rules: SchedulingRule[]; semester: number; repositoryRuleIds: string[]
  onSave: (rules: SchedulingRule[]) => void; onClose: () => void; onReset: () => void
}) {
  const [draft, setDraft] = useState(() => structuredClone(rules))
  const [courseCodeText, setCourseCodeText] = useState<Record<string, string>>({})
  const [showOtherSemesters, setShowOtherSemesters] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const semesterId = useId()
  const descriptionId = useId()
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    if (!dialog.open) dialog.showModal()
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus({ preventScroll: true })
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])
  const patch = (index: number, values: Partial<SchedulingRule>) => setDraft(old => old.map((rule, i) => i === index ? { ...rule, ...values } : rule))
  const validationError = validateSchedulingRules(draft)
  const visible = draft.map((rule, index) => ({ rule, index })).filter(({ rule }) => showOtherSemesters || appliesToSemester(rule, semester))
  const windows = visible.filter(({ rule }) => WINDOW_RULE_KINDS.includes(rule.kind))
  const otherRules = visible.filter(({ rule }) => !WINDOW_RULE_KINDS.includes(rule.kind))
  const newId = () => `director_${crypto.randomUUID()}`
  function addRule(kind: 'DAY_WINDOW' | 'CATEGORY_WINDOW') {
    setDraft(old => [...old, createWindowRule(kind, semester, newId())])
  }
  function targetSemester(index: number, value: string) {
    const target = value ? Number(value) : undefined
    patch(index, { targetSemester: target })
    if (target !== undefined && target !== semester) setShowOtherSemesters(true)
  }

  return <dialog
    ref={dialogRef}
    className={styles.modal}
    aria-labelledby={titleId + ' ' + semesterId}
    aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length > 0)
      const current = controls.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && current <= 0) {
        event.preventDefault()
        controls.at(-1)?.focus()
      } else if (!event.shiftKey && (current === controls.length - 1 || current < 0)) {
        event.preventDefault()
        controls[0]?.focus()
      }
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
    }}
  >
    <header className={styles.header}>
      <div className={styles.headerIcon}><Icon name="settings" size={23} /></div>
      <div className={styles.headerCopy}>
        <div className={styles.titleRow}>
          <h2 id={titleId} className={styles.title}>Scheduling rules</h2>
          <span id={semesterId} className={styles.semesterBadge}>Semester {semester}</span>
        </div>
        <p id={descriptionId} className={styles.subtitle}>Choose when your courses can run. Matching rules apply together.</p>
      </div>
      <button ref={closeRef} type="button" className={styles.iconButton + ' ' + styles.closeButton} aria-label="Close scheduling rules" title="Close" onClick={onClose}><Icon name="close" size={21} /></button>
    </header>

    <div className={styles.toolbar}>
      <div className={styles.addActions}>
        <button type="button" className={styles.button + ' ' + styles.primaryButton} disabled={draft.length >= 100} onClick={() => addRule('CATEGORY_WINDOW')}><Icon name="plus" size={16} />Add category rule</button>
        <button type="button" className={styles.button} disabled={draft.length >= 100} onClick={() => addRule('DAY_WINDOW')}><Icon name="clock" size={16} />Add availability rule</button>
      </div>
      <label className={styles.toggle}><input type="checkbox" checked={showOtherSemesters} onChange={e => setShowOtherSemesters(e.target.checked)} />Show other semesters</label>
    </div>

    <div className={styles.body}>
      <div className={styles.sectionHeading}>
        <h3>Scheduling windows <span className={styles.optional}>({windows.length})</span></h3>
        <p className={styles.sectionHint}>{showOtherSemesters ? 'Showing all semesters' : 'Semester ' + semester + ' and campus-wide rules'}</p>
      </div>
      {!windows.length && <div className={styles.emptyState}>
        <div className={styles.emptyIcon}><Icon name="clock" size={23} /></div>
        <h4>No scheduling windows yet</h4>
        <p>Add a category rule for AEC, MDC, SEC, VAC or DSC, or set availability for the whole campus.</p>
      </div>}

      {windows.map(({ rule, index }, position) => {
        const heading = rule.kind === 'CATEGORY_WINDOW' ? (rule.targetCategory || 'Course') + ' window' : 'Campus availability'
        const selectedDays = ((rule.parameters?.days ?? rule.parameters?.allowed_days) as number[] | undefined) ?? [1, 2, 3, 4, 5]
        const selectedPeriods = ((rule.parameters?.periods ?? rule.parameters?.allowed_periods) as number[] | undefined) ?? [1, 2, 3, 4, 5, 6]
        return <fieldset key={rule.id} className={styles.ruleCard}>
          <legend className={styles.srOnly}>{heading} · {rule.targetSemester ? 'Semester ' + rule.targetSemester : 'All semesters'}</legend>
          <div className={styles.cardHeader}>
            <div className={styles.cardHeading}>
              <span className={styles.ruleNumber}>{String(position + 1).padStart(2, '0')}</span>
              <h4>{heading}</h4>
              <span className={styles.scopeBadge}>{rule.targetSemester ? 'Semester ' + rule.targetSemester : 'All semesters'}</span>
            </div>
            <div className={styles.cardActions}>
              <button type="button" className={styles.iconButton} disabled={draft.length >= 100} title={'Copy for Semester ' + semester} aria-label={'Copy ' + heading + ' for Semester ' + semester} onClick={() => setDraft(old => [...old, { ...structuredClone(rule), id: newId(), targetSemester: semester, version: 1 }])}><Icon name="copy" size={16} /></button>
              {!repositoryRuleIds.includes(rule.id) && <button type="button" className={styles.iconButton + ' ' + styles.dangerButton} title="Remove rule" aria-label={'Remove ' + heading} onClick={() => setDraft(old => old.filter((_, i) => i !== index))}><Icon name="trash" size={16} /></button>}
            </div>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.formGrid}>
              <label className={styles.field}>Semester
                <select className={styles.input} aria-label={'Semester for rule ' + (index + 1)} value={rule.targetSemester ?? ''} onChange={e => targetSemester(index, e.target.value)}>
                  <option value="">All semesters</option>
                  {SEMESTERS.map(value => <option key={value} value={value}>Semester {value}</option>)}
                </select>
              </label>
              {rule.kind === 'CATEGORY_WINDOW' && <label className={styles.field}>Category
                <select className={styles.input} aria-label={'Category for rule ' + (index + 1)} value={rule.targetCategory ?? ''} onChange={e => patch(index, { targetCategory: e.target.value || undefined })}>
                  <option value="">Choose category</option>
                  {[...new Set([...SCHEDULING_CATEGORIES, ...(rule.targetCategory ? [rule.targetCategory] : [])])].map(category => <option key={category} value={category}>{category === 'AEC' ? 'AEC / AECC' : category === 'DSC' ? 'DSC (major and minor papers)' : category}</option>)}
                </select>
              </label>}
              <label className={styles.field}>Description
                <input className={styles.input} value={rule.description} maxLength={500} onChange={e => patch(index, { description: e.target.value })} />
              </label>
              {rule.kind === 'CATEGORY_WINDOW' && <label className={styles.field}>
                <span className={styles.labelRow}>Specific course codes <span className={styles.optional}>Optional</span></span>
                <input className={styles.input} placeholder="Leave empty to include the whole category" value={courseCodeText[rule.id] ?? ((rule.parameters?.courseCodes as string[] | undefined) ?? []).join(', ')} onChange={e => {
                  setCourseCodeText(old => ({ ...old, [rule.id]: e.target.value }))
                  const courseCodes = [...new Set(e.target.value.split(/[,\n]/).map(code => code.trim().toUpperCase()).filter(Boolean))]
                  const parameters = { ...rule.parameters }
                  if (courseCodes.length) parameters.courseCodes = courseCodes
                  else delete parameters.courseCodes
                  patch(index, { parameters })
                }} />
              </label>}
            </div>

            <fieldset className={styles.selectionGroup}>
              <legend>Allowed days</legend>
              <div className={styles.dayGrid}>
                {DAYS.map((day, i) => <label key={day} className={styles.choice}>
                  <input className={styles.choiceInput} type="checkbox" checked={selectedDays.includes(i + 1)} onChange={e => patch(index, { parameters: { ...rule.parameters, days: e.target.checked ? [...selectedDays, i + 1].sort() : selectedDays.filter(n => n !== i + 1) } })} />
                  <span className={styles.choiceTile}>{day}</span>
                </label>)}
              </div>
            </fieldset>
            <fieldset className={styles.selectionGroup}>
              <legend>Allowed periods</legend>
              <div className={styles.periodGrid}>
                {[1, 2, 3, 4, 5, 6].map(period => <label key={period} className={styles.choice}>
                  <input className={styles.choiceInput} type="checkbox" checked={selectedPeriods.includes(period)} onChange={e => patch(index, { parameters: { ...rule.parameters, periods: e.target.checked ? [...selectedPeriods, period].sort() : selectedPeriods.filter(n => n !== period) } })} />
                  <span className={styles.choiceTile}>P{period}<small>{PERIOD_TIMES[period - 1]}</small></span>
                </label>)}
              </div>
            </fieldset>
            <p className={styles.helperText}><Icon name="clock" size={14} />Lunch is 12:30–13:30. Contact hours, practical blocks and clash checks still apply.</p>
          </div>
        </fieldset>
      })}

      <details className={styles.coreRules}>
        <summary><Icon name="shield" />Core and other rules<span className={styles.coreCount}>{otherRules.length}</span><span className={styles.chevron}><Icon name="chevron" size={16} /></span></summary>
        <div className={styles.coreBody}>
          {otherRules.map(({ rule, index }) => <fieldset key={rule.id} className={styles.coreCard}>
            <legend>{rule.kind.replaceAll('_', ' ')}{rule.targetSemester ? ' · Semester ' + rule.targetSemester : ''}{rule.targetCategory ? ' · ' + rule.targetCategory : ''}</legend>
            <label className={styles.field}>Description
              <input className={styles.input} value={rule.description} maxLength={500} onChange={e => patch(index, { description: e.target.value })} />
            </label>
            {!rule.isHard && <label className={styles.field + ' ' + styles.weightField}>Preference weight
              <input className={styles.input} type="number" min={0} max={1000} value={rule.weight ?? 1} onChange={e => patch(index, { weight: Number(e.target.value) })} />
            </label>}
            {rule.isHard && <p className={styles.helperText}><Icon name="shield" size={14} />Required rule. Core safety checks always apply.</p>}
          </fieldset>)}
        </div>
      </details>
      <p className={styles.helperText}>Changes are saved in this browser for your campus and used when generating the matching semester.</p>
    </div>

    <footer className={styles.footer}>
      {validationError && <p role="alert" className={styles.validationError}>{validationError}</p>}
      <button type="button" className={styles.resetButton} aria-label="Restore defaults" title="Restore defaults" onClick={onReset}><Icon name="reset" size={15} /><span className={styles.resetLabel}>Restore defaults</span></button>
      <div className={styles.footerActions}>
        <button type="button" className={styles.button} onClick={onClose}>Cancel</button>
        <button type="button" className={styles.button + ' ' + styles.primaryButton} disabled={!!validationError} onClick={() => onSave(draft)}><Icon name="check" size={17} />Save rules</button>
      </div>
    </footer>
  </dialog>
}
