'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  IconChevronDown,
  IconChevronUp,
  IconHierarchy,
  IconMessageCircle,
  IconPlus,
  IconSettings,
  IconTicket,
} from '@tabler/icons-react'
import { ChevronRight, Pencil } from 'lucide-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'
import { SkeletonGoalDetail } from '@/app/(app)/work/skeletons'
import { toast } from 'sonner'
import {
  ALL_GOAL_STATUSES,
  InlineStatusPicker,
  StatusDot,
  statusLabel,
  type GoalStatus,
} from '@/app/(app)/work/shared'

// ---------------------------------------------------------------------------
// Inline editable title (matches TeamDetailClient pattern)
// ---------------------------------------------------------------------------

function EditableGoalTitle({
  goalId,
  title,
  onSave,
}: {
  goalId: string
  title: string
  onSave: (newTitle: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing])

  useEffect(() => {
    setValue(title)
  }, [title])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== title) {
      onSave(trimmed)
    } else {
      setValue(title)
    }
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="group inline-flex items-center gap-2 text-left"
      >
        <h1 className="text-xl font-semibold tracking-tight text-white">{title}</h1>
        <Pencil className="h-3.5 w-3.5 text-white/15 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    )
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          setValue(title)
          setEditing(false)
        }
      }}
      onBlur={commit}
      className="h-8 border-0 bg-transparent p-0 text-xl font-semibold tracking-tight text-white outline-none"
    />
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GoalDetailClient({ goalId }: { goalId: string }) {
  const utils = trpc.useUtils()
  const [updateBody, setUpdateBody] = useState('')
  const [updateFormOpen, setUpdateFormOpen] = useState(false)
  const [newTicketTitle, setNewTicketTitle] = useState('')
  const [heartbeatAgentId, setHeartbeatAgentId] = useState('')
  const [heartbeatCronExpr, setHeartbeatCronExpr] = useState('0 9 * * 1-5')
  const [heartbeatTimezone, setHeartbeatTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  )
  const [settingsOpen, setSettingsOpen] = useState(false)

  const goalQuery = trpc.work.getGoal.useQuery({ goalId })
  const agentsQuery = trpc.org.listAgents.useQuery()
  const heartbeatQuery = trpc.work.getHeartbeatConfig.useQuery({
    targetKind: 'goal',
    targetId: goalId,
  })
  const postUpdateMutation = trpc.work.postWorkUpdate.useMutation({
    onSuccess: async () => {
      setUpdateBody('')
      setUpdateFormOpen(false)
      await utils.work.getGoal.invalidate({ goalId })
      await utils.work.getDashboard.invalidate()
    },
    onError: () => {
      toast.error('Failed to post update')
    },
  })
  const updateGoalMutation = trpc.work.updateGoal.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.getGoal.invalidate({ goalId }),
        utils.work.listGoals.invalidate(),
        utils.work.getDashboard.invalidate(),
      ])
    },
    onError: () => {
      toast.error('Failed to update goal')
    },
  })
  const createTicketMutation = trpc.work.createTicket.useMutation({
    onSuccess: async () => {
      setNewTicketTitle('')
      await Promise.all([
        utils.work.getGoal.invalidate({ goalId }),
        utils.work.getDashboard.invalidate(),
      ])
    },
    onError: () => {
      toast.error('Failed to create ticket')
    },
  })
  const heartbeatMutation = trpc.work.upsertHeartbeat.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.work.getGoal.invalidate({ goalId }),
        utils.work.getHeartbeatConfig.invalidate({ targetKind: 'goal', targetId: goalId }),
        utils.work.listUpdates.invalidate(),
        utils.work.getDashboard.invalidate(),
      ])
    },
    onError: () => {
      toast.error('Failed to save heartbeat')
    },
  })

  const goal = goalQuery.data
  const heartbeatConfig = heartbeatQuery.data

  useEffect(() => {
    const heartbeat = heartbeatQuery.data
    if (!heartbeat) return
    setHeartbeatAgentId(heartbeat.agentId)
    setHeartbeatCronExpr(heartbeat.cronExpr ?? '0 9 * * 1-5')
    setHeartbeatTimezone(
      heartbeat.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
    )
  }, [heartbeatQuery.data])

  if (goalQuery.isLoading || !goal) {
    return <SkeletonGoalDetail />
  }

  const ticketsByStatus = goal.tickets.reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-white/40">
        <Link href="/goals" className="hover:text-white/70 transition-colors">
          Goals
        </Link>
        {goal.parentGoal && (
          <>
            <ChevronRight className="h-3 w-3" />
            <Link
              href={`/goals/${goal.parentGoal.id}`}
              className="hover:text-white/70 transition-colors"
            >
              {goal.parentGoal.title}
            </Link>
          </>
        )}
        <ChevronRight className="h-3 w-3" />
        <span className="text-white/70">{goal.title}</span>
      </nav>

      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <EditableGoalTitle
            goalId={goalId}
            title={goal.title}
            onSave={(newTitle) => updateGoalMutation.mutate({ goalId, patch: { title: newTitle } })}
          />
          <InlineStatusPicker
            currentStatus={goal.status}
            statuses={ALL_GOAL_STATUSES}
            onStatusChange={(s) =>
              updateGoalMutation.mutate({ goalId, patch: { status: s as GoalStatus } })
            }
            showLabel
          />
        </div>
        {goal.outcome && <p className="mt-2 max-w-3xl text-sm text-white/50">{goal.outcome}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-white/35">
          <span>Owner: {goal.owner ? goal.owner.label : 'No owner'}</span>
          <span>
            Updated <RelativeTime timestamp={goal.updatedAt} />
          </span>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main content */}
        <div className="space-y-8">
          {/* Tickets */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <IconTicket className="h-4 w-4 text-white/30" />
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                Tickets
              </span>
              <span className="ml-auto text-[0.6rem] tabular-nums text-white/30">
                {goal.tickets.length}
              </span>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/50">
              {goal.tickets.length > 0 ? (
                <div className="divide-y divide-zinc-800/60">
                  {goal.tickets.map((ticket) => (
                    <Link
                      key={ticket.id}
                      href={`/tickets/${ticket.id}`}
                      className="group flex items-center gap-2.5 px-4 py-2.5 transition hover:bg-white/[0.03]"
                    >
                      <StatusDot status={ticket.status} />
                      <span className="min-w-0 flex-1 truncate text-sm text-white/85">
                        {ticket.title}
                      </span>
                      <span className="shrink-0 text-xs text-white/30 tabular-nums">
                        ${ticket.receiptSummary?.totalCostUsd.toFixed(2) ?? '0.00'}
                      </span>
                      <span className="shrink-0 text-[10px] text-white/25 tabular-nums">
                        {ticket.receiptSummary?.workItems.length ?? 0} receipts
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6 text-center text-xs text-white/25">
                  No tickets yet. Add one below.
                </div>
              )}
            </div>
            {/* Inline ticket creation */}
            <div className="mt-2 flex items-center gap-1">
              <Input
                value={newTicketTitle}
                onChange={(event) => setNewTicketTitle(event.target.value)}
                placeholder="New ticket..."
                className="h-7 w-48 text-xs"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && newTicketTitle.trim()) {
                    createTicketMutation.mutate({
                      goalId,
                      title: newTicketTitle,
                      status: 'ready',
                    })
                  }
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() =>
                  createTicketMutation.mutate({
                    goalId,
                    title: newTicketTitle,
                    status: 'ready',
                  })
                }
                disabled={!newTicketTitle.trim() || createTicketMutation.isPending}
              >
                <IconPlus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </section>

          {/* Updates timeline with inline post form */}
          <section>
            <div className="mb-3 flex items-center gap-2">
              <IconMessageCircle className="h-4 w-4 text-white/30" />
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                Updates
              </span>
              <span className="ml-auto text-[0.6rem] tabular-nums text-white/30">
                {goal.updates.length}
              </span>
            </div>

            <div className="space-y-3">
              {/* Inline update form */}
              {updateFormOpen ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 space-y-2">
                  <Textarea
                    value={updateBody}
                    onChange={(event) => setUpdateBody(event.target.value)}
                    placeholder="Leave a note, status update, or checkpoint."
                    rows={3}
                    autoFocus
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => postUpdateMutation.mutate({ goalId, body: updateBody })}
                      disabled={!updateBody.trim() || postUpdateMutation.isPending}
                    >
                      Post
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setUpdateFormOpen(false)
                        setUpdateBody('')
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setUpdateFormOpen(true)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 text-left text-sm text-white/35 transition hover:border-zinc-700 hover:bg-zinc-950/80"
                >
                  Write an update...
                </button>
              )}

              {goal.updates.length > 0 ? (
                goal.updates.map((update) => (
                  <div key={update.id} className="space-y-1 px-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{update.kind}</Badge>
                      <span className="text-[0.6rem] text-white/25">
                        <RelativeTime timestamp={update.created_at} />
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-white/50">{update.body}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-white/25">No updates yet. Write one to track progress.</p>
              )}
            </div>
          </section>

          {/* Child goals */}
          {goal.childGoals.length > 0 ? (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <IconHierarchy className="h-4 w-4 text-white/30" />
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                  Child Goals
                </span>
                <span className="ml-auto text-[0.6rem] tabular-nums text-white/30">
                  {goal.childGoals.length}
                </span>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 divide-y divide-zinc-800/60">
                {goal.childGoals.map((child) => (
                  <Link
                    key={child.id}
                    href={`/goals/${child.id}`}
                    className="group flex items-center gap-2.5 px-4 py-2.5 transition hover:bg-white/[0.03]"
                  >
                    <StatusDot status={child.status} />
                    <span className="min-w-0 flex-1 truncate text-sm text-white/85">
                      {child.title}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        {/* Sidebar: properties and metadata */}
        <div className="space-y-6">
          {/* Summary stats */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-4">
            <div className="space-y-0.5">
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-white/40">Cost</span>
                <span className="text-xs font-medium tabular-nums text-white/80">
                  ${goal.rollup.totalCostUsd.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-white/40">Work items</span>
                <span className="text-xs font-medium tabular-nums text-white/80">
                  {goal.rollup.totalWorkItems}
                </span>
              </div>

              {/* Ticket counts by status */}
              {Object.keys(ticketsByStatus).length > 0 ? (
                <>
                  <div className="my-2 border-t border-zinc-800" />
                  <p className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40 pb-1">
                    Tickets
                  </p>
                  {Object.entries(ticketsByStatus).map(([s, count]) => (
                    <div key={s} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-1.5">
                        <StatusDot status={s} className="h-1.5 w-1.5" />
                        <span className="text-xs text-white/40 capitalize">{statusLabel(s)}</span>
                      </div>
                      <span className="text-xs font-medium tabular-nums text-white/80">
                        {count}
                      </span>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          </div>

          {/* Heartbeat settings - collapsed by default */}
          <div>
            <button
              type="button"
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-sm text-white/40 transition hover:border-zinc-700 hover:bg-zinc-950/80"
            >
              <IconSettings className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">Settings</span>
              {settingsOpen ? (
                <IconChevronUp className="h-3.5 w-3.5" />
              ) : (
                <IconChevronDown className="h-3.5 w-3.5" />
              )}
            </button>

            {settingsOpen ? (
              <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-4 space-y-3">
                <div className="flex items-center gap-2">
                  <IconSettings className="h-4 w-4 text-white/30" />
                  <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40">
                    Heartbeat
                  </span>
                </div>

                {heartbeatConfig ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/30 p-3 text-sm text-white/50">
                    <p>
                      Runs with {heartbeatConfig.agentName ?? 'Unknown agent'} on{' '}
                      <span className="font-mono text-xs">{heartbeatConfig.cronExpr}</span> (
                      {heartbeatConfig.timezone})
                    </p>
                    <p className="mt-1">
                      {heartbeatConfig.nextRunAt ? (
                        <>
                          Next run <RelativeTime timestamp={heartbeatConfig.nextRunAt} />
                        </>
                      ) : (
                        'Heartbeat is paused.'
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-white/25">
                    Configure a heartbeat to keep this goal reviewed on a schedule.
                  </p>
                )}

                <NativeSelect
                  value={heartbeatAgentId}
                  onChange={(event) => setHeartbeatAgentId(event.target.value)}
                  className="w-full"
                >
                  <NativeSelectOption value="">Select agent</NativeSelectOption>
                  {(agentsQuery.data ?? []).map((agent) => (
                    <NativeSelectOption key={agent.id} value={agent.id}>
                      {agent.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Input
                  value={heartbeatCronExpr}
                  onChange={(event) => setHeartbeatCronExpr(event.target.value)}
                  placeholder="0 9 * * 1-5"
                />
                <Input
                  value={heartbeatTimezone}
                  onChange={(event) => setHeartbeatTimezone(event.target.value)}
                  placeholder="America/Chicago"
                />
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={() =>
                      heartbeatMutation.mutate({
                        targetKind: 'goal',
                        targetId: goalId,
                        agentId: heartbeatAgentId,
                        cronExpr: heartbeatCronExpr,
                        timezone: heartbeatTimezone,
                        enabled: true,
                      })
                    }
                    disabled={
                      !heartbeatAgentId ||
                      !heartbeatCronExpr.trim() ||
                      !heartbeatTimezone.trim() ||
                      heartbeatMutation.isPending
                    }
                  >
                    {heartbeatConfig ? 'Save Heartbeat' : 'Create Heartbeat'}
                  </Button>
                  {heartbeatConfig?.enabled ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        heartbeatMutation.mutate({
                          targetKind: 'goal',
                          targetId: goalId,
                          agentId: heartbeatAgentId || heartbeatConfig.agentId,
                          cronExpr: heartbeatCronExpr,
                          timezone: heartbeatTimezone,
                          enabled: false,
                        })
                      }
                      disabled={heartbeatMutation.isPending}
                    >
                      Pause
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
