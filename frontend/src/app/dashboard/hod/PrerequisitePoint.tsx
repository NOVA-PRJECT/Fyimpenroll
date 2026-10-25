'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import styles from './hod-dashboard.module.css'

export default function PrerequisitePoint({ value, index, count, disabled, onChange, onMove, onRemove }: {
  value: string; index: number; count: number; disabled: boolean
  onChange: (value: string) => void; onMove: (direction: -1 | 1) => void; onRemove: () => void
}) {
  const [controlsOpen, setControlsOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const press = useRef<{ x: number; y: number; held: boolean } | null>(null)

  function cancelTimer() {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setControlsOpen(false)
    }
    function onScroll() { cancelTimer(); setControlsOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      cancelTimer()
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [])

  function act(action: () => void) {
    cancelTimer()
    press.current = null
    setControlsOpen(false)
    action()
  }

  return <div ref={root} className={styles.prerequisitePoint} data-controls-open={controlsOpen || undefined}
    onPointerDown={event => {
      cancelTimer()
      press.current = null
      if (disabled || event.pointerType === 'mouse' || (event.target as HTMLElement).closest('button')) return
      press.current = { x: event.clientX, y: event.clientY, held: false }
      timer.current = setTimeout(() => {
        if (press.current) {
          press.current.held = true
          setControlsOpen(true)
        }
      }, 500)
    }}
    onPointerMove={event => {
      const start = press.current
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancelTimer()
    }}
    onPointerUp={cancelTimer} onPointerCancel={() => { cancelTimer(); press.current = null }}
    onContextMenu={event => { if (press.current || controlsOpen) event.preventDefault() }}
    onClickCapture={event => {
      if (press.current?.held) { event.preventDefault(); event.stopPropagation(); press.current = null }
    }}
    onKeyDown={event => {
      if (event.key === 'Escape' && controlsOpen) {
        event.preventDefault()
        event.stopPropagation()
        setControlsOpen(false)
        root.current?.querySelector('textarea')?.focus()
      }
    }}>
    <textarea value={value} maxLength={500} rows={3} aria-label={`Prerequisite ${index + 1}`}
      className={`${styles.input} ${styles.prerequisitePointInput}`} disabled={disabled}
      placeholder="For example: You should know the C programming language."
      onChange={event => onChange(event.target.value)} />
    <span className={styles.prerequisitePointCount}>{value.length}/500</span>
    <div className={styles.prerequisitePointActions} role="group" aria-label={`Actions for prerequisite ${index + 1}`}>
      <button type="button" disabled={disabled || index === 0} onClick={() => act(() => onMove(-1))}
        aria-label={`Move prerequisite ${index + 1} up`} title="Move up"><ArrowUp size={16} aria-hidden="true" /></button>
      <button type="button" disabled={disabled || index === count - 1} onClick={() => act(() => onMove(1))}
        aria-label={`Move prerequisite ${index + 1} down`} title="Move down"><ArrowDown size={16} aria-hidden="true" /></button>
      <button type="button" disabled={disabled} onClick={() => act(onRemove)}
        aria-label={`Remove prerequisite ${index + 1}`} title="Remove"><Trash2 size={16} aria-hidden="true" /></button>
    </div>
  </div>
}
