'use client'
import { useEffect, useState } from 'react'
import type { DataDomain } from '@fyimp/contracts'

/** Mutation invalidation updates active views; manual Refresh calls only its section loader. */
export function useDataRevision(domains: readonly DataDomain[], blocked = false) {
  const [revision, setRevision] = useState(0)
  const key = [...domains].sort().join(',')
  useEffect(() => {
    const selected = key.split(',').filter(Boolean) as DataDomain[]
    const change = (event: Event) => {
      if (!blocked && (event as CustomEvent<DataDomain[]>).detail.some(domain => selected.includes(domain))) setRevision(value => value + 1)
    }
    window.addEventListener('fyimp:data-change', change)
    return () => { window.removeEventListener('fyimp:data-change', change) }
  }, [key, blocked])
  return revision
}
