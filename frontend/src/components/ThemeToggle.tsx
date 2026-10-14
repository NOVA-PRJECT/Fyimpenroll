'use client'

import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react'
import { Moon, Sun } from 'lucide-react'
import { THEME_KEY, THEME_POSITION_KEY } from '@/core/theme/preferences'
import styles from './theme-toggle.module.css'

type Position = { x: number; y: number }

export default function ThemeToggle() {
  const control = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; origin: Position; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const location = useRef<Position | null>(null)
  const [position, setPosition] = useState<Position | null>(null)
  const [dark, setDark] = useState(false)
  const [ready, setReady] = useState(false)
  const [dragging, setDragging] = useState(false)

  function clamp(next: Position): Position {
    const bounds = control.current?.getBoundingClientRect()
    const width = window.visualViewport?.width ?? window.innerWidth
    const height = window.visualViewport?.height ?? window.innerHeight
    return {
      x: Math.max(12, Math.min(next.x, width - (bounds?.width || 44) - 12)),
      y: Math.max(12, Math.min(next.y, height - (bounds?.height || 44) - 12)),
    }
  }

  function move(next: Position, save = false) {
    const value = clamp(next)
    location.current = value
    setPosition(value)
    if (save) {
      try { localStorage.setItem(THEME_POSITION_KEY, JSON.stringify(value)) } catch {}
    }
  }

  useEffect(() => {
    const applyTheme = (theme: string | null) => {
      const isDark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
      setDark(isDark)
    }
    let savedTheme: string | null = null
    try { savedTheme = localStorage.getItem(THEME_KEY) } catch {}
    applyTheme(savedTheme)
    try {
      const saved = JSON.parse(localStorage.getItem(THEME_POSITION_KEY) ?? 'null')
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) move(saved)
    } catch {}
    setReady(true)

    const resize = () => {
      if (location.current) move(location.current, true)
    }
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemChange = () => {
      let stored: string | null = null
      try { stored = localStorage.getItem(THEME_KEY) } catch {}
      if (stored !== 'light' && stored !== 'dark') applyTheme(null)
    }
    const onStorageChange = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) applyTheme(event.newValue)
    }
    window.addEventListener('resize', resize)
    window.visualViewport?.addEventListener('resize', resize)
    window.addEventListener('storage', onStorageChange)
    systemTheme.addEventListener('change', onSystemChange)
    return () => {
      window.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('resize', resize)
      window.removeEventListener('storage', onStorageChange)
      systemTheme.removeEventListener('change', onSystemChange)
    }
  }, [])

  function toggleTheme() {
    const next = !dark
    document.documentElement.dataset.theme = next ? 'dark' : 'light'
    document.documentElement.style.colorScheme = next ? 'dark' : 'light'
    setDark(next)
    try { localStorage.setItem(THEME_KEY, next ? 'dark' : 'light') } catch {}
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0 || !control.current) return
    const bounds = control.current.getBoundingClientRect()
    suppressClick.current = false
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: { x: bounds.left, y: bounds.top }, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current
    if (!start || start.pointerId !== event.pointerId) return
    if (!start.moved) {
      // Allow a small amount of finger movement during a tap.
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8) return
      start.moved = true
      suppressClick.current = true
      setDragging(true)
    }
    move({ x: start.origin.x + event.clientX - start.x, y: start.origin.y + event.clientY - start.y })
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current
    if (!start || start.pointerId !== event.pointerId) return
    if (event.type === 'pointerup') moveDrag(event)
    else suppressClick.current = true
    drag.current = null
    setDragging(false)
    if (start.moved && location.current) move(location.current, true)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const delta: Record<string, Position> = { ArrowLeft: { x: -24, y: 0 }, ArrowRight: { x: 24, y: 0 }, ArrowUp: { x: 0, y: -24 }, ArrowDown: { x: 0, y: 24 } }
    const step = delta[event.key]
    const bounds = control.current?.getBoundingClientRect()
    if (!step || !bounds) return
    event.preventDefault()
    move({ x: bounds.left + step.x, y: bounds.top + step.y }, true)
  }

  return (
    <button
      ref={control}
      type="button"
      className={styles.control}
      data-dragging={dragging}
      data-ready={ready}
      style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}
      role="switch"
      aria-label="Dark mode"
      aria-checked={dark}
      aria-description="Tap to switch theme. Drag to move, or use arrow keys."
      title={`${dark ? 'Switch to light mode' : 'Switch to dark mode'} · Drag to move`}
      draggable={false}
      onDragStart={event => event.preventDefault()}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={moveWithKeyboard}
      onClick={event => {
        const wasDragged = suppressClick.current && event.detail > 0
        suppressClick.current = false
        if (wasDragged) return
        toggleTheme()
      }}
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  )
}
