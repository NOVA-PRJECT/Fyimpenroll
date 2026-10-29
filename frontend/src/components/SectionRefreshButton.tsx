'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { canonicalDataUrl } from '@fyimp/contracts'
import { dataClient, refreshDatasets } from '@/core/data-cache'
import styles from './section-refresh-button.module.css'

/** Fits beside a section's existing filters/actions; never refreshes other sections. */
export default function SectionRefreshButton({ endpoints, onRefresh, disabled = false, className, label = 'Refresh' }: {
  endpoints: string[]
  onRefresh: () => unknown | Promise<unknown>
  disabled?: boolean
  className?: string
  label?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [, update] = useState(0)
  useEffect(() => dataClient.getQueryCache().subscribe(() => update(value => value + 1)), [])
  const urls = new Set(endpoints.map(canonicalDataUrl))
  const queries = dataClient.getQueryCache().findAll({ predicate: query => query.queryKey[0] === 'data' && urls.has(String(query.queryKey[3])) })
  const last = Math.max(0, ...queries.map(query => query.state.dataUpdatedAt))
  const failed = queries.some(query => query.state.status === 'error')
  return <>
    <button type="button" className={[styles.button, className].filter(Boolean).join(' ')} disabled={disabled || busy}
      title={last ? `Last updated ${new Date(last).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST` : undefined}
      onClick={async () => {
        setBusy(true); setError('')
        try { await refreshDatasets(endpoints, onRefresh) }
        catch (reason) { if (!(reason instanceof Error && reason.name === 'AbortError')) setError('Refresh failed. Please retry.') }
        finally { setBusy(false) }
      }}>
      <RefreshCw size={14} aria-hidden="true" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />
      {busy ? 'Refreshing…' : failed ? 'Retry' : label}
    </button>
    {error && <span role="alert">{error}</span>}
  </>
}
