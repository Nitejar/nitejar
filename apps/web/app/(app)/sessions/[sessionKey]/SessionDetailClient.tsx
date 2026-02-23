'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  IconArrowUp,
  IconLoader2,
  IconPlayerPlay,
  IconRefresh,
  IconUserPlus,
} from '@tabler/icons-react'
import { trpc, type RouterOutputs } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@/components/ui/avatar'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'

type SessionDetail = RouterOutputs['sessions']['get']
type SessionParticipant = SessionDetail['participants'][number]

type PendingTurn = {
  id: string
  createdAt: number
  message: string
  phase: 'sending' | 'thinking' | 'failed'
  workItemId: string | null
  targetParticipants: SessionParticipant[]
  error: string | null
}

function parseMentionHandles(input: string, knownHandles: string[]): string[] {
  const handleSet = new Set(knownHandles.map((handle) => handle.toLowerCase()))
  const mentionRegex = /@([a-z0-9_][a-z0-9_-]*)/gi
  const found = new Set<string>()

  let match: RegExpExecArray | null
  while ((match = mentionRegex.exec(input)) !== null) {
    const handle = match[1]!.toLowerCase()
    if (handleSet.has(handle)) {
      found.add(handle)
    }
  }

  return [...found]
}

function getMentionToken(text: string, cursorPos: number): { token: string; start: number } | null {
  const safePos = Math.max(0, Math.min(cursorPos, text.length))
  const before = text.slice(0, safePos)
  const tokenStart = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n')) + 1
  const token = before.slice(tokenStart)
  if (!token.startsWith('@')) return null
  if (token.includes('\t')) return null
  return { token, start: tokenStart }
}

function AgentAvatar({
  participant,
  size = 'sm',
}: {
  participant: SessionParticipant
  size?: 'sm' | 'default' | 'lg'
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

function TypingRow({ name }: { name: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{name}</span>
      <span className="ml-2 inline-flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
      </span>
    </div>
  )
}

export function SessionDetailClient({ sessionKey }: { sessionKey: string }) {
  const utils = trpc.useUtils()
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const [composerValue, setComposerValue] = useState('')
  const [composerCursor, setComposerCursor] = useState(0)
  const [pendingTurns, setPendingTurns] = useState<PendingTurn[]>([])
  const [agentToAdd, setAgentToAdd] = useState('')

  const sessionQuery = trpc.sessions.get.useQuery({ sessionKey })
  const agentsQuery = trpc.sessions.listAgents.useQuery()

  const timelineQuery = trpc.sessions.timeline.useInfiniteQuery(
    { sessionKey, limit: 30 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      refetchInterval: (query) => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
          return false
        }
        const pages = query.state.data?.pages ?? []
        const hasActive = pages.some(
          (page) =>
            page.hasActiveDispatch ||
            page.turns.some((turn) => turn.status === 'queued' || turn.status === 'running')
        )
        return hasActive ? 1000 : 10_000
      },
    }
  )

  const addParticipantsMutation = trpc.sessions.addParticipants.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.sessions.get.invalidate({ sessionKey }),
        utils.sessions.timeline.invalidate({ sessionKey, limit: 30 }),
      ])
      setAgentToAdd('')
    },
  })

  const sendMessageMutation = trpc.sessions.sendMessage.useMutation({
    onSuccess: async (_, variables) => {
      await utils.sessions.timeline.invalidate({ sessionKey: variables.sessionKey, limit: 30 })
    },
  })

  const retryMutation = trpc.sessions.retryMessage.useMutation({
    onSuccess: async () => {
      await utils.sessions.timeline.invalidate({ sessionKey, limit: 30 })
    },
  })

  const participants = useMemo(
    () => sessionQuery.data?.participants ?? [],
    [sessionQuery.data?.participants]
  )
  const participantByHandle = useMemo(
    () =>
      new Map(participants.map((participant) => [participant.handle.toLowerCase(), participant])),
    [participants]
  )
  const mentionContext = useMemo(() => {
    const token = getMentionToken(composerValue, composerCursor)
    if (!token) return null
    const query = token.token.slice(1).toLowerCase()
    const matches = participants.filter((participant) =>
      participant.handle.toLowerCase().startsWith(query)
    )
    if (matches.length === 0) return null
    return { ...token, query, matches }
  }, [composerCursor, composerValue, participants])

  const allTurns = useMemo(() => {
    const pages = timelineQuery.data?.pages ?? []
    return pages
      .slice()
      .reverse()
      .flatMap((page) => [...page.turns].reverse())
  }, [timelineQuery.data?.pages])

  useEffect(() => {
    if (pendingTurns.length === 0) return
    const realized = new Set(allTurns.map((turn) => turn.workItemId))
    setPendingTurns((current) =>
      current.filter((turn) => (turn.workItemId ? !realized.has(turn.workItemId) : true))
    )
  }, [allTurns, pendingTurns.length])

  const newestFailedTurnId = useMemo(() => {
    const turnsDesc = [...allTurns].reverse()
    return turnsDesc.find((turn) => turn.status === 'failed')?.workItemId ?? null
  }, [allTurns])

  const availableAgentsToAdd = useMemo(() => {
    const assigned = new Set(participants.map((participant) => participant.id))
    return (agentsQuery.data ?? []).filter((agent) => !assigned.has(agent.id))
  }, [agentsQuery.data, participants])

  const headerPrimaryAgent =
    participants.find((participant) => participant.id === sessionQuery.data?.primaryAgentId) ??
    participants[0]

  const handleInsertMention = (handle: string) => {
    const token = getMentionToken(composerValue, composerCursor)
    if (!token) return
    const after = composerValue.slice(composerCursor)
    const before = composerValue.slice(0, token.start)
    const updated = `${before}@${handle} ${after}`
    setComposerValue(updated)
    const nextCursor = before.length + handle.length + 2
    setComposerCursor(nextCursor)
    requestAnimationFrame(() => {
      composerRef.current?.focus()
      composerRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  const submitMessage = async () => {
    const trimmed = composerValue.trim()
    if (!trimmed || sendMessageMutation.isPending) return
    const userTargetsFromMentions = parseMentionHandles(
      trimmed,
      participants.map((participant) => participant.handle)
    )
    const resolvedTargets =
      userTargetsFromMentions.length > 0
        ? userTargetsFromMentions
            .map((handle) => participantByHandle.get(handle))
            .filter((participant): participant is SessionParticipant => !!participant)
        : participants
            .filter((participant) => participant.id === sessionQuery.data?.primaryAgentId)
            .slice(0, 1)

    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    setPendingTurns((current) => [
      ...current,
      {
        id: pendingId,
        createdAt: Date.now() / 1000,
        message: trimmed,
        phase: 'sending',
        workItemId: null,
        targetParticipants: resolvedTargets,
        error: null,
      },
    ])
    setComposerValue('')
    setComposerCursor(0)
    composerRef.current?.focus()

    try {
      const result = await sendMessageMutation.mutateAsync({
        sessionKey,
        message: trimmed,
        clientMessageId: pendingId,
      })
      setPendingTurns((current) =>
        current.map((turn) =>
          turn.id === pendingId
            ? {
                ...turn,
                phase: 'thinking',
                workItemId: result.workItemId,
              }
            : turn
        )
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message.'
      setPendingTurns((current) =>
        current.map((turn) =>
          turn.id === pendingId
            ? {
                ...turn,
                phase: 'failed',
                error: message,
              }
            : turn
        )
      )
    }
  }

  if (sessionQuery.isLoading) {
    return (
      <Card className="border-dashed border-border/60 bg-card/60">
        <CardContent className="py-10 text-sm text-muted-foreground">Loading session…</CardContent>
      </Card>
    )
  }

  if (!sessionQuery.data) {
    return (
      <Card className="border-dashed border-border/60 bg-card/60">
        <CardContent className="py-10 text-sm text-muted-foreground">
          Session not found.
        </CardContent>
      </Card>
    )
  }

  const isEmpty = allTurns.length === 0 && pendingTurns.length === 0

  return (
    <div className="space-y-4">
      <Card className="bg-card/70">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AvatarGroup>
                {participants.slice(0, 4).map((participant) => (
                  <AgentAvatar key={participant.id} participant={participant} />
                ))}
                {participants.length > 4 ? (
                  <AvatarGroupCount>+{participants.length - 4}</AvatarGroupCount>
                ) : null}
              </AvatarGroup>
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground">
                  {sessionQuery.data.title ?? 'Untitled session'}
                </p>
                <p>
                  Started <RelativeTime timestamp={sessionQuery.data.createdAt} />
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <NativeSelect
                value={agentToAdd}
                onChange={(event) => setAgentToAdd(event.target.value)}
                className="w-52"
              >
                <NativeSelectOption value="">Add participant…</NativeSelectOption>
                {availableAgentsToAdd.map((agent) => (
                  <NativeSelectOption key={agent.id} value={agent.id}>
                    {agent.name} (@{agent.handle})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  addParticipantsMutation.mutate({
                    sessionKey,
                    agentIds: [agentToAdd],
                  })
                }
                disabled={!agentToAdd || addParticipantsMutation.isPending}
              >
                <IconUserPlus className="mr-1 h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          </div>

          <div className="max-h-[62vh] space-y-4 overflow-y-auto rounded-md border border-border/60 bg-background/20 p-4">
            {timelineQuery.hasNextPage ? (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void timelineQuery.fetchNextPage()}
                  disabled={timelineQuery.isFetchingNextPage}
                >
                  <IconArrowUp className="mr-1 h-3.5 w-3.5" />
                  {timelineQuery.isFetchingNextPage ? 'Loading older…' : 'Load older messages'}
                </Button>
              </div>
            ) : null}

            {isEmpty ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-center">
                {headerPrimaryAgent ? (
                  <AgentAvatar participant={headerPrimaryAgent} size="lg" />
                ) : null}
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {headerPrimaryAgent?.name ?? 'Agent'}
                  </p>
                  <p className="text-xs text-muted-foreground">{headerPrimaryAgent?.title ?? ''}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Send a message below to start this conversation.
                </p>
              </div>
            ) : (
              <>
                {allTurns.map((turn) => {
                  const isRetryableFailedTurn =
                    turn.status === 'failed' &&
                    turn.workItemId === newestFailedTurnId &&
                    turn.canRetry
                  return (
                    <div key={turn.workItemId} className="space-y-2">
                      <div className="ml-auto max-w-[85%] rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
                        <p className="whitespace-pre-wrap text-sm text-foreground">
                          {turn.userMessage}
                        </p>
                      </div>
                      {turn.agentReplies.map((reply) => (
                        <div
                          key={`${turn.workItemId}:${reply.agentId}:${reply.jobId ?? 'pending'}`}
                          className="space-y-1"
                        >
                          {reply.message ? (
                            <div className="max-w-[85%] rounded-lg border border-border/60 bg-card px-3 py-2">
                              <div className="mb-1 flex items-center gap-2 text-[0.7rem] text-muted-foreground">
                                <span className="font-medium text-foreground">
                                  {reply.agentName}
                                </span>
                                <Link
                                  href={reply.runLink}
                                  className="underline-offset-2 hover:underline"
                                >
                                  View run
                                </Link>
                              </div>
                              <p className="whitespace-pre-wrap text-sm text-foreground">
                                {reply.message}
                              </p>
                            </div>
                          ) : reply.status === 'queued' || reply.status === 'running' ? (
                            <TypingRow name={reply.agentName} />
                          ) : (
                            <div className="max-w-[85%] rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                              {reply.agentName} could not respond.
                              <Link
                                href={reply.runLink}
                                className="ml-2 underline underline-offset-2"
                              >
                                View run
                              </Link>
                            </div>
                          )}
                        </div>
                      ))}

                      {isRetryableFailedTurn ? (
                        <div className="flex gap-2">
                          <Link
                            href={`/work-items/${turn.workItemId}`}
                            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                          >
                            View run
                          </Link>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => retryMutation.mutate({ sessionKey })}
                            disabled={retryMutation.isPending}
                          >
                            <IconRefresh className="mr-1 h-3.5 w-3.5" />
                            {retryMutation.isPending ? 'Retrying…' : 'Retry'}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}

                {pendingTurns.map((pending) => (
                  <div key={pending.id} className="space-y-2">
                    <div className="ml-auto max-w-[85%] rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
                      <p className="whitespace-pre-wrap text-sm text-foreground">
                        {pending.message}
                      </p>
                      <p className="mt-1 text-[0.7rem] text-muted-foreground">
                        {pending.phase === 'sending'
                          ? 'Sending…'
                          : pending.phase === 'thinking'
                            ? 'Queued'
                            : 'Failed to send'}
                      </p>
                    </div>
                    {pending.phase === 'thinking'
                      ? pending.targetParticipants.map((participant) => (
                          <TypingRow
                            key={`${pending.id}:${participant.id}`}
                            name={participant.name}
                          />
                        ))
                      : null}
                    {pending.phase === 'failed' ? (
                      <div className="max-w-[85%] rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {pending.error ?? 'Message failed to send.'}
                      </div>
                    ) : null}
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Textarea
                ref={composerRef}
                value={composerValue}
                onChange={(event) => {
                  setComposerValue(event.target.value)
                  setComposerCursor(event.target.selectionStart ?? event.target.value.length)
                }}
                onClick={(event) =>
                  setComposerCursor((event.target as HTMLTextAreaElement).selectionStart ?? 0)
                }
                onKeyUp={(event) =>
                  setComposerCursor((event.target as HTMLTextAreaElement).selectionStart ?? 0)
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void submitMessage()
                  }
                }}
                placeholder="Message the agent… (use @handle to target participants)"
                className="min-h-[84px] pr-12"
              />

              {mentionContext ? (
                <div className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-md border border-border bg-popover p-1 shadow-lg">
                  {mentionContext.matches.slice(0, 6).map((participant) => (
                    <button
                      key={participant.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
                      onClick={() => handleInsertMention(participant.handle)}
                    >
                      <AgentAvatar participant={participant} size="sm" />
                      <span className="font-medium">{participant.name}</span>
                      <span className="text-muted-foreground">@{participant.handle}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <Button
                size="icon-sm"
                className="absolute bottom-2 right-2"
                onClick={() => void submitMessage()}
                disabled={sendMessageMutation.isPending || !composerValue.trim()}
              >
                {sendMessageMutation.isPending ? (
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <IconPlayerPlay className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 text-[0.7rem]">
              <Badge variant="outline" className={cn('border-border/60 text-muted-foreground')}>
                Enter to send
              </Badge>
              <Badge variant="outline" className={cn('border-border/60 text-muted-foreground')}>
                Shift+Enter for newline
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
