'use client'

import { useEffect, useRef, useState } from 'react'
import { LogOut, LoaderCircle } from 'lucide-react'
import { performLogout, registerLogoutDialog } from '@/core/security/logout'
import { resumeSessionAfterLogoutFailure } from '@/core/security/refresh-coordinator'
import styles from './LogoutDialog.module.css'
import { keepDialogFocus } from './dialog-focus'

export default function LogoutDialog() {
  const dialog = useRef<HTMLDialogElement>(null)
  const resolve = useRef<((result: boolean) => void) | null>(null)
  const submitting = useRef(false)
  const [stage, setStage] = useState<'closed' | 'confirm' | 'busy' | 'error'>('closed')

  useEffect(() => registerLogoutDialog(() => new Promise<boolean>(done => {
    resolve.current = done
    setStage('confirm')
  })), [])

  useEffect(() => {
    const modal = dialog.current
    if (!modal || stage === 'closed') return
    const previousFocus = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    modal.showModal()
    return () => {
      modal.close()
      document.body.style.overflow = overflow
      requestAnimationFrame(() => previousFocus?.focus())
    }
  }, [stage === 'closed'])

  useEffect(() => { if (stage === 'busy') dialog.current?.focus() }, [stage])

  function close() {
    if (submitting.current) return
    if (stage === 'error') resumeSessionAfterLogoutFailure()
    setStage('closed')
    resolve.current?.(false)
    resolve.current = null
  }

  async function confirm() {
    if (submitting.current) return
    submitting.current = true
    setStage('busy')
    if (await performLogout()) {
      resolve.current?.(true)
      resolve.current = null
      // Keep the dialog locked until the full navigation completes.
      return
    }
    submitting.current = false
    setStage('error')
  }

  return <dialog ref={dialog} tabIndex={-1} className={styles.dialog} aria-labelledby="logout-title" aria-describedby="logout-description" aria-busy={stage === 'busy'} onKeyDown={keepDialogFocus}
    onCancel={event => { event.preventDefault(); close() }}>
    <div className={styles.icon} aria-hidden="true">{stage === 'busy' ? <LoaderCircle className={styles.spinner} /> : <LogOut />}</div>
    <h2 id="logout-title">{stage === 'busy' ? 'Logging out…' : stage === 'error' ? 'Logout not confirmed' : 'Log out?'}</h2>
    <p id="logout-description" role={stage === 'error' ? 'alert' : 'status'}>
      {stage === 'busy' ? 'Please wait while your session is signed out.' : stage === 'error'
        ? 'We could not confirm logout. Check your connection and retry. Your browser may already be signed out.'
        : 'You will be signed out of the portal on all devices.'}
    </p>
    {stage !== 'busy' && <div className={styles.actions}>
      <button type="button" onClick={close} autoFocus>{stage === 'error' ? 'Close' : 'Cancel'}</button>
      <button type="button" className={styles.primary} onClick={() => void confirm()}>{stage === 'error' ? 'Retry' : 'Log out'}</button>
    </div>}
  </dialog>
}
