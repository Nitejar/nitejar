'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { IconChevronDown, IconCpu, IconSettings } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ModelSelect, type ModelRecord } from '../../components/ModelSelect'

const TEMP_PRESETS = [
  { value: 0, label: 'Precise', description: 'Deterministic, best for code and structured output' },
  { value: 0.3, label: 'Focused', description: 'Slight variation, good for most tasks' },
  { value: 0.7, label: 'Balanced', description: 'Default — creative but grounded' },
  { value: 1.0, label: 'Creative', description: 'More varied and expressive responses' },
  { value: 1.5, label: 'Wild', description: 'Highly unpredictable, use with care' },
]

function getTemperatureLabel(temp: number): string {
  if (temp <= 0.1) return 'Precise'
  if (temp <= 0.4) return 'Focused'
  if (temp <= 0.8) return 'Balanced'
  if (temp <= 1.1) return 'Creative'
  return 'Wild'
}

interface ModelSectionProps {
  agentId: string
  initialModel: string | undefined
  initialTemperature: number | undefined
  initialMaxTokens: number | undefined
  initialEditToolMode: 'hashline' | 'replace' | undefined
  initialTriageMaxTokens: number | undefined
  initialTriageReasoningEffort: 'low' | 'medium' | 'high' | undefined
  initialTriageRecentHistoryMaxChars: number | undefined
  initialTriageRecentHistoryLookbackMessages: number | undefined
  initialTriageRecentHistoryPerMessageMaxChars: number | undefined
}

export function ModelSection({
  agentId,
  initialModel,
  initialTemperature,
  initialMaxTokens,
  initialEditToolMode,
  initialTriageMaxTokens,
  initialTriageReasoningEffort,
  initialTriageRecentHistoryMaxChars,
  initialTriageRecentHistoryLookbackMessages,
  initialTriageRecentHistoryPerMessageMaxChars,
}: ModelSectionProps) {
  const [model, setModel] = useState(initialModel || '')
  const [temperature, setTemperature] = useState(
    initialTemperature !== undefined ? String(initialTemperature) : '0.7'
  )
  const [maxTokens, setMaxTokens] = useState(
    initialMaxTokens !== undefined ? String(initialMaxTokens) : '4096'
  )
  const [editToolMode, setEditToolMode] = useState<'hashline' | 'replace'>(
    initialEditToolMode ?? 'hashline'
  )
  const [triageMaxTokens, setTriageMaxTokens] = useState(
    initialTriageMaxTokens !== undefined ? String(initialTriageMaxTokens) : '4000'
  )
  const [triageReasoningEffort, setTriageReasoningEffort] = useState<
    'default' | 'low' | 'medium' | 'high'
  >(initialTriageReasoningEffort ?? 'default')
  const [triageRecentHistoryMaxChars, setTriageRecentHistoryMaxChars] = useState(
    initialTriageRecentHistoryMaxChars !== undefined
      ? String(initialTriageRecentHistoryMaxChars)
      : '20000'
  )
  const [triageRecentHistoryLookbackMessages, setTriageRecentHistoryLookbackMessages] = useState(
    initialTriageRecentHistoryLookbackMessages !== undefined
      ? String(initialTriageRecentHistoryLookbackMessages)
      : '250'
  )
  const [triageRecentHistoryPerMessageMaxChars, setTriageRecentHistoryPerMessageMaxChars] =
    useState(
      initialTriageRecentHistoryPerMessageMaxChars !== undefined
        ? String(initialTriageRecentHistoryPerMessageMaxChars)
        : '500'
    )
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const modelsQuery = trpc.gateway.listModels.useQuery()
  const updateModel = trpc.org.updateAgentModel.useMutation()

  const fetchedModels = modelsQuery.data?.models
  const models = useMemo<ModelRecord[]>(() => fetchedModels ?? [], [fetchedModels])
  const selectedModel = useMemo(
    () => models.find((item) => item.externalId === model),
    [models, model]
  )

  const contextLength = useMemo(() => {
    const metadata = selectedModel?.metadata ?? {}
    return typeof metadata.contextLength === 'number' ? Math.floor(metadata.contextLength) : null
  }, [selectedModel])

  const supportsTools = useMemo(() => {
    const metadata = selectedModel?.metadata ?? {}
    return Boolean(metadata.supportsTools)
  }, [selectedModel])
  const supportsReasoningControl = useMemo(() => {
    const metadata = selectedModel?.metadata ?? {}
    return Boolean(metadata.supportsReasoningControl)
  }, [selectedModel])

  useEffect(() => {
    if (!contextLength) return
    const current = Number(maxTokens)
    if (!Number.isFinite(current)) return
    if (current > contextLength) {
      setMaxTokens(String(contextLength))
    }
  }, [contextLength, maxTokens])
  useEffect(() => {
    if (!contextLength) return
    const current = Number(triageMaxTokens)
    if (!Number.isFinite(current)) return
    if (current > contextLength) {
      setTriageMaxTokens(String(contextLength))
    }
  }, [contextLength, triageMaxTokens])
  useEffect(() => {
    if (!supportsReasoningControl) {
      setTriageReasoningEffort('default')
    }
  }, [supportsReasoningControl])

  const handleSave = useCallback(async () => {
    setMessage(null)

    const tempValue = parseFloat(temperature)
    if (isNaN(tempValue) || tempValue < 0 || tempValue > 2) {
      setMessage({ type: 'error', text: 'Temperature must be between 0 and 2' })
      return
    }

    const tokensValue = parseInt(maxTokens, 10)
    if (isNaN(tokensValue) || tokensValue < 1) {
      setMessage({ type: 'error', text: 'Max tokens must be a positive number' })
      return
    }
    const triageTokensValue = parseInt(triageMaxTokens, 10)
    if (isNaN(triageTokensValue) || triageTokensValue < 1) {
      setMessage({ type: 'error', text: 'Triage max tokens must be a positive number' })
      return
    }
    const triageRecentHistoryMaxCharsValue = parseInt(triageRecentHistoryMaxChars, 10)
    if (isNaN(triageRecentHistoryMaxCharsValue) || triageRecentHistoryMaxCharsValue < 500) {
      setMessage({ type: 'error', text: 'Triage history max chars must be at least 500' })
      return
    }
    const triageRecentHistoryLookbackMessagesValue = parseInt(
      triageRecentHistoryLookbackMessages,
      10
    )
    if (
      isNaN(triageRecentHistoryLookbackMessagesValue) ||
      triageRecentHistoryLookbackMessagesValue < 10
    ) {
      setMessage({ type: 'error', text: 'Triage history lookback messages must be at least 10' })
      return
    }
    const triageRecentHistoryPerMessageMaxCharsValue = parseInt(
      triageRecentHistoryPerMessageMaxChars,
      10
    )
    if (
      isNaN(triageRecentHistoryPerMessageMaxCharsValue) ||
      triageRecentHistoryPerMessageMaxCharsValue < 100
    ) {
      setMessage({
        type: 'error',
        text: 'Triage history per-message max chars must be at least 100',
      })
      return
    }

    if (contextLength && tokensValue > contextLength) {
      setMessage({
        type: 'error',
        text: `Max tokens cannot exceed ${contextLength.toLocaleString()}`,
      })
      return
    }
    if (contextLength && triageTokensValue > contextLength) {
      setMessage({
        type: 'error',
        text: `Triage max tokens cannot exceed ${contextLength.toLocaleString()}`,
      })
      return
    }

    if (!model.trim()) {
      setMessage({ type: 'error', text: 'Model is required' })
      return
    }

    try {
      await updateModel.mutateAsync({
        id: agentId,
        model: model.trim(),
        temperature: tempValue,
        maxTokens: tokensValue,
        editToolMode,
        triageMaxTokens: triageTokensValue,
        triageReasoningEffort:
          supportsReasoningControl && triageReasoningEffort !== 'default'
            ? triageReasoningEffort
            : 'default',
        triageRecentHistoryMaxChars: triageRecentHistoryMaxCharsValue,
        triageRecentHistoryLookbackMessages: triageRecentHistoryLookbackMessagesValue,
        triageRecentHistoryPerMessageMaxChars: triageRecentHistoryPerMessageMaxCharsValue,
      })

      setMessage({ type: 'success', text: 'Settings saved' })
      setTimeout(() => setMessage(null), 3000)
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings' })
    }
  }, [
    agentId,
    contextLength,
    editToolMode,
    maxTokens,
    model,
    supportsReasoningControl,
    temperature,
    triageMaxTokens,
    triageRecentHistoryLookbackMessages,
    triageRecentHistoryMaxChars,
    triageRecentHistoryPerMessageMaxChars,
    triageReasoningEffort,
    updateModel,
  ])

  const tempValue = parseFloat(temperature) || 0.7

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <IconCpu className="h-4 w-4 text-muted-foreground" />
          Model
        </CardTitle>
        <CardDescription className="text-xs">
          Which model this agent uses and how it generates responses.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Model Picker */}
        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <ModelSelect
            value={model}
            onChange={setModel}
            disabled={updateModel.isPending}
            id="model"
            models={models}
            isLoading={modelsQuery.isLoading}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {modelsQuery.isError ? (
              <span>Unable to load models. Check gateway settings.</span>
            ) : selectedModel ? (
              <>
                <span className="font-mono text-[10px]">{selectedModel.externalId}</span>
                {contextLength ? (
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px]">
                    {contextLength.toLocaleString()} ctx
                  </span>
                ) : null}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${supportsTools ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}
                >
                  {supportsTools ? 'tools supported' : 'no tool support'}
                </span>
              </>
            ) : (
              <span>Select from the model library.</span>
            )}
          </div>
        </div>

        {/* Temperature Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Temperature</Label>
            <span className="text-xs text-muted-foreground">
              {tempValue.toFixed(1)} · {getTemperatureLabel(tempValue)}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={tempValue}
            onChange={(e) => setTemperature(e.target.value)}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-primary [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            {TEMP_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setTemperature(String(preset.value))}
                className={`transition hover:text-foreground ${tempValue === preset.value ? 'text-primary' : ''}`}
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Lower values produce more consistent output. Higher values increase variety and
            creativity. Most tasks work well between 0.3 and 0.7.
          </p>
        </div>

        {/* Max Tokens */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="maxTokens">Response length limit</Label>
            <Input
              id="maxTokens"
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
              min="1"
              max={contextLength ? String(contextLength) : undefined}
              step="1"
              className="h-7 w-24 border-white/10 bg-white/5 text-center text-xs"
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Maximum tokens per response.
            {contextLength ? ` This model supports up to ${contextLength.toLocaleString()}.` : ''}
          </p>
        </div>

        {/* Edit Tool Mode */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="editToolMode">File editing strategy</Label>
            <Select
              value={editToolMode}
              onValueChange={(value) => setEditToolMode(value as 'hashline' | 'replace')}
            >
              <SelectTrigger id="editToolMode" className="h-7 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hashline">Hashline (recommended)</SelectItem>
                <SelectItem value="replace">String Replace</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-[10px] text-muted-foreground">
            How the agent edits files. Hashline is faster and more reliable for most models.
          </p>
        </div>

        {/* Advanced / Triage Settings */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <IconSettings className="h-3.5 w-3.5" />
          Triage tuning
          <span className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}>
            <IconChevronDown className="h-3 w-3" />
          </span>
        </button>

        {showAdvanced && (
          <div className="space-y-4 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="text-[10px] text-muted-foreground">
              Triage is the fast classifier that runs before each agent turn to decide if a message
              needs a response. These settings control how much conversation context it sees.
            </p>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-foreground">Context budget</Label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={triageRecentHistoryMaxChars}
                    onChange={(e) => setTriageRecentHistoryMaxChars(e.target.value)}
                    min="500"
                    step="100"
                    className="h-7 w-20 border-white/10 bg-white/5 text-center text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground">chars</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                How much recent conversation the triage classifier can read.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-foreground">Message lookback</Label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={triageRecentHistoryLookbackMessages}
                    onChange={(e) => setTriageRecentHistoryLookbackMessages(e.target.value)}
                    min="10"
                    step="10"
                    className="h-7 w-20 border-white/10 bg-white/5 text-center text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground">msgs</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                How many recent messages are scanned for context.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-foreground">Per-message limit</Label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={triageRecentHistoryPerMessageMaxChars}
                    onChange={(e) => setTriageRecentHistoryPerMessageMaxChars(e.target.value)}
                    min="100"
                    step="50"
                    className="h-7 w-20 border-white/10 bg-white/5 text-center text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground">chars</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Long messages are trimmed to this length before triage reads them.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-foreground">Response budget</Label>
                <Input
                  type="number"
                  value={triageMaxTokens}
                  onChange={(e) => setTriageMaxTokens(e.target.value)}
                  min="1"
                  max={contextLength ? String(contextLength) : undefined}
                  step="1"
                  className="h-7 border-white/10 bg-white/5 text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Max tokens for the triage response.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-foreground">Reasoning effort</Label>
                <Select
                  value={triageReasoningEffort}
                  onValueChange={(value) =>
                    setTriageReasoningEffort(value as 'default' | 'low' | 'medium' | 'high')
                  }
                  disabled={!supportsReasoningControl}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Model Default</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  {supportsReasoningControl
                    ? 'How hard triage thinks before deciding.'
                    : 'Not available for this model.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Save */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-xs font-medium text-primary transition hover:border-primary/60 hover:bg-primary/20"
            onClick={handleSave}
            disabled={updateModel.isPending}
          >
            {updateModel.isPending ? 'Saving...' : 'Save'}
          </button>

          {message && (
            <span
              className={`rounded-full px-3 py-1 text-[0.65rem] font-medium ${
                message.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-200'
                  : 'bg-destructive/10 text-destructive'
              }`}
            >
              {message.text}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
