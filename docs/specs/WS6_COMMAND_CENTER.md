# WS6: Command Center Dashboard

## Overview

The Command Center is a fleet-level operational dashboard that shows the health, activity, and cost posture of the entire Nitejar agent fleet at a glance. It is the single page an operator opens to answer: "Is my fleet healthy right now, and do I need to intervene anywhere?"

### How it differs from the existing dashboard

The current `/admin` page (Activity) is a **chronological event feed**. It answers "what happened recently?" by showing work items grouped by day, with per-run details. It is excellent for auditing individual runs but does not provide:

- Aggregate fleet statistics (how many agents, how many are active, total runs today)
- Per-agent health at a glance (error rates, cost trends, last-active timestamps)
- Currently-running operations with live duration timers
- Cost breakdown across the fleet in a single view
- "Needs Attention" alerts for degraded agents or budget warnings

The Command Center fills these gaps. It is a **fleet status board**, not a timeline.

### Navigation relationship

The Command Center becomes the new landing page at `/admin`. The existing activity feed moves to `/admin/activity` and remains accessible from the nav. The AdminNav changes:

```
Before: Activity | Agents | Collections | Costs | Plugins | Settings
After:  Command Center | Activity | Agents | Collections | Costs | Plugins | Settings
```

The "Command Center" label is the nav item that points to `/admin`. The existing "Activity" label moves to `/admin/activity`. This is a one-line route rename with no data migration.

---

## Data Requirements

All timestamps in the database are Unix epoch seconds. All cost values are USD floats. The Command Center needs six categories of data, each described below with the specific aggregation queries required.

### 1. Fleet Summary Stats

Six summary cards displayed in a row at the top of the page.

| Card | Source | Query |
|------|--------|-------|
| **Total Agents** | `agents` table | `SELECT count(*) FROM agents` |
| **Active Now** | `jobs` table | `SELECT count(DISTINCT agent_id) FROM jobs WHERE status IN ('RUNNING', 'PENDING')` |
| **Runs (period)** | `jobs` table | `SELECT count(*) FROM jobs WHERE created_at >= :sinceUnix` |
| **Avg Run Duration** | `jobs` table | `SELECT avg(completed_at - started_at) FROM jobs WHERE completed_at IS NOT NULL AND started_at IS NOT NULL AND created_at >= :sinceUnix` |
| **Total Cost (period)** | `inference_calls` + `external_api_calls` | Existing `getTotalSpend(sinceUnix)` from `packages/database/src/repositories/inference-calls.ts` |
| **Pending Items** | `run_dispatches` table | `SELECT count(*) FROM run_dispatches WHERE status = 'queued'` |

**Period selector**: The summary cards respect a time-period toggle (Today / 7d / 30d / All Time) that filters the "Runs", "Avg Duration", and "Total Cost" cards. Default period is **7d**. "Total Agents", "Active Now", and "Pending Items" are always real-time.

### 2. Agent Roster (per-agent metrics)

A table with one row per agent, showing fleet-level metrics. This is the core of the Command Center.

Columns:

| Column | Source | Query notes |
|--------|--------|-------------|
| **Agent** (avatar + name + handle) | `agents` table | Join with `agents.config` JSON to extract `emoji`, `avatarUrl`, `title` via `parseAgentConfig` |
| **Status** (idle/busy/offline) | `agents.status` + active job check | Reuse existing `getAgentIdsWithActiveJobs()` pattern |
| **Runs** (count in period) | `jobs` table | `SELECT count(*) FROM jobs WHERE agent_id = :id AND created_at >= :sinceUnix` |
| **Success Rate** (%) | `jobs` table | `SELECT count(*) FILTER (WHERE status = 'COMPLETED') * 100.0 / count(*) FROM jobs WHERE agent_id = :id AND created_at >= :sinceUnix` (SQLite does not support FILTER; use CASE/SUM) |
| **Avg Score** | eval system (WS4) / `jobs` fallback | **v1 placeholder**: run success rate (`completed / total`), displayed as a percentage. Once the eval system (WS4) is built, this column will display the agent's average eval score from the scoring pipeline. The column header remains "Avg Score" in both phases so the UI does not change when evals land. |
| **Cost** (in period) | `inference_calls` + `external_api_calls` | Reuse `getSpendByAgent(sinceUnix)` |
| **Last Active** (relative time) | `jobs` table | `SELECT max(created_at) FROM jobs WHERE agent_id = :id` |
| **Trend** (sparkline) | `inference_calls` grouped by day | 7-day daily cost or run-count series (see Sparklines section) |

#### WS4 Eval Integration Path

The Avg Score column transitions from a placeholder to eval-backed data when WS4 ships:

- **Field name:** `avgEvalScore: number | null` added to the roster row type.
- **Source:** `evals` repository, query `overall_score` from `eval_runs` for the agent within the selected time period (where `status = 'completed'` and `gates_passed = 1`).
- **Scale:** 0-1 normalized (from the evaluator pipeline). Display as a percentage in the UI (e.g., 0.843 displays as "84.3%").
- **v1 placeholder:** Run success rate (`completed / total`). The column header shows "Avg Score" with a tooltip: "Based on run success rate." When evals are active for an agent (i.e., the agent has active evaluators in `agent_evaluators` and at least one completed `eval_runs` row in the period), the tooltip changes to "Based on evaluator pipeline scores" and the value switches to the eval-backed `avgEvalScore`.
- **Transition logic:** If `avgEvalScore` is non-null for an agent, use it. Otherwise, fall back to the run success rate placeholder.

**Efficient aggregation**: Rather than N+1 queries per agent, build a single query that groups by `agent_id`:

```sql
SELECT
  j.agent_id,
  count(*) AS run_count,
  sum(CASE WHEN j.status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_count,
  sum(CASE WHEN j.status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count,
  -- v1 placeholder for Avg Score: success rate as a 0-100 value.
  -- Replace with eval system (WS4) average score once available.
  CASE WHEN count(*) > 0
    THEN sum(CASE WHEN j.status = 'COMPLETED' THEN 1 ELSE 0 END) * 100.0 / count(*)
    ELSE NULL END AS avg_score,
  max(j.created_at) AS last_active_at,
  coalesce(sum(ic.cost), 0) AS total_cost
FROM jobs j
LEFT JOIN (
  SELECT job_id, sum(cost_usd) AS cost
  FROM inference_calls
  WHERE created_at >= :sinceUnix
  GROUP BY job_id
) ic ON ic.job_id = j.id
WHERE j.created_at >= :sinceUnix
GROUP BY j.agent_id
```

This returns one row per agent that has any jobs in the period. Agents with zero jobs appear from the `agents` table with zeroed metrics.

**Sparkline data**: A separate query returns daily aggregates per agent for the last 7 days:

```sql
SELECT
  agent_id,
  date(created_at, 'unixepoch') AS day,
  count(*) AS run_count,
  coalesce(sum(ic_cost), 0) AS daily_cost
FROM jobs j
LEFT JOIN (
  SELECT job_id, sum(cost_usd) AS ic_cost
  FROM inference_calls
  GROUP BY job_id
) ic ON ic.job_id = j.id
WHERE j.created_at >= :sevenDaysAgoUnix
GROUP BY j.agent_id, date(created_at, 'unixepoch')
ORDER BY j.agent_id, day
```

The client groups the flat array into per-agent sparkline series. This avoids sending N separate queries.

### 3. Active Operations

A sidebar (or collapsible panel) showing currently-running dispatches with live duration timers.

Source: `run_dispatches` table joined to `work_items` and `agents`.

```sql
SELECT
  rd.id AS dispatch_id,
  rd.agent_id,
  a.name AS agent_name,
  a.config AS agent_config,
  rd.status,
  wi.title,
  wi.source,
  rd.started_at,
  rd.created_at
FROM run_dispatches rd
INNER JOIN work_items wi ON wi.id = rd.work_item_id
INNER JOIN agents a ON a.id = rd.agent_id
WHERE rd.status IN ('running', 'queued')
ORDER BY rd.created_at DESC
LIMIT 25
```

The client computes elapsed duration as `Date.now()/1000 - started_at` and re-renders on an interval (every second for running items). No server polling is needed for the timer itself; only the list of active dispatches needs periodic refresh.

### 4. Cost Breakdown

A bar chart showing cost per agent for the selected period. This reuses the existing `getSpendByAgent(sinceUnix)` query from `packages/database/src/repositories/inference-calls.ts`, which already merges inference and external API costs.

Additionally, a secondary chart can show cost by source (telegram, github, etc.) using the existing `getSpendBySourceGlobal(sinceUnix)`.

No new queries needed; the existing cost infrastructure is sufficient.

### 5. Needs Attention

A panel highlighting agents or operations that may need intervention. This is derived from the data already fetched for the roster and active operations, plus a few targeted queries:

| Signal | How to compute | Threshold |
|--------|---------------|-----------|
| **High failure rate** | `failed_count / run_count` from roster data | > 30% in period with >= 3 runs |
| **Cost spike** | Compare current-period cost to previous-period cost per agent | > 2x increase vs. prior period |
| **Long-running dispatch** | `Date.now()/1000 - started_at` from active operations | > 10 minutes (hardcoded for v1) |
| **Budget warning** | Compare spend to cost limits | Existing `listAllCostLimits()` + `getAgentSpendInWindow()` |
| **Zombie dispatches** | `run_dispatches` with `status = 'running'` and stale `lease_expires_at` | `lease_expires_at < now()` |
| **Declining eval score** | Compare last 7d avg `overall_score` from `eval_runs` to prior 7d avg for the agent. | Delta > 5% decrease when evals are active (agent has completed eval runs in both windows). Available after WS4 integration. |

The failure rate and cost spike signals are computed client-side from data already fetched for the roster. Budget warnings and zombie detection require one additional query each.

**Budget proximity query**: Reuse existing `listAllCostLimits()` and `getAgentSpendInWindow(agentId, sinceUnix)` / `getOrgSpendInWindow(sinceUnix)` from the cost limits infrastructure. The Command Center checks each active limit and flags when spend exceeds the soft limit percentage.

### 6. Fleet Activity Sparkline (optional enhancement)

A single area chart at the top showing fleet-wide run volume over the last 7 days, reusing the daily trend pattern from the costs dashboard. This provides quick visual context for "are we busier or quieter than usual?"

---

## tRPC Routes

A new `commandCenterRouter` is added to `apps/web/server/routers/` and wired into `_app.ts`.

```typescript
// apps/web/server/routers/command-center.ts

export const commandCenterRouter = router({
  // All-in-one fleet summary. One network round-trip for the entire dashboard.
  getFleetStatus: protectedProcedure
    .input(z.object({
      period: z.enum(['today', '7d', '30d', 'all']).default('7d'),
    }))
    .query(async ({ input }) => {
      // Returns:
      // {
      //   summary: { totalAgents, activeNow, runsInPeriod, avgDurationSeconds, totalCost, pendingItems }
      //   roster: Array<{ agentId, name, handle, config, status, runCount, completedCount, failedCount, avgScore, cost, lastActiveAt }>
      //   sparklines: Array<{ agentId, day, runCount, dailyCost }>
      //   activeOperations: Array<{ dispatchId, agentId, agentName, agentConfig, status, title, source, startedAt, createdAt }>
      //   costByAgent: Array<{ agentId, agentName, total, callCount }>
      //   costBySource: Array<{ source, total, callCount }>
      //   budgetAlerts: Array<{ limitId, scope, agentId?, period, limitUsd, currentSpend, softPct, hardPct }>
      // }
    }),
})
```

### Why a single procedure instead of multiple

The Command Center needs all six data categories on initial load. Splitting into six separate tRPC queries would cause six parallel HTTP requests (even with batching, they are six logical operations). A single `getFleetStatus` procedure:

1. Runs all database queries in parallel with `Promise.all` on the server
2. Returns one payload, one network round-trip
3. Makes cache invalidation simple (one query key)
4. Keeps the refresh button straightforward

The period parameter controls the time window for runs, cost, and success rate. Active operations and agent count are always real-time.

### Where it lives in the router tree

```typescript
// apps/web/server/routers/_app.ts
import { commandCenterRouter } from './command-center'

export const appRouter = router({
  // ... existing routers
  commandCenter: commandCenterRouter,
})
```

### Refresh strategy

The tRPC query uses polling via `refetchInterval` on the client. Since the entire dashboard shares a single `getFleetStatus` query, a **30-second `refetchInterval`** is the default. This balances freshness against query load. Real-time push (SSE/WebSocket) is deferred; polling is the v1 approach (see Q32).

The `useQuery` call:

```typescript
const fleet = trpc.commandCenter.getFleetStatus.useQuery(
  { period },
  { refetchInterval: 30_000 }
)
```

---

## Admin UI Layout

The Command Center is a single client component at `apps/web/app/admin/command-center/CommandCenterDashboard.tsx`, rendered by a server component page at `apps/web/app/admin/page.tsx` (replacing the current activity feed, which moves to `/admin/activity`).

### Component hierarchy

```
CommandCenterDashboard (client component, fetches getFleetStatus)
  |
  +-- PeriodSelector (Today | 7d | 30d | All)
  |
  +-- SummaryCardsRow
  |     +-- StatCard x 6
  |
  +-- FleetGrid (CSS grid: 2/3 left, 1/3 right)
  |     |
  |     +-- [Left column]
  |     |     +-- AgentRosterTable
  |     |     |     +-- AgentRow x N (with inline sparkline)
  |     |     |
  |     |     +-- CostBreakdownPanel
  |     |           +-- BarChart (cost by agent)
  |     |           +-- BarChart (cost by source) [collapsed by default]
  |     |
  |     +-- [Right column]
  |           +-- ActiveOperationsPanel
  |           |     +-- OperationRow x N (with live duration timer)
  |           |
  |           +-- NeedsAttentionPanel
  |                 +-- AlertRow x N
  |
  +-- FleetSparkline (optional, full-width area chart of 7d run volume)
```

### Detailed component specs

#### PeriodSelector

A row of pill buttons (reuse the `FilterPill` pattern from `AgentsTable.tsx`). Options: Today, 7d, 30d, All. Default: **7d**. Changing the period re-fetches `getFleetStatus` with the new period parameter.

#### SummaryCardsRow

Six cards in a responsive grid (`grid-cols-2 sm:grid-cols-3 xl:grid-cols-6`). Each card follows the existing pattern from `CostsDashboard.tsx`:

```
+-------------------+
| TOTAL AGENTS      |  <- muted label, text-xs
|        12         |  <- text-2xl font-semibold tabular-nums
+-------------------+
```

Cards and their semantics:

1. **Total Agents** -- count from `summary.totalAgents`. Icon: `IconRobot`.
2. **Active Now** -- count from `summary.activeNow`. Icon: `IconActivity`. Green tint if > 0.
3. **Runs (period)** -- count from `summary.runsInPeriod`. Icon: `IconPlayerPlay`.
4. **Avg Duration** -- formatted as `Xs` or `Xm Xs` from `summary.avgDurationSeconds`. Icon: `IconClock`.
5. **Total Cost** -- formatted with `formatCost()` from `summary.totalCost`. Icon: `IconCurrencyDollar`.
6. **Pending** -- count from `summary.pendingItems`. Icon: `IconHourglass`. Amber tint if > 0.

#### AgentRosterTable

A table using the existing `Table` / `TableRow` / `TableHead` / `TableCell` components from `@/components/ui/table`. Columns:

| Column | Width | Content |
|--------|-------|---------|
| Agent | 30% | Avatar + name + handle (reuse `AgentAvatar` pattern from `AgentsTable.tsx`), linked to `/admin/agents/:id` |
| Status | 8% | Colored dot + label (reuse `StatusIndicator` pattern) |
| Runs | 8% | Numeric count, tabular-nums |
| Success | 8% | Percentage with color coding (green >= 90%, amber >= 70%, red < 70%). Show as "--" if zero runs. |
| Avg Score | 9% | **v1**: run success rate as percentage (same value as Success column but presented as a score). Once WS4 evals land, this pulls the agent's average eval score instead. Show as "--" if zero runs. Tooltip: "Based on run success rate. Eval scores coming soon." |
| Cost | 10% | `formatCost()` value |
| Last Active | 12% | Relative time ("2m ago", "3h ago"). Use the existing `RelativeTime` component from `apps/web/app/admin/components/RelativeTime.tsx` or the `formatRelativeTime` helper from the activity page. |
| Trend | 15% | Inline sparkline (see Sparklines section) |

**Sorting**: Click column headers to sort. Default sort: by status (busy first), then by run count descending. Sorting is client-side since the roster fits in memory (fleets are typically < 100 agents).

**Filtering**: A search input above the table (reuse pattern from `AgentsTable.tsx`) filters by agent name/handle. Status filter pills (All / Active / Idle / Offline) filter the roster.

#### ActiveOperationsPanel

A card in the right column showing currently running and queued dispatches. Both `running` and `queued` statuses are included. Running dispatches are shown first (unlimited within the panel cap), followed by up to **5 queued dispatches**. If there are more queued items beyond the 5 shown, display a "+N queued" overflow label linking to `/admin/work-items?status=QUEUED`.

Each row shows:
- Agent avatar (small, 20px) + agent name
- Work item title (truncated)
- Source badge (telegram/github/manual)
- Duration timer (live-updating every second for "running" status, static "queued" label for queued)
- Status dot (blue pulsing for running, amber for queued)

Maximum 15 visible running rows. If there are more running items, show a "+N more" link to `/admin/work-items?status=RUNNING`. Queued items are capped at 5 with the "+N queued" overflow described above.

The duration timer uses a `useEffect` with `setInterval(1000)` that increments a local counter. The timer is reset when the query refetches and the `startedAt` values change.

Empty state: "No active operations" with a subtle icon.

#### CostBreakdownPanel

Below the agent roster table on the left side. Two visualizations:

1. **Cost by Agent** (horizontal bar chart) -- Uses Recharts `BarChart` with `layout="vertical"` so agent names are on the Y-axis. Top 10 agents by cost. Color: primary. Pattern identical to the existing bar chart in `CostsDashboard.tsx`.

2. **Cost by Source** (small horizontal bar chart) -- Collapsed under a disclosure toggle by default. Uses `getSpendBySourceGlobal` data. Shows telegram, github, manual, scheduler, etc.

Both charts use the existing `ChartContainer` / `ChartTooltip` wrappers from `@/components/ui/chart.tsx`.

#### NeedsAttentionPanel

A card below the active operations panel on the right side. Shows a list of alert items, each with:

- Severity icon (warning triangle for critical, info circle for advisory)
- Short description ("Agent Mary: 45% failure rate (last 24h)")
- Link to the relevant agent or cost page

Alert types (in priority order):

1. **Budget exceeded** (hard limit) -- red, links to `/admin/costs`
2. **Budget warning** (soft limit) -- amber, links to `/admin/costs`
3. **High failure rate** (> 30% with >= 3 runs) -- red, links to `/admin/agents/:id`
4. **Long-running dispatch** (> 10 min) -- amber, links to `/admin/work-items/:id`
5. **Cost spike** (> 2x prior period) -- amber, links to `/admin/agents/:id`
6. **Zombie dispatch** (stale lease) -- red, links to admin runtime control

Maximum 10 alerts shown. Empty state: "Fleet is healthy" with a green checkmark.

---

## Performance Considerations

### Query optimization

The `getFleetStatus` procedure runs 6-8 database queries in parallel via `Promise.all`. On SQLite (local dev), these are all hitting the same file and run sequentially at the engine level, but the application-level parallelism still helps when some queries are I/O-bound.

Key indexes that should exist (verify or add):

```sql
-- For fleet summary
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_agent_id_created_at ON jobs(agent_id, created_at);

-- For active operations
CREATE INDEX IF NOT EXISTS idx_run_dispatches_status ON run_dispatches(status);

-- For cost aggregation (should already exist from cost dashboard)
CREATE INDEX IF NOT EXISTS idx_inference_calls_agent_id_created_at ON inference_calls(agent_id, created_at);
```

### Data volume expectations

- Agents: < 100 (always fits in memory)
- Jobs: could be thousands. The period filter limits scan range. The `idx_jobs_agent_id_created_at` index makes per-agent aggregation efficient.
- Inference calls: could be tens of thousands. The `created_at` index + `sinceUnix` filter limits scan to the active period.
- Run dispatches (active): typically < 50 at any moment. No optimization needed.

### Caching strategy

No server-side cache is needed for the initial implementation. The tRPC query has a 30-second `refetchInterval` on the client, which is sufficient for an operational dashboard. SQLite queries over indexed data with typical Nitejar workloads (< 10k jobs, < 100k inference calls) complete in < 50ms.

If performance becomes an issue at scale:

1. **Add a materialized summary row**: A background task runs every 60 seconds and writes a JSON summary to a `fleet_summary_cache` table. The `getFleetStatus` query reads the cache instead of computing aggregates live. This is a future optimization, not needed at launch.

2. **Stale-while-revalidate on the client**: Set `staleTime: 15_000` on the tRPC query so the UI shows cached data immediately while refetching in the background. This is essentially free and should be the default.

```typescript
const fleet = trpc.commandCenter.getFleetStatus.useQuery(
  { period },
  {
    refetchInterval: 30_000,
    staleTime: 15_000,
  }
)
```

### Payload size

Estimated payload for a fleet of 20 agents with 7d period:

- Summary: ~100 bytes
- Roster: 20 agents x ~200 bytes = ~4 KB
- Sparklines: 20 agents x 7 days x ~30 bytes = ~4 KB
- Active operations: ~10 items x ~200 bytes = ~2 KB
- Cost by agent: ~20 items x ~50 bytes = ~1 KB
- Cost by source: ~5 items x ~40 bytes = ~200 bytes
- Budget alerts: ~5 items x ~100 bytes = ~500 bytes

Total: ~12 KB. Well within acceptable limits.

---

## Relationship to Existing Pages

### What changes

| Page | Before | After |
|------|--------|-------|
| `/admin` | Activity feed (chronological event timeline) | Command Center dashboard |
| `/admin/activity` | Does not exist | Activity feed (moved from `/admin`) |
| Nav "Activity" link | Points to `/admin` | Points to `/admin/activity` |
| Nav first item | "Activity" | "Command Center" |

### What does NOT change

- `/admin/agents` -- Agent list page remains unchanged
- `/admin/agents/:id` -- Agent detail page remains unchanged
- `/admin/costs` -- Cost dashboard remains unchanged; the Command Center's cost panel is a lightweight summary that links to the full costs page for details
- `/admin/work-items` -- Work items page remains unchanged
- All other admin pages remain unchanged

### Cross-linking

The Command Center links out to detail pages:

- Agent name in roster -> `/admin/agents/:id`
- Work item title in active operations -> `/admin/work-items/:workItemId`
- Cost totals -> `/admin/costs`
- "View all activity" link -> `/admin/activity`
- Alert items -> relevant detail pages

---

## Chart / Visualization Approach

### Library: Recharts (already installed)

The codebase already uses Recharts 2.15.4 (`apps/web/package.json`). The costs dashboard and agent detail pages both use `LineChart`, `BarChart`, `XAxis`, `YAxis`, `CartesianGrid`, `Line`, and `Bar` from Recharts, wrapped in the shadcn/ui `ChartContainer` and `ChartTooltip` components from `apps/web/components/ui/chart.tsx`.

The Command Center uses the same library and patterns. No new dependency needed.

### Sparklines

For the agent roster table sparklines, Recharts' `LineChart` can render a tiny chart with minimal configuration:

```tsx
<LineChart width={120} height={32} data={agentSparklineData}>
  <Line
    type="monotone"
    dataKey="runCount"
    stroke="hsl(var(--primary))"
    strokeWidth={1.5}
    dot={false}
  />
</LineChart>
```

No axes, no grid, no tooltip -- just a bare line. This keeps the sparkline lightweight and fast to render inside a table cell. The `data` prop is the 7-element array of daily values for that agent.

Alternatively, if Recharts sparklines feel heavy in a table with 50+ rows, a pure SVG sparkline (a single `<polyline>` element) is trivial to implement:

```tsx
function Sparkline({ data, width = 120, height = 32 }: { data: number[], width?: number, height?: number }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * height}`)
    .join(' ')
  return (
    <svg width={width} height={height} className="text-primary">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
```

**Recommendation**: Start with the pure SVG sparkline. It is ~15 lines of code, zero-dependency, renders instantly, and matches the Recharts aesthetic. If we later need tooltips or click-to-drill-down, upgrade to Recharts.

### Cost breakdown bar chart

Use the identical pattern from `CostsDashboard.tsx`: `BarChart` with `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`. The only difference is using `layout="vertical"` for horizontal bars (agent names on Y-axis are more readable than rotated X-axis labels when there are many agents).

### Color palette

Follow existing conventions:

- Primary (indigo): main data series, sparklines, active indicators
- Emerald: success/healthy states (idle, high success rate, "fleet is healthy")
- Amber: warning states (busy, pending, soft limit, long-running)
- Red: error states (failed, hard limit exceeded, high failure rate)
- White/10, white/20, etc.: borders, muted text, backgrounds (existing dark theme palette)

---

## Implementation Outline

This is not implementation code, but a suggested order of work for the builder.

### Phase 1: Data layer (backend)

1. Create `apps/web/server/routers/command-center.ts` with the `getFleetStatus` procedure
2. Add new repository function in `packages/database/src/repositories/jobs.ts`:
   - `getFleetRosterMetrics(sinceUnix: number)` -- the grouped-by-agent query
   - `getFleetSparklines(sinceUnix: number)` -- the daily-per-agent query
   - `getFleetSummary(sinceUnix: number)` -- the summary counts
3. Add new repository function in `packages/database/src/repositories/run-dispatches.ts`:
   - `listAllActiveDispatches(limit: number)` -- currently active dispatches across all agents
4. Wire the router into `_app.ts`

### Phase 2: UI shell (frontend)

5. Move existing `/admin/page.tsx` content to `/admin/activity/page.tsx`
6. Create `/admin/page.tsx` that renders `<CommandCenterDashboard />`
7. Update `AdminNav.tsx` to add "Command Center" item and move "Activity" link
8. Build the `CommandCenterDashboard` client component with loading/error states

### Phase 3: Panels

9. SummaryCardsRow component
10. AgentRosterTable component with sorting/filtering
11. ActiveOperationsPanel with live timers
12. CostBreakdownPanel with bar charts
13. NeedsAttentionPanel with alert derivation

### Phase 4: Polish

14. SVG sparkline component
15. Period selector state management
16. Responsive layout testing
17. Empty states for all panels
18. Verify needed database indexes exist

---

## Open Questions (Resolved / Deferred)

1. **Q27 — Should the Command Center fully replace `/admin` or be a separate route?**
   **RESOLVED**: Command Center **replaces** `/admin` as the landing page. The existing Activity feed moves to `/admin/activity`. Operators should see fleet health first.

2. **Q27b — What time period should be the default?**
   **RESOLVED**: **7 days**. Low-activity fleets would show zeroes on "Today" too often. A 7-day window gives meaningful data out of the box.

3. **Q29 — Should sparklines show run count or cost?**
   **DEFERRED**: Default to **run count** for v1. A toggle to switch between run count and cost may be added later if operators request it.

4. **Q30 — What are the right thresholds for "Needs Attention"?**
   **RESOLVED**: Hardcoded defaults for v1. The thresholds are: > 30% failure rate (with >= 3 runs), > 2x cost spike vs. prior period, > 10 min dispatch duration. Making these configurable is a future enhancement, not v1 scope.

5. **Q31 — Should active operations show queued dispatches or only running ones?**
   **RESOLVED**: Include **both running and queued**. Running dispatches display without limit (within the panel cap of 15). Queued dispatches are limited to **5 visible rows** with a "+N queued" overflow label linking to the work items page.

6. **Q32 — Real-time updates (SSE/WebSocket) vs polling?**
   **RESOLVED**: **Polling for v1** with a 30-second `refetchInterval`. If the platform later adds SSE/WebSocket support for other features (e.g., live run output streaming), the Command Center can subscribe to the same channel. No real-time push infrastructure needed at launch.

7. **Q33 — Should "Needs Attention" include routine/scheduled item health?**
   **DEFERRED**: v1 focuses on jobs and dispatches only. Routine health surfacing can be added once routine observability is more mature.

8. **Q34 — Mobile responsiveness priority.**
   **RESOLVED**: **Desktop-first for v1**. The two-column grid collapses to a single column on mobile (roster stacks above operations), but no special card-based mobile layouts are in scope. Functional but not optimized for small screens.
