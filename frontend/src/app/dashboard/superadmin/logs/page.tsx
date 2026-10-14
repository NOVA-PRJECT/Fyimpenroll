'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SuperAdminLogsRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/dashboard/superadmin?tab=logs')
  }, [router])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: "var(--portal-canvas,#f0f2f5)",
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: "var(--portal-brand-text,#002147)",
    }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontWeight: 600, fontSize: '1rem', margin: '0 0 0.5rem 0' }}>Opening System &amp; Audit Logs...</p>
        <p style={{ fontSize: '0.8rem', color: "var(--portal-muted,#64748b)", margin: 0 }}>Redirecting to SuperAdmin console</p>
      </div>
    </div>
  )
}
