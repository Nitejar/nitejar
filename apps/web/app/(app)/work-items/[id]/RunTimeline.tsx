'use client'

import { useCallback } from 'react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

interface RunTimelineEntry {
  jobId: string
  agentName: string
  agentEmoji?: string | null
  agentId: string
  startedAt: number | null
  completedAt: number | null
  status: string
  cost?: number | null
  errorText?: string | null
  passed?: boolean
  isReplay?: boolean
}

const BAR_COLORS = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-cyan-500',
]

function isActiveStatus(status: string): boolean {
  return status === 'RUNNING' || status === 'PENDING' || status === 'PAUSED'
}

function formatTime(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${Math.round(secs)}s`
}

export function RunTimeline({ runs }: { runs: RunTimelineEntry[] }) {
  const handleBarClick = useCallback((jobId: string) => {
    const allDetails = document.querySelectorAll<HTMLDetailsElement>('details[data-run-id]')
    allDetails.forEach((el) => {
      el.open = el.dataset.runId === jobId
    })
    const target = document.querySelector<HTMLDetailsElement>(`details[data-run-id="${jobId}"]`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])

  // Build stable color assignment by agentId (same agent always gets same color)
  const agentColorMap = new Map<string, string>()
  let colorIdx = 0
  for (const run of runs) {
    if (!agentColorMap.has(run.agentId)) {
      agentColorMap.set(run.agentId, BAR_COLORS[colorIdx % BAR_COLORS.length]!)
      colorIdx++
    }
  }

  // Separate passed runs (no timing data) from timed runs
  const timed = runs.filter((r) => r.startedAt != null && !r.passed)
  const passedRuns = runs.filter((r) => r.passed)
  if (timed.length === 0 && passedRuns.length === 0) return null

  const nowSec = Math.floor(Date.now() / 1000)
  const getRunEnd = (run: RunTimelineEntry): number => {
    if (run.completedAt != null) return run.completedAt
    if (run.startedAt == null) return nowSec
    return isActiveStatus(run.status) ? nowSec : run.startedAt + 1
  }

  const timedWithBounds = timed
    .map((run) => ({
      run,
      start: run.startedAt!,
      end: getRunEnd(run),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end)

  // Assign each run to a vertical lane so overlapping intervals stay visible.
  const laneEndTimes: number[] = []
  const runLaneById = new Map<string, number>()
  for (const { run, start, end } of timedWithBounds) {
    const reusableLane = laneEndTimes.findIndex((laneEnd) => laneEnd <= start)
    const lane = reusableLane === -1 ? laneEndTimes.length : reusableLane
    laneEndTimes[lane] = end
    runLaneById.set(run.jobId, lane)
  }

  const laneCount = Math.max(1, laneEndTimes.length)
  const lanePitchPx = 16
  const barHeightPx = 12
  const chartPaddingPx = 2
  const chartHeightPx = chartPaddingPx * 2 + lanePitchPx * laneCount

  const earliest = timedWithBounds.length > 0 ? Math.min(...timedWithBounds.map((r) => r.start)) : 0
  const latest = timedWithBounds.length > 0 ? Math.max(...timedWithBounds.map((r) => r.end)) : 1
  const totalSpan = latest - earliest

  // Avoid division by zero for instant runs
  const span = totalSpan > 0 ? totalSpan : 1

  return (
    <div className="space-y-1">
      <div
        className="relative w-full rounded bg-white/[0.03] border border-white/10"
        style={{ height: `${chartHeightPx}px` }}
      >
        {timedWithBounds.map(({ run, start, end }) => {
          const duration = end - start
          const lane = runLaneById.get(run.jobId) ?? 0
          const topPx = chartPaddingPx + lane * lanePitchPx
          const startOffset = start - earliest
          // Ensure a minimum visible width
          const widthPct = Math.max((duration / span) * 100, 2)
          const color = agentColorMap.get(run.agentId) ?? BAR_COLORS[0]
          const isActive = isActiveStatus(run.status)
          const durationStr = formatDuration(duration)

          return (
            <Tooltip key={run.jobId}>
              <TooltipTrigger
                className={`absolute rounded-sm ${color} ${isActive ? 'animate-pulse' : ''} cursor-pointer border-0 p-0`}
                style={{
                  top: `${topPx}px`,
                  height: `${barHeightPx}px`,
                  left: `${(startOffset / span) * 100}%`,
                  width: `${widthPct}%`,
                }}
                onClick={() => handleBarClick(run.jobId)}
              >
                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-white truncate px-1">
                  {widthPct > 15 && (
                    <>
                      {run.isReplay ? '↻ ' : ''}
                      {run.agentEmoji ?? ''} {run.agentName}{' '}
                    </>
                  )}
                  ({durationStr})
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    {run.isReplay && '↻ '}
                    {run.agentName}
                  </span>
                  {run.isReplay && (
                    <span className="text-blue-400 text-[10px]">Retry of earlier run</span>
                  )}
                  <span className="text-muted-foreground">
                    {formatTime(run.startedAt!)} → {formatTime(end)} ({durationStr})
                  </span>
                  {run.cost != null && run.cost > 0 && (
                    <span className="text-muted-foreground">${run.cost.toFixed(4)}</span>
                  )}
                  {run.status === 'FAILED' && run.errorText && (
                    <span className="text-red-400 max-w-[200px] truncate">{run.errorText}</span>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
      {passedRuns.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-0.5">
          <span className="text-[9px] text-muted-foreground">Passed:</span>
          {passedRuns.map((run) => (
            <button
              key={run.jobId}
              className="rounded bg-yellow-400/10 px-1.5 py-0.5 text-[9px] text-yellow-400/70 hover:text-yellow-400 cursor-pointer border-0"
              onClick={() => handleBarClick(run.jobId)}
            >
              {run.agentEmoji ?? ''} {run.agentName}
            </button>
          ))}
        </div>
      )}
      {timed.length > 0 && (
        <div className="flex justify-between text-[9px] text-muted-foreground px-0.5">
          <span>{formatTime(earliest)}</span>
          <span>
            {formatTime(latest)} ({formatDuration(totalSpan)})
          </span>
        </div>
      )}
    </div>
  )
}
