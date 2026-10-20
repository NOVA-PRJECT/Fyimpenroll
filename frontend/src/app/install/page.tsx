'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Download, CheckCircle2, Wifi, ArrowRight } from 'lucide-react'
import PortalHeader from '@/components/portal/PortalHeader'
import PortalFooter from '@/components/portal/PortalFooter'
import UniversityLogo from '@/components/UniversityLogo'
import { usePwa } from '@/components/pwa/PwaProvider'

export default function InstallPage() {
  const { canInstall, isInstalled, isIOS, install } = usePwa()
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState('')
  const [showHelp, setShowHelp] = useState(false)

  async function handleInstall() {
    setError('')
    if (!canInstall) {
      setShowHelp(true)
      return
    }
    setInstalling(true)
    try {
      if (await install() === 'unavailable') setShowHelp(true)
    } catch {
      setError('The installer could not open. You can use your browser’s install option below.')
      setShowHelp(true)
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[color:var(--portal-canvas,#f8f9ff)]">
      <PortalHeader variant="back" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-5 py-12 sm:py-20">
        <div className="mb-8 flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <UniversityLogo alt="Kannur University" width={50} height={56} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--portal-muted,#64748b)]">Your campus, closer</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Install FYIMP Portal</h1>
          </div>
        </div>
        <p className="max-w-xl text-base leading-7 text-[color:var(--portal-muted,#64748b)]">Keep your university portal on your home screen. Open your courses, timetable and attendance in a dedicated app window.</p>

        <section aria-label="Install the app" className="mt-8 rounded-2xl border border-[color:var(--portal-strong-border,#e2e8f0)] bg-[color:var(--portal-surface,#fff)] p-6 sm:p-8">
          {isInstalled ? (
            <>
              <CheckCircle2 aria-hidden="true" className="mb-4 text-[color:var(--portal-success-text,#047857)]" size={28} />
              <h2 className="text-xl font-semibold">You’re all set</h2>
              <p className="mt-2 text-sm leading-6 text-[color:var(--portal-muted,#64748b)]">FYIMP Portal is installed. You can open it from your home screen or app launcher.</p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold">Your portal, one tap away</h2>
              <p className="mt-2 text-sm leading-6 text-[color:var(--portal-muted,#64748b)]">Add FYIMP Portal to your home screen for quick access.</p>
              <button type="button" disabled={installing} onClick={handleInstall}
                aria-expanded={showHelp} aria-controls={showHelp ? 'install-help' : undefined}
                className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#082042] px-6 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto">
                <Download size={18} aria-hidden="true" />{installing ? 'Opening installer…' : 'Install app'}
              </button>
              {error && <p role="alert" className="mt-3 text-sm text-[color:var(--portal-danger-text,#b91c1c)]">{error}</p>}
              {showHelp && (
                <div id="install-help" role="status" className="mt-5 rounded-xl bg-[color:var(--portal-info-bg,#eef3fb)] p-4">
                  <h3 className="text-sm font-semibold">{isIOS ? 'Finish installing in Safari' : 'Use your browser to finish installing'}</h3>
                  {isIOS ? (
                    <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-[color:var(--portal-muted,#64748b)]">
                      <li>Open this website in Safari.</li>
                      <li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li>
                      <li>Keep <strong>Open as Web App</strong> enabled if shown, then tap <strong>Add</strong>.</li>
                    </ol>
                  ) : (
                    <p className="mt-2 text-sm leading-7 text-[color:var(--portal-muted,#64748b)]">This browser hasn’t offered a direct installer. In Chrome or Edge, open the menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. If you already installed the portal, open it from your app launcher.</p>
                  )}
                </div>
              )}
            </>
          )}
          <Link href="/" className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[color:var(--portal-info-text,#1e40af)]">Continue to portal <ArrowRight size={16} aria-hidden="true" /></Link>
        </section>

        <p className="mt-6 flex items-start gap-3 text-sm leading-6 text-[color:var(--portal-muted,#64748b)]"><Wifi size={20} aria-hidden="true" className="mt-0.5 shrink-0" />An internet connection is needed to sign in and view or submit academic records. If you lose your connection, the app shows a reconnect screen.</p>
      </main>
      <PortalFooter currentYear={new Date().getFullYear()} />
    </div>
  )
}
