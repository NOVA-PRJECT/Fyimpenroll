'use client'

import { logoutPortal } from '@/core/security/logout'
import { navigateAfterSessionChange } from '@/core/security/session-navigation'

import React, { useState, useEffect } from 'react'
import Image from 'next/image'
import { Eye, EyeOff, Lock, KeyRound, AlertCircle, CheckCircle2, LogOut, Info } from 'lucide-react'
import PortalHeader from '@/components/portal/PortalHeader'
import { useBfcacheGuard } from '@/core/hooks/useBfcacheGuard'
import { ROLE_DASHBOARD_MAP } from '@/core/security/routeConfig'
import { Role } from '@/core/constants/roles'
import {
  hasMinLength,
  hasLetter,
  hasNumber,
} from '@/core/validation/passwordValidation'

export default function SharedChangePasswordPage() {
  useBfcacheGuard()
  const [role, setRole] = useState<Role | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState('')
  const [canRetrySync, setCanRetrySync] = useState(false)
  const [retryingSync, setRetryingSync] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<{
    current_password?: string
    new_password?: string
    confirm_password?: string
  }>({})

  useEffect(() => {
    // Fetch profile to know whether user is teacher or student
    fetch('/api/auth/profile')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.role) {
          setRole(data.role as Role)
        }
      })
      .catch(() => {})
  }, [])

  const minLengthMet = hasMinLength(newPassword)
  const letterMet = hasLetter(newPassword)
  const numberMet = hasNumber(newPassword)

  function validate() {
    const errors: typeof fieldErrors = {}
    if (!currentPassword) errors.current_password = 'Current password is required'
    if (!newPassword) errors.new_password = 'New password is required'
    else if (!minLengthMet) errors.new_password = 'Password must be at least 10 characters'
    else if (!letterMet) errors.new_password = 'Password must contain at least one letter'
    else if (!numberMet) errors.new_password = 'Password must contain at least one number'

    if (!confirmPassword) errors.confirm_password = 'Please confirm your new password'
    else if (newPassword !== confirmPassword) errors.confirm_password = 'Passwords do not match'

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    setLoading(true)
    setError('')
    setCanRetrySync(false)

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error ?? data.message ?? 'Failed to update password. Please try again.')
        setLoading(false)
        return
      }

      // R32: Check for partial synchronization failure
      if (data.code === 'SYNC_FAILED' || data.success === false) {
        setError(data.message || 'Password updated in authentication system, but profile synchronization failed.')
        setCanRetrySync(true)
        setLoading(false)
        return
      }

      if (typeof window !== 'undefined') {
        sessionStorage.clear()
      }

      const dest = (role && ROLE_DASHBOARD_MAP[role]) || '/dashboard/student'
      navigateAfterSessionChange(dest)
    } catch {
      setError('Network error updating password. Please check your connection.')
      setLoading(false)
    }
  }

  async function handleRetrySync() {
    setRetryingSync(true)
    setError('')
    try {
      const res = await fetch('/api/auth/sync-password-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (res.ok && data.success) {
        if (typeof window !== 'undefined') {
          sessionStorage.clear()
        }
        const dest = (role && ROLE_DASHBOARD_MAP[role]) || '/dashboard/student'
        navigateAfterSessionChange(dest)
      } else {
        setError(data.message || 'Profile synchronization failed on retry. Please try again.')
        setRetryingSync(false)
      }
    } catch {
      setError('Network error during synchronization retry. Please check your connection.')
      setRetryingSync(false)
    }
  }

  async function handleLogout() {
    setLoggingOut(true)
    if (!await logoutPortal()) setLoggingOut(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <PortalHeader
        variant="none"
        rightAction={
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="text-xs font-medium px-3.5 py-1.5 border border-slate-200 hover:bg-slate-100 hover:text-slate-900 text-slate-600 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <LogOut size={13} />
            <span>{loggingOut ? 'Signing out...' : 'Sign Out'}</span>
          </button>
        }
      />

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {/* Header Banner */}
          <div className="px-6 pt-6 pb-4 border-b border-slate-100 text-center">
            <div className="inline-flex items-center justify-center p-2 rounded-xl bg-slate-100 mb-3">
              <Image
                src="/kannur-university-logo.png"
                alt="Kannur University"
                width={48}
                height={48}
                priority
              />
            </div>
            <p className="text-xs font-semibold text-emerald-800 tracking-wider uppercase">Kannur University</p>
            <h1 className="text-lg font-bold text-slate-900 mt-1">Update Your Password</h1>
            <p className="text-xs text-slate-500 mt-1">
              {role === 'teacher'
                ? 'Faculty account security: please establish your permanent password.'
                : 'Student account security: please establish your permanent password.'}
            </p>
          </div>

          <div className="p-6">
            <div className="p-3 mb-4 rounded-xl bg-emerald-50/60 border border-emerald-100 text-xs text-emerald-900 flex items-start gap-2.5">
              <Info size={15} className="text-emerald-700 flex-shrink-0 mt-0.5" />
              <p>
                Your account was initialized with a temporary password. You must set a permanent password before accessing portal features.
              </p>
            </div>

            {error && (
              <div className="p-3 mb-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2" role="alert">
                <AlertCircle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {canRetrySync && (
              <div className="p-3 mb-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex flex-col gap-2 text-xs">
                <div>
                  <p className="font-semibold text-amber-950">Pending Profile Synchronization</p>
                  <p className="text-amber-800">Your password was updated in the authentication system. Click retry to complete profile synchronization.</p>
                </div>
                <button
                  type="button"
                  onClick={handleRetrySync}
                  disabled={retryingSync}
                  className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg text-xs shadow-sm transition-colors"
                >
                  {retryingSync ? 'Synchronizing...' : 'Retry Profile Synchronization'}
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="current-password">
                  Current Password
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <KeyRound size={15} />
                  </span>
                  <input
                    id="current-password"
                    type={showCurrentPassword ? 'text' : 'password'}
                    className={`w-full pl-9 pr-9 py-2 text-xs rounded-lg border ${
                      fieldErrors.current_password ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-emerald-200'
                    } focus:outline-none focus:ring-2`}
                    placeholder="Enter temporary password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  >
                    {showCurrentPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {fieldErrors.current_password && (
                  <p className="text-[11px] text-red-600 mt-1">{fieldErrors.current_password}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="new-password">
                  New Password
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <Lock size={15} />
                  </span>
                  <input
                    id="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    className={`w-full pl-9 pr-9 py-2 text-xs rounded-lg border ${
                      fieldErrors.new_password ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-emerald-200'
                    } focus:outline-none focus:ring-2`}
                    placeholder="Create strong permanent password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                  >
                    {showNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {fieldErrors.new_password && (
                  <p className="text-[11px] text-red-600 mt-1">{fieldErrors.new_password}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="confirm-password">
                  Confirm New Password
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <Lock size={15} />
                  </span>
                  <input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    className={`w-full pl-9 pr-9 py-2 text-xs rounded-lg border ${
                      fieldErrors.confirm_password ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-emerald-200'
                    } focus:outline-none focus:ring-2`}
                    placeholder="Re-type new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {fieldErrors.confirm_password && (
                  <p className="text-[11px] text-red-600 mt-1">{fieldErrors.confirm_password}</p>
                )}
              </div>

              {/* Password Requirements */}
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 space-y-1">
                <p className="font-semibold text-slate-700 mb-1">Password Requirements:</p>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={12} className={minLengthMet ? 'text-emerald-600' : 'text-slate-300'} />
                  <span className={minLengthMet ? 'text-emerald-700 font-medium' : ''}>At least 10 characters</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={12} className={letterMet ? 'text-emerald-600' : 'text-slate-300'} />
                  <span className={letterMet ? 'text-emerald-700 font-medium' : ''}>At least one letter (a-z, A-Z)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={12} className={numberMet ? 'text-emerald-600' : 'text-slate-300'} />
                  <span className={numberMet ? 'text-emerald-700 font-medium' : ''}>At least one number (0-9)</span>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-semibold rounded-xl text-xs shadow transition-colors flex items-center justify-center gap-2"
              >
                {loading ? 'Updating Password...' : 'Save & Continue to Portal'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
