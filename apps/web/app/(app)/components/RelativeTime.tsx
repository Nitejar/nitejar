'use client'

import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

interface RelativeTimeProps {
  /** Unix epoch seconds */
  timestamp: number
  prefix?: string
  className?: string
}

export function RelativeTime({ timestamp, prefix, className }: RelativeTimeProps) {
  const absolute = new Date(timestamp * 1000).toLocaleString()
  const relative = formatRelativeTime(timestamp)

  return (
    <Tooltip>
      <TooltipTrigger className={className ?? 'cursor-default'}>
        {prefix ? `${prefix} ${relative}` : relative}
      </TooltipTrigger>
      <TooltipContent side="bottom">{absolute}</TooltipContent>
    </Tooltip>
  )
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp * 1000

  // Future timestamps
  if (diffMs < 0) {
    const seconds = Math.floor(-diffMs / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `in ${days}d`
    if (hours > 0) return `in ${hours}h`
    if (minutes > 0) return `in ${minutes}m`
    return 'in a moment'
  }

  // Past timestamps
  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'just now'
}
