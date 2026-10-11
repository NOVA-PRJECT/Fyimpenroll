'use client'

import { navigateAfterSessionChange, clearSessionStorage } from '@/core/security/session-navigation'

export const dynamic = 'force-dynamic'

import { useState, useEffect, Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import styles from './login.module.css'
import PortalHeader from '@/components/portal/PortalHeader'
import PortalFooter from '@/components/portal/PortalFooter'

function LoginForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [messageOverride, setSuccessMsg] = useState<string | null>(null)
  const successMsg = messageOverride ?? searchParams.get('message') ?? ''
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})


  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload()
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [])

  function validate() {
    const errors: { email?: string; password?: string } = {}
    if (!email) errors.email = 'Email is required'
    else if (!/\S+@\S+\.\S+/.test(email)) errors.email = 'Invalid email address'
    if (!password) errors.password = 'Password is required'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleLogin(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (!validate()) return

    if (!acceptedTerms) {
      setError('Please review and accept the Terms of Use and Privacy Policy to sign in.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        let msg = 'Something went wrong. Please try again.'
        if (response.status === 401) {
          msg = 'Invalid email or password. Please try again.'
        } else if (data?.message) {
          msg = Array.isArray(data.message) ? data.message[0] : data.message
        }
        setError(msg)
        setLoading(false)
        return
      }

      clearSessionStorage()
      navigateAfterSessionChange(data.redirectTo)
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="bg-[#f8f9ff] font-sans text-[#0b1c30] antialiased selection:bg-[#d3e4fe] selection:text-[#0b1c30] flex flex-col min-h-screen">
      {/* Top Institutional Header */}
      <PortalHeader variant="login" />

      {/* Main Form Body */}
      <main className="w-full flex-grow flex flex-col items-center justify-center px-4 sm:px-6 md:px-8 py-8 relative overflow-hidden">
        {/* Ambient background glow orbs */}
        <div className="absolute inset-0 pointer-events-none -z-10 flex items-center justify-center">
          <div className="w-[680px] h-[680px] rounded-full bg-[#dce9ff]/45 blur-3xl transform -translate-y-12" />
          <div className="absolute top-1/4 right-1/4 w-[340px] h-[340px] rounded-full bg-[#d5e3fc]/60 blur-2xl" />
        </div>

        {/* Central Card Reverted to Original */}
        <div className={styles.card}>
          {/* Card Header */}
          <div className={styles.cardHeader}>
            <div className={styles.logoWrapper}>
              <Image
                src="/knrunilogo.png"
                alt="Kannur University"
                width={44}
                height={48}
                style={{ width: 'auto', height: '48px' }}
                className={styles.logo}
              />
            </div>
            <p className={styles.universityName}>Kannur University</p>
            <h1 className={styles.portalTitle}>FYIMP Registration Portal</h1>
            <div className={styles.goldLine} />
          </div>

          {/* Card Body */}
          <div className={styles.cardBody}>
            <p className={styles.formTitle}>Sign In</p>

            {/* Success Message Banner */}
            {successMsg && (
              <div className="mb-4 rounded-lg p-3.5 flex items-start gap-2.5 text-xs bg-[#f0fdf4] border border-[#bbf7d0] text-[#166534]">
                <span className="material-symbols-outlined text-[#16a34a] text-[18px] shrink-0 mt-0.5">
                  check_circle
                </span>
                <span className="flex-1 font-medium leading-relaxed">{successMsg}</span>
                <button
                  type="button"
                  onClick={() => setSuccessMsg('')}
                  className="text-[#166534] hover:opacity-75 transition-opacity"
                  aria-label="Dismiss message"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            )}

            {/* Global Error */}
            {error && <div className={styles.errorBanner}>{error}</div>}

            {/* Form Fields */}
            <form onSubmit={handleLogin}>
              <div className={styles.fieldGroup}>
                {/* Email */}
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="email">
                    Email Address
                  </label>
                  <input
                    id="email"
                    type="email"
                    className={`${styles.input} ${fieldErrors.email ? styles.inputError : ''}`}
                    placeholder="student@kannuruniv.ac.in"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: undefined })
                    }}
                    disabled={loading}
                    autoComplete="email"
                  />
                  {fieldErrors.email && (
                    <p className={styles.errorMsg}>{fieldErrors.email}</p>
                  )}
                </div>

                {/* Password */}
                <div className={styles.field}>
                  <div className="flex items-center justify-between">
                    <label className={styles.label} htmlFor="password">
                      Password
                    </label>
                    <Link
                      href="/reset-password"
                      className="text-[11px] text-slate-500 hover:text-[#002147] transition-colors"
                      style={{ textDecoration: 'none', marginBottom: '0.2rem' }}
                    >
                      Forgot Password?
                    </Link>
                  </div>
                  <div className="password-wrapper">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      className={`${styles.input} password-input ${fieldErrors.password ? styles.inputError : ''}`}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value)
                        if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: undefined })
                      }}
                      disabled={loading}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <p className={styles.errorMsg}>{fieldErrors.password}</p>
                  )}
                </div>
              </div>

              {/* Terms & Privacy Policy Acceptance Checkbox */}
              <div className={styles.termsWrapper}>
                <input
                  type="checkbox"
                  id="acceptTerms"
                  checked={acceptedTerms}
                  onChange={(e) => {
                    setAcceptedTerms(e.target.checked)
                    if (error) setError('')
                  }}
                  className={styles.termsCheckbox}
                />
                <label htmlFor="acceptTerms" className={styles.termsLabel}>
                  I accept the{' '}
                  <Link href="/terms-of-use" target="_blank" className={styles.termsLink}>
                    Terms of Use
                  </Link>{' '}
                  and acknowledge the{' '}
                  <Link href="/privacy-policy" target="_blank" className={styles.termsLink}>
                    Privacy Policy
                  </Link>
                  .
                </label>
              </div>

              {/* Submit Button */}
              <button
                className={styles.submitBtn}
                type="submit"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className={styles.spinner} />
                    Signing in...
                  </>
                ) : (
                  'Sign In →'
                )}
              </button>

              {/* Divider */}
              <div className={styles.divider}>
                <div className={styles.dividerLine} />
                <span className={styles.dividerText}></span>
                <div className={styles.dividerLine} />
              </div>
            </form>
          </div>
        </div>

        {/* Statutory IT Helpdesk Footnote */}
        <div className="mt-6 text-center text-xs text-slate-500">
          Need help?{' '}
          <a
            href="mailto:itcentre@kannuruniversity.ac.in"
            className="font-medium text-slate-700 underline underline-offset-2 hover:text-[#082042] transition-colors"
          >
            Contact support
          </a>
        </div>
      </main>

      {/* Institutional Footer */}
      <PortalFooter />
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#082042] flex items-center justify-center">
          <div className="w-12 h-12 border-3 border-[#E0A92C]/20 border-t-[#E0A92C] rounded-full animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
