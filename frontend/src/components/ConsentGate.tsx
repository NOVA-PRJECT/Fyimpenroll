'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export default function ConsentGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [consentPassed, setConsentPassed] = useState(false)

  useEffect(() => {
    // Exclude public and compliance pages from consent blocking
    if (
      pathname.startsWith('/privacy-policy') ||
      pathname.startsWith('/terms-of-use') ||
      pathname.startsWith('/consent') ||
      pathname.startsWith('/login') ||
      pathname.startsWith('/reset-password') ||
      pathname === '/dashboard/student/change-password'
    ) {
      setConsentPassed(true)
      return
    }

    let isMounted = true

    async function checkConsent() {
      try {
        const res = await fetch('/api/consent/status', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          if (!data.accepted) {
            router.replace('/consent')
            return
          }
          if (isMounted) setConsentPassed(true)
        } else {
          const data = await res.json().catch(() => ({}))
          if (data?.consent_required || !data?.accepted) {
            router.replace('/consent')
            return
          }
          if (res.status === 401) {
            router.replace('/login')
            return
          }
        }
      } catch (err) {
        console.warn('Consent verification check failed:', err)
      }
    }

    checkConsent()

    return () => {
      isMounted = false
    }
  }, [pathname, router])

  if (!consentPassed) {
    return null // Keep UI unrendered until consent validation passes
  }

  return <>{children}</>
}
