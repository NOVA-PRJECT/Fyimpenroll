'use client'

import { useState, useEffect, useCallback } from 'react'
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

interface LevelBandItem {
  band: string
  title: string
  registeredCredits?: number
  earned: number
  minimum: number
  shortfall: number
  isMet: boolean
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
  coreCredits?: number
  additionalCredits?: number
  categories: CategoryItem[]
  levelBands: LevelBandItem[]
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
    levelBand: string
    isAdditional?: boolean
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
  const [data, setData] = useState<CreditLedgerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
  }, [fetchLedger])

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingContainer}>
          <div className={styles.spinner} />
          <p>Loading registered coursework...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className={styles.container}>
        <div className={styles.errorContainer}>
          <p style={{ color: '#be123c', fontWeight: 600 }}>{error || 'Unable to load credit ledger.'}</p>
          <button onClick={fetchLedger} className={styles.backBtn}>
            Try Again
          </button>
        </div>
      </div>
    )
  }

  const {
    totalCredits,
    coreCredits = totalCredits,
    additionalCredits = 0,
    categories,
    levelBands,
    byDepartment,
    registeredCourses,
    advisoryMatrixVersion = 'Academic matrix pending',
    disclaimer,
    unresolvedRequirementNote,
  } = data

  const exportUrl = (fmt: 'csv' | 'xlsx') =>
    `/api/export/credit-ledger/${studentId || 'me'}?format=${fmt}`

  return (
    <div className={styles.container}>
      <main className={styles.contentWrapper}>
        {/* Top Header Card (F50 Advisory Labeling) */}
        <section className={styles.ledgerHeaderCard}>
          <div className={styles.ledgerHeaderLeft}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h1 className={styles.ledgerHeaderTitle}>KU-FYIMP Registered-Credit Ledger</h1>
              <span style={{ fontSize: '0.75rem', background: '#dbeafe', color: '#1e40af', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                {advisoryMatrixVersion || 'Academic matrix pending'}
              </span>
            </div>
            <p className={styles.ledgerHeaderSub}>
              Registered coursework; degree compliance is not assessed
            </p>
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
              <a
                href={exportUrl('csv')}
                download
                className={styles.backBtn}
                style={{ textDecoration: 'none', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
              >
                📥 Export CSV
              </a>
              <a
                href={exportUrl('xlsx')}
                download
                className={styles.backBtn}
                style={{ textDecoration: 'none', fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
              >
                📊 Export Excel
              </a>
            </div>
          </div>
          <div className={styles.totalCreditsBox}>
            <div className={styles.totalCreditsLabel}>Total Registered Credits</div>
            <div className={styles.totalCreditsValue}>{totalCredits}</div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
              Core: {coreCredits} cr | Addl: {additionalCredits} cr
            </div>
          </div>
        </section>

        {/* Advisory Disclaimer Box (F50, F52) */}
        {disclaimer && (
          <div style={{
            background: '#fffbeb',
            border: '1px solid #fef3c7',
            borderLeft: '4px solid #f59e0b',
            borderRadius: '8px',
            padding: '0.85rem 1.25rem',
            marginBottom: '1.25rem',
            fontSize: '0.85rem',
            color: '#92400e',
            lineHeight: 1.45,
          }}>
            <strong>Advisory Notice:</strong> {disclaimer}
            {unresolvedRequirementNote && (
              <div style={{ marginTop: '0.4rem', color: '#78350f', fontSize: '0.8rem' }}>
                ℹ️ {unresolvedRequirementNote}
              </div>
            )}
          </div>
        )}

        <section className={styles.sectionCard}>
          <h2>Registered credits by category</h2>
          <p>Degree requirements are unavailable until the academic matrix is approved. Missing historical snapshots use current catalogue credits and are not certified historical totals.</p>
          <div className={styles.circularGrid}>{categories.map(c => <div key={c.category} className={styles.circularCard}><strong>{c.category}</strong><span>{c.registeredCredits ?? c.earned} credits</span></div>)}</div>
        </section>

        {/* Section 3: Level Band Breakdown Table (F51 Parsed Levels) */}
        <section className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Course Level Band Distribution</h2>
              <p className={styles.sectionSub}>Explicit catalogue levels only. Course serial numbers do not determine academic level.</p>
            </div>
          </div>

          <div className={styles.tableResponsive}>
            <table className={styles.ledgerTable}>
              <thead>
                <tr>
                  <th>Level Band</th>
                  <th>Level Description</th>
                  <th>Registered Credits</th>
                </tr>
              </thead>
              <tbody>
                {levelBands.map((band) => (
                  <tr key={band.band}>
                    <td>
                      <strong>{band.band}</strong>
                    </td>
                    <td>
                      <span>{band.title}</span>
                    </td>
                    <td>
                      <strong style={{ fontSize: '1rem', color: '#0f172a' }}>{band.earned} Credits</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                  <th>Level</th>
                  <th>Track</th>
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
                      <code style={{ fontWeight: 700, color: '#1e3a8a' }}>{c.courseCode}</code>
                    </td>
                    <td>{c.title}</td>
                    <td>{c.normalizedCategory}</td>
                    <td>
                      <span style={{ fontSize: '0.75rem', background: '#f1f5f9', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                        {c.levelBand}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.75rem', color: c.isAdditional ? '#b45309' : '#047857' }}>
                        {c.isAdditional ? 'Additional' : 'Core'}
                      </span>
                    </td>
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
