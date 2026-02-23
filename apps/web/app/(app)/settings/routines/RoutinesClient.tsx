'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'
import {
  IconClock,
  IconBolt,
  IconEye,
  IconRocket,
  IconCalendarEvent,
  IconInfoCircle,
} from '@tabler/icons-react'
import { describeCron } from './cron-describe'

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type TriggerKind = 'cron' | 'event' | 'condition' | 'oneshot'

const TRIGGER_KIND_META: Record<
  TriggerKind,
  { label: string; description: string; Icon: typeof IconClock }
> = {
  cron: {
    label: 'Scheduled',
    description: 'Runs on a time-based schedule.',
    Icon: IconClock,
  },
  event: {
    label: 'On Event',
    description: 'Fires when a matching event arrives.',
    Icon: IconBolt,
  },
  condition: {
    label: 'Condition Check',
    description: 'Scheduled check that only fires when a probe condition is met.',
    Icon: IconEye,
  },
  oneshot: {
    label: 'One-Time',
    description: 'Fires once, then auto-disables.',
    Icon: IconRocket,
  },
}

const ENVELOPE_FIELDS = [
  'eventId',
  'source',
  'eventType',
  'sourceRef',
  'sessionKey',
  'pluginInstanceId',
  'actorKind',
  'actorHandle',
  'status',
  'title',
  'createdAt',
] as const

const ENVELOPE_FIELD_META: Record<string, { label: string; hint: string; examples: string }> = {
  eventId: { label: 'Event ID', hint: 'Unique identifier for the event.', examples: 'uuid' },
  source: {
    label: 'Source Platform',
    hint: 'The platform that produced this event.',
    examples: 'telegram, github',
  },
  eventType: {
    label: 'Event Type',
    hint: 'What kind of event happened.',
    examples: 'message, issue_comment, check_run',
  },
  sourceRef: {
    label: 'Source Reference',
    hint: 'Platform-specific reference ID.',
    examples: 'chat:12345, owner/repo#42',
  },
  sessionKey: {
    label: 'Session Key',
    hint: 'Session that generated the event.',
    examples: 'telegram:12345, github:owner/repo#1',
  },
  pluginInstanceId: {
    label: 'Plugin Instance',
    hint: 'Which plugin instance received this event.',
    examples: 'uuid',
  },
  actorKind: {
    label: 'Actor Kind',
    hint: 'Whether the actor is a user, bot, or system.',
    examples: 'user, bot, system',
  },
  actorHandle: {
    label: 'Actor Handle',
    hint: 'Username or handle of the actor.',
    examples: '@johndoe, octocat',
  },
  status: {
    label: 'Status',
    hint: 'Current status of the work item.',
    examples: 'NEW, IN_PROGRESS, COMPLETED',
  },
  title: {
    label: 'Title',
    hint: 'Title of the work item.',
    examples: 'Fix login bug, Deploy v2',
  },
  createdAt: {
    label: 'Created At',
    hint: 'Unix timestamp when the event was created.',
    examples: '1700000000',
  },
}

const RULE_OPERATORS = ['eq', 'neq', 'contains', 'in', 'exists', 'matches'] as const

const OPERATOR_META: Record<string, { label: string; hint: string }> = {
  eq: { label: 'equals', hint: 'Exact match.' },
  neq: { label: 'does not equal', hint: 'Anything except an exact match.' },
  contains: { label: 'contains', hint: 'Value includes this substring.' },
  in: { label: 'is one of', hint: 'Value matches any item in a comma-separated list.' },
  exists: { label: 'exists', hint: 'Field is present (value is ignored).' },
  matches: { label: 'matches regex', hint: 'Value matches a regular expression.' },
}

const PROBE_META: Record<string, { label: string; description: string }> = {
  github_stale_prs: {
    label: 'Stale Pull Requests',
    description: 'Detects PRs that have been open beyond a threshold.',
  },
  github_dependency_alerts: {
    label: 'Dependency Alerts',
    description: 'Checks for open Dependabot or security alerts.',
  },
  ci_failure_rate: {
    label: 'CI Failure Rate',
    description: 'Monitors CI pipeline failure rate over a window.',
  },
}

const DEFAULT_RULE_JSON = JSON.stringify(
  {
    field: 'eventType',
    op: 'eq',
    value: 'message',
  },
  null,
  2
)

const DEFAULT_FORM = {
  routineId: '',
  name: '',
  description: '',
  agentId: '',
  triggerKind: 'event' as TriggerKind,
  cronExpr: '*/15 * * * *',
  timezone: 'UTC',
  ruleJsonText: DEFAULT_RULE_JSON,
  conditionProbe: '',
  conditionConfigText: '',
  targetPluginInstanceId: '',
  targetSessionKey: '',
  targetResponseContextText: '',
  actionPrompt: '',
  enabled: true,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonOrThrow(text: string, fallback: unknown): unknown {
  const trimmed = text.trim()
  if (!trimmed) return fallback
  return JSON.parse(trimmed)
}

function stringifySafe(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Try to parse a rule JSON string into a single predicate {field, op, value}. */
function tryParseSinglePredicate(
  text: string
): { field: string; op: string; value: string } | null {
  try {
    const parsed: unknown = JSON.parse(text.trim())
    if (!isRecord(parsed)) return null
    if ('all' in parsed || 'any' in parsed || 'not' in parsed) return null

    const { field, op, value } = parsed
    if (typeof field !== 'string' || typeof op !== 'string') return null

    const valueText =
      value == null
        ? ''
        : typeof value === 'string'
          ? value
          : typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : JSON.stringify(value)

    return {
      field,
      op,
      value: valueText,
    }
  } catch {
    // not valid JSON
  }
  return null
}

/** Parse a session key into a human-readable label. */
function formatSessionKeyLabel(sessionKey: string): string {
  // telegram:123456789
  const telegramSimple = sessionKey.match(/^telegram:(\d+)$/)
  if (telegramSimple) return `Telegram Chat ${telegramSimple[1]}`

  // telegram:123456789:thread:42
  const telegramThread = sessionKey.match(/^telegram:(\d+):thread:(\d+)$/)
  if (telegramThread) return `Telegram Thread ${telegramThread[2]} (Chat ${telegramThread[1]})`

  // github:owner/repo#123
  const githubIssue = sessionKey.match(/^github:([^#]+)#(\d+)$/)
  if (githubIssue) return `GitHub ${githubIssue[1]} #${githubIssue[2]}`

  // github:owner/repo
  const githubRepo = sessionKey.match(/^github:([^#]+)$/)
  if (githubRepo) return `GitHub ${githubRepo[1]}`

  return sessionKey
}

/** Derive response context JSON from a session key. */
function deriveResponseContextFromSessionKey(sessionKey: string): string {
  const telegramThread = sessionKey.match(/^telegram:(-?\d+):thread:(\d+)$/)
  if (telegramThread) {
    return JSON.stringify(
      { chatId: Number(telegramThread[1]), messageThreadId: Number(telegramThread[2]) },
      null,
      2
    )
  }

  const telegramSimple = sessionKey.match(/^telegram:(-?\d+)$/)
  if (telegramSimple) {
    return JSON.stringify({ chatId: Number(telegramSimple[1]) }, null, 2)
  }

  const githubIssue = sessionKey.match(/^github:([^/]+)\/([^#]+)#(\d+)$/)
  if (githubIssue) {
    return JSON.stringify(
      { owner: githubIssue[1], repo: githubIssue[2], issueNumber: Number(githubIssue[3]) },
      null,
      2
    )
  }

  return ''
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TriggerBadge({ kind, cronExpr }: { kind: string; cronExpr?: string | null }) {
  switch (kind) {
    case 'cron': {
      const desc = describeCron(cronExpr)
      return (
        <Badge variant="secondary" className="gap-1">
          <IconClock className="size-3" />
          {desc ?? 'cron'}
        </Badge>
      )
    }
    case 'event':
      return (
        <Badge variant="outline" className="gap-1 border-amber-500/30 text-amber-400">
          <IconBolt className="size-3" />
          event
        </Badge>
      )
    case 'condition':
      return (
        <Badge variant="outline" className="gap-1 border-sky-500/30 text-sky-400">
          <IconEye className="size-3" />
          condition
        </Badge>
      )
    case 'oneshot':
      return (
        <Badge variant="outline" className="gap-1 border-violet-500/30 text-violet-400">
          <IconRocket className="size-3" />
          oneshot
        </Badge>
      )
    default:
      return <Badge variant="outline">{kind}</Badge>
  }
}

function LabelWithHint({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label>{label}</Label>
      <Tooltip>
        <TooltipTrigger className="cursor-default text-muted-foreground">
          <IconInfoCircle className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {hint}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function TriggerKindPicker({
  value,
  onChange,
}: {
  value: TriggerKind
  onChange: (kind: TriggerKind) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {(
        Object.entries(TRIGGER_KIND_META) as [
          TriggerKind,
          (typeof TRIGGER_KIND_META)[TriggerKind],
        ][]
      ).map(([kind, meta]) => {
        const selected = value === kind
        return (
          <button
            key={kind}
            type="button"
            className={cn(
              'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
              selected
                ? 'border-primary bg-primary/5'
                : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'
            )}
            onClick={() => onChange(kind)}
          >
            <meta.Icon
              className={cn(
                'mt-0.5 size-4 shrink-0',
                selected ? 'text-primary' : 'text-muted-foreground'
              )}
            />
            <div className="min-w-0">
              <div
                className={cn(
                  'text-sm font-medium',
                  selected ? 'text-foreground' : 'text-foreground/80'
                )}
              >
                {meta.label}
              </div>
              <div className="text-xs text-muted-foreground">{meta.description}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function SimpleRuleBuilder({
  field,
  op,
  value,
  onChange,
}: {
  field: string
  op: string
  value: string
  onChange: (f: string, o: string, v: string) => void
}) {
  const fieldMeta = ENVELOPE_FIELD_META[field]
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Fire when the incoming event matches this condition:
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Field</Label>
          <Select value={field} onValueChange={(v) => onChange(v ?? field, op, value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select field" />
            </SelectTrigger>
            <SelectContent>
              {ENVELOPE_FIELDS.map((f) => {
                const meta = ENVELOPE_FIELD_META[f]
                return (
                  <SelectItem key={f} value={f}>
                    {meta?.label ?? f}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Operator</Label>
          <Select value={op} onValueChange={(v) => onChange(field, v ?? op, value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RULE_OPERATORS.map((o) => {
                const meta = OPERATOR_META[o]
                return (
                  <SelectItem key={o} value={o}>
                    {meta?.label ?? o}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Value</Label>
          <Input
            value={value}
            onChange={(e) => onChange(field, op, e.target.value)}
            placeholder={op === 'exists' ? '(ignored)' : (fieldMeta?.examples ?? 'value')}
            disabled={op === 'exists'}
          />
        </div>
      </div>
    </div>
  )
}

function RuleSchemaReference() {
  return (
    <Accordion>
      <AccordionItem>
        <AccordionTrigger>Rule syntax reference</AccordionTrigger>
        <AccordionContent>
          <div className="space-y-3">
            <div>
              <p className="mb-1 font-medium">Single predicate</p>
              <code className="block rounded bg-white/5 p-2 text-[11px]">
                {'{ "field": "eventType", "op": "eq", "value": "message" }'}
              </code>
            </div>
            <div>
              <p className="mb-1 font-medium">Compound rules</p>
              <code className="block rounded bg-white/5 p-2 text-[11px]">
                {'{ "all": [ ...predicates ] }'}
                <br />
                {'{ "any": [ ...predicates ] }'}
                <br />
                {'{ "not": predicate }'}
              </code>
            </div>
            <div>
              <p className="mb-1 font-medium">Available fields</p>
              <div className="grid gap-1">
                {ENVELOPE_FIELDS.map((f) => {
                  const meta = ENVELOPE_FIELD_META[f]
                  return (
                    <div key={f} className="flex gap-2">
                      <code className="shrink-0 text-[11px] text-primary/80">{f}</code>
                      <span className="text-muted-foreground">{meta?.hint}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div>
              <p className="mb-1 font-medium">Operators</p>
              <div className="grid gap-1">
                {RULE_OPERATORS.map((o) => {
                  const meta = OPERATOR_META[o]
                  return (
                    <div key={o} className="flex gap-2">
                      <code className="shrink-0 text-[11px] text-primary/80">{o}</code>
                      <span className="text-muted-foreground">
                        {meta?.label} &mdash; {meta?.hint}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RoutinesClient() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [routineToArchive, setRoutineToArchive] = useState<{
    id: string
    name: string
  } | null>(null)

  // Rule builder state
  const [ruleMode, setRuleMode] = useState<'simple' | 'json'>('simple')
  const [simpleField, setSimpleField] = useState('eventType')
  const [simpleOp, setSimpleOp] = useState('eq')
  const [simpleValue, setSimpleValue] = useState('message')

  // Response context disclosure
  const [showResponseContextEditor, setShowResponseContextEditor] = useState(false)

  const utils = trpc.useUtils()
  const routinesQuery = trpc.routines.list.useQuery({ includeArchived: false })
  const agentsQuery = trpc.org.listAgents.useQuery()
  const targetsQuery = trpc.routines.listTargets.useQuery(
    { agentId: form.agentId || '__none__' },
    { enabled: Boolean(form.agentId) }
  )
  const runsQuery = trpc.routines.listRuns.useQuery(
    { routineId: selectedRoutineId ?? '', limit: 50, offset: 0 },
    { enabled: Boolean(selectedRoutineId) }
  )

  const createMutation = trpc.routines.create.useMutation({
    onSuccess: async () => {
      toast.success('Routine created')
      await utils.routines.list.invalidate()
      setIsModalOpen(false)
      setForm(DEFAULT_FORM)
      setErrorMessage(null)
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const updateMutation = trpc.routines.update.useMutation({
    onSuccess: async () => {
      toast.success('Routine updated')
      await utils.routines.list.invalidate()
      if (selectedRoutineId) {
        await utils.routines.listRuns.invalidate({
          routineId: selectedRoutineId,
          limit: 50,
          offset: 0,
        })
      }
      setIsModalOpen(false)
      setForm(DEFAULT_FORM)
      setErrorMessage(null)
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  const setEnabledMutation = trpc.routines.setEnabled.useMutation({
    onSuccess: async () => {
      await utils.routines.list.invalidate()
    },
  })

  const archiveMutation = trpc.routines.archive.useMutation({
    onSuccess: async () => {
      toast.success('Routine archived')
      await utils.routines.list.invalidate()
      if (selectedRoutineId) {
        await utils.routines.listRuns.invalidate({
          routineId: selectedRoutineId,
          limit: 50,
          offset: 0,
        })
      }
      setRoutineToArchive(null)
    },
    onError: (err) => {
      toast.error(err.message)
      setRoutineToArchive(null)
    },
  })

  const runNowMutation = trpc.routines.runNow.useMutation({
    onSuccess: async () => {
      toast.success('Routine queued')
      await utils.routines.list.invalidate()
      if (selectedRoutineId) {
        await utils.routines.listRuns.invalidate({
          routineId: selectedRoutineId,
          limit: 50,
          offset: 0,
        })
      }
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  // Fix 1: Resolve selected agent for display
  const selectedAgent = useMemo(() => {
    if (!form.agentId) return null
    return (agentsQuery.data ?? []).find((a) => a.id === form.agentId) ?? null
  }, [form.agentId, agentsQuery.data])

  const pluginTargetsForAgent = useMemo(() => {
    return targetsQuery.data ?? []
  }, [targetsQuery.data])

  const sessionsForSelectedPluginTarget = useMemo(() => {
    return (
      pluginTargetsForAgent.find((entry) => entry.pluginInstanceId === form.targetPluginInstanceId)
        ?.sessions ?? []
    )
  }, [pluginTargetsForAgent, form.targetPluginInstanceId])

  const openCreateModal = () => {
    setIsEditing(false)
    setForm(DEFAULT_FORM)
    setErrorMessage(null)
    setRuleMode('simple')
    setSimpleField('eventType')
    setSimpleOp('eq')
    setSimpleValue('message')
    setShowResponseContextEditor(false)
    setIsModalOpen(true)
  }

  const openEditModal = (routine: NonNullable<typeof routinesQuery.data>[number]) => {
    setIsEditing(true)
    const ruleText = stringifySafe(routine.ruleJson)
    setForm({
      routineId: routine.id,
      name: routine.name,
      description: routine.description ?? '',
      agentId: routine.agent_id,
      triggerKind: routine.trigger_kind as TriggerKind,
      cronExpr: routine.cron_expr ?? '',
      timezone: routine.timezone ?? 'UTC',
      ruleJsonText: ruleText,
      conditionProbe: routine.condition_probe ?? '',
      conditionConfigText: stringifySafe(routine.conditionConfig),
      targetPluginInstanceId: routine.target_plugin_instance_id,
      targetSessionKey: routine.target_session_key,
      targetResponseContextText: stringifySafe(routine.targetResponseContext),
      actionPrompt: routine.action_prompt,
      enabled: routine.enabled,
    })
    setErrorMessage(null)
    setShowResponseContextEditor(false)

    // Auto-detect simple vs JSON mode for event triggers
    if (routine.trigger_kind === 'event') {
      const predicate = tryParseSinglePredicate(ruleText)
      if (predicate) {
        setRuleMode('simple')
        setSimpleField(predicate.field)
        setSimpleOp(predicate.op)
        setSimpleValue(predicate.value)
      } else {
        setRuleMode('json')
      }
    } else {
      setRuleMode('json')
    }

    setIsModalOpen(true)
  }

  const handleRuleModeSwitch = (mode: 'simple' | 'json') => {
    if (mode === 'json' && ruleMode === 'simple') {
      // Serialize simple fields into JSON
      const obj = { field: simpleField, op: simpleOp, value: simpleValue }
      setForm((prev) => ({ ...prev, ruleJsonText: JSON.stringify(obj, null, 2) }))
    } else if (mode === 'simple' && ruleMode === 'json') {
      // Try to parse JSON into simple fields
      const predicate = tryParseSinglePredicate(form.ruleJsonText)
      if (predicate) {
        setSimpleField(predicate.field)
        setSimpleOp(predicate.op)
        setSimpleValue(predicate.value)
      }
    }
    setRuleMode(mode)
  }

  const handleSessionKeyChange = (sessionKey: string | null) => {
    if (!sessionKey) return
    const derived = deriveResponseContextFromSessionKey(sessionKey)
    setForm((prev) => ({
      ...prev,
      targetSessionKey: sessionKey,
      targetResponseContextText: derived || prev.targetResponseContextText,
    }))
  }

  const submitForm = async () => {
    try {
      setErrorMessage(null)

      // If in simple mode for event triggers, serialize before submit
      let ruleText = form.ruleJsonText
      if (form.triggerKind === 'event' && ruleMode === 'simple') {
        ruleText = JSON.stringify({ field: simpleField, op: simpleOp, value: simpleValue })
      }

      const ruleJson = parseJsonOrThrow(ruleText, {})
      const conditionConfig = parseJsonOrThrow(form.conditionConfigText, null)
      const targetResponseContext = parseJsonOrThrow(form.targetResponseContextText, null)

      const payload = {
        name: form.name,
        description: form.description || undefined,
        agentId: form.agentId,
        triggerKind: form.triggerKind,
        cronExpr: form.cronExpr || undefined,
        timezone: form.timezone || undefined,
        ruleJson,
        conditionProbe: form.conditionProbe || undefined,
        conditionConfig,
        targetPluginInstanceId: form.targetPluginInstanceId,
        targetSessionKey: form.targetSessionKey,
        targetResponseContext,
        actionPrompt: form.actionPrompt,
        enabled: form.enabled,
      }

      if (isEditing) {
        await updateMutation.mutateAsync({
          routineId: form.routineId,
          patch: payload,
        })
      } else {
        await createMutation.mutateAsync(payload)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save routine')
    }
  }

  const routines = routinesQuery.data ?? []

  // Resolve selectedRoutine from the list
  const selectedRoutineName = routines.find((r) => r.id === selectedRoutineId)?.name ?? null

  // Derive a summary line for the response context
  const responseContextSummary = useMemo(() => {
    if (!form.targetSessionKey) return null
    return formatSessionKeyLabel(form.targetSessionKey)
  }, [form.targetSessionKey])

  return (
    <div className="space-y-6">
      {/* -- Routine Catalog ---------------------------------------- */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Routine Catalog</CardTitle>
          <CardDescription>
            Cron, event, and condition routines with explicit delivery targets.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {routines.length === 0 ? (
            <Empty className="py-12">
              <EmptyMedia variant="icon">
                <IconCalendarEvent />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>No routines yet</EmptyTitle>
                <EmptyDescription>
                  Routines fire on a schedule, event, or condition and deliver an action prompt to
                  an agent. Create one to get started.
                </EmptyDescription>
              </EmptyHeader>
              <Button onClick={openCreateModal}>Create Routine</Button>
            </Empty>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {routines.length} active routine{routines.length !== 1 ? 's' : ''}
                </p>
                <Button onClick={openCreateModal}>Create Routine</Button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/10 bg-white/[0.02] text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Agent</th>
                      <th className="px-3 py-2">Trigger</th>
                      <th className="px-3 py-2">Next Run</th>
                      <th className="px-3 py-2">Last Status</th>
                      <th className="px-3 py-2">Enabled</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routines.map((routine) => {
                      const isSelected = routine.id === selectedRoutineId
                      return (
                        <tr
                          key={routine.id}
                          className={cn(
                            'cursor-pointer border-b border-white/5 transition-colors hover:bg-white/[0.03]',
                            isSelected && 'border-l-2 border-l-primary bg-primary/5'
                          )}
                          onClick={() => setSelectedRoutineId(isSelected ? null : routine.id)}
                        >
                          <td className="px-3 py-2">
                            <div className="font-medium text-foreground">{routine.name}</div>
                            <div className="text-xs text-muted-foreground">{routine.id}</div>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {routine.agentName ?? routine.agent_id}
                          </td>
                          <td className="px-3 py-2">
                            <TriggerBadge
                              kind={routine.trigger_kind}
                              cronExpr={routine.cron_expr}
                            />
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {routine.next_run_at ? (
                              <RelativeTime timestamp={routine.next_run_at} />
                            ) : (
                              <span className="text-muted-foreground/50">&mdash;</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {routine.last_status ?? 'n/a'}
                          </td>
                          <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                            <Switch
                              checked={routine.enabled}
                              onCheckedChange={(enabled) =>
                                setEnabledMutation.mutate({ routineId: routine.id, enabled })
                              }
                              disabled={setEnabledMutation.isPending}
                            />
                          </td>
                          <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openEditModal(routine)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={runNowMutation.isPending}
                                onClick={() => runNowMutation.mutate({ routineId: routine.id })}
                              >
                                {runNowMutation.isPending ? 'Queuing…' : 'Run Now'}
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={archiveMutation.isPending}
                                onClick={() =>
                                  setRoutineToArchive({ id: routine.id, name: routine.name })
                                }
                              >
                                Archive
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* -- Run Receipts ------------------------------------------- */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Run Receipts</CardTitle>
          <CardDescription>
            {selectedRoutineName
              ? `Decisions and queued receipts for "${selectedRoutineName}".`
              : 'Select a routine to inspect run history.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {selectedRoutineId ? (
            <div className="space-y-2">
              {(runsQuery.data ?? []).map((run) => (
                <div
                  key={run.id}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-foreground">{run.decision}</div>
                    <div className="text-muted-foreground">
                      {run.evaluated_at ? <RelativeTime timestamp={run.evaluated_at} /> : 'n/a'}
                    </div>
                  </div>
                  <div className="mt-1 text-muted-foreground">origin: {run.trigger_origin}</div>
                  {run.decision_reason ? (
                    <div className="mt-1 text-muted-foreground">reason: {run.decision_reason}</div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {run.work_item_id ? (
                      <Link
                        href={`/work-items/${run.work_item_id}`}
                        className="text-primary hover:underline"
                      >
                        Work Item {run.work_item_id}
                      </Link>
                    ) : null}
                    {run.scheduled_item_id ? (
                      <span className="text-muted-foreground">
                        Scheduled Item {run.scheduled_item_id}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
              {runsQuery.data?.length === 0 ? (
                <Empty className="py-8">
                  <EmptyHeader>
                    <EmptyTitle>No receipts yet</EmptyTitle>
                    <EmptyDescription>
                      This routine hasn&apos;t fired yet. Use &quot;Run Now&quot; to trigger a
                      manual run.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Select a routine to inspect run history.
            </p>
          )}
        </CardContent>
      </Card>

      {/* -- Archive Confirmation Dialog ----------------------------- */}
      <AlertDialog
        open={routineToArchive !== null}
        onOpenChange={(open) => {
          if (!open) setRoutineToArchive(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive routine?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive &quot;{routineToArchive?.name}&quot;. It will stop running and be
              hidden from the catalog. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={archiveMutation.isPending}
              onClick={() => {
                if (routineToArchive) {
                  archiveMutation.mutate({ routineId: routineToArchive.id })
                }
              }}
            >
              {archiveMutation.isPending ? 'Archiving…' : 'Archive'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* -- Create / Edit Dialog ----------------------------------- */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Routine' : 'Create Routine'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update trigger, delivery target, and instructions.'
                : 'Set up when this routine fires, where it delivers, and what to do.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* --- Section: Basics ---------------------------------- */}
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Basics
              </legend>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Stale PR Reminder"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Agent</Label>
                  <Select
                    value={form.agentId}
                    onValueChange={(value) =>
                      setForm({
                        ...form,
                        agentId: value ?? '',
                        targetPluginInstanceId: '',
                        targetSessionKey: '',
                      })
                    }
                  >
                    <SelectTrigger>
                      {selectedAgent ? (
                        <span>
                          {selectedAgent.name} (@{selectedAgent.handle})
                        </span>
                      ) : (
                        <SelectValue placeholder="Select agent" />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {(agentsQuery.data ?? []).map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name} (@{agent.handle})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional description of what this routine does"
                />
              </div>
            </fieldset>

            <hr className="border-white/10" />

            {/* --- Section: When to Fire ---------------------------- */}
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                When to Fire
              </legend>

              <div className="space-y-2">
                <TriggerKindPicker
                  value={form.triggerKind}
                  onChange={(kind) => {
                    setForm({ ...form, triggerKind: kind })
                    if (kind === 'event') {
                      setRuleMode('simple')
                    } else {
                      setRuleMode('json')
                    }
                  }}
                />
              </div>

              {(form.triggerKind === 'cron' || form.triggerKind === 'condition') && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <LabelWithHint
                      label="Cron Expression"
                      hint="Standard 5-field cron: minute hour day-of-month month day-of-week."
                    />
                    <Input
                      value={form.cronExpr}
                      onChange={(e) => setForm({ ...form, cronExpr: e.target.value })}
                      placeholder="*/15 * * * *"
                    />
                    {form.cronExpr && (
                      <p className="text-xs text-muted-foreground">
                        {describeCron(form.cronExpr) ?? form.cronExpr}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Timezone (IANA)</Label>
                    <Input
                      value={form.timezone}
                      onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                      placeholder="UTC"
                    />
                  </div>
                </div>
              )}

              {form.triggerKind === 'condition' && (
                <>
                  <div className="space-y-2">
                    <Label>Condition Probe</Label>
                    <Select
                      value={form.conditionProbe}
                      onValueChange={(value) => setForm({ ...form, conditionProbe: value ?? '' })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select probe" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PROBE_META).map(([key, meta]) => (
                          <SelectItem key={key} value={key}>
                            <div>
                              <div>{meta.label}</div>
                              <div className="text-xs text-muted-foreground">
                                {meta.description}
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Condition Config (JSON)</Label>
                    <Textarea
                      rows={5}
                      value={form.conditionConfigText}
                      onChange={(e) => setForm({ ...form, conditionConfigText: e.target.value })}
                      placeholder='{"repoFullName":"owner/repo","thresholdDays":7}'
                    />
                  </div>
                </>
              )}

              {/* --- Rule builder ----------------------------------- */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <LabelWithHint
                    label="Rule"
                    hint="A predicate tested against each event envelope. Single predicates use {field, op, value}. Compound rules use {all: [...]}, {any: [...]}, or {not: {...}}."
                  />
                  {form.triggerKind === 'event' && (
                    <div className="flex gap-1 rounded-md border border-white/10 p-0.5 text-xs">
                      <button
                        type="button"
                        className={cn(
                          'rounded px-2 py-0.5 transition-colors',
                          ruleMode === 'simple'
                            ? 'bg-white/10 text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                        onClick={() => handleRuleModeSwitch('simple')}
                      >
                        Simple
                      </button>
                      <button
                        type="button"
                        className={cn(
                          'rounded px-2 py-0.5 transition-colors',
                          ruleMode === 'json'
                            ? 'bg-white/10 text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                        onClick={() => handleRuleModeSwitch('json')}
                      >
                        JSON
                      </button>
                    </div>
                  )}
                </div>

                {form.triggerKind === 'event' && ruleMode === 'simple' ? (
                  <SimpleRuleBuilder
                    field={simpleField}
                    op={simpleOp}
                    value={simpleValue}
                    onChange={(f, o, v) => {
                      setSimpleField(f)
                      setSimpleOp(o)
                      setSimpleValue(v)
                    }}
                  />
                ) : (
                  <div className="space-y-2">
                    <Textarea
                      rows={6}
                      value={form.ruleJsonText}
                      onChange={(e) => setForm({ ...form, ruleJsonText: e.target.value })}
                      className="font-mono text-xs"
                    />
                    <RuleSchemaReference />
                  </div>
                )}
              </div>
            </fieldset>

            <hr className="border-white/10" />

            {/* --- Section: Where & What ---------------------------- */}
            <fieldset className="space-y-4">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Where &amp; What
              </legend>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Destination</Label>
                  <Select
                    value={form.targetPluginInstanceId}
                    onValueChange={(value) =>
                      setForm({ ...form, targetPluginInstanceId: value ?? '' })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select plugin instance" />
                    </SelectTrigger>
                    <SelectContent>
                      {pluginTargetsForAgent.map((target) => (
                        <SelectItem key={target.pluginInstanceId} value={target.pluginInstanceId}>
                          {target.pluginInstanceName ?? target.integrationName} (
                          {target.pluginInstanceType ?? target.integrationType})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Channel</Label>
                  <Select value={form.targetSessionKey} onValueChange={handleSessionKeyChange}>
                    <SelectTrigger>
                      {form.targetSessionKey ? (
                        <span>{formatSessionKeyLabel(form.targetSessionKey)}</span>
                      ) : (
                        <SelectValue placeholder="Select channel" />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {sessionsForSelectedPluginTarget.map((session) => (
                        <SelectItem key={session.sessionKey} value={session.sessionKey}>
                          <div>
                            <div>{formatSessionKeyLabel(session.sessionKey)}</div>
                            {session.title && (
                              <div className="text-xs text-muted-foreground">{session.title}</div>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Delivery Context — progressive disclosure */}
              <div className="space-y-2">
                <LabelWithHint
                  label="Delivery Context"
                  hint="Platform-specific metadata for delivering the response (e.g. thread IDs, reply targets). Auto-filled from channel selection."
                />
                {!showResponseContextEditor ? (
                  <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {responseContextSummary
                        ? responseContextSummary
                        : 'Select a channel to auto-fill.'}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setShowResponseContextEditor(true)}
                    >
                      Edit manually
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Textarea
                      rows={4}
                      value={form.targetResponseContextText}
                      onChange={(e) =>
                        setForm({ ...form, targetResponseContextText: e.target.value })
                      }
                      className="font-mono text-xs"
                    />
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowResponseContextEditor(false)}
                    >
                      Collapse
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <LabelWithHint
                  label="Instructions"
                  hint="The instruction sent to the agent when this routine fires. Be specific about what output you want and where it should go."
                />
                <Textarea
                  rows={4}
                  value={form.actionPrompt}
                  onChange={(e) => setForm({ ...form, actionPrompt: e.target.value })}
                  placeholder="e.g. Summarize all open PRs older than 7 days and post a reminder to the channel."
                />
              </div>
            </fieldset>

            {/* --- Active toggle (edit mode only) ------------------- */}
            {isEditing && (
              <>
                <hr className="border-white/10" />
                <div className="flex items-center justify-between rounded-lg border border-white/10 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">Active</div>
                    <div className="text-xs text-muted-foreground">
                      Pause this routine without archiving it.
                    </div>
                  </div>
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(enabled) => setForm({ ...form, enabled })}
                  />
                </div>
              </>
            )}

            {errorMessage ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {errorMessage}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={submitForm}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {isEditing ? 'Save Changes' : 'Create Routine'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
