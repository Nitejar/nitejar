'use client'

import { useState } from 'react'
import { IconShieldBolt } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

interface FleetAccessSectionProps {
  agentId: string
}

export function FleetAccessSection({ agentId }: FleetAccessSectionProps) {
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const utils = trpc.useUtils()

  const sandboxesQuery = trpc.sandboxes.list.useQuery({ agentId })

  const setDangerouslyUnrestrictedPolicy =
    trpc.sandboxes.setDangerouslyUnrestrictedPolicy.useMutation({
      onSuccess: async () => {
        await utils.sandboxes.list.invalidate({ agentId })
        setMessage({ type: 'success', text: 'Fleet access updated.' })
      },
      onError: (error) => setMessage({ type: 'error', text: error.message }),
    })

  const dangerouslyUnrestricted = sandboxesQuery.data?.dangerouslyUnrestricted ?? false

  const handleToggle = (enabled: boolean) => {
    if (enabled) {
      const confirmed = window.confirm(
        'This grants the agent tools to create, modify, and delete any agent in the fleet. Are you sure?'
      )
      if (!confirmed) return
    }
    setDangerouslyUnrestrictedPolicy.mutate({ agentId, enabled })
  }

  return (
    <Card className="border-red-500/20 bg-red-500/[0.03]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <IconShieldBolt className="h-4 w-4 text-red-400" />
          Fleet Access
        </CardTitle>
        <CardDescription className="text-xs">
          Allow this agent to manage other agents in the fleet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/[0.03] px-3 py-2">
          <div>
            <p className="text-sm font-medium text-foreground">Enable fleet-wide control</p>
            <p className="text-[0.7rem] text-muted-foreground">
              Grants platform-control tools for managing agents across the fleet.
            </p>
          </div>
          <Switch
            checked={dangerouslyUnrestricted}
            onCheckedChange={handleToggle}
            disabled={setDangerouslyUnrestrictedPolicy.isPending || sandboxesQuery.isLoading}
          />
        </label>

        {dangerouslyUnrestricted && (
          <div className="rounded-md border border-red-500/15 bg-red-500/[0.03] px-3 py-2">
            <p className="mb-1.5 text-xs font-medium text-red-300">Granted tools</p>
            <ul className="space-y-0.5 text-[0.7rem] text-muted-foreground">
              <li>List all agents in the fleet</li>
              <li>Create and delete agents</li>
              <li>Update agent config and soul</li>
              <li>Set agent status (online/offline)</li>
            </ul>
          </div>
        )}

        {message ? (
          <div
            className={`rounded-md px-3 py-2 text-xs ${
              message.type === 'success'
                ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border border-destructive/30 bg-destructive/10 text-destructive'
            }`}
          >
            {message.text}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
