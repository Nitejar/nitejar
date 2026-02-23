'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  IconSearch,
  IconPlus,
  IconChevronRight,
  IconUsers,
  IconRobot,
  IconX,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { CreateTeamForm } from './CreateTeamForm'

type TeamMember = {
  id: string
  name: string
  avatarUrl: string | null
  role: string
}
type TeamAgent = {
  id: string
  name: string
  title: string | null
  emoji: string | null
  avatarUrl: string | null
}
type Team = {
  id: string
  name: string
  description: string | null
  members: TeamMember[]
  agents: TeamAgent[]
}
type Member = {
  id: string
  name: string
  email: string
  avatar_url: string | null
}
type Agent = {
  id: string
  name: string
  title: string | null
  emoji: string | null
  avatarUrl: string | null
}

function Avatar({
  name,
  avatarUrl,
  emoji,
  size = 'sm',
}: {
  name: string
  avatarUrl?: string | null
  emoji?: string | null
  size?: 'sm' | 'md'
}) {
  const initials = name
    .split(/[-_\s]/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const sizeClasses = size === 'sm' ? 'h-7 w-7 text-[0.6rem]' : 'h-9 w-9 text-xs'

  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-white/10 to-white/5',
        sizeClasses
      )}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
      ) : emoji ? (
        <span className="leading-none">{emoji}</span>
      ) : (
        <span className="font-semibold text-white/60">{initials}</span>
      )}
    </div>
  )
}

function AvatarStack({
  items,
  max = 4,
}: {
  items: Array<{ name: string; avatarUrl?: string | null; emoji?: string | null }>
  max?: number
}) {
  const displayed = items.slice(0, max)
  const remaining = items.length - max

  if (items.length === 0) {
    return <span className="text-[0.65rem] text-white/30">None</span>
  }

  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {displayed.map((item, i) => (
          <div key={i} className="relative" style={{ zIndex: max - i }}>
            <Avatar name={item.name} avatarUrl={item.avatarUrl} emoji={item.emoji} />
          </div>
        ))}
      </div>
      {remaining > 0 && <span className="ml-2 text-[0.65rem] text-white/40">+{remaining}</span>}
    </div>
  )
}

function TeamRow({
  team,
  members,
  agents,
  isExpanded,
  onToggle,
}: {
  team: Team
  members: Member[]
  agents: Agent[]
  isExpanded: boolean
  onToggle: () => void
}) {
  const utils = trpc.useUtils()

  const addMember = trpc.org.addTeamMember.useMutation({
    onSuccess: () => void utils.org.listTeams.invalidate(),
  })
  const removeMember = trpc.org.removeTeamMember.useMutation({
    onSuccess: () => void utils.org.listTeams.invalidate(),
  })
  const addAgent = trpc.org.assignAgentToTeam.useMutation({
    onSuccess: () => void utils.org.listTeams.invalidate(),
  })
  const removeAgent = trpc.org.removeAgentFromTeam.useMutation({
    onSuccess: () => void utils.org.listTeams.invalidate(),
  })

  const teamMemberIds = useMemo(() => new Set(team.members.map((m) => m.id)), [team.members])
  const teamAgentIds = useMemo(() => new Set(team.agents.map((a) => a.id)), [team.agents])

  const availableMembers = useMemo(
    () => members.filter((m) => !teamMemberIds.has(m.id)),
    [members, teamMemberIds]
  )
  const availableAgents = useMemo(
    () => agents.filter((a) => !teamAgentIds.has(a.id)),
    [agents, teamAgentIds]
  )

  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        onClick={onToggle}
        className="group flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded transition-transform',
            isExpanded && 'rotate-90'
          )}
        >
          <IconChevronRight className="h-4 w-4 text-white/30 group-hover:text-white/50" />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white/90 group-hover:text-white">
              {team.name}
            </p>
            <p className="truncate text-xs text-white/40">{team.description || 'No description'}</p>
          </div>

          <div className="hidden w-32 shrink-0 items-center gap-2 sm:flex">
            <IconUsers className="h-3.5 w-3.5 text-white/30" />
            <AvatarStack
              items={team.members.map((m) => ({
                name: m.name,
                avatarUrl: m.avatarUrl,
              }))}
            />
          </div>
          <div className="hidden w-32 shrink-0 items-center gap-2 sm:flex">
            <IconRobot className="h-3.5 w-3.5 text-white/30" />
            <AvatarStack
              items={team.agents.map((a) => ({
                name: a.name,
                avatarUrl: a.avatarUrl,
                emoji: a.emoji,
              }))}
            />
          </div>

          <div className="w-28 shrink-0 text-right text-[0.65rem] text-white/30">
            <span className="tabular-nums">{team.members.length}</span> members
            <span className="mx-0.5">·</span>
            <span className="tabular-nums">{team.agents.length}</span> agents
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-white/5 bg-white/[0.01] px-4 py-4">
          <div className="ml-9 grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-white/40">
                  Team Members
                </h4>
                <span className="text-[0.6rem] tabular-nums text-white/30">
                  {team.members.length} assigned
                </span>
              </div>

              <div className="space-y-1.5">
                {team.members.map((member) => (
                  <div
                    key={member.id}
                    className="group/item flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar name={member.name} avatarUrl={member.avatarUrl} />
                      <div>
                        <p className="text-xs font-medium text-white/80">{member.name}</p>
                        <p className="text-[0.6rem] text-white/40">{member.role}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeMember.mutate({ teamId: team.id, userId: member.id })}
                      className="rounded p-1 text-white/20 opacity-0 transition hover:bg-white/10 hover:text-white/60 group-hover/item:opacity-100"
                    >
                      <IconX className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {team.members.length === 0 && (
                  <p className="py-2 text-center text-[0.65rem] text-white/30">
                    No members assigned
                  </p>
                )}
              </div>

              {availableMembers.length > 0 && (
                <div className="space-y-1.5 border-t border-white/5 pt-3">
                  <p className="text-[0.6rem] text-white/30">Add member:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableMembers.slice(0, 5).map((member) => (
                      <button
                        key={member.id}
                        onClick={() => addMember.mutate({ teamId: team.id, userId: member.id })}
                        disabled={addMember.isPending}
                        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[0.6rem] text-white/60 transition hover:border-primary/30 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                      >
                        <IconPlus className="h-2.5 w-2.5" />
                        {member.name}
                      </button>
                    ))}
                    {availableMembers.length > 5 && (
                      <span className="px-2 py-1 text-[0.6rem] text-white/30">
                        +{availableMembers.length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-white/40">
                  Assigned Agents
                </h4>
                <span className="text-[0.6rem] tabular-nums text-white/30">
                  {team.agents.length} assigned
                </span>
              </div>

              <div className="space-y-1.5">
                {team.agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="group/item flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                  >
                    <Link
                      href={`/agents/${agent.id}`}
                      className="flex items-center gap-3 transition-colors hover:opacity-80"
                    >
                      <Avatar name={agent.name} avatarUrl={agent.avatarUrl} emoji={agent.emoji} />
                      <div>
                        <p className="text-xs font-medium text-white/80 group-hover/item:text-primary">
                          {agent.name}
                        </p>
                        <p className="text-[0.6rem] text-white/40">{agent.title || 'No title'}</p>
                      </div>
                    </Link>
                    <button
                      onClick={() => removeAgent.mutate({ teamId: team.id, agentId: agent.id })}
                      className="rounded p-1 text-white/20 opacity-0 transition hover:bg-white/10 hover:text-white/60 group-hover/item:opacity-100"
                    >
                      <IconX className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {team.agents.length === 0 && (
                  <p className="py-2 text-center text-[0.65rem] text-white/30">
                    No agents assigned
                  </p>
                )}
              </div>

              {availableAgents.length > 0 && (
                <div className="space-y-1.5 border-t border-white/5 pt-3">
                  <p className="text-[0.6rem] text-white/30">Add agent:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {availableAgents.slice(0, 5).map((agent) => (
                      <button
                        key={agent.id}
                        onClick={() => addAgent.mutate({ teamId: team.id, agentId: agent.id })}
                        disabled={addAgent.isPending}
                        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[0.6rem] text-white/60 transition hover:border-primary/30 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                      >
                        {agent.emoji && <span>{agent.emoji}</span>}
                        <IconPlus className="h-2.5 w-2.5" />
                        {agent.name}
                      </button>
                    ))}
                    {availableAgents.length > 5 && (
                      <span className="px-2 py-1 text-[0.6rem] text-white/30">
                        +{availableAgents.length - 5} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function TeamsSection() {
  const [search, setSearch] = useState('')
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const { data: teamsData, isLoading } = trpc.org.listTeams.useQuery()
  const { data: membersData } = trpc.org.listMembers.useQuery()
  const { data: agentsData } = trpc.org.listAgents.useQuery()

  const teams = useMemo(() => (teamsData ?? []) as Team[], [teamsData])
  const members = useMemo(() => (membersData ?? []) as Member[], [membersData])
  const agents = useMemo(() => (agentsData ?? []) as Agent[], [agentsData])

  const filteredTeams = useMemo(() => {
    if (!search) return teams
    const searchLower = search.toLowerCase()
    return teams.filter(
      (team) =>
        team.name.toLowerCase().includes(searchLower) ||
        team.description?.toLowerCase().includes(searchLower)
    )
  }, [teams, search])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] py-12">
        <p className="text-sm text-white/40">Loading teams...</p>
      </div>
    )
  }

  if (teams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-8 py-16">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
          <IconUsers className="h-8 w-8 text-white/30" />
        </div>
        <h3 className="text-lg font-semibold text-white/90">No teams yet</h3>
        <p className="mt-1 max-w-sm text-center text-sm text-white/50">
          Create teams to organize your agents and humans. Assign approval policies and escalation
          paths.
        </p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger
            render={
              <button className="mt-6 inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/15 px-4 py-2.5 text-sm font-medium text-primary transition hover:border-primary/60 hover:bg-primary/25" />
            }
          >
            <IconPlus className="h-4 w-4" />
            Create Team
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Team</DialogTitle>
              <DialogDescription>
                Teams define who can approve agent work and own escalation lanes.
              </DialogDescription>
            </DialogHeader>
            <CreateTeamForm onSuccess={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-md flex-1">
          <IconSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <Input
            placeholder="Search teams..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 border-white/10 bg-white/5 pl-9 text-sm placeholder:text-white/30 focus-visible:border-white/20 focus-visible:ring-white/10"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[0.65rem] text-white/30">
            <span className="tabular-nums">{teams.length} teams</span>
            <span>·</span>
            <span className="tabular-nums">
              {teams.reduce((sum, t) => sum + t.members.length, 0)} members
            </span>
            <span>·</span>
            <span className="tabular-nums">
              {teams.reduce((sum, t) => sum + t.agents.length, 0)} agents
            </span>
          </div>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger render={<Button size="sm" variant="outline" />}>
              Create Team
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create Team</DialogTitle>
                <DialogDescription>
                  Teams define who can approve agent work and own escalation lanes.
                </DialogDescription>
              </DialogHeader>
              <CreateTeamForm onSuccess={() => setCreateOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
        <div className="flex items-center gap-4 border-b border-white/10 bg-white/[0.02] px-4 py-2">
          <div className="w-5 shrink-0" />
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <span className="min-w-0 flex-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white/40">
              Team
            </span>
            <span className="hidden w-32 shrink-0 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white/40 sm:flex">
              Members
            </span>
            <span className="hidden w-32 shrink-0 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white/40 sm:flex">
              Agents
            </span>
            <span className="w-28 shrink-0 text-right text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white/40">
              Summary
            </span>
          </div>
        </div>

        {filteredTeams.map((team) => (
          <TeamRow
            key={team.id}
            team={team}
            members={members}
            agents={agents}
            isExpanded={expandedTeam === team.id}
            onToggle={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)}
          />
        ))}

        {filteredTeams.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-white/40">No teams match your search</p>
            <button
              onClick={() => setSearch('')}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Clear search
            </button>
          </div>
        )}
      </div>

      <p className="text-center text-[0.6rem] text-white/20">
        Click a team to expand and manage members and agents
      </p>
    </div>
  )
}
