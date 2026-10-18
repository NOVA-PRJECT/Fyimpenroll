import type { KeyboardEvent } from 'react'

export function keepDialogFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return
  const dialog = event.currentTarget
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )).filter(element => element.getClientRects().length > 0)
  const first = controls[0], last = controls.at(-1)
  if (!first) { event.preventDefault(); dialog.focus(); return }
  const active = dialog.ownerDocument.activeElement
  if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault(); last?.focus()
  } else if (!event.shiftKey && (active === last || active === dialog)) {
    event.preventDefault(); first.focus()
  }
}
