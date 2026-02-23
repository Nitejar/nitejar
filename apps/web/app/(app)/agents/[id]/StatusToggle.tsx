'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { IconCircleCheck, IconCircleDashed, IconCircleX } from '@tabler/icons-react'

type AgentStatus = 'idle' | 'busy' | 'offline'

interface StatusToggleProps {
  agentId: string
  currentStatus: AgentStatus
}

const statusConfig: Record<
  AgentStatus,
  { icon: typeof IconCircleCheck; label: string; color: string }
> = {
  idle: {
    icon: IconCircleCheck,
    label: 'Idle',
    color: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10 hover:bg-emerald-400/20',
  },
  busy: {
    icon: IconCircleDashed,
    label: 'Busy',
    color: 'text-amber-400 border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20',
  },
  offline: {
    icon: IconCircleX,
    label: 'Offline',
    color: 'text-zinc-400 border-zinc-500/30 bg-zinc-500/10 hover:bg-zinc-500/20',
  },
}

export function StatusToggle({ agentId, currentStatus }: StatusToggleProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)

  const updateStatus = trpc.org.updateAgentStatus.useMutation({
    onSuccess: () => {
      router.refresh()
      setIsOpen(false)
    },
  })

  const status = statusConfig[currentStatus] ?? statusConfig.offline
  const StatusIcon = status.icon

  const handleStatusChange = (newStatus: AgentStatus) => {
    if (newStatus !== currentStatus) {
      updateStatus.mutate({ id: agentId, status: newStatus })
    } else {
      setIsOpen(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={updateStatus.isPending}
        className={cn(
          'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition',
          status.color,
          updateStatus.isPending && 'opacity-50'
        )}
      >
        <StatusIcon className="h-3.5 w-3.5" />
        {updateStatus.isPending ? '...' : status.label}
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          {/* Dropdown */}
          <div className="absolute right-0 top-full z-20 mt-1 min-w-[120px] overflow-hidden rounded-lg border border-white/10 bg-zinc-900 shadow-xl">
            {(['idle', 'busy', 'offline'] as AgentStatus[]).map((s) => {
              const config = statusConfig[s]
              const Icon = config.icon
              const isActive = s === currentStatus
              return (
                <button
                  key={s}
                  onClick={() => handleStatusChange(s)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-xs transition hover:bg-white/5',
                    isActive && 'bg-white/5'
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5', config.color.split(' ')[0])} />
                  <span className={isActive ? 'text-white' : 'text-white/70'}>{config.label}</span>
                  {isActive && <span className="ml-auto text-[10px] text-white/30">current</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
