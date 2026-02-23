'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { IconPlus } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@/components/ui/avatar'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'

type SessionParticipant = {
  id: string
  handle: string
  name: string
  title: string | null
  emoji: string | null
  avatarUrl: string | null
}

function AgentAvatar({
  participant,
  size = 'sm',
}: {
  participant: SessionParticipant
  size?: 'sm' | 'default'
}) {
  const fallback = participant.emoji || participant.name.slice(0, 1).toUpperCase()
  return (
    <Avatar size={size}>
      {participant.avatarUrl ? (
        <AvatarImage src={participant.avatarUrl} alt={participant.name} />
      ) : null}
      <AvatarFallback>{fallback}</AvatarFallback>
    </Avatar>
  )
}

export function SessionsListClient() {
  const utils = trpc.useUtils()
  const sessionsQuery = trpc.sessions.list.useQuery({ limit: 50 })
  const agentsQuery = trpc.sessions.listAgents.useQuery()

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [primaryAgentId, setPrimaryAgentId] = useState('')

  const createSession = trpc.sessions.create.useMutation({
    onSuccess: async () => {
      await utils.sessions.list.invalidate()
    },
  })

  const availableAgents = agentsQuery.data ?? []

  const canCreate = primaryAgentId.length > 0 && !createSession.isPending

  const sortedSessions = useMemo(() => sessionsQuery.data?.items ?? [], [sessionsQuery.data?.items])

  const handleCreate = async () => {
    if (!primaryAgentId) return
    const created = await createSession.mutateAsync({
      title: title.trim() || null,
      primaryAgentId,
    })
    setOpen(false)
    setTitle('')
    setPrimaryAgentId('')
    window.location.href = `/sessions/${encodeURIComponent(created.sessionKey)}`
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button variant="secondary">
                <IconPlus className="mr-2 h-4 w-4" />
                New Session
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start Session</DialogTitle>
              <DialogDescription>
                Pick a primary agent. You can add more participants later from the session view.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Title (optional)</p>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Untitled conversation"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Primary agent</p>
                <NativeSelect
                  value={primaryAgentId}
                  onChange={(event) => setPrimaryAgentId(event.target.value)}
                  className="w-full"
                >
                  <NativeSelectOption value="">Select an agent…</NativeSelectOption>
                  {availableAgents.map((agent) => (
                    <NativeSelectOption key={agent.id} value={agent.id}>
                      {agent.name} (@{agent.handle})
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreate()} disabled={!canCreate}>
                {createSession.isPending ? 'Starting…' : 'Start Session'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {sessionsQuery.isLoading ? (
        <Card className="border-dashed border-border/60 bg-card/60">
          <CardHeader>
            <CardTitle>Loading sessions…</CardTitle>
          </CardHeader>
        </Card>
      ) : sortedSessions.length === 0 ? (
        <Card className="border-dashed border-border/60 bg-card/60">
          <CardHeader>
            <CardTitle>No sessions yet</CardTitle>
            <CardDescription>Start a session to begin chatting with an agent.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sortedSessions.map((session) => (
            <Link
              key={session.sessionKey}
              href={`/sessions/${encodeURIComponent(session.sessionKey)}`}
            >
              <Card className="h-full border-border/60 bg-card/70 transition hover:border-primary/50 hover:bg-card">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <AvatarGroup>
                      {session.participants.slice(0, 3).map((participant) => (
                        <AgentAvatar
                          key={`${session.sessionKey}:${participant.id}`}
                          participant={participant}
                        />
                      ))}
                      {session.participants.length > 3 ? (
                        <AvatarGroupCount>+{session.participants.length - 3}</AvatarGroupCount>
                      ) : null}
                    </AvatarGroup>
                    <RelativeTime
                      timestamp={session.lastMessageAt ?? session.lastActivityAt}
                      className="text-[0.7rem] text-muted-foreground"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="line-clamp-1 text-sm font-medium text-foreground">
                      {session.displayTitle}
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{session.preview}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
