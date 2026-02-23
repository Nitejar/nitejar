'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { IconCloud, IconCheck, IconAlertTriangle, IconRefresh } from '@tabler/icons-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function GatewaySettingsClient() {
  const [provider, setProvider] = useState<'openrouter'>('openrouter')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [refreshStatus, setRefreshStatus] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const settingsQuery = trpc.gateway.getSettings.useQuery()
  const updateSettings = trpc.gateway.updateSettings.useMutation({
    onSuccess: (data) => {
      setHasApiKey(Boolean(data.hasApiKey))
      setApiKey('')
      setStatus({ type: 'success', text: 'Gateway settings saved.' })
    },
    onError: () => {
      setStatus({ type: 'error', text: 'Failed to save settings.' })
    },
  })
  const refreshModels = trpc.gateway.refreshModels.useMutation({
    onSuccess: (data) => {
      if (data.error) {
        setRefreshStatus({ type: 'error', text: data.error })
      } else {
        setRefreshStatus({
          type: 'success',
          text: `Loaded ${data.count} models (${data.source}).`,
        })
      }
    },
    onError: () => {
      setRefreshStatus({ type: 'error', text: 'Failed to refresh models.' })
    },
  })

  useEffect(() => {
    if (!settingsQuery.data) return
    setProvider((settingsQuery.data.provider as 'openrouter') ?? 'openrouter')
    setBaseUrl(settingsQuery.data.baseUrl ?? '')
    setHasApiKey(Boolean(settingsQuery.data.hasApiKey))
  }, [settingsQuery.data])

  const handleSave = () => {
    setStatus(null)

    updateSettings.mutate({
      provider,
      baseUrl: baseUrl.trim() || null,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    })
  }

  const handleRefresh = () => {
    setRefreshStatus(null)
    refreshModels.mutate()
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <IconCloud className="h-5 w-5 text-white/80" />
            </div>
            <div>
              <CardTitle className="text-base">Gateway Configuration</CardTitle>
              <CardDescription>
                Centralize OpenRouter access and manage shared credentials.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select
                value={provider}
                onValueChange={(value) => setProvider((value ?? 'openrouter') as 'openrouter')}
                disabled
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Base URL</Label>
              <Input
                value={baseUrl}
                placeholder="https://openrouter.ai/api/v1"
                onChange={(event) => setBaseUrl(event.target.value)}
                disabled={settingsQuery.isLoading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>API Key</Label>
            <Input
              type="password"
              value={apiKey}
              placeholder={hasApiKey ? 'Stored (leave blank to keep)' : 'Enter API key'}
              onChange={(event) => setApiKey(event.target.value)}
              disabled={settingsQuery.isLoading}
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant="outline"
                className={
                  hasApiKey
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
                }
              >
                {hasApiKey ? 'Key stored' : 'No key'}
              </Badge>
              <span>Encrypted at rest. Leave blank to keep the current key.</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={updateSettings.isPending || settingsQuery.isLoading}
            >
              {updateSettings.isPending ? 'Saving...' : 'Verify & Save'}
            </Button>
            {status && (
              <span
                className={
                  status.type === 'success' ? 'text-xs text-emerald-300' : 'text-xs text-rose-300'
                }
              >
                {status.text}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <CardTitle className="text-base">Model Library</CardTitle>
          <CardDescription>
            Sync the catalog so agents can pick from the latest OpenRouter models.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 text-white/80">
              <IconRefresh className="h-4 w-4" />
              <span>Refresh pulls the latest models into the shared catalog.</span>
            </div>
            <p className="mt-2 text-[0.7rem] text-white/50">
              Refreshing does not affect running agents.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={handleRefresh} disabled={refreshModels.isPending}>
              {refreshModels.isPending ? 'Refreshing...' : 'Refresh Models'}
            </Button>
            {refreshStatus && (
              <div className="flex items-center gap-2 text-xs">
                {refreshStatus.type === 'success' ? (
                  <IconCheck className="h-3.5 w-3.5 text-emerald-300" />
                ) : (
                  <IconAlertTriangle className="h-3.5 w-3.5 text-amber-300" />
                )}
                <span
                  className={
                    refreshStatus.type === 'success' ? 'text-emerald-300' : 'text-amber-300'
                  }
                >
                  {refreshStatus.text}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
