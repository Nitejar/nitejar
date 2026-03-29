'use client'

import Link from 'next/link'
import { formatCost } from '@/lib/utils'
import type { RouterOutputs } from '@/lib/trpc'

type FleetStatus = RouterOutputs['commandCenter']['getFleetStatus']
type WorkDashboard = RouterOutputs['work']['getDashboard']
type CostSummary = RouterOutputs['costs']['getSummary'] | undefined

interface PulseStripProps {
  fleet: FleetStatus
  work: WorkDashboard
  costs: CostSummary
}

function PulseCell({
  label,
  value,
  subNote,
  subNoteHref,
  accent,
  href,
}: {
  label: string
  value: string | number
  subNote?: string | null
  subNoteHref?: string | null
  accent?: boolean
  href: string
}) {
  return (
    <div className="px-4 py-2.5">
      <Link href={href} className="block transition hover:opacity-80">
        <p className="text-[0.6rem] font-medium uppercase tracking-[0.15em] text-muted-foreground">
          {label}
        </p>
        <p className={`text-lg font-semibold tabular-nums ${accent ? 'text-emerald-400' : ''}`}>
          {value}
        </p>
      </Link>
      {subNote &&
        (subNoteHref ? (
          <Link
            href={subNoteHref}
            className="text-[0.6rem] tabular-nums text-amber-400/70 hover:text-amber-300 hover:underline"
          >
            {subNote}
          </Link>
        ) : (
          <p className="text-[0.6rem] tabular-nums text-amber-400/70">{subNote}</p>
        ))}
    </div>
  )
}

export function PulseStrip({ fleet, work, costs }: PulseStripProps) {
  const activeRuns = fleet.activeOperations.filter((op) => op.status === 'running').length
  const monthSpend = costs ? formatCost(costs.spendThisMonth) : '$—'
  const openGoals = work.summary.goalCount
  const atRiskGoals = work.summary.atRiskGoalCount
  const openTickets = work.summary.openTicketCount
  const blockedTickets = work.summary.blockedTicketCount

  return (
    <div className="grid grid-cols-2 items-stretch divide-x divide-zinc-800/60 border-b border-zinc-800 sm:grid-cols-4 lg:grid-cols-5">
      <PulseCell label="Active runs" value={activeRuns} accent={activeRuns > 0} href="/agents" />
      <PulseCell label="Month spend" value={monthSpend} href="/costs" />
      <PulseCell
        label="Goals"
        value={openGoals}
        subNote={atRiskGoals > 0 ? `${atRiskGoals} at risk` : null}
        subNoteHref={atRiskGoals > 0 ? '/goals?status=at_risk' : null}
        href="/goals"
      />
      <PulseCell
        label="Open tickets"
        value={openTickets}
        subNote={blockedTickets > 0 ? `${blockedTickets} blocked` : null}
        subNoteHref={blockedTickets > 0 ? '/tickets?status=blocked' : null}
        href="/tickets"
      />
      <div className="hidden lg:block">
        <PulseCell
          label="Fleet"
          value={`${fleet.summary.activeNow} / ${fleet.summary.totalAgents}`}
          subNote={fleet.summary.activeNow > 0 ? 'busy / total' : null}
          href="/agents"
        />
      </div>
    </div>
  )
}
