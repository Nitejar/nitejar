import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCircleCheck,
  IconClock,
  IconFilter,
  IconLayoutKanban,
  IconSearch,
  IconUsers,
} from '@tabler/icons-react'

const scalabilityCriteria = [
  {
    title: 'Scanable health before drill-down',
    detail:
      'Operators should see goal health, last movement, ticket load, and ownership coverage without opening every goal.',
  },
  {
    title: 'Fast narrowing',
    detail:
      'Search, health filters, and saved sorts need to collapse a large portfolio to the relevant slice in one or two interactions.',
  },
  {
    title: 'Stable summary signals',
    detail:
      'Each goal should expose a deterministic health state backed by receipts: blocked tickets, stale activity, active work, and agent coverage.',
  },
  {
    title: 'Operator handoff points',
    detail:
      'The portfolio must point directly to the next artifact: the goal session, key tickets, and which agents are attached.',
  },
]

const implementationPlan = [
  {
    icon: IconLayoutKanban,
    title: 'Data model additions',
    bullets: [
      'Add a typed goal portfolio query that aggregates goals, child tickets, assignees, last activity, and recent work receipts.',
      'Define health classification rules in one place so the UI and future automations share the same interpretation.',
      'Expose counts that remain useful as the portfolio grows: open tickets, blocked tickets, active tickets, and assigned agents.',
    ],
  },
  {
    icon: IconFilter,
    title: 'Portfolio UI shape',
    bullets: [
      'Replace the current fleet-first surface with a goal-first list or grid that supports search, health filters, and multi-column sorting.',
      'Keep the default view dense enough for dozens of goals: title, outcome, health, ticket count, assignee coverage, and last activity.',
      'Allow drill-down cards to expand goal detail without losing list context.',
    ],
  },
  {
    icon: IconUsers,
    title: 'Health and ownership signals',
    bullets: [
      'Healthy: recent work or active ticket movement with agent coverage.',
      'At risk: stale activity or open tickets without assigned agents.',
      'Blocked: one or more blocked tickets attached to the goal.',
    ],
  },
  {
    icon: IconSearch,
    title: 'Follow-on operator improvements',
    bullets: [
      'Saved views for “blocked now”, “unowned work”, and “recently stale” once usage patterns stabilize.',
      'Pagination or virtualization only if goal count makes the first page materially slow; avoid premature complexity.',
      'Optional trend sparkline per goal once there is enough time-series data to justify it.',
    ],
  },
]

export default function GoalsPortfolioPage() {
  return (
    <div className="space-y-6">
      <div className="max-w-4xl">
        <h1 className="text-2xl font-semibold text-white">Goal portfolio</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Spec scaffold for the scalable goal portfolio. This defines what “scalable” should mean in
          Nitejar before we wire the backed-by-receipts data model and operator UI.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {scalabilityCriteria.map((item) => (
          <Card key={item.title} className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-white">{item.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{item.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <CardTitle className="text-sm text-white">Proposed goal health model</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2 text-emerald-300">
              <IconCircleCheck className="h-4 w-4" />
              <span className="text-sm font-medium">Healthy</span>
            </div>
            <p className="mt-2 text-sm text-emerald-100/80">
              Active work or recent ticket movement with agent ownership.
            </p>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
            <div className="flex items-center gap-2 text-amber-300">
              <IconClock className="h-4 w-4" />
              <span className="text-sm font-medium">At risk</span>
            </div>
            <p className="mt-2 text-sm text-amber-100/80">
              Stale activity or open tickets with no assigned agent coverage.
            </p>
          </div>
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
            <div className="flex items-center gap-2 text-red-300">
              <IconAlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">Blocked</span>
            </div>
            <p className="mt-2 text-sm text-red-100/80">
              At least one blocked ticket requires operator intervention.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {implementationPlan.map((section) => {
          const Icon = section.icon
          return (
            <Card key={section.title} className="border-white/10 bg-white/[0.02]">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-white">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {section.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2">
                      <IconArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
