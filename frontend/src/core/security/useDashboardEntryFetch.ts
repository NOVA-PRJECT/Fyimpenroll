'use client'

import { useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { takeDashboardEntry } from './dashboard-entry'
import { primeData } from '../data-cache'

/** Seed shared display data from the login preload; later reads use the shared transport. */
export function useDashboardEntryFetch() {
  const path = usePathname()
  return useCallback((endpoint: string, init?: RequestInit): Promise<Response> => {
    if (init?.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
    const entry = (!init?.method || init.method === 'GET') ? takeDashboardEntry(path, endpoint) : null
    if (entry) { primeData(endpoint, entry.data); return Promise.resolve(Response.json(entry.data)) }
    return fetch(endpoint, init)
  }, [path])
}
