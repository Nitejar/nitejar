'use client'

import { useState } from 'react'
import { IconAdjustments } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

interface CapabilitiesSectionProps {
  agentId: string
}

export function CapabilitiesSection({ agentId }: CapabilitiesSectionProps) {
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const utils = trpc.useUtils()

  const sandboxesQuery = trpc.sandboxes.list.useQuery({ agentId })

  const setPolicy = trpc.sandboxes.setEphemeralCreationPolicy.useMutation({
    onSuccess: async () => {
      await utils.sandboxes.list.invalidate({ agentId })
      setMessage({ type: 'success', text: 'Ephemeral creation policy updated.' })
    },
    onError: (error) => setMessage({ type: 'error', text: error.message }),
  })

  const setRoutinePolicy = trpc.sandboxes.setRoutineManagementPolicy.useMutation({
    onSuccess: async () => {
      await utils.sandboxes.list.invalidate({ agentId })
      setMessage({ type: 'success', text: 'Routine management policy updated.' })
    },
    onError: (error) => setMessage({ type: 'error', text: error.message }),
  })

  const allowEphemeralCreation = sandboxesQuery.data?.allowEphemeralSandboxCreation ?? false
  const allowRoutineManagement = sandboxesQuery.data?.allowRoutineManagement ?? false

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <IconAdjustments className="h-4 w-4 text-muted-foreground" />
          Capabilities
        </CardTitle>
        <CardDescription className="text-xs">
          Control which tools this agent can use.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
          <div>
            <p className="text-sm font-medium text-foreground">
              Allow ephemeral workspace creation
            </p>
            <p className="text-[0.7rem] text-muted-foreground">
              Controls whether the agent can create temporary workspaces for task execution.
            </p>
          </div>
          <Switch
            checked={allowEphemeralCreation}
            onCheckedChange={(enabled) => setPolicy.mutate({ agentId, enabled })}
            disabled={setPolicy.isPending || sandboxesQuery.isLoading}
          />
        </label>

        <label className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
          <div>
            <p className="text-sm font-medium text-foreground">Allow routine management</p>
            <p className="text-[0.7rem] text-muted-foreground">
              Controls whether the agent can create, update, pause, and delete routines.
            </p>
          </div>
          <Switch
            checked={allowRoutineManagement}
            onCheckedChange={(enabled) => setRoutinePolicy.mutate({ agentId, enabled })}
            disabled={setRoutinePolicy.isPending || sandboxesQuery.isLoading}
          />
        </label>

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
