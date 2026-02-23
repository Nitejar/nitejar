'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { IconMessageCircle, IconLoader2 } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

interface ChatWithAgentButtonProps {
  agentId: string
  agentName?: string
  variant?: 'default' | 'icon'
  className?: string
}

export function ChatWithAgentButton({
  agentId,
  agentName,
  variant = 'default',
  className,
}: ChatWithAgentButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const startOrResume = trpc.sessions.startOrResume.useMutation()

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (loading) return
    setLoading(true)
    try {
      const result = await startOrResume.mutateAsync({ agentId })
      router.push(`/sessions/${encodeURIComponent(result.sessionKey)}`)
    } catch {
      setLoading(false)
    }
  }

  if (variant === 'icon') {
    return (
      <button
        onClick={handleClick}
        disabled={loading}
        title={agentName ? `Chat with ${agentName}` : 'Chat'}
        className={cn(
          'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary disabled:opacity-50',
          className
        )}
      >
        {loading ? (
          <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <IconMessageCircle className="h-3.5 w-3.5" />
        )}
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 rounded-lg border border-primary/40 bg-primary/15 px-4 py-2 text-sm font-medium text-primary transition hover:border-primary/60 hover:bg-primary/25 disabled:opacity-50',
        className
      )}
    >
      {loading ? (
        <IconLoader2 className="h-4 w-4 animate-spin" />
      ) : (
        <IconMessageCircle className="h-4 w-4" />
      )}
      Chat
    </button>
  )
}
