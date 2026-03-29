'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { parseAgentIdentityConfig } from '@/lib/agent-config-client'
import type { RouterOutputs } from '@/lib/trpc'

type ActiveOperation = RouterOutputs['commandCenter']['getFleetStatus']['activeOperations'][number]

function formatElapsed(startedAt: number | null, nowTs: number): string {
  if (!startedAt) return '—'
  const elapsed = Math.max(0, nowTs - startedAt)
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60)
    return `${hrs}h ${mins % 60}m`
  }
  return `${mins}m ${String(secs).padStart(2, '0')}s`
}

function AgentAvatar({ name, config }: { name: string; config: string | null }) {
  const identity = parseAgentIdentityConfig(config)
  const initials = name
    .split(/[-_\s]/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded border border-zinc-800 bg-gradient-to-br from-white/10 to-white/5">
      {identity.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={identity.avatarUrl} alt={name} className="h-full w-full object-cover" />
      ) : identity.emoji ? (
        <span className="text-[0.5rem] leading-none">{identity.emoji}</span>
      ) : (
        <span className="text-[0.4rem] font-semibold text-white/60">{initials}</span>
      )}
    </div>
  )
}

function OperationRow({ op, nowTs }: { op: ActiveOperation; nowTs: number }) {
  return (
    <Link
      href={op.source === 'session' ? '/sessions' : '/work-items'}
      className="flex items-center gap-3 rounded px-3 py-1.5 transition hover:bg-white/[0.04]"
    >
      <AgentAvatar name={op.agentName} config={op.agentConfig} />
      <span className="min-w-0 flex-1 truncate text-sm text-white/80">{op.agentName}</span>
      <span className="min-w-0 max-w-[200px] truncate text-xs text-muted-foreground">
        {op.title}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-amber-400/70">
        {formatElapsed(op.startedAt, nowTs)}
      </span>
      <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[0.6rem] text-muted-foreground">
        {op.source}
      </span>
    </Link>
  )
}

export function LiveOperations({ operations }: { operations: ActiveOperation[] }) {
  const running = operations.filter((op) => op.status === 'running')
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    if (running.length === 0) return
    const interval = setInterval(() => {
      setNowTs(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [running.length])

  if (running.length === 0) return null

  return (
    <div className="border-b border-zinc-800 bg-amber-500/[0.03]">
      <div className="flex items-center gap-2 px-4 pt-2 pb-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
        <span className="text-[0.65rem] font-medium uppercase tracking-[0.15em] text-amber-400/70">
          {running.length} running
        </span>
      </div>
      <div className="space-y-0.5 px-1 pb-2">
        {running.map((op) => (
          <OperationRow key={op.dispatchId} op={op} nowTs={nowTs} />
        ))}
      </div>
    </div>
  )
}
