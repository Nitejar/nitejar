'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc'
import { InlinePicker } from '../work/shared'

export type TeamLeadActor = {
  kind: string
  ref: string
  label: string
  title?: string | null
  emoji?: string | null
  avatarUrl?: string | null
} | null

export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void
) {
  useEffect(() => {
    if (!active) return
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, active, onClose])
}

export function AgentAssignmentControl({
  teamId,
  currentAgentIds,
  onChanged,
  buttonLabel = 'Add agent',
  className,
}: {
  teamId: string
  currentAgentIds: string[]
  onChanged?: () => void | Promise<void>
  buttonLabel?: string
  className?: string
}) {
  const utils = trpc.useUtils()
  const agentsQuery = trpc.company.listAgents.useQuery()

  const handleSuccess = useCallback(async () => {
    await Promise.all([utils.company.getOverview.invalidate(), onChanged?.()])
  }, [onChanged, utils.company.getOverview])

  const addAgent = trpc.company.addAgentToTeam.useMutation({
    onSuccess: () => {
      void handleSuccess()
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to add agent to team')
    },
  })

  const transferAgent = trpc.company.transferAgentToTeam.useMutation({
    onSuccess: (result) => {
      void handleSuccess()
      toast.success(
        result.fromTeamName ? `Transferred from ${result.fromTeamName}` : 'Agent transferred'
      )
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to transfer agent')
    },
  })

  const items = useMemo(() => {
    const all = agentsQuery.data ?? []
    const currentSet = new Set(currentAgentIds)
    return all
      .filter((agent) => !currentSet.has(agent.id))
      .sort((a, b) => {
        const aAssigned = a.teamId ? 1 : 0
        const bAssigned = b.teamId ? 1 : 0
        if (aAssigned !== bAssigned) return aAssigned - bAssigned
        return a.name.localeCompare(b.name)
      })
      .map((agent) => ({
        value: agent.id,
        label: agent.name,
        hint:
          agent.teamId && agent.teamId !== teamId
            ? `On ${agent.teamName ?? 'another team'}`
            : [agent.roleName, agent.handle ? `@${agent.handle}` : null, 'Unassigned']
                .filter(Boolean)
                .join(' · '),
      }))
  }, [agentsQuery.data, currentAgentIds, teamId])

  return (
    <div className={className}>
      <InlinePicker
        value={null}
        items={items}
        placeholder={buttonLabel}
        className="px-0 py-0 text-sm text-zinc-500 hover:bg-transparent hover:text-zinc-300"
        onValueChange={async (agentId) => {
          const agent = agentsQuery.data?.find((entry) => entry.id === agentId)
          if (!agent) return

          if (agent.teamId && agent.teamId !== teamId) {
            const confirmed = window.confirm(
              `Transfer ${agent.name} from ${agent.teamName ?? 'their current team'} to this team?`
            )
            if (!confirmed) return
            await transferAgent.mutateAsync({ agentId: agent.id, teamId })
            return
          }

          await addAgent.mutateAsync({ agentId: agent.id, teamId })
        }}
      />
    </div>
  )
}

export function LeadPicker({
  teamId,
  currentLead,
  onChanged,
  className,
  label = 'Lead',
}: {
  teamId: string
  currentLead: TeamLeadActor
  onChanged?: () => void | Promise<void>
  className?: string
  label?: string
}) {
  const utils = trpc.useUtils()
  const agentsQuery = trpc.company.listAgents.useQuery()
  const usersQuery = trpc.company.listUsers.useQuery()

  const setLead = trpc.company.setTeamLead.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.company.getOverview.invalidate(), onChanged?.()])
    },
    onError: () => {
      toast.error('Failed to set team lead')
    },
  })

  const tabs = useMemo(() => {
    const people = (usersQuery.data ?? []).map((user) => ({
      value: `user:${user.id}`,
      label: user.name,
      hint: user.email ?? undefined,
    }))
    const agents = (agentsQuery.data ?? []).map((agent) => ({
      value: `agent:${agent.id}`,
      label: agent.name,
      hint:
        [agent.roleName, agent.handle ? `@${agent.handle}` : null].filter(Boolean).join(' · ') ||
        undefined,
    }))
    return [
      { key: 'user', label: 'People', items: people },
      { key: 'agent', label: 'Agents', items: agents },
    ]
  }, [agentsQuery.data, usersQuery.data])

  return (
    <div className={className}>
      <div className="space-y-1">
        <div className="text-[0.6rem] uppercase tracking-[0.15em] text-white/35">{label}</div>
        <InlinePicker
          value={currentLead ? `${currentLead.kind}:${currentLead.ref}` : null}
          placeholder="Set lead..."
          tabs={tabs}
          className="min-w-0 h-6 px-0 py-0 text-sm text-white/70 hover:bg-transparent"
          onValueChange={(value) => {
            const [kind, ref] = value.split(':')
            if (!kind || !ref) return
            setLead.mutate({ teamId, leadKind: kind as 'user' | 'agent', leadRef: ref })
          }}
        />
      </div>
    </div>
  )
}
