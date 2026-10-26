'use client'

import { logoutPortal } from '@/core/security/logout'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PortalHeader from '@/components/portal/PortalHeader'
import PortalFooter from '@/components/portal/PortalFooter'
import styles from './consent.module.css'
import { ROLE_DASHBOARD_MAP } from '@/core/security/routeConfig'
import { Role } from '@/core/constants/roles'
import {
  ShieldCheck,
  MapPin,
  FileText,
  ExternalLink,
  ArrowRight,
  LogOut,
  AlertCircle,
  UserCheck,
  BookOpen,
  CalendarCheck,
  Shield,
  Loader2,
} from 'lucide-react'

export default function ConsentPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<Role | null>(null)
  const [currentVersion, setCurrentVersion] = useState('2026-10-22')
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function verifyStatus() {
      try {
        const [profileRes, statusRes] = await Promise.all([
          fetch('/api/auth/profile'),
          fetch('/api/consent/status'),
        ])

        if (!profileRes.ok) {
          router.replace('/login')
          return
        }

        const profileData = await profileRes.json()
        setUserRole(profileData.role as Role)

        if (statusRes.ok) {
          const statusData = await statusRes.json()
          if (statusData.currentVersion) {
            setCurrentVersion(statusData.currentVersion)
          }

          // If already accepted, redirect straight to role dashboard
          if (statusData.accepted) {
            const dest = profileData.role
              ? ROLE_DASHBOARD_MAP[profileData.role as Role] || '/dashboard/student'
              : '/dashboard/student'
            router.replace(dest)
            return
          }
        }
      } catch (err) {
        console.error('Failed to verify consent status:', err)
      } finally {
        setChecking(false)
      }
    }

    verifyStatus()
  }, [router])

  const handleAccept = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/consent/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy_version: currentVersion }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.message || 'Failed to record consent. Please try again.')
      }

      const dest = userRole ? ROLE_DASHBOARD_MAP[userRole] || '/dashboard/student' : '/dashboard/student'
      router.replace(dest)
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : '') || 'An error occurred during submission.')
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    await logoutPortal()
  }

  if (checking) {
    return (
      <div className={styles.pageWrapper}>
        <PortalHeader variant="none" />
        <main className={styles.loadingContainer}>
          <div className={styles.spinner} />
          <p className={styles.loadingText}>Checking consent and account status...</p>
        </main>
        <PortalFooter />
      </div>
    )
  }

  return (
    <div className={styles.pageWrapper}>
      {/* Institutional Portal Header */}
      <PortalHeader
        variant="none"
        rightAction={
          <button
            type="button"
            onClick={handleSignOut}
            disabled={loading}
            className="text-xs font-medium px-3.5 py-1.5 border border-[color:var(--portal-strong-border,#e2e8f0)] hover:bg-[color:var(--portal-info-bg,#f1f5f9)] hover:text-[color:var(--portal-brand-text,#0f172a)] text-[color:var(--portal-info-text,#475569)] rounded-lg transition-colors flex items-center gap-1.5"
          >
            <LogOut size={13} />
            <span>Sign Out</span>
          </button>
        }
      />

      {/* Main Container */}
      <main className={styles.mainContent}>
        <div className={styles.card}>
          {/* Executive Card Header */}
          <div className={styles.cardHeader}>
            <div className={styles.shieldEmblem}>
              <ShieldCheck size={28} className={styles.shieldIcon} />
            </div>
            <div className={styles.versionBadge}>
              Policy Update • Version {currentVersion}
            </div>
            <h1 className={styles.title}>Data Privacy & Terms Agreement</h1>
            <p className={styles.subtitle}>
              Five Year Integrated Masters Programme  (FYIMP)
              </p>
            <div className={styles.goldLine} />
          </div>

          {/* Card Body */}
          <div className={styles.cardBody}>
            <p className={styles.introNotice}>
              Please review how your data is collected and protected before accessing the institutional portal.
            </p>

            <div className={styles.dataGrid}>
              {/* 1. Identity Information */}
              <div className={styles.dataCard}>
                <div className={styles.cardIconCol}>
                  <div className={styles.iconCircle}>
                    <UserCheck size={18} />
                  </div>
                </div>
                <div className={styles.cardBodyCol}>
                  <h3 className={styles.itemTitle}>Identity Information</h3>
                  <p className={styles.itemDesc}>
                    Name, registration number, department, and campus affiliation are used solely to route your account
                    to authorized courses, timetables, and departmental records.
                  </p>
                </div>
              </div>

              {/* 2. Academic Coordination Data */}
              <div className={styles.dataCard}>
                <div className={styles.cardIconCol}>
                  <div className={styles.iconCircle}>
                    <BookOpen size={18} />
                  </div>
                </div>
                <div className={styles.cardBodyCol}>
                  <h3 className={styles.itemTitle}>Academic Coordination Data</h3>
                  <p className={styles.itemDesc}>
                    Course registrations, timetable slot assignments, and credit statements are processed
                    to automate schedule coordination and official credit ledgers.
                  </p>
                </div>
              </div>

              {/* 3. Attendance Tracking */}
              <div className={styles.dataCard}>
                <div className={styles.cardIconCol}>
                  <div className={styles.iconCircle}>
                    <CalendarCheck size={18} />
                  </div>
                </div>
                <div className={styles.cardBodyCol}>
                  <h3 className={styles.itemTitle}>Attendance Tracking</h3>
                  <p className={styles.itemDesc}>
                    Class period attendance marked by instructors and campus check-in status (on-time,
                    late, early-leave) help maintain official university statutory attendance records.
                  </p>
                </div>
              </div>

              {/* 4. Zero GPS Coordinate Retention (Highlight) */}
              <div className={`${styles.dataCard} ${styles.highlightCard}`}>
                <div className={styles.cardIconCol}>
                  <div className={`${styles.iconCircle} ${styles.highlightIconCircle}`}>
                    <MapPin size={18} />
                  </div>
                </div>
                <div className={styles.cardBodyCol}>
                  <div className={styles.highlightHeader}>
                    <h3 className={styles.highlightTitle}>Zero GPS Coordinate Retention</h3>
                    <span className={styles.privacyGuaranteeTag}>Privacy Guaranteed</span>
                  </div>
                  <p className={styles.itemDesc}>
                    <strong>Momentary verification only:</strong> Device location coordinates are sent for a single momentary
                    check to confirm presence within the campus boundary and are discarded immediately.
                  </p>
                  <p className={styles.privacyNote}>
                    <Shield size={13} className={styles.privacyShieldIcon} />
                    <span>Exact GPS coordinates are never stored in any database, never tracked in the background, and never shared.</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Legal Documents */}
            <div className={styles.legalSection}>
              <span className={styles.legalLabel}>Statutory Documentation</span>
              <p className={styles.legalDesc}>
                You can review our complete institutional legal and privacy frameworks at any time:
              </p>
              <div className={styles.legalLinksRow}>
                <Link href="/privacy-policy" className={styles.legalCardLink}>
                  <FileText size={16} className={styles.legalIcon} />
                  <span className={styles.legalLinkText}>Read Full Privacy Policy</span>
                  <ExternalLink size={14} className={styles.extIcon} />
                </Link>
                <Link href="/terms-of-use" className={styles.legalCardLink}>
                  <FileText size={16} className={styles.legalIcon} />
                  <span className={styles.legalLinkText}>Read Terms of Use</span>
                  <ExternalLink size={14} className={styles.extIcon} />
                </Link>
              </div>
            </div>

            {error && (
              <div className={styles.errorAlert}>
                <AlertCircle size={17} />
                <span>{error}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className={styles.actions}>
              <button
                type="button"
                onClick={handleAccept}
                disabled={loading}
                className={styles.agreeButton}
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span>Recording Consent...</span>
                  </>
                ) : (
                  <>
                    <span>I Agree &amp; Continue to Portal</span>
                    <ArrowRight size={18} />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleSignOut}
                disabled={loading}
                className={styles.declineButton}
              >
                <LogOut size={16} />
                <span>Decline &amp; Sign Out</span>
              </button>
            </div>

            <p className={styles.complianceNotice}>
              Consent acceptance is timestamped and recorded in an immutable audit ledger in accordance with university statutory compliance regulations.
            </p>
          </div>
        </div>
      </main>

      {/* Institutional Portal Footer */}
      <PortalFooter />
    </div>
  )
}
