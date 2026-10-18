'use client'

import { useEffect, useRef } from 'react'
import { keepDialogFocus } from './dialog-focus'

/** Native modal focus containment and Escape handling, with busy-state protection. */
export default function AccessibleModal({ children, className, label, busy, onClose }: {
  children: React.ReactNode; className?: string; label: string; busy?: boolean; onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const modal = ref.current
    const previousFocus = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    modal?.showModal()
    return () => {
      modal?.close()
      document.body.style.overflow = overflow
      requestAnimationFrame(() => previousFocus?.focus())
    }
  }, [])
  return <dialog ref={ref} tabIndex={-1} className={className} aria-label={label} aria-busy={busy || undefined} onKeyDown={keepDialogFocus}
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
    style={{ margin: 0, padding: 0, border: 0, maxWidth: 'none', maxHeight: 'none', width: '100vw', height: '100dvh', color: 'inherit' }}>
    {children}
  </dialog>
}
