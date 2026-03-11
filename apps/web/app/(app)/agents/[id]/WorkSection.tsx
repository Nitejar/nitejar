import Link from 'next/link'
import { getDb, listGoals, listLinkedWorkItemsForTicket, listTickets } from '@nitejar/database'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export async function WorkSection({ agentId }: { agentId: string }) {
  const db = getDb()
  const [activeTickets, recentCompleted, ownedGoals] = await Promise.all([
    listTickets({
      assigneeKind: 'agent',
      assigneeRef: agentId,
      statuses: ['ready', 'in_progress', 'blocked'],
      limit: 20,
    }),
    listTickets({
      assigneeKind: 'agent',
      assigneeRef: agentId,
      statuses: ['done'],
      limit: 10,
    }),
    listGoals({
      ownerKind: 'agent',
      ownerRef: agentId,
      includeArchived: false,
      limit: 10,
    }),
  ])

  const linkedGoalIds = [
    ...new Set(
      activeTickets
        .concat(recentCompleted)
        .map((ticket) => ticket.goal_id)
        .filter(Boolean)
    ),
  ] as string[]
  const contributedGoals =
    linkedGoalIds.length > 0
      ? await db
          .selectFrom('goals')
          .select(['id', 'title', 'status'])
          .where('id', 'in', linkedGoalIds)
          .execute()
      : []

  const receiptTotals = await Promise.all(
    activeTickets.map(async (ticket) => {
      const workItems = await listLinkedWorkItemsForTicket(ticket.id)
      return {
        ticketId: ticket.id,
        receiptCount: workItems.length,
      }
    })
  )

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Work</CardTitle>
        <CardDescription className="text-xs">
          Current tickets, recent completions, and goals this agent is driving.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
              Open Tickets
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{activeTickets.length}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
              Recent Done
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{recentCompleted.length}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
              Goals
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {
                new Set(
                  ownedGoals.map((goal) => goal.id).concat(contributedGoals.map((goal) => goal.id))
                ).size
              }
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Active Tickets
            </p>
            {activeTickets.length > 0 ? (
              activeTickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/tickets/${ticket.id}`}
                  className="block rounded-lg border border-white/10 bg-white/[0.02] p-3 transition hover:border-white/20 hover:bg-white/[0.04]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-medium">{ticket.title}</p>
                    <Badge variant={ticket.status === 'blocked' ? 'destructive' : 'outline'}>
                      {ticket.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {receiptTotals.find((entry) => entry.ticketId === ticket.id)?.receiptCount ?? 0}{' '}
                    linked receipts
                  </p>
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No active tickets assigned.</p>
            )}
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Owned Goals
              </p>
              {ownedGoals.length > 0 ? (
                ownedGoals.map((goal) => (
                  <Link
                    key={goal.id}
                    href={`/goals/${goal.id}`}
                    className="block rounded-lg border border-white/10 bg-white/[0.02] p-3 transition hover:border-white/20 hover:bg-white/[0.04]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium">{goal.title}</p>
                      <Badge variant="outline">{goal.status}</Badge>
                    </div>
                  </Link>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  This agent does not own any goals yet.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Recent Done
              </p>
              {recentCompleted.length > 0 ? (
                recentCompleted.map((ticket) => (
                  <Link
                    key={ticket.id}
                    href={`/tickets/${ticket.id}`}
                    className="block rounded-lg border border-white/10 bg-white/[0.02] p-3 transition hover:border-white/20 hover:bg-white/[0.04]"
                  >
                    <p className="truncate text-sm font-medium">{ticket.title}</p>
                  </Link>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No completed tickets yet.</p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
