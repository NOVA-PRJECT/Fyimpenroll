'use client'
import { useEffect, useState } from 'react'

export default function AuthCleanupStatus({ requestId }: { requestId: string }) {
  const [summary, setSummary] = useState<{ completed: number; pending: number; failed: number } | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let terminal = false, pending = false
    const load = async () => {
      if (pending || controller.signal.aborted) return
      pending = true
      try {
        const response = await fetch(`/api/admin/auth-cleanup?requestId=${encodeURIComponent(requestId)}`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Could not refresh account cleanup status')
        const value = await response.json()
        if (!controller.signal.aborted) { setSummary(value); setError(''); terminal = value.pending === 0 }
      } catch (error) { if (!controller.signal.aborted) setError((error as Error).message) }
      finally { pending = false }
    }
    void load()
    const timer = setInterval(() => { if (!terminal && document.visibilityState !== 'hidden') void load() }, 10000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [requestId, revision])
  const retry = async () => {
    const response = await fetch('/api/admin/auth-cleanup/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId }) })
    if (!response.ok) { setError('Could not retry account cleanup'); return }
    setRevision(value => value + 1)
  }
  return <div role="status" aria-live="polite">
    <strong>Authentication account cleanup</strong>
    {summary && <p>{summary.completed} completed · {summary.pending} pending · {summary.failed} need attention.</p>}
    {error && <p>{error}</p>}
    {!!summary?.failed && <button type="button" onClick={() => { void retry().catch(() => setError('Could not retry account cleanup')) }}>Retry failed cleanup</button>}
  </div>
}
