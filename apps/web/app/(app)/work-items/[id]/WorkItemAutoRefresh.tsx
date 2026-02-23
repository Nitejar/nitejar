'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  enabled: boolean
  intervalMs?: number
}

export function WorkItemAutoRefresh({ enabled, intervalMs = 2000 }: Props) {
  const router = useRouter()

  useEffect(() => {
    if (!enabled) return

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        router.refresh()
      }
    }, intervalMs)

    return () => clearInterval(timer)
  }, [enabled, intervalMs, router])

  return null
}
