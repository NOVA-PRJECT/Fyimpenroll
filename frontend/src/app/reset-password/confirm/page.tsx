'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import PortalHeader from '@/components/portal/PortalHeader'
import PortalFooter from '@/components/portal/PortalFooter'
import { supabase } from '@/core/supabase/client'
import {
  getChecks,
  getPasswordLevel,
  validatePassword,
} from '@/core/validation/passwordValidation'

function ConfirmResetForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking')
  const [errorMessage, setErrorMessage] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [canRetrySync, setCanRetrySync] = useState(false)

  useEffect(() => {
    let isMounted = true

    // 1. Extract from search parameters
    const code = searchParams.get('code')
    const queryError = searchParams.get('error_description') || searchParams.get('error')

    // 2. Extract from hash fragment
    let hashAccessToken: string | null = null
    let hashRefreshToken: string | null = null
    let hashError: string | null = null

    if (typeof window !== 'undefined' && window.location.hash) {
      try {
        const hashStr = window.location.hash.startsWith('#')
          ? window.location.hash.substring(1)
          : window.location.hash
        const hashParams = new URLSearchParams(hashStr)

        hashAccessToken = hashParams.get('access_token')
        hashRefreshToken = hashParams.get('refresh_token')
        const errDesc = hashParams.get('error_description') || hashParams.get('error')
        if (errDesc) {
          hashError = decodeURIComponent(errDesc.replace(/\+/g, ' '))
        }
      } catch (err) {
        console.error('Failed to parse URL hash:', err)
      }
    }

    const explicitError =
      hashError ||
      (queryError ? decodeURIComponent(queryError.replace(/\+/g, ' ')) : null)

    // Check for explicit error from Supabase (e.g. token expired, already used)
    if (explicitError) {
      setStatus('error')
      setErrorMessage(explicitError)
      return
    }

    // Step C: Listen to onAuthStateChange for PASSWORD_RECOVERY
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setStatus('ready')
      }
    })

    async function initializeSession() {
      try {
        // Option A: Active session already established
        const { data: sessionData } = await supabase.auth.getSession()
        if (sessionData?.session) {
          if (isMounted) setStatus('ready')
          return
        }

        // Option B: Access token in hash fragment (implicit flow)
        if (hashAccessToken) {
          const { data: setSessionData, error: setSessionError } =
            await supabase.auth.setSession({
              access_token: hashAccessToken,
              refresh_token: hashRefreshToken || '',
            })
          if (!setSessionError && setSessionData?.session) {
            if (isMounted) setStatus('ready')
            return
          }
        }

        // Option C: PKCE authorization code in query params
        if (code) {
          const { data: exchangeData, error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code)

          if (exchangeError || !exchangeData?.session) {
            if (isMounted) {
              setStatus('error')
              setErrorMessage('This reset link has expired or has already been used.')
            }
            return
          }

          if (isMounted) setStatus('ready')
          return
        }

        // Neither code, hash token, nor session present: direct navigation
        if (isMounted) {
          router.replace(
            '/reset-password?message=Please%20request%20a%20new%20password%20reset%20link.',
          )
        }
      } catch (err: any) {
        console.error('Session initialization error:', err)
        if (isMounted) {
          setStatus('error')
          setErrorMessage('This reset link has expired or has already been used.')
        }
      }
    }

    initializeSession()

    return () => {
      isMounted = false
      authListener?.subscription?.unsubscribe()
    }
  }, [searchParams, router])

  const checks = getChecks(password)
  const passwordLevel = getPasswordLevel(password)

  async function handleRetrySync() {
    setSubmitting(true)
    setSubmitError('')
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      const syncRes = await fetch('/api/auth/sync-password-status', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      const syncData = await syncRes.json().catch(() => ({}))
      if (!syncRes.ok || syncData.success === false) {
        setSubmitError(syncData.message || 'Synchronization retry failed. Please try again.')
        setSubmitting(false)
        return
      }

      await supabase.auth.signOut().catch(() => {})
      router.replace(
        '/login?message=Password%20updated%20successfully.%20Please%20log%20in%20with%20your%20new%20password.',
      )
    } catch (err: any) {
      setSubmitError(err?.message || 'Synchronization request failed. Please check your connection.')
      setSubmitting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError('')
    setCanRetrySync(false)

    const validation = validatePassword(password, confirmPassword)
    if (!validation.valid) {
      setSubmitError(
        validation.errors.new_password ||
          validation.errors.confirm_password ||
          'Please verify your password requirements.',
      )
      return
    }

    setSubmitting(true)

    try {
      // Step F.1: Call supabase.auth.updateUser({ password: newPassword })
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      })

      // Step F.2: If that fails, show the error message inline — do not redirect
      if (updateError) {
        setSubmitError(updateError.message || 'Failed to update password. Please try again.')
        setSubmitting(false)
        return
      }

      // Step F.3: If that succeeds, call POST /api/auth/complete-password-reset with credentials: 'include'
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      const resetRes = await fetch('/api/auth/complete-password-reset', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ passwordUpdated: true }),
      })

      const resetData = await resetRes.json().catch(() => ({}))

      // Step F.4: F10 fix - If backend synchronization fails, do NOT show false success or redirect
      if (!resetRes.ok || resetData.success === false) {
        const errorMsg =
          resetData.message ||
          'Password updated in authentication system, but student account synchronization failed. Please retry synchronization below.'
        setSubmitError(errorMsg)
        setCanRetrySync(true)
        setSubmitting(false)
        return
      }

      // Explicit sign out so student logs in explicitly
      await supabase.auth.signOut().catch(() => {})

      // Step F.5: Redirect to /login with success message
      router.replace(
        '/login?message=Password%20updated%20successfully.%20Please%20log%20in%20with%20your%20new%20password.',
      )
    } catch (err: any) {
      setSubmitError(err?.message || 'An unexpected error occurred. Please try again.')
      setSubmitting(false)
    }
  }

  // ── Checking / Loading State ──────────────────────────────────────────────
  if (status === 'checking') {
    return (
      <div className="w-full max-w-[460px] flex flex-col items-center">
        <div className="w-full bg-white rounded-xl shadow-md overflow-hidden relative border border-[#E2E8F0]">
          <div className="bg-[#082042] py-7 px-8 text-center">
            <div className="w-10 h-10 rounded-full bg-white/10 mx-auto mb-3.5 flex items-center justify-center">
              <span className="material-symbols-outlined text-[#f7bd40] text-[20px] animate-spin">
                progress_activity
              </span>
            </div>
            <h1 className="font-serif text-2xl text-white font-medium tracking-tight">
              Verifying Reset Link
            </h1>
            <div className="w-12 h-0.5 bg-[#E0A92C] mx-auto my-3 rounded-full" />
            <p className="text-xs text-[#dce9ff] max-w-xs mx-auto leading-relaxed">
              Validating your security session with Kannur University...
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Step D: Expired / Invalid Link State ───────────────────────────────────
  if (status === 'error') {
    return (
      <div className="w-full max-w-[460px] flex flex-col items-center">
        <div className="w-full bg-white rounded-xl shadow-md overflow-hidden relative border border-[#E2E8F0]">
          <div className="bg-[#082042] py-7 px-8 text-center">
            <div className="w-10 h-10 rounded-full bg-white/10 mx-auto mb-3.5 flex items-center justify-center">
              <span className="material-symbols-outlined text-[#f7bd40] text-[20px]">
                link_off
              </span>
            </div>
            <h1 className="font-serif text-2xl text-white font-medium tracking-tight">
              Link Expired
            </h1>
            <div className="w-12 h-0.5 bg-[#E0A92C] mx-auto my-3 rounded-full" />
            <p className="text-xs text-[#dce9ff] max-w-xs mx-auto leading-relaxed">
              {errorMessage || 'This reset link has expired or has already been used.'}
            </p>
          </div>
          <div className="p-6 md:p-8 space-y-4 bg-white">
            {/* Anti-Spam Bot Pre-fetch Tip */}
            <div className="p-3.5 bg-amber-50 border border-amber-200/80 rounded-lg text-left text-xs text-amber-950 leading-relaxed flex items-start gap-2.5">
              <span className="material-symbols-outlined text-amber-600 text-[18px] shrink-0 mt-0.5">
                info
              </span>
              <span>
                <strong>Spam Folder Notice:</strong> If this email arrived in your{' '}
                <strong>Spam</strong> or <strong>Junk</strong> folder, your email provider
                may have automatically scanned the link and consumed the single-use token.
                Please request a new link and <strong>move the email to your Inbox</strong>{' '}
                before opening it.
              </span>
            </div>

            <Link
              href="/reset-password"
              className="w-full h-11 bg-[#082042] hover:bg-[#0B192C] text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              <span>Request a new link</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Link>
            <div className="pt-1 text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#44474e] hover:text-[#082042] transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                <span>Back to Sign In</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Step E: Password Reset Form ───────────────────────────────────────────
  return (
    <div className="w-full max-w-[460px] flex flex-col items-center">
      <div className="w-full bg-white rounded-xl shadow-md overflow-hidden relative border border-[#E2E8F0]">
        {/* Header */}
        <div className="bg-[#082042] py-7 px-8 text-center">
          <div className="w-10 h-10 rounded-full bg-white/10 mx-auto mb-3.5 flex items-center justify-center">
            <span className="material-symbols-outlined text-[#f7bd40] text-[20px]">
              lock_reset
            </span>
          </div>
          <h1 className="font-serif text-2xl text-white font-medium tracking-tight">
            Set New Password
          </h1>
          <div className="w-12 h-0.5 bg-[#E0A92C] mx-auto my-3 rounded-full" />
          <p className="text-xs text-[#dce9ff] max-w-xs mx-auto leading-relaxed">
            Choose a strong password for your FYIMP portal account.
          </p>
        </div>

        {/* Body */}
        <div className="p-6 md:p-8 space-y-5 bg-white">
          {/* Submit Error Banner */}
          {submitError && (
            <div className="rounded-lg p-3.5 flex flex-col gap-2.5 text-xs bg-[#ffdad6] border border-[#ba1a1a]/30 text-[#93000a]">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[#ba1a1a] text-[18px] mt-0.5 shrink-0">
                  error
                </span>
                <span className="flex-1 leading-relaxed">{submitError}</span>
                <button
                  type="button"
                  onClick={() => setSubmitError('')}
                  className="text-[#93000a] hover:opacity-70"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
              {canRetrySync && (
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleRetrySync}
                    disabled={submitting}
                    className="px-3 py-1.5 bg-[#ba1a1a] text-white font-medium text-xs rounded hover:bg-[#93000a] disabled:opacity-50 transition-colors shadow-sm"
                  >
                    {submitting ? 'Retrying Synchronization...' : 'Retry Synchronization'}
                  </button>
                </div>
              )}
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            {/* New Password Field */}
            <div className="flex flex-col gap-1.5">
              <label
                className="text-[11px] font-bold text-[#44474e] uppercase tracking-wider"
                htmlFor="newPassword"
              >
                New Password
              </label>
              <div className="h-11 px-3.5 bg-[#EEF3FB] border border-[#CBD5E1] rounded-lg text-sm focus-within:bg-white focus-within:border-[#082042] focus-within:ring-2 focus-within:ring-[#082042]/15 flex items-center gap-2.5 transition-all">
                <span className="material-symbols-outlined text-[#75777f] text-[18px] shrink-0">
                  lock
                </span>
                <input
                  id="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  className="text-sm text-[#0B192C] placeholder:text-[#75777f] w-full bg-transparent outline-none border-none p-0 focus:ring-0"
                  placeholder="Min. 10 characters"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setSubmitError('')
                  }}
                  autoComplete="new-password"
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[#75777f] hover:text-[#082042] transition-colors shrink-0"
                  tabIndex={-1}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>

              {/* Strength Level Label */}
              {password && passwordLevel && (
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border"
                    style={{
                      color: passwordLevel.color,
                      backgroundColor: passwordLevel.bg,
                      borderColor: passwordLevel.border,
                    }}
                  >
                    {passwordLevel.label}
                  </span>
                </div>
              )}

              {/* Requirement Checklist */}
              {password && (
                <ul className="mt-1 space-y-1">
                  {checks.map((c) => (
                    <li key={c.label} className="flex items-center gap-2 text-[11px]">
                      <span
                        className="material-symbols-outlined text-[14px]"
                        style={{ color: c.met ? '#22c55e' : '#94a3b8' }}
                      >
                        {c.met ? 'check_circle' : 'radio_button_unchecked'}
                      </span>
                      <span style={{ color: c.met ? '#166534' : '#64748b' }}>{c.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Confirm Password Field */}
            <div className="flex flex-col gap-1.5">
              <label
                className="text-[11px] font-bold text-[#44474e] uppercase tracking-wider"
                htmlFor="confirmPassword"
              >
                Confirm New Password
              </label>
              <div className="h-11 px-3.5 bg-[#EEF3FB] border border-[#CBD5E1] rounded-lg text-sm focus-within:bg-white focus-within:border-[#082042] focus-within:ring-2 focus-within:ring-[#082042]/15 flex items-center gap-2.5 transition-all">
                <span className="material-symbols-outlined text-[#75777f] text-[18px] shrink-0">
                  lock_clock
                </span>
                <input
                  id="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  className="text-sm text-[#0B192C] placeholder:text-[#75777f] w-full bg-transparent outline-none border-none p-0 focus:ring-0"
                  placeholder="Repeat your password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    setSubmitError('')
                  }}
                  autoComplete="new-password"
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="text-[#75777f] hover:text-[#082042] transition-colors shrink-0"
                  tabIndex={-1}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {showConfirm ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>

              {/* Match indicator */}
              {confirmPassword && (
                <p
                  className="text-[11px] flex items-center gap-1.5 mt-0.5"
                  style={{ color: password === confirmPassword ? '#16a34a' : '#dc2626' }}
                >
                  <span className="material-symbols-outlined text-[13px]">
                    {password === confirmPassword ? 'check_circle' : 'cancel'}
                  </span>
                  {password === confirmPassword ? 'Passwords match' : 'Passwords do not match'}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <button
              className="w-full h-11 bg-[#082042] hover:bg-[#0B192C] text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm active:scale-[0.99] cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed"
              type="submit"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <span className="material-symbols-outlined text-[16px] animate-spin">
                    progress_activity
                  </span>
                  <span>Updating Password...</span>
                </>
              ) : (
                <>
                  <span>Set New Password</span>
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </>
              )}
            </button>
          </form>

          <div className="pt-1 text-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#44474e] hover:text-[#082042] transition-colors py-1"
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              <span>Back to Sign In</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-slate-500">
        Need help?{' '}
        <a
          href="mailto:itcentre@kannuruniversity.ac.in"
          className="font-medium text-slate-700 underline underline-offset-2 hover:text-[#082042] transition-colors"
        >
          Contact support
        </a>
      </div>
    </div>
  )
}

export default function ConfirmResetPage() {
  return (
    <div className="bg-[#f8f9ff] font-sans text-[#0b1c30] min-h-screen flex flex-col justify-between selection:bg-[#ffdea4] selection:text-[#261900]">
      <PortalHeader
        rightAction={
          <Link
            href="/login"
            className="text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors inline-flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            <span>Back to Sign In</span>
          </Link>
        }
      />

      <main className="w-full flex-1 bg-[#f8f9ff] flex items-center justify-center p-4 md:p-6">
        <div className="flex flex-col w-full">
          <div className="w-full flex items-center justify-center py-6 md:py-10">
            <Suspense
              fallback={
                <div className="w-full max-w-[460px]">
                  <div className="w-full bg-white rounded-xl shadow-md border border-[#E2E8F0] overflow-hidden">
                    <div className="bg-[#082042] py-7 px-8 text-center">
                      <div className="w-10 h-10 rounded-full bg-white/10 mx-auto mb-3.5 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[#f7bd40] text-[20px] animate-spin">
                          progress_activity
                        </span>
                      </div>
                      <h1 className="font-serif text-2xl text-white font-medium tracking-tight">
                        Verifying Link
                      </h1>
                      <div className="w-12 h-0.5 bg-[#E0A92C] mx-auto my-3 rounded-full" />
                    </div>
                    <div className="p-6 text-center">
                      <p className="text-xs text-[#75777f]">Verifying your reset link...</p>
                    </div>
                  </div>
                </div>
              }
            >
              <ConfirmResetForm />
            </Suspense>
          </div>
        </div>
      </main>

      <PortalFooter />
    </div>
  )
}
