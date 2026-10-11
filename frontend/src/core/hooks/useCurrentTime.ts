'use client'
import { useEffect, useState } from 'react'

/** Minute updates, with an extra wake-up at a deadline and after resuming a tab. */
export function useCurrentTime(intervalMs = 60000, boundary?: string | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const timer = setInterval(refresh, intervalMs)
    const target = boundary ? Date.parse(boundary) : NaN
    const delay = target - Date.now()
    const deadlineTimer = Number.isFinite(target) && delay <= 2147483646
      ? setTimeout(refresh, Math.max(1, delay + 1)) : undefined
    const resume = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', resume)
    return () => {
      clearInterval(timer)
      clearTimeout(deadlineTimer)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [intervalMs, boundary])
  return now
}
