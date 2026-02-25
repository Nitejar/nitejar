'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'
import {
  IconMicrophone,
  IconMusic,
  IconPhoto,
  IconTerminal2,
  IconWorldSearch,
} from '@tabler/icons-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const DEFAULT_COST_PER_CREDIT = 0.008
const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image-preview'
const DEFAULT_STT_MODEL = 'google/gemini-2.5-flash'
const DEFAULT_TTS_MODEL = 'tts-1'
const DEFAULT_TTS_COST_PER_1K_CHARS_USD = 0.015

const IMAGE_MODELS = [
  'google/gemini-2.5-flash-image-preview',
  'openai/gpt-5-image-mini',
  'openai/gpt-5-image',
  'black-forest-labs/flux.2-pro',
]

const STT_MODELS = ['google/gemini-2.5-flash', 'openai/gpt-4o-mini-transcribe']
const TTS_MODELS = ['tts-1', 'tts-1-hd']

function readStringConfig(config: Record<string, unknown> | null | undefined, key: string): string {
  if (!config) return ''
  const value = config[key]
  return typeof value === 'string' ? value : ''
}

export function CapabilitiesClient() {
  const gatewayQuery = trpc.gateway.getSettings.useQuery()
  const saveCapability = trpc.capabilitySettings.update.useMutation()

  const webQuery = trpc.capabilitySettings.get.useQuery({ id: 'web_search' })
  const toolExecutionQuery = trpc.capabilitySettings.get.useQuery({ id: 'tool_execution' })
  const imageQuery = trpc.capabilitySettings.get.useQuery({ id: 'image_generation' })
  const sttQuery = trpc.capabilitySettings.get.useQuery({ id: 'speech_to_text' })
  const ttsQuery = trpc.capabilitySettings.get.useQuery({ id: 'text_to_speech' })

  const [webApiKey, setWebApiKey] = useState('')
  const [webEnabled, setWebEnabled] = useState(true)
  const [webHasApiKey, setWebHasApiKey] = useState(false)
  const [webCostPerCredit, setWebCostPerCredit] = useState(DEFAULT_COST_PER_CREDIT)
  const [webStatus, setWebStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  )

  const [toolExecutionApiKey, setToolExecutionApiKey] = useState('')
  const [toolExecutionEnabled, setToolExecutionEnabled] = useState(true)
  const [toolExecutionHasApiKey, setToolExecutionHasApiKey] = useState(false)
  const [toolExecutionStatus, setToolExecutionStatus] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const [imageEnabled, setImageEnabled] = useState(true)
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL)
  const [imageStatus, setImageStatus] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const [sttEnabled, setSttEnabled] = useState(true)
  const [sttModel, setSttModel] = useState(DEFAULT_STT_MODEL)
  const [sttStatus, setSttStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  )

  const [ttsEnabled, setTtsEnabled] = useState(false)
  const [ttsProvider, setTtsProvider] = useState('openai')
  const [ttsApiKey, setTtsApiKey] = useState('')
  const [ttsHasApiKey, setTtsHasApiKey] = useState(false)
  const [ttsModel, setTtsModel] = useState(DEFAULT_TTS_MODEL)
  const [ttsCostPer1kCharsUsd, setTtsCostPer1kCharsUsd] = useState(
    DEFAULT_TTS_COST_PER_1K_CHARS_USD
  )
  const [ttsStatus, setTtsStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  )

  useEffect(() => {
    if (!webQuery.data) return
    setWebHasApiKey(webQuery.data.hasApiKey)
    setWebEnabled(webQuery.data.enabled)
    if (webQuery.data.config && typeof webQuery.data.config.cost_per_credit === 'number') {
      setWebCostPerCredit(webQuery.data.config.cost_per_credit)
    }
  }, [webQuery.data])

  useEffect(() => {
    if (!toolExecutionQuery.data) return
    setToolExecutionHasApiKey(toolExecutionQuery.data.hasApiKey)
    setToolExecutionEnabled(toolExecutionQuery.data.enabled)
  }, [toolExecutionQuery.data])

  useEffect(() => {
    if (!imageQuery.data) return
    setImageEnabled(imageQuery.data.enabled)
    const configured = readStringConfig(imageQuery.data.config, 'model')
    setImageModel(configured || DEFAULT_IMAGE_MODEL)
  }, [imageQuery.data])

  useEffect(() => {
    if (!sttQuery.data) return
    setSttEnabled(sttQuery.data.enabled)
    const configured = readStringConfig(sttQuery.data.config, 'model')
    setSttModel(configured || DEFAULT_STT_MODEL)
  }, [sttQuery.data])

  useEffect(() => {
    if (!ttsQuery.data) return
    setTtsEnabled(ttsQuery.data.enabled)
    setTtsHasApiKey(ttsQuery.data.hasApiKey)
    const configuredProvider = readStringConfig(ttsQuery.data.config, 'provider')
    const configuredModel = readStringConfig(ttsQuery.data.config, 'model')
    setTtsProvider(configuredProvider || 'openai')
    setTtsModel(configuredModel || DEFAULT_TTS_MODEL)
    const configuredCost = ttsQuery.data.config?.cost_per_1k_chars_usd
    if (
      typeof configuredCost === 'number' &&
      Number.isFinite(configuredCost) &&
      configuredCost >= 0
    ) {
      setTtsCostPer1kCharsUsd(configuredCost)
    } else {
      setTtsCostPer1kCharsUsd(DEFAULT_TTS_COST_PER_1K_CHARS_USD)
    }
  }, [ttsQuery.data])

  const handleSaveWeb = async () => {
    setWebStatus(null)
    try {
      const saved = await saveCapability.mutateAsync({
        id: 'web_search',
        provider: 'tavily',
        ...(webApiKey.trim() ? { apiKey: webApiKey.trim() } : {}),
        enabled: webEnabled,
        config: { cost_per_credit: webCostPerCredit },
      })
      setWebHasApiKey(saved.hasApiKey)
      setWebApiKey('')
      setWebStatus({ type: 'success', text: 'Web search settings saved.' })
    } catch {
      setWebStatus({ type: 'error', text: 'Failed to save web search settings.' })
    }
  }

  const handleSaveImage = async () => {
    setImageStatus(null)
    try {
      await saveCapability.mutateAsync({
        id: 'image_generation',
        provider: 'openrouter',
        enabled: imageEnabled,
        config: { model: imageModel },
      })
      setImageStatus({ type: 'success', text: 'Image generation settings saved.' })
    } catch {
      setImageStatus({ type: 'error', text: 'Failed to save image generation settings.' })
    }
  }

  const handleSaveToolExecution = async () => {
    setToolExecutionStatus(null)
    try {
      const saved = await saveCapability.mutateAsync({
        id: 'tool_execution',
        provider: 'sprites',
        ...(toolExecutionApiKey.trim() ? { apiKey: toolExecutionApiKey.trim() } : {}),
        enabled: toolExecutionEnabled,
      })
      setToolExecutionHasApiKey(saved.hasApiKey)
      setToolExecutionApiKey('')
      setToolExecutionStatus({ type: 'success', text: 'Tool execution settings saved.' })
    } catch {
      setToolExecutionStatus({ type: 'error', text: 'Failed to save tool execution settings.' })
    }
  }

  const handleSaveSTT = async () => {
    setSttStatus(null)
    try {
      await saveCapability.mutateAsync({
        id: 'speech_to_text',
        provider: 'openrouter',
        enabled: sttEnabled,
        config: { model: sttModel },
      })
      setSttStatus({ type: 'success', text: 'Speech-to-text settings saved.' })
    } catch {
      setSttStatus({ type: 'error', text: 'Failed to save speech-to-text settings.' })
    }
  }

  const handleSaveTTS = async () => {
    setTtsStatus(null)
    try {
      const saved = await saveCapability.mutateAsync({
        id: 'text_to_speech',
        provider: ttsProvider,
        ...(ttsApiKey.trim() ? { apiKey: ttsApiKey.trim() } : {}),
        enabled: ttsEnabled,
        config: {
          provider: ttsProvider,
          model: ttsModel,
          cost_per_1k_chars_usd: ttsCostPer1kCharsUsd,
        },
      })
      setTtsHasApiKey(saved.hasApiKey)
      setTtsApiKey('')
      setTtsStatus({ type: 'success', text: 'Text-to-speech settings saved.' })
    } catch {
      setTtsStatus({ type: 'error', text: 'Failed to save text-to-speech settings.' })
    }
  }

  const hasGatewayKey = Boolean(gatewayQuery.data?.hasApiKey)

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <IconWorldSearch className="h-5 w-5 text-white/80" />
            </div>
            <div>
              <CardTitle className="text-base">Web Search</CardTitle>
              <CardDescription>Search and URL extraction via Tavily.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              type="password"
              value={webApiKey}
              placeholder={webHasApiKey ? 'Stored (leave blank to keep)' : 'Enter Tavily API key'}
              onChange={(event) => setWebApiKey(event.target.value)}
              disabled={webQuery.isLoading}
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant="outline"
                className={
                  webHasApiKey
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
                }
              >
                {webHasApiKey ? 'Key stored' : 'No key'}
              </Badge>
              <span>Encrypted at rest. Leave blank to keep the current key.</span>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 p-3">
            <div>
              <p className="text-sm font-medium text-white/80">Enabled</p>
              <p className="text-xs text-muted-foreground">
                When disabled, agents will not have access to web search tools.
              </p>
            </div>
            <Switch
              checked={webEnabled}
              onCheckedChange={setWebEnabled}
              disabled={webQuery.isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label>Cost per Credit (USD)</Label>
            <Input
              type="number"
              step="0.001"
              min="0"
              value={webCostPerCredit}
              onChange={(event) => {
                const value = parseFloat(event.target.value)
                if (!isNaN(value) && value >= 0) setWebCostPerCredit(value)
              }}
              disabled={webQuery.isLoading}
              className="max-w-[180px]"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSaveWeb}
              disabled={saveCapability.isPending || webQuery.isLoading}
            >
              {saveCapability.isPending ? 'Saving...' : 'Save'}
            </Button>
            {webStatus && (
              <span
                className={
                  webStatus.type === 'success'
                    ? 'text-xs text-emerald-300'
                    : 'text-xs text-rose-300'
                }
              >
                {webStatus.text}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <IconTerminal2 className="h-5 w-5 text-white/80" />
            </div>
            <div>
              <CardTitle className="text-base">Tool Execution</CardTitle>
              <CardDescription>Sprite-backed filesystem and command tools.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Sprites API Key</Label>
            <Input
              type="password"
              value={toolExecutionApiKey}
              placeholder={
                toolExecutionHasApiKey ? 'Stored (leave blank to keep)' : 'Enter Sprites API key'
              }
              onChange={(event) => setToolExecutionApiKey(event.target.value)}
              disabled={toolExecutionQuery.isLoading}
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant="outline"
                className={
                  toolExecutionHasApiKey
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
                }
              >
                {toolExecutionHasApiKey ? 'Key stored' : 'No key'}
              </Badge>
              <span>Encrypted at rest. Leave blank to keep the current key.</span>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 p-3">
            <div>
              <p className="text-sm font-medium text-white/80">Enabled</p>
              <p className="text-xs text-muted-foreground">
                Controls command execution and sprite filesystem tools.
              </p>
            </div>
            <Switch
              checked={toolExecutionEnabled}
              onCheckedChange={setToolExecutionEnabled}
              disabled={toolExecutionQuery.isLoading}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSaveToolExecution}
              disabled={saveCapability.isPending || toolExecutionQuery.isLoading}
            >
              {saveCapability.isPending ? 'Saving...' : 'Save'}
            </Button>
            {toolExecutionStatus && (
              <span
                className={
                  toolExecutionStatus.type === 'success'
                    ? 'text-xs text-emerald-300'
                    : 'text-xs text-rose-300'
                }
              >
                {toolExecutionStatus.text}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <IconPhoto className="h-5 w-5 text-white/80" />
            </div>
            <div>
              <CardTitle className="text-base">Image Generation</CardTitle>
              <CardDescription>Generative image models through OpenRouter.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge
              variant="outline"
              className={
                hasGatewayKey
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }
            >
              {hasGatewayKey ? 'Gateway key ready' : 'Gateway key missing'}
            </Badge>
            <span>Uses the gateway API key from Gateway settings.</span>
          </div>

          <div className="space-y-2">
            <Label>Default Model</Label>
            <Select
              value={imageModel}
              onValueChange={(value) => setImageModel(value ?? DEFAULT_IMAGE_MODEL)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_MODELS.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 p-3">
            <div>
              <p className="text-sm font-medium text-white/80">Enabled</p>
              <p className="text-xs text-muted-foreground">
                Controls access to `generate_image` tool.
              </p>
            </div>
            <Switch checked={imageEnabled} onCheckedChange={setImageEnabled} />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSaveImage} disabled={saveCapability.isPending}>
              {saveCapability.isPending ? 'Saving...' : 'Save'}
            </Button>
            {imageStatus && (
              <span
                className={
                  imageStatus.type === 'success'
                    ? 'text-xs text-emerald-300'
                    : 'text-xs text-rose-300'
                }
              >
                {imageStatus.text}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <IconMicrophone className="h-5 w-5 text-white/80" />
            </div>
            <div>
              <CardTitle className="text-base">Speech To Text</CardTitle>
              <CardDescription>Audio transcription through OpenRouter chat models.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge
              variant="outline"
              className={
                hasGatewayKey
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }
            >
              {hasGatewayKey ? 'Gateway key ready' : 'Gateway key missing'}
            </Badge>
            <span>Uses the same gateway API key.</span>
          </div>

          <div className="space-y-2">
            <Label>Default Model</Label>
            <Select
              value={sttModel}
              onValueChange={(value) => setSttModel(value ?? DEFAULT_STT_MODEL)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {STT_MODELS.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 p-3">
            <div>
              <p className="text-sm font-medium text-white/80">Enabled</p>
              <p className="text-xs text-muted-foreground">
                Controls access to `transcribe_audio` tool.
              </p>
            </div>
            <Switch checked={sttEnabled} onCheckedChange={setSttEnabled} />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSaveSTT} disabled={saveCapability.isPending}>
              {saveCapability.isPending ? 'Saving...' : 'Save'}
            </Button>
            {sttStatus && (
              <span
                className={
                  sttStatus.type === 'success'
                    ? 'text-xs text-emerald-300'
                    : 'text-xs text-rose-300'
                }
              >
                {sttStatus.text}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <IconMusic className="h-5 w-5 text-white/80" />
            </div>
            <div>
              <CardTitle className="text-base">Text To Speech</CardTitle>
              <CardDescription>Direct provider calls for speech synthesis output.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select
                value={ttsProvider}
                onValueChange={(value) => setTtsProvider(value ?? 'openai')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Default Model</Label>
              <Select
                value={ttsModel}
                onValueChange={(value) => setTtsModel(value ?? DEFAULT_TTS_MODEL)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {TTS_MODELS.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Provider API Key</Label>
            <Input
              type="password"
              value={ttsApiKey}
              placeholder={ttsHasApiKey ? 'Stored (leave blank to keep)' : 'Enter provider API key'}
              onChange={(event) => setTtsApiKey(event.target.value)}
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant="outline"
                className={
                  ttsHasApiKey
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
                }
              >
                {ttsHasApiKey ? 'Key stored' : 'No key'}
              </Badge>
              <span>Used only for speech synthesis requests.</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Estimated Cost per 1K chars (USD)</Label>
            <Input
              type="number"
              step="0.0001"
              min="0"
              value={ttsCostPer1kCharsUsd}
              onChange={(event) => {
                const value = parseFloat(event.target.value)
                if (!isNaN(value) && value >= 0) setTtsCostPer1kCharsUsd(value)
              }}
              className="max-w-[220px]"
            />
            <p className="text-xs text-muted-foreground">
              Used for estimated TTS cost receipts when provider-side usage cost is unavailable.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 p-3">
            <div>
              <p className="text-sm font-medium text-white/80">Enabled</p>
              <p className="text-xs text-muted-foreground">
                Controls access to `synthesize_speech` tool.
              </p>
            </div>
            <Switch checked={ttsEnabled} onCheckedChange={setTtsEnabled} />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSaveTTS} disabled={saveCapability.isPending}>
              {saveCapability.isPending ? 'Saving...' : 'Save'}
            </Button>
            {ttsStatus && (
              <span
                className={
                  ttsStatus.type === 'success'
                    ? 'text-xs text-emerald-300'
                    : 'text-xs text-rose-300'
                }
              >
                {ttsStatus.text}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
