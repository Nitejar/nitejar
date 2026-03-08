'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { IconArrowRight, IconHierarchy, IconPlus } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'

const GOAL_STATUSES = ['draft', 'active', 'at_risk', 'blocked', 'done', 'archived'] as const
type GoalStatus = (typeof GOAL_STATUSES)[number]

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'blocked' || status === 'at_risk') return 'destructive'
  if (status === 'done') return 'secondary'
  if (status === 'active') return 'default'
  return 'outline'
}

function parseGoalStatus(value: string): GoalStatus {
  return GOAL_STATUSES.find((status) => status === value) ?? 'active'
}

export function GoalDetailClient({ goalId }: { goalId: string }) {
  const utils = trpc.useUtils()
  const [updateBody, setUpdateBody] = useState('')
  const [newTicketTitle, setNewTicketTitle] = useState('')
  const [status, setStatus] = useState<GoalStatus>('active')
  const [heartbeatAgentId, setHeartbeatAgentId] = useState('')
  const [heartbeatCronExpr, setHeartbeatCronExpr] = useState('0 9 * * 1-5')
  const [heartbeatTimezone, setHeartbeatTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  )

  const goalQuery = trpc.work.getGoal.useQuery({ goalId })
  const agentsQuery = trpc.org.listAgents.useQuery()
  const heartbeatQuery = trpc.work.getHeartbeatConfig.useQuery({
    targetKind: 'goal',
    targetId: goalId,
  })
  const postUpdateMutation = trpc.work.postWorkUpdate.useMutation({
    onSuccess: async () => {
      setUpdateBody('')
      await utils.work.getGoal.invalidate({ goalId })
      await utils.work.getDashboard.invalidate()
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
  })
  const createTicketMutation = trpc.work.createTicket.useMutation({
    onSuccess: async () => {
      setNewTicketTitle('')
      await Promise.all([
        utils.work.getGoal.invalidate({ goalId }),
        utils.work.getDashboard.invalidate(),
      ])
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
  })

  const goal = goalQuery.data
  const heartbeatConfig = heartbeatQuery.data

  useEffect(() => {
    if (goal) {
      setStatus(parseGoalStatus(goal.status))
    }
  }, [goal])

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
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="py-10 text-sm text-muted-foreground">Loading goal…</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-semibold">{goal.title}</h3>
                <Badge variant={statusBadgeVariant(goal.status)}>{goal.status}</Badge>
              </div>
              <p className="max-w-3xl text-sm text-muted-foreground">{goal.outcome}</p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>Owner: {goal.owner ? goal.owner.label : 'No owner'}</span>
                <span>
                  Updated <RelativeTime timestamp={goal.updatedAt} />
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <NativeSelect
                value={status}
                onChange={(event) => setStatus(parseGoalStatus(event.target.value))}
                className="w-full min-w-[180px]"
              >
                {GOAL_STATUSES.map((goalStatus) => (
                  <NativeSelectOption key={goalStatus} value={goalStatus}>
                    {goalStatus}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                variant="outline"
                onClick={() => updateGoalMutation.mutate({ goalId, patch: { status } })}
                disabled={updateGoalMutation.isPending || status === goal.status}
              >
                Update Status
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 md:grid-cols-3">
          <div className="bg-white/[0.03] p-4">
            <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
              Tickets
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{goal.tickets.length}</p>
          </div>
          <div className="bg-white/[0.03] p-4">
            <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
              Receipt Cost
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              ${goal.rollup.totalCostUsd.toFixed(2)}
            </p>
          </div>
          <div className="bg-white/[0.03] p-4">
            <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
              Work Items
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{goal.rollup.totalWorkItems}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Tickets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {goal.tickets.length > 0 ? (
                goal.tickets.map((ticket) => (
                  <Link
                    key={ticket.id}
                    href={`/work/tickets/${ticket.id}`}
                    className="block rounded-lg border border-white/10 bg-white/[0.02] p-3 transition hover:border-white/20 hover:bg-white/[0.04]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">{ticket.title}</p>
                          <Badge variant={statusBadgeVariant(ticket.status)}>{ticket.status}</Badge>
                        </div>
                        {ticket.body ? (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {ticket.body}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <p>${ticket.receiptSummary?.totalCostUsd.toFixed(2) ?? '0.00'}</p>
                        <p>{ticket.receiptSummary?.workItems.length ?? 0} receipts</p>
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No tickets linked to this goal yet.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Updates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {goal.updates.length > 0 ? (
                goal.updates.map((update) => (
                  <div
                    key={update.id}
                    className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant="outline">{update.kind}</Badge>
                      <span className="text-xs text-muted-foreground">
                        <RelativeTime timestamp={update.created_at} />
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{update.body}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No updates recorded yet.</p>
              )}
            </CardContent>
          </Card>

          {goal.childGoals.length > 0 ? (
            <Card className="border-white/10 bg-white/[0.02]">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <IconHierarchy className="h-4 w-4" />
                  Child Goals
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {goal.childGoals.map((child) => (
                  <Link
                    key={child.id}
                    href={`/work/goals/${child.id}`}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 transition hover:bg-white/5"
                  >
                    <span className="truncate text-sm">{child.title}</span>
                    <IconArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Heartbeat</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {heartbeatConfig ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm text-muted-foreground">
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
                <p className="text-sm text-muted-foreground">
                  No heartbeat routine yet. Configure one to keep this goal reviewed on a schedule.
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
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <IconPlus className="h-4 w-4" />
                Add Ticket
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={newTicketTitle}
                onChange={(event) => setNewTicketTitle(event.target.value)}
                placeholder="Define the next chunk of work"
              />
              <Button
                className="w-full"
                onClick={() =>
                  createTicketMutation.mutate({
                    goalId,
                    title: newTicketTitle,
                    status: 'ready',
                  })
                }
                disabled={!newTicketTitle.trim() || createTicketMutation.isPending}
              >
                Create Ticket
              </Button>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Post Update</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={updateBody}
                onChange={(event) => setUpdateBody(event.target.value)}
                placeholder="Leave a note, status update, or checkpoint."
                rows={5}
              />
              <Button
                className="w-full"
                onClick={() => postUpdateMutation.mutate({ goalId, body: updateBody })}
                disabled={!updateBody.trim() || postUpdateMutation.isPending}
              >
                Post Update
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
