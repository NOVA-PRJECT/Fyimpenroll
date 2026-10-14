'use client'

export const dynamic = 'force-dynamic'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import PortalHeader from '@/components/portal/PortalHeader'
import PortalFooter from '@/components/portal/PortalFooter'
import { supabase } from '@/core/supabase/client'
import { AlertCircle, ArrowLeft, ArrowRight, CircleCheck, Info, KeyRound, LoaderCircle, Mail } from 'lucide-react'

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [messageOverride, setInfoMessage] = useState<string | null>(null)
  const infoMessage = messageOverride ?? searchParams.get('message') ?? ''


  async function handleFormSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault()
    setError('')
    setInfoMessage('')

    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError('Please enter your university email address.')
      return
    }
    if (!/\S+@\S+\.\S+/.test(trimmedEmail)) {
      setError('Please enter a valid email address.')
      return
    }

    setLoading(true)

    try {
      const redirectTo = `${window.location.origin}/reset-password/confirm`
      await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo,
      })
    } catch (err) {
      console.error('Password reset dispatch handled:', err)
      // Never reveal whether the email exists or if an error occurred
    } finally {
      setSent(true)
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-[460px] flex flex-col items-center">
      {/* Main Institutional Card */}
      <div className="w-full bg-[color:var(--portal-surface,white)] rounded-xl shadow-md overflow-hidden relative border border-[color:var(--portal-strong-border,#E2E8F0)]">
        {/* Authority Header Banner */}
        <div className="bg-[color:var(--portal-primary,#082042)] py-7 px-8 text-center">
          <div className="w-10 h-10 rounded-full bg-white/10 mx-auto mb-3.5 flex items-center justify-center">
            <KeyRound size={20} className="text-[color:var(--portal-warning-text,#f7bd40)] shrink-0" aria-hidden="true" />
          </div>
          <h1 className="font-serif text-2xl text-white font-medium tracking-tight">
            Reset Your Password
          </h1>
          <div className="w-12 h-0.5 bg-[#E0A92C] mx-auto my-3 rounded-full" />
          <p className="text-xs text-[color:var(--portal-info-text,#dce9ff)] max-w-xs mx-auto leading-relaxed">
            Enter your registered university email to receive a password reset link.
          </p>
        </div>

        {/* Form & Interactive Panel Body */}
        <div className="p-6 md:p-8 space-y-5 bg-[color:var(--portal-surface,white)]">
          {/* Info Banner from Redirect */}
          {infoMessage && !sent && (
            <div className="rounded-lg p-3.5 flex items-start gap-3 text-xs bg-[color:var(--portal-info-bg,#eff6ff)] border border-[color:var(--portal-info-border,#bfdbfe)] text-[color:var(--portal-info-text,#1e40af)]">
              <Info size={18} className="text-[color:var(--portal-info-text,#3b82f6)] mt-0.5 shrink-0" aria-hidden="true" />
              <span className="flex-1">{infoMessage}</span>
            </div>
          )}

          {/* Neutral Confirmation Banner (Same message for all outcomes) */}
          {sent ? (
            <div className="space-y-5">
              <div
                className="rounded-lg p-4 flex items-start gap-3 text-xs bg-[color:var(--portal-success-bg,#f0fdf4)] border border-[color:var(--portal-success-border,#bbf7d0)] text-[color:var(--portal-success-text,#166534)]"
                id="statusNotification"
              >
                <CircleCheck size={20} className="text-[color:var(--portal-success-text,#16a34a)] mt-0.5 shrink-0" aria-hidden="true" />
                <div className="flex-1 leading-relaxed">
                  <span className="font-semibold block text-sm text-[color:var(--portal-success-text,#14532d)] mb-1">
                    Check your email
                  </span>
                  <span>
                    If that email is registered, you will receive a reset link shortly. Check your inbox and spam folder. If the email arrives in Spam, please move it to your Inbox before clicking the link so your email provider does not pre-consume the single-use security token.
                  </span>
                </div>
              </div>

              <div className="pt-2 text-center space-y-2">
                <Link
                  className="w-full h-11 bg-[color:var(--portal-primary,#082042)] hover:bg-[color:var(--portal-primary,#0B192C)] text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
                  href="/login"
                >
                  <ArrowLeft size={16} className="shrink-0" aria-hidden="true" />
                  <span>Back to Sign In</span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setSent(false)
                    setEmail('')
                  }}
                  className="text-xs text-[color:var(--portal-muted,#64748b)] hover:text-[color:var(--portal-brand-text,#1e293b)] underline transition-colors"
                >
                  Send another link
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Error Notification Banner */}
              {error && (
                <div className="rounded-lg p-3.5 flex items-start gap-3 text-xs bg-[color:var(--portal-danger-bg,#ffdad6)] border border-[color:var(--portal-danger-border,#ba1a1a)]/30 text-[color:var(--portal-danger-text,#93000a)]">
                  <AlertCircle size={18} className="text-[color:var(--portal-danger-text,#ba1a1a)] mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="flex-1">{error}</span>
                </div>
              )}

              {/* Password Recovery Form */}
              <form className="space-y-5" id="recoveryForm" onSubmit={handleFormSubmit}>
                {/* Email Input Field Block */}
                <div className="flex flex-col gap-1.5">
                  <label
                    className="text-[11px] font-bold text-[color:var(--portal-muted,#44474e)] uppercase tracking-wider"
                    htmlFor="recoveryEmail"
                  >
                    University Email Address
                  </label>
                  <div className="h-11 px-3.5 bg-[color:var(--portal-info-bg,#EEF3FB)] border border-[color:var(--portal-strong-border,#CBD5E1)] rounded-lg text-sm text-[color:var(--portal-brand-text,#0B192C)] focus-within:bg-[color:var(--portal-surface,white)] focus-within:border-[color:var(--portal-info-border,#082042)] focus-within:ring-2 focus-within:ring-[color:var(--portal-info-border,#082042)]/15 flex items-center gap-2.5 transition-all">
                    <Mail size={18} className="text-[color:var(--portal-muted,#75777f)] shrink-0" aria-hidden="true" />
                    <input
                      autoComplete="email"
                      className="text-sm text-[color:var(--portal-brand-text,#0B192C)] placeholder:text-[color:var(--portal-muted,#75777f)] w-full bg-transparent outline-none border-none p-0 focus:ring-0"
                      id="recoveryEmail"
                      name="email"
                      placeholder="scholar@kannuruniv.ac.in"
                      required
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        if (error) setError('')
                      }}
                      disabled={loading}
                    />
                  </div>
                  <span className="text-[11px] text-[color:var(--portal-muted,#75777f)]">
                    Must correspond to your Kannur University registration register.
                  </span>
                </div>

                {/* Primary Action CTA Button */}
                <button
                  className="w-full h-11 bg-[color:var(--portal-primary,#082042)] hover:bg-[color:var(--portal-primary,#0B192C)] text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm active:scale-[0.99] cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed"
                  id="submitBtn"
                  type="submit"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <LoaderCircle size={16} className="animate-spin shrink-0" aria-hidden="true" />
                      <span>Sending Reset Link...</span>
                    </>
                  ) : (
                    <>
                      <span>Send Recovery Link</span>
                      <ArrowRight size={16} className="shrink-0" aria-hidden="true" />
                    </>
                  )}
                </button>
              </form>

              {/* Back Navigation Link */}
              <div className="pt-2 text-center">
                <Link
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[color:var(--portal-muted,#44474e)] hover:text-[color:var(--portal-brand-text,#082042)] transition-colors py-1"
                  href="/login"
                >
                  <ArrowLeft size={16} className="shrink-0" aria-hidden="true" />
                  <span>Back to Sign In</span>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Statutory IT Helpdesk Footnote */}
      <div className="mt-6 text-center text-xs text-[color:var(--portal-muted,#64748b)]">
        Need help?{' '}
        <a
          href="mailto:itcentre@kannuruniversity.ac.in"
          className="font-medium text-[color:var(--portal-info-text,#334155)] underline underline-offset-2 hover:text-[color:var(--portal-brand-text,#082042)] transition-colors"
        >
          Contact support
        </a>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="bg-[color:var(--portal-canvas,#f8f9ff)] font-sans text-[color:var(--portal-brand-text,#0b1c30)] min-h-screen flex flex-col justify-between selection:bg-[color:var(--portal-warning-bg,#ffdea4)] selection:text-[color:var(--portal-warning-text,#261900)]">
      {/* Institutional Header */}
      <PortalHeader
        rightAction={
          <Link
            href="/login"
            className="text-xs font-medium text-[color:var(--portal-info-text,#475569)] hover:text-[color:var(--portal-brand-text,#0f172a)] transition-colors inline-flex items-center gap-1.5"
          >
            <ArrowLeft size={16} className="shrink-0" aria-hidden="true" />
            <span>Back to Sign In</span>
          </Link>
        }
      />

      {/* Main Content Area */}
      <main className="w-full flex-1 bg-[color:var(--portal-canvas,#f8f9ff)] flex items-center justify-center p-4 md:p-6">
        <div className="flex flex-col w-full">
          <div className="w-full flex items-center justify-center py-6 md:py-10">
            <Suspense
              fallback={
                <div className="w-full max-w-[460px] h-[350px] bg-[color:var(--portal-surface,white)] rounded-xl shadow-md border border-[color:var(--portal-strong-border,#E2E8F0)] animate-pulse" />
              }
            >
              <ResetPasswordForm />
            </Suspense>
          </div>
        </div>
      </main>

      {/* Institutional Footer */}
      <PortalFooter />
    </div>
  )
}
