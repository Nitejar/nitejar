'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { RunTodoPanel } from './RunTodoPanel'
import { TraceView } from './TraceView'
import { IconTerminal2 } from '@tabler/icons-react'

interface Props {
  jobId: string
}

function ElapsedTime({ startedAt }: { startedAt: number }) {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000 - startedAt))
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60

  return (
    <span className="tabular-nums text-muted-foreground">
      {minutes}:{seconds.toString().padStart(2, '0')}
    </span>
  )
}

interface LiveMessage {
  id: string
  role: string
  content: string | null
  created_at: number
}

interface LiveBackgroundTask {
  id: string
  label: string | null
  command: string
  status: string
  exit_code: number | null
  error_text: string | null
  output_tail: string | null
  sprite_session_id: string
  started_at: number
  finished_at: number | null
}

interface LiveInferenceCall {
  id: string
  turn: number
  model: string
  request_payload_hash: string | null
  response_payload_hash: string | null
  attempt_kind: string | null
  attempt_index: number | null
  payload_state: string | null
  model_span_id: string | null
  request_payload_json: string | null
  request_payload_metadata_json: string | null
  response_payload_json: string | null
  response_payload_metadata_json: string | null
}

interface ParsedToolCall {
  id?: string
  function?: { name?: string; arguments?: string }
}

function parseLiveMessagePreview(content: string | null): {
  text: string
  reasoning: string
  toolCallSummary: string
} {
  if (!content) {
    return { text: '', reasoning: '', toolCallSummary: '' }
  }

  try {
    const parsed = JSON.parse(content) as {
      text?: unknown
      content?: unknown
      reasoning_segments?: unknown
      tool_calls?: unknown
    }
    const text =
      typeof parsed.text === 'string'
        ? parsed.text
        : typeof parsed.content === 'string'
          ? parsed.content
          : ''
    const reasoning = Array.isArray(parsed.reasoning_segments)
      ? parsed.reasoning_segments
          .filter((segment): segment is string => typeof segment === 'string')
          .join('\n\n')
      : ''
    const toolCalls = Array.isArray(parsed.tool_calls)
      ? (parsed.tool_calls as ParsedToolCall[])
      : []
    const names = toolCalls
      .map((toolCall) => toolCall.function?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
    const toolCallSummary =
      names.length > 0 ? `Tool call${names.length === 1 ? '' : 's'}: ${names.join(', ')}` : ''
    return { text, reasoning, toolCallSummary }
  } catch {
    return { text: content, reasoning: '', toolCallSummary: '' }
  }
}

function LiveBackgroundTaskCard({ task }: { task: LiveBackgroundTask }) {
  const [expanded, setExpanded] = useState(false)

  const statusColor =
    task.status === 'succeeded'
      ? 'text-emerald-400'
      : task.status === 'failed'
        ? 'text-red-400'
        : task.status === 'killed'
          ? 'text-amber-400'
          : 'text-sky-400'

  const borderColor =
    task.status === 'succeeded'
      ? 'border-emerald-500/20 bg-emerald-500/[0.03]'
      : task.status === 'failed'
        ? 'border-red-500/20 bg-red-500/[0.03]'
        : task.status === 'killed'
          ? 'border-amber-500/20 bg-amber-500/[0.03]'
          : 'border-sky-500/20 bg-sky-500/[0.03]'

  const hasOutput = task.output_tail && task.output_tail.trim().length > 0

  return (
    <div className={`rounded border ${borderColor} text-xs`}>
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <div className="flex items-center gap-2">
          <IconTerminal2 className="h-3 w-3 text-muted-foreground" />
          <span className={`font-medium uppercase ${statusColor}`}>{task.status}</span>
          <span className="truncate font-mono text-[11px] text-foreground/60">
            {task.label ?? task.command}
          </span>
          {task.exit_code !== null && (
            <span className="text-[10px] text-muted-foreground">exit {task.exit_code}</span>
          )}
        </div>
        {hasOutput && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 text-[10px] text-white/30 hover:text-white/60"
          >
            {expanded ? 'Hide' : 'Output'}
          </button>
        )}
      </div>
      {expanded && hasOutput && (
        <div className="border-t border-inherit px-2 py-1.5">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-foreground/70">
            {task.output_tail}
          </pre>
        </div>
      )}
      {task.error_text && (
        <div className="border-t border-inherit px-2 py-1.5 text-[10px] text-red-400">
          {task.error_text}
        </div>
      )}
    </div>
  )
}

type TimelineItem =
  | { kind: 'message'; message: LiveMessage; timestamp: number }
  | { kind: 'background_task'; task: LiveBackgroundTask; timestamp: number }

function buildTimeline(
  messages: LiveMessage[],
  backgroundTasks: LiveBackgroundTask[]
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...messages.map((m) => ({ kind: 'message' as const, message: m, timestamp: m.created_at })),
    ...backgroundTasks.map((t) => ({
      kind: 'background_task' as const,
      task: t,
      timestamp: t.started_at,
    })),
  ]
  items.sort((a, b) => a.timestamp - b.timestamp)
  return items
}

export function LiveRunView({ jobId }: Props) {
  const utils = trpc.useUtils()
  const pauseRun = trpc.jobs.pauseRun.useMutation({
    onSuccess: async () => {
      await utils.jobs.getJobWithMessages.invalidate({ jobId })
    },
  })
  const resumeRun = trpc.jobs.resumeRun.useMutation({
    onSuccess: async () => {
      await utils.jobs.getJobWithMessages.invalidate({ jobId })
    },
  })
  const cancelRun = trpc.jobs.cancelRun.useMutation({
    onSuccess: async () => {
      await utils.jobs.getJobWithMessages.invalidate({ jobId })
    },
  })

  const { data, isLoading } = trpc.jobs.getJobWithMessages.useQuery(
    { jobId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.job.status
        if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') return false
        return 3000
      },
    }
  )

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
        Loading run data...
      </div>
    )
  }

  const { job, messages, inferenceCalls, backgroundTasks, spans, runControl } =
    data as typeof data & {
      inferenceCalls?: LiveInferenceCall[]
    }
  const isActive = job.status === 'PENDING' || job.status === 'RUNNING' || job.status === 'PAUSED'
  const isPaused = job.status === 'PAUSED' || runControl?.controlState === 'paused'
  const activeTaskCount = backgroundTasks.filter((task) => task.status === 'running').length
  const timeline = buildTimeline(messages, backgroundTasks)
  const displayTimeline = timeline.length > 8 ? timeline.slice(-8) : timeline
  const hiddenCount = timeline.length - displayTimeline.length
  const showTraceView = spans.length > 0

  return (
    <div>
      {/* Controls bar — connected card top section */}
      <div
        className={`space-y-3 border border-t-0 border-white/10 bg-white/[0.02] px-4 py-3 ${showTraceView ? '' : 'rounded-b-lg'}`}
      >
        {/* Status indicator */}
        <div className="flex items-center gap-3 text-xs">
          {isActive ? (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              Live
            </span>
          ) : (
            <span className="text-muted-foreground">Run finished</span>
          )}
          {job.started_at && <ElapsedTime startedAt={job.started_at} />}
          <span className="text-muted-foreground">
            {messages.length} message{messages.length !== 1 ? 's' : ''}
          </span>
          {backgroundTasks.length > 0 && (
            <span className="text-muted-foreground">
              {backgroundTasks.length} bg task{backgroundTasks.length !== 1 ? 's' : ''}
              {activeTaskCount > 0 ? ` (${activeTaskCount} active)` : ''}
            </span>
          )}
          {runControl?.controlState && runControl.controlState !== 'normal' && (
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
              {runControl.controlState.replace('_', ' ')}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isPaused ? (
            <button
              className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
              onClick={() => pauseRun.mutate({ jobId })}
              disabled={pauseRun.isPending || cancelRun.isPending || job.status !== 'RUNNING'}
            >
              {pauseRun.isPending ? 'Pausing...' : 'Pause Run'}
            </button>
          ) : (
            <button
              className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
              onClick={() => resumeRun.mutate({ jobId })}
              disabled={resumeRun.isPending || cancelRun.isPending}
            >
              {resumeRun.isPending ? 'Resuming...' : 'Resume Run'}
            </button>
          )}
          <button
            className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/20 disabled:opacity-50"
            onClick={() => {
              const confirmed = window.confirm(
                'Cancel this run? This will stop further processing for this lane.'
              )
              if (!confirmed) return
              cancelRun.mutate({ jobId })
            }}
            disabled={
              cancelRun.isPending ||
              job.status === 'COMPLETED' ||
              job.status === 'FAILED' ||
              job.status === 'CANCELLED'
            }
          >
            {cancelRun.isPending ? 'Cancelling...' : 'Cancel Run'}
          </button>
        </div>

        <RunTodoPanel todoState={job.todo_state} />

        {/* Inline message timeline (before trace view is available) */}
        {!showTraceView &&
          (timeline.length > 0 ? (
            <div className="space-y-2">
              {hiddenCount > 0 && (
                <p className="text-center text-[10px] text-muted-foreground">
                  ...{hiddenCount} earlier item{hiddenCount !== 1 ? 's' : ''}
                </p>
              )}
              {displayTimeline.map((item) => {
                if (item.kind === 'background_task') {
                  return <LiveBackgroundTaskCard key={`bg-${item.task.id}`} task={item.task} />
                }

                const msg = item.message
                const { text, reasoning, toolCallSummary } = parseLiveMessagePreview(msg.content)

                const roleColors: Record<string, string> = {
                  user: 'text-sky-400',
                  assistant: 'text-emerald-400',
                  tool: 'text-amber-400',
                  system: 'text-purple-400',
                }

                return (
                  <div key={msg.id} className="flex gap-2 text-xs">
                    <span
                      className={`shrink-0 font-medium uppercase ${roleColors[msg.role] ?? 'text-muted-foreground'}`}
                    >
                      {msg.role}
                    </span>
                    <span className="line-clamp-3 text-foreground/80">
                      {text || reasoning || toolCallSummary || '(no content)'}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isActive ? 'Waiting for agent output...' : 'No activity recorded for this run.'}
            </p>
          ))}
      </div>

      {/* Trace view — sits flush below controls with its own border */}
      {showTraceView && (
        <TraceView
          spans={spans}
          messages={messages}
          inferenceCalls={inferenceCalls ?? []}
          runStatus={job.status}
          backgroundTasks={backgroundTasks}
        />
      )}
    </div>
  )
}
