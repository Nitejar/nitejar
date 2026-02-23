'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { parseAgentIdentityConfig } from '@/lib/agent-config-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  IconPlus,
  IconMessageCircle,
  IconSettings,
  IconCircleCheck,
  IconCircleDashed,
  IconX,
  IconLoader2,
  IconRocket,
  IconArrowRight,
  IconSearch,
} from '@tabler/icons-react'
import { ChatWithAgentButton } from './agents/[id]/ChatWithAgentButton'
import { RelativeTime } from './components/RelativeTime'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarGroup,
  AvatarGroupCount,
} from '@/components/ui/avatar'
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

const FleetDashboard = dynamic(
  () => import('./fleet/FleetDashboard').then((module) => module.FleetDashboard),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-24">
        <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
)

// ---------------------------------------------------------------------------
// Empty State — 0 agents
// ---------------------------------------------------------------------------

function EmptyState() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const createAgent = trpc.org.createAgent.useMutation()
  const startOrResume = trpc.sessions.startOrResume.useMutation()

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
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02]">
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
            className="h-10 border-white/10 bg-white/5 text-sm placeholder:text-white/30"
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
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
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
// HomeSearch — cmdk-powered search bar + command palette
// ---------------------------------------------------------------------------

function HomeSearch({ agents, sessions }: { agents: FleetAgent[]; sessions: SessionItem[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const startOrResume = trpc.sessions.startOrResume.useMutation()

  // Register ⌘K / Ctrl+K keyboard shortcut
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
    <>
      {/* Fake search input — opens the command dialog */}
      <button
        onClick={() => setOpen(true)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:border-white/20 hover:bg-white/[0.05]"
      >
        <IconSearch className="h-4 w-4 shrink-0 text-white/30" />
        <span className="flex-1 text-sm text-white/30">Search sessions or start a new one...</span>
        <kbd className="hidden rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[0.6rem] font-medium text-white/30 sm:inline-block">
          ⌘K
        </kbd>
      </button>

      {/* Command palette dialog */}
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

            {/* Start New group */}
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
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded border border-white/10 bg-gradient-to-br from-white/10 to-white/5">
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
                        <span className="text-[0.4rem] font-semibold text-white/60">
                          {initials}
                        </span>
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
    </>
  )
}

// ---------------------------------------------------------------------------
// Getting Started Checklist
// ---------------------------------------------------------------------------

function GettingStartedChecklist({ onDismiss }: { onDismiss: () => void }) {
  const { data } = trpc.commandCenter.getOnboardingStatus.useQuery()

  if (!data) return null

  const items = [
    {
      label: 'Connect a channel',
      done: data.hasPluginInstances,
      href: '/plugins',
    },
    {
      label: 'Add skills to your agents',
      done: data.hasSkillAssignments,
      href: '/skills',
    },
    {
      label: 'Set cost limits',
      done: data.hasCostLimits,
      href: '/costs',
    },
  ]

  const allDone = items.every((item) => item.done)
  if (allDone) return null

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Getting Started</CardTitle>
          <button
            onClick={onDismiss}
            className="cursor-pointer rounded-md p-1 text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {items.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition hover:bg-white/[0.03]"
            >
              {item.done ? (
                <IconCircleCheck className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <IconCircleDashed className="h-4 w-4 shrink-0 text-white/30" />
              )}
              <span className={item.done ? 'text-muted-foreground line-through' : ''}>
                {item.label}
              </span>
              {!item.done && (
                <IconArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
              )}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

function AgentCard({ agent }: { agent: FleetAgent }) {
  const config = parseAgentIdentityConfig(agent.config)
  const initials = agent.name
    .split(/[-_\s]/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <Link
        href={`/agents/${agent.agentId}`}
        className="flex min-w-0 flex-1 items-center gap-3 hover:text-primary"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-white/10 to-white/5">
          {config.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.avatarUrl} alt={agent.name} className="h-full w-full object-cover" />
          ) : config.emoji ? (
            <span className="text-lg leading-none">{config.emoji}</span>
          ) : (
            <span className="text-[0.6rem] font-semibold text-white/60">{initials}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{agent.name}</p>
          <div className="mt-0.5 flex items-center gap-2 text-[0.65rem] text-muted-foreground">
            <span>@{agent.handle}</span>
            <span className="text-white/10">|</span>
            <span>{agent.runCount} runs</span>
            {agent.lastActiveAt && (
              <>
                <span className="text-white/10">|</span>
                <RelativeTime timestamp={agent.lastActiveAt} prefix="Active" />
              </>
            )}
          </div>
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-1.5">
        <ChatWithAgentButton agentId={agent.agentId} agentName={agent.name} variant="icon" />
        <Link
          href={`/agents/${agent.agentId}`}
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/50 transition hover:border-white/20 hover:bg-white/10 hover:text-white/70"
          title="Configure"
        >
          <IconSettings className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recent Sessions List
// ---------------------------------------------------------------------------

function RecentSessionsList({ sessions }: { sessions: SessionItem[] }) {
  if (sessions.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        No sessions yet — start one from the search bar above.
      </p>
    )
  }

  return (
    <div className="space-y-0.5">
      {sessions.map((session) => (
        <Link
          key={session.sessionKey}
          href={`/sessions/${encodeURIComponent(session.sessionKey)}`}
          className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-3 py-2.5 transition hover:bg-white/[0.05]"
        >
          <AvatarGroup>
            {session.participants.slice(0, 3).map((p) => (
              <Avatar key={p.id} size="sm">
                {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt={p.name} /> : null}
                <AvatarFallback>{p.emoji || p.name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
            ))}
            {session.participants.length > 3 && (
              <AvatarGroupCount>+{session.participants.length - 3}</AvatarGroupCount>
            )}
          </AvatarGroup>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{session.displayTitle}</p>
          </div>
          <RelativeTime
            timestamp={session.lastMessageAt}
            className="shrink-0 text-[0.6rem] text-muted-foreground"
          />
        </Link>
      ))}
      <Link
        href="/sessions"
        className="mt-2 block text-center text-xs text-muted-foreground transition hover:text-foreground"
      >
        View all sessions &rarr;
      </Link>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Getting Started State — 1-3 agents
// ---------------------------------------------------------------------------

function GettingStartedState({
  agents,
  sessions,
}: {
  agents: FleetAgent[]
  sessions: SessionItem[]
}) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('nitejar-getting-started-dismissed') === '1'
  })

  function handleDismiss() {
    localStorage.setItem('nitejar-getting-started-dismissed', '1')
    setDismissed(true)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Home</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your agents and recent activity.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/agents/new"
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:border-white/20 hover:bg-white/10"
          >
            <IconPlus className="h-3.5 w-3.5" />
            New Agent
          </Link>
        </div>
      </div>

      {/* Search bar */}
      <HomeSearch agents={agents} sessions={sessions} />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Left column */}
        <div className="space-y-6">
          {/* Agent cards */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Your Agents
            </h3>
            <div className="space-y-1.5">
              {agents.map((agent) => (
                <AgentCard key={agent.agentId} agent={agent} />
              ))}
            </div>
          </div>

          {/* Recent sessions */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recent
            </h3>
            <RecentSessionsList sessions={sessions} />
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {!dismissed && <GettingStartedChecklist onDismiss={handleDismiss} />}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Active Fleet State — 4+ agents
// ---------------------------------------------------------------------------

function ActiveFleetState({ sessions }: { sessions: SessionItem[] }) {
  return (
    <div>
      <FleetDashboard recentSessions={sessions} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// AdminHome — adaptive wrapper
// ---------------------------------------------------------------------------

export function AdminHome() {
  const fleetQuery = trpc.commandCenter.getFleetStatus.useQuery({ period: '7d' })
  const sessionsQuery = trpc.sessions.list.useQuery({ limit: 5 })

  if (fleetQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const fleet = fleetQuery.data
  if (!fleet) return null

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

  // State 2: Getting Started (1-3 agents)
  if (totalAgents <= 3) {
    return <GettingStartedState agents={fleet.roster} sessions={sessions} />
  }

  // State 3: Active Fleet
  return <ActiveFleetState sessions={sessions} />
}
