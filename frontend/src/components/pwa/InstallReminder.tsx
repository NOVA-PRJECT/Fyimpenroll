'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Download, X } from 'lucide-react'
import {
  installReminderStore,
  canShowInstallReminder,
  INSTALL_REMINDER_CHANGED_EVENT,
  INSTALL_REMINDER_DELAY,
  INSTALL_REMINDER_DISMISSED_KEY,
  INSTALL_REMINDER_LAST_SHOWN_KEY,
} from '@/core/pwa/install-reminder'
import styles from './install-reminder.module.css'

/** All Get the app actions share the same browser-local permanent opt-out. */
export function GetAppLink({ className }: { className?: string }) {
  return <Link href="/install" className={className}
    onClick={() => installReminderStore.dismissPermanently()}
    onAuxClick={(event) => { if (event.button === 1) installReminderStore.dismissPermanently() }}>
    <Download size={17} aria-hidden="true" />
    Get the app
  </Link>
}

export default function InstallReminder({ ready, installed, blocked }: {
  ready: boolean
  installed: boolean
  blocked: boolean
}) {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const allowed = canShowInstallReminder({ pathname, ready, installed, blocked })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      clearTimeout(timer)
      setVisible(false)
      if (!allowed || document.visibilityState !== 'visible' || !installReminderStore.isEligible()) return
      timer = setTimeout(() => {
        if (document.visibilityState !== 'visible' || !installReminderStore.isEligible()) return
        installReminderStore.markShown()
        setVisible(true)
      }, INSTALL_REMINDER_DELAY)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== INSTALL_REMINDER_LAST_SHOWN_KEY && event.key !== INSTALL_REMINDER_DISMISSED_KEY) return
      try { if (event.storageArea !== window.localStorage) return } catch { return }
      check()
    }
    check()
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', check)
    window.addEventListener(INSTALL_REMINDER_CHANGED_EVENT, check)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', check)
      window.removeEventListener(INSTALL_REMINDER_CHANGED_EVENT, check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [pathname, allowed])

  if (!visible || !allowed) return null

  return <div className={styles.backdrop} onClick={() => setVisible(false)}>
    <aside aria-label="App installation reminder" aria-live="polite" className={styles.card} onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label="Dismiss app reminder" className={styles.close} onClick={() => setVisible(false)}><X size={18} aria-hidden="true" /></button>
      <div className={styles.icon}><Download size={22} aria-hidden="true" /></div>
      <h2>Keep FYIMP Portal on your home screen</h2>
      <p>Quick access to your courses, timetable and attendance.</p>
      <div className={styles.actions}>
        <GetAppLink className={styles.primary} />
        <button type="button" className={styles.later} onClick={() => setVisible(false)}>Not now</button>
      </div>
    </aside>
  </div>
}
