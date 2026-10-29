'use client'
import { QueryClientProvider } from '@tanstack/react-query'
import { cachedDataFetch, clearDataCache, dataClient } from '@/core/data-cache'
import { installGlobalFetchInterceptor, registerDataTransport } from '@/core/security/refresh-coordinator'
let installed = false

export default function DataProvider({ children }: { children: React.ReactNode }) {
  // Install before children mount; their first effects must use the same transport.
  if (typeof window !== 'undefined' && !installed) {
    registerDataTransport(cachedDataFetch)
    window.addEventListener('fyimp:session-cleared', clearDataCache)
    installGlobalFetchInterceptor()
    installed = true
  }
  return <QueryClientProvider client={dataClient}>{children}</QueryClientProvider>
}
