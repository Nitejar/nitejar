'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { parseAgentIdentityConfig } from '@/lib/agent-config-client'
import { Input } from '@/components/ui/input'
import { IconLoader2, IconRocket, IconMessageCircle } from '@tabler/icons-react'
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarGroup,
  AvatarGroupCount,
} from '@/components/ui/avatar'
import { toast } from 'sonner'
import { PageScrollShell } from './components/PageScrollShell'
import { PulseStrip } from './command-center/PulseStrip'
import { LiveOperations } from './command-center/LiveOperations'
import { RecentActivity } from './command-center/RecentActivity'
import { AttentionColumn } from './command-center/AttentionColumn'
import { DashboardSkeleton } from './command-center/DashboardSkeleton'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FleetAgent = {
  agentId: string
  name: string
  handle: string
  config: string | null
  status: 'busy' | 'idle'
  runCount: number
  cost: number
  lastActiveAt: number | null
}

type SessionItem = {
  sessionKey: string
  displayTitle: string
  lastMessageAt: number
  participants: Array<{
    id: string
    name: string
    emoji: string | null
    avatarUrl: string | null
  }>
}

// ---------------------------------------------------------------------------
// Empty State — 0 agents
// ---------------------------------------------------------------------------

function EmptyState() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const createAgent = trpc.org.createAgent.useMutation({
    onError: () => {
      toast.error('Failed to create agent')
    },
  })
  const startOrResume = trpc.sessions.startOrResume.useMutation({
    onError: () => {
      toast.error('Failed to start session')
    },
  })

  function deriveHandle(agentName: string): string {
    return (
      agentName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30) || 'agent'
    )
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || loading) return
    setLoading(true)
    setError(null)
    try {
      const handle = deriveHandle(name)
      const agent = await createAgent.mutateAsync({
        handle,
        name: name.trim(),
      })
      const session = await startOrResume.mutateAsync({ agentId: agent.id })
      router.push(`/sessions/${encodeURIComponent(session.sessionKey)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center px-4 py-16">
      <div className="mb-6 flex h-20 w-20 items-center justify-center border border-dashed border-zinc-800 bg-white/[0.02]">
        <IconRocket className="h-10 w-10 text-white/20" />
      </div>
      <h1 className="text-2xl font-semibold">Welcome to Nitejar</h1>
      <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
        Create your first agent to get started. Give it a name and a one-liner about what it does.
      </p>

      <form onSubmit={handleCreate} className="mt-8 w-full max-w-md space-y-4">
        <div>
          <Input
            placeholder="Agent name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-10 border-zinc-800 bg-white/5 text-sm placeholder:text-white/30"
            autoFocus
          />
          {name.trim() && (
            <p className="mt-1 text-[0.65rem] text-muted-foreground">
              Handle: @{deriveHandle(name)}
            </p>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={!name.trim() || loading}
          className="flex w-full items-center justify-center gap-2 bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? (
            <IconLoader2 className="h-4 w-4 animate-spin" />
          ) : (
            <IconMessageCircle className="h-4 w-4" />
          )}
          Create & Start Chatting
        </button>
      </form>

      <div className="mt-6 flex flex-col items-center gap-2 text-xs text-muted-foreground">
        <Link href="/agents/builder" className="hover:text-foreground">
          Want more control? Use the agent builder &rarr;
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HomeSearch — cmdk-powered command palette
// ---------------------------------------------------------------------------

function HomeSearch({ agents, sessions }: { agents: FleetAgent[]; sessions: SessionItem[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const startOrResume = trpc.sessions.startOrResume.useMutation({
    onError: () => {
      toast.error('Failed to start session')
    },
  })

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleStartSession = useCallback(
    async (agentId: string) => {
      if (loading) return
      setLoading(agentId)
      try {
        const result = await startOrResume.mutateAsync({ agentId })
        setOpen(false)
        router.push(`/sessions/${encodeURIComponent(result.sessionKey)}`)
      } catch {
        setLoading(null)
      }
    },
    [loading, startOrResume, router]
  )

  const handleGoToSession = useCallback(
    (sessionKey: string) => {
      setOpen(false)
      router.push(`/sessions/${encodeURIComponent(sessionKey)}`)
    },
    [router]
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Search sessions or start a new conversation"
    >
      <Command shouldFilter>
        <CommandInput placeholder="Search sessions or start a new one..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          <CommandGroup heading="Start New">
            {agents.map((agent) => {
              const config = parseAgentIdentityConfig(agent.config)
              const initials = agent.name
                .split(/[-_\s]/)
                .map((part) => part[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()
              const isLoading = loading === agent.agentId
              return (
                <CommandItem
                  key={agent.agentId}
                  value={`new ${agent.name} ${agent.handle}`}
                  onSelect={() => handleStartSession(agent.agentId)}
                >
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded border border-zinc-800 bg-gradient-to-br from-white/10 to-white/5">
                    {config.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={config.avatarUrl}
                        alt={agent.name}
                        className="h-full w-full object-cover"
                      />
                    ) : config.emoji ? (
                      <span className="text-[0.5rem] leading-none">{config.emoji}</span>
                    ) : (
                      <span className="text-[0.4rem] font-semibold text-white/60">{initials}</span>
                    )}
                  </div>
                  <span className="flex-1 truncate">Chat with {agent.name}</span>
                  {isLoading && <IconLoader2 className="h-3.5 w-3.5 animate-spin" />}
                </CommandItem>
              )
            })}
          </CommandGroup>

          {sessions.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Recent Sessions">
                {sessions.map((session) => (
                  <CommandItem
                    key={session.sessionKey}
                    value={`session ${session.displayTitle} ${session.participants.map((p) => p.name).join(' ')}`}
                    onSelect={() => handleGoToSession(session.sessionKey)}
                  >
                    <AvatarGroup>
                      {session.participants.slice(0, 2).map((p) => (
                        <Avatar key={p.id} size="sm">
                          {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.name} /> : null}
                          <AvatarFallback>
                            {p.emoji || p.name.slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                      {session.participants.length > 2 && (
                        <AvatarGroupCount>+{session.participants.length - 2}</AvatarGroupCount>
                      )}
                    </AvatarGroup>
                    <span className="flex-1 truncate">{session.displayTitle}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

// ---------------------------------------------------------------------------
// AdminHome — adaptive wrapper
// ---------------------------------------------------------------------------

export function AdminHome() {
  const fleetQuery = trpc.commandCenter.getFleetStatus.useQuery({ period: '7d' })
  const sessionsQuery = trpc.sessions.list.useQuery({ limit: 5 })
  const workQuery = trpc.work.getDashboard.useQuery(undefined, { refetchInterval: 30_000 })
  const costQuery = trpc.costs.getSummary.useQuery()
  const activityQuery = trpc.commandCenter.getRecentActivity.useQuery(undefined, {
    refetchInterval: 30_000,
  })

  if (fleetQuery.isLoading || workQuery.isLoading) {
    return (
      <PageScrollShell className="mx-auto max-w-6xl">
        <DashboardSkeleton />
      </PageScrollShell>
    )
  }

  const fleet = fleetQuery.data
  const work = workQuery.data
  if (!fleet || !work) return null

  const sessions: SessionItem[] = (sessionsQuery.data?.items ?? []).map((s) => ({
    sessionKey: s.sessionKey,
    displayTitle: s.displayTitle,
    lastMessageAt: s.lastMessageAt,
    participants: s.participants.map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji,
      avatarUrl: p.avatarUrl,
    })),
  }))

  const { totalAgents } = fleet.summary

  // State 1: Empty (0 agents)
  if (totalAgents === 0) {
    return <EmptyState />
  }

  // State 2+: Dashboard
  return (
    <PageScrollShell className="mx-auto max-w-6xl space-y-6">
      {/* Zone 1: Pulse Strip */}
      <PulseStrip fleet={fleet} work={work} costs={costQuery.data} />

      {/* Zone 2: Live Operations (conditional) */}
      <LiveOperations operations={fleet.activeOperations} />

      {/* Zone 3: Two-column main content */}
      <div className="grid grid-cols-1 gap-6 px-4 sm:px-0 lg:grid-cols-[minmax(0,1fr)_340px]">
        <RecentActivity entries={activityQuery.data ?? []} isLoading={activityQuery.isLoading} />
        <div className="order-first lg:order-last">
          <AttentionColumn fleet={fleet} work={work} />
        </div>
      </div>

      {/* Search palette (Cmd+K) */}
      <HomeSearch agents={fleet.roster} sessions={sessions} />
    </PageScrollShell>
  )
}
