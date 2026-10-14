'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ROLE_DASHBOARD_MAP } from '@/core/security/routeConfig'
import { Role } from '@/core/constants/roles'
import PortalHeader from '@/components/portal/PortalHeader'
import PortalFooter from '@/components/portal/PortalFooter'
import { ArrowRight, BookOpen } from 'lucide-react'

export default function Home() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
      setChecking(false)
    }, 2500)

    async function checkSession() {
      try {
        const response = await fetch('/api/auth/profile', {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (response.ok) {
          const data = await response.json()
          if (data.role) {
            clearTimeout(timeoutId)
            const target = ROLE_DASHBOARD_MAP[data.role as Role] || '/dashboard/student'
            router.replace(target)
            return
          }
        }
      } catch (err: unknown) {
        if ((err instanceof Error ? err.name : '') !== 'AbortError') {
          console.error('Session check failed:', err)
        }
      } finally {
        clearTimeout(timeoutId)
        setChecking(false)
      }
    }

    checkSession()

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setChecking(true)
        checkSession()
      }
    }

    window.addEventListener('pageshow', handlePageShow)
    return () => {
      clearTimeout(timeoutId)
      controller.abort()
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [router])

  return (
    <div className="bg-[color:var(--portal-canvas,#f8f9ff)] text-[color:var(--portal-brand-text,#0b1c30)] flex flex-col min-h-screen selection:bg-[color:var(--portal-info-bg,#d3e4fe)] selection:text-[color:var(--portal-brand-text,#0b1c30)]">
      {/* Institutional Navigation Bar */}
      <PortalHeader variant="home" />

      {/* Main Hero Section */}
      <main className="flex-grow flex flex-col items-center justify-center px-4 sm:px-6 md:px-8 py-16 md:py-24">
        <div className="w-full max-w-4xl mx-auto flex flex-col items-center text-center">
          {/* Hero Tag Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-[color:var(--portal-info-bg,#eff4ff)] rounded-full mb-6 border border-[color:var(--portal-warning-border,#E0A92C)]/40 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-[#E0A92C]" />
            <span className="text-xs font-semibold tracking-wide text-[color:var(--portal-brand-text,#0b1c30)]">
              Five-Year Integrated Masters Programme
            </span>
          </div>

          {/* Editorial Headline */}
          <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl text-[color:var(--portal-brand-text,#0b1c30)] tracking-tight max-w-3xl mx-auto mb-4 font-normal">
            Welcome to FYIMP Portal
          </h1>

          <div className="w-12 h-0.5 bg-[#E0A92C] rounded-full mx-auto mb-8" />

          <p className="text-sm sm:text-base text-[color:var(--portal-info-text,#475569)] max-w-xl mx-auto mb-10 leading-relaxed font-normal">
            Unified institutional platform for curriculum registration, course preference allocation, and academic governance.
          </p>

          {/* Primary & Secondary CTA */}
          <div className="flex flex-wrap items-center justify-center gap-4 mb-8">
            <Link
              href="/login"
              className="px-6 py-3 bg-[color:var(--portal-primary,#0B192C)] text-white rounded-lg text-sm font-medium hover:bg-[color:var(--portal-primary,#152846)] transition-all inline-flex items-center gap-2 shadow-sm border border-[color:var(--portal-info-border,#0B192C)]"
            >
              <span>Access Portal</span>

            </Link>
            <Link
              href="/terms-of-use"
              className="px-5 py-3 text-[color:var(--portal-brand-text,#0B192C)] hover:bg-[color:var(--portal-info-bg,#dce9ff)]/50 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2 border border-[color:var(--portal-warning-border,#E0A92C)]/30 bg-[color:var(--portal-surface,white)]"
            >
              <span>Academic Guidelines</span>
            </Link>
          </div>

          {/* Pulsing 3-dot yellow loader in space between CTA and footer while checking session */}
          <div className="h-6 flex items-center justify-center mb-8">
            {checking && (
              <div className="flex items-center justify-center gap-2 transition-opacity duration-300" aria-label="Checking session status">
                <span className="w-2.5 h-2.5 rounded-full bg-[#E0A92C] animate-pulse [animation-delay:0ms]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#E0A92C] animate-pulse [animation-delay:200ms]" />
                <span className="w-2.5 h-2.5 rounded-full bg-[#E0A92C] animate-pulse [animation-delay:400ms]" />
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Statutory Institutional Footer */}
      <PortalFooter />
    </div>
  )
}
