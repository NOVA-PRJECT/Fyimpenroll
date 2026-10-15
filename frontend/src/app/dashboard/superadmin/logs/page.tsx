'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import PageLoading from '@/components/PageLoading'

export default function SuperAdminLogsRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/dashboard/superadmin?tab=logs')
  }, [router])

  return (
    <PageLoading message="Opening system and audit logs…" layout="table" />
  )
}
