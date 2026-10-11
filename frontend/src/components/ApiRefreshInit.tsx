'use client'

import { useEffect } from 'react'
import { installGlobalFetchInterceptor } from '../core/security/refresh-coordinator'

export function ApiRefreshInit() {
  useEffect(() => {
    installGlobalFetchInterceptor()
  }, [])

  return null
}
