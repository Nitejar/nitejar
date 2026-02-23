'use client'

import { useState } from 'react'
import { IconFolders, IconTrash } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface SandboxesSectionProps {
  agentId: string
}

export function SandboxesSection({ agentId }: SandboxesSectionProps) {
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const sandboxesQuery = trpc.sandboxes.list.useQuery({ agentId })

  const deleteSandbox = trpc.sandboxes.delete.useMutation({
    onSuccess: async () => {
      await sandboxesQuery.refetch()
      setMessage({ type: 'success', text: 'Workspace deleted.' })
    },
    onError: (error) => setMessage({ type: 'error', text: error.message }),
  })

  const sandboxes = sandboxesQuery.data?.sandboxes ?? []

  const onDelete = (sandboxName: string) => {
    const confirmed = window.confirm(`Delete workspace "${sandboxName}"?`)
    if (!confirmed) return
    setMessage(null)
    deleteSandbox.mutate({ agentId, sandboxName })
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <IconFolders className="h-4 w-4 text-muted-foreground" />
          Workspaces
        </CardTitle>
        <CardDescription className="text-xs">
          Home and ephemeral workspaces for this agent.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sandboxes.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">No workspaces yet.</p>
        ) : (
          <div className="rounded-md border border-white/10">
            {sandboxes.map((sandbox, idx) => (
              <div
                key={sandbox.id}
                className={`flex items-center gap-2 px-2.5 py-1.5 ${idx > 0 ? 'border-t border-white/5' : ''}`}
              >
                {sandbox.stale ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Stale" />
                ) : (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                  {sandbox.name}
                </span>
                <span className="shrink-0 text-[0.6rem] text-muted-foreground">
                  {sandbox.kind === 'home'
                    ? 'home'
                    : new Date(sandbox.last_used_at * 1000).toLocaleDateString()}
                </span>
                {sandbox.kind === 'ephemeral' ? (
                  <button
                    type="button"
                    onClick={() => onDelete(sandbox.name)}
                    disabled={deleteSandbox.isPending}
                    className="shrink-0 p-0.5 text-muted-foreground transition hover:text-destructive disabled:opacity-60"
                    title={`Delete ${sandbox.name}`}
                  >
                    <IconTrash className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            ))}
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
