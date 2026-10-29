'use client'

import { useDataRevision } from '@/core/hooks/useDataRevision'
import { refreshDatasets } from '@/core/data-cache'
import SectionRefreshButton from '@/components/SectionRefreshButton'

import LoadingState from '@/components/LoadingState'

import { Info as UiInfo } from 'lucide-react'

import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import styles from './credit-ledger.module.css'

interface CategoryItem {
  category: string
  title: string
  registeredCredits?: number
  earned: number
  min3Year: number
  min4Year: number
  shortfall3Year: number
  shortfall4Year: number
  isMet3Year: boolean
  isMet4Year: boolean
  advisoryStatus?: string
}

interface DeptItem {
  departmentId: string
  departmentName: string
  earned: number
  count: number
}

interface ExitMilestone {
  title: string
  eligible: boolean
  advisoryEligible?: boolean
  totalCredits: number
  requiredCredits: number
  targetCredits?: number
  totalShortfall: number
  unmetCategories: string[]
  unmetBands: string[]
  primaryShortfall: string
  statusNote?: string
}

interface CreditLedgerData {
  student: {
    id: string
    fullName: string
    capApplicationNumber: string
    currentSemester: number
    academicYearJoined: string
    departmentName: string
    departmentCode: string
    campusName: string
  }
  advisoryMatrixVersion?: string
  disclaimer?: string
  unresolvedRequirementNote?: string
  totalCredits: number
  totalRegisteredCredits?: number
  categories: CategoryItem[]
  byDepartment: DeptItem[]
  exitEligibility: {
    threeYear: ExitMilestone
    fourYear: ExitMilestone
    fiveYear: ExitMilestone
  }
  registeredCourses: Array<{
    id: string
    courseCode: string
    title: string
    credits: number
    category: string
    normalizedCategory: string
    departmentName: string
    semester: number
    academicYear?: string
    creditSource?: string
  }>
}

interface CreditLedgerViewProps {
  studentId?: string
}

export default function CreditLedgerView({
  studentId,
}: CreditLedgerViewProps) {
  const dataRevision = useDataRevision(["people","catalogue","enrollment","assignments"])
  const [data, setData] = useState<CreditLedgerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const ledgerEndpoint = studentId && studentId !== 'me' ? `/api/credit-ledger/${studentId}` : '/api/credit-ledger/me'

  const fetchLedger = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const baseEndpoint = studentId && studentId !== 'me'
        ? `/api/credit-ledger/${studentId}`
        : '/api/credit-ledger/me'
      const endpoint = `${baseEndpoint}?_t=${Date.now()}`

      const res = await fetch(endpoint, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      })
      const json = await res.json()

      if (!res.ok) {
        setError(json.message || 'Failed to load credit ledger.')
        setLoading(false)
        return
      }

      setData(json)
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : '') || 'Network error fetching credit ledger.')
    } finally {
      setLoading(false)
    }
  }, [studentId])

  useEffect(() => {

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Starts synchronization with the remote API for this mounted view.
    fetchLedger()
  }, [fetchLedger, dataRevision])

  if (loading) {
    return (
      <div className={styles.container}>
        <LoadingState layout="dashboard" message="Loading registered coursework…" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className={styles.container}>
        <div className={styles.errorContainer}>
          <p style={{ color: "var(--portal-danger-text,#be123c)", fontWeight: 600 }}>{error || 'Unable to load credit ledger.'}</p>
          <button onClick={() => void refreshDatasets([ledgerEndpoint], fetchLedger)} className={styles.backBtn}>
            Try Again
          </button>
        </div>
      </div>
    )
  }

  const {
    totalCredits,
    categories,
    byDepartment,
    registeredCourses,
    advisoryMatrixVersion = 'Academic matrix pending',
    disclaimer,
    unresolvedRequirementNote,
  } = data

  const exportUrl = (fmt: 'csv' | 'xlsx') =>
    `/api/export/credit-ledger/${studentId || 'me'}?format=${fmt}`
  const registeredTotal = data.totalRegisteredCredits ?? totalCredits
  const categoryTotal = categories.reduce((sum, category) => sum + (category.registeredCredits ?? category.earned), 0)
  const categoryColors = ['#3b82f6', '#14b8a6', '#a78bfa', '#f59e0b', '#38bdf8', '#f472b6']

  return (
    <div className={styles.container}>
      <main className={styles.contentWrapper}>
        {error && <div role="alert" className={styles.errorContainer}>
          <p>{error} Showing the last successful result.</p>
          <button className={styles.backBtn} onClick={() => void refreshDatasets([ledgerEndpoint], fetchLedger)}>Retry</button>
        </div>}
        {/* Top Header Card (F50 Advisory Labeling) */}
        <section className={styles.ledgerHeaderCard}>
          <div className={styles.ledgerHeaderLeft}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h1 className={styles.ledgerHeaderTitle}>KU-FYIMP Registered-Credit Ledger</h1>
              <span style={{ fontSize: '0.75rem', background: "var(--portal-info-bg,#dbeafe)", color: "var(--portal-info-text,#1e40af)", padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                {advisoryMatrixVersion || 'Academic matrix pending'}
              </span>
            </div>
            <p className={styles.ledgerHeaderSub}>
              Registered coursework; degree compliance is not assessed
            </p>
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
              <SectionRefreshButton endpoints={[ledgerEndpoint]} onRefresh={fetchLedger} disabled={loading} className={styles.backBtn} label="Refresh ledger" />
              <a
                href={exportUrl('csv')}
                download
                className={styles.backBtn}
                style={{ textDecoration: 'none', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
              >
                Export CSV
              </a>
              <a
                href={exportUrl('xlsx')}
                download
                className={styles.backBtn}
                style={{ textDecoration: 'none', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
              >
                Export Excel
              </a>
            </div>
          </div>
          <div className={styles.totalCreditsBox}>
            <div className={styles.totalCreditsLabel}>Total Registered Credits</div>
            <div className={styles.totalCreditsValue}>{registeredTotal}<span> credits</span></div>
          </div>
        </section>

        {/* Advisory Disclaimer Box (F50, F52) */}
        {disclaimer && (
          <details className={styles.advisoryNotice}>
            <summary><UiInfo size={15} aria-hidden="true" /> Registered credits do not confirm course completion</summary>
            <p>{disclaimer}</p>
            {unresolvedRequirementNote && (
              <p>{unresolvedRequirementNote}</p>
            )}
          </details>
        )}

        <section className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Registered credits by category</h2>
            </div>
          </div>
          <div className={styles.circularGrid}>{categories.map((category, index) => {
            const credits = category.registeredCredits ?? category.earned
            const share = categoryTotal > 0 ? credits / categoryTotal : 0
            return <article key={category.category} className={`${styles.circularCard} ${credits === 0 ? styles.emptyCategory : ''}`}
              style={{ '--category-color': categoryColors[index % categoryColors.length] } as CSSProperties}>
              <span className={styles.categoryCardCode}>{category.category}</span>
              <div className={styles.circleWrapper}>
                <svg viewBox="0 0 96 96" className={styles.circleSvg} aria-hidden="true">
                  <circle cx="48" cy="48" r="39" className={styles.circleTrack} />
                  <circle cx="48" cy="48" r="39" className={styles.circleFill} pathLength="100" strokeDasharray={`${Math.min(100, Math.max(0, share * 100))} 100`} />
                </svg>
                <div className={styles.circleCenter}><strong className={styles.circleCreditNum}>{credits}</strong><span className={styles.circleCreditUnit}>credits</span></div>
              </div>
            </article>
          })}</div>
        </section>

        {/* Section 4: Department Distribution Bar Graph */}
        <section className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Registered Credits by Academic Department</h2>
              <p className={styles.sectionSub}>Departmental credit distribution from registered coursework</p>
            </div>
          </div>

          {byDepartment.length > 0 ? (
            <div className={styles.barGraph}>
              {(() => {
                const maxCredits = Math.max(...byDepartment.map((d) => d.earned), 1)
                return byDepartment.map((dept) => {
                  const widthPercent = Math.max(6, Math.round((dept.earned / maxCredits) * 100))
                  return (
                    <div key={dept.departmentId} className={styles.barItem}>
                      <div className={styles.barHeader}>
                        <span className={styles.barDeptTitle}>{dept.departmentName}</span>
                        <span className={styles.barDeptMeta}>
                          {dept.count} {dept.count === 1 ? 'course' : 'courses'} registered
                        </span>
                      </div>
                      <div className={styles.barTrackWrapper}>
                        <div className={styles.barTrack}>
                          <div
                            className={styles.barFill}
                            style={{ width: `${widthPercent}%` }}
                          />
                        </div>
                        <span className={styles.barBadge}>{dept.earned} Credits</span>
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          ) : (
            <p className={styles.barEmpty}>No departmental course registrations recorded.</p>
          )}
        </section>

        {/* Section 5: Registered Papers Audit Grid */}
        <section className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Registered Courses Audit Log</h2>
              <p className={styles.sectionSub}>Complete inventory of papers evaluated for this registered-credit ledger</p>
            </div>
          </div>

          <div className={styles.tableResponsive}>
            <table className={styles.ledgerTable}>
              <thead>
                <tr>
                  <th>Sem</th>
                  <th>Code</th>
                  <th>Course Title</th>
                  <th>Category</th>
                  <th>Department</th>
                  <th>Credits</th>
                </tr>
              </thead>
              <tbody>
                {registeredCourses.map((c) => (
                  <tr key={`${c.id}-${c.academicYear}-${c.semester}`}>
                    <td>
                      <span className={`${styles.statusTag} ${styles.info}`}>{c.semester}</span>
                    </td>
                    <td>
                      <code style={{ fontWeight: 700, color: "var(--portal-info-text,#1e3a8a)" }}>{c.courseCode}</code>
                    </td>
                    <td>{c.title}</td>
                    <td>{c.normalizedCategory}</td>
                    <td>{c.departmentName}</td>
                    <td>
                      <strong title={c.creditSource === 'registration_snapshot' ? 'Registration snapshot' : 'Current catalogue; historical snapshot unavailable'}>{c.credits}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
