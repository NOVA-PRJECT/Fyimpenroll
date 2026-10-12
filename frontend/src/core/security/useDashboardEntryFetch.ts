'use client'

import { useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { takeDashboardEntry } from './dashboard-entry'

/** Consume the login preload once; subsequent refreshes always reach the API. */
export function useDashboardEntryFetch() {
  const path = usePathname()
  return useCallback((endpoint: string, init?: RequestInit): Promise<Response> => {
    if (init?.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
    const entry = (!init?.method || init.method === 'GET') ? takeDashboardEntry(path, endpoint) : null
    return entry ? Promise.resolve(Response.json(entry.data)) : fetch(endpoint, init)
  }, [path])
}
