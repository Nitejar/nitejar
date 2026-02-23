'use client'

import { useEffect, useMemo, useState } from 'react'
import type { NetworkPolicy, PolicyPreset } from '@nitejar/agent/types'
import { IconLockAccess, IconRefresh, IconShieldCheck } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface NetworkPolicySectionProps {
  agentId: string
}

interface SyncStatus {
  synced: boolean
  lastSyncAttempt?: Date
  error?: string
}

function getModeLabel(mode: NetworkPolicy['mode']): string {
  switch (mode) {
    case 'unrestricted':
      return 'Unrestricted'
    case 'allow-list':
      return 'Allow List'
    case 'deny-list':
      return 'Deny List'
    default:
      return mode
  }
}

function clonePolicy(policy: NetworkPolicy): NetworkPolicy {
  return {
    ...policy,
    rules: policy.rules.map((rule) => ({ ...rule })),
  }
}

export function NetworkPolicySection({ agentId }: NetworkPolicySectionProps) {
  const [localPolicy, setLocalPolicy] = useState<NetworkPolicy | null>(null)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [newDomain, setNewDomain] = useState('')
  const [newAction, setNewAction] = useState<'allow' | 'deny'>('allow')
  const [isDirty, setIsDirty] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ synced: true })
  const [message, setMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const policyQuery = trpc.networkPolicy.get.useQuery({ agentId })
  const presetsQuery = trpc.networkPolicy.listPresets.useQuery()
  const setPolicy = trpc.networkPolicy.set.useMutation()
  const retrySync = trpc.networkPolicy.retrySync.useMutation()

  const presets = useMemo<PolicyPreset[]>(() => presetsQuery.data ?? [], [presetsQuery.data])

  useEffect(() => {
    if (policyQuery.data?.policy) {
      const policy = clonePolicy(policyQuery.data.policy)
      setLocalPolicy(policy)
      setSelectedPresetId(policy.presetId ?? null)
      setSyncStatus({ synced: true })
      setIsDirty(false)
    } else {
      setLocalPolicy(null)
      setSelectedPresetId(null)
    }
  }, [policyQuery.data])

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId]
  )

  const selectPreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId)
    if (!preset) return

    // Same preset already active with no unsaved changes — no-op
    if (presetId === selectedPresetId && !isDirty) return

    // Confirm if there are unsaved edits
    if (isDirty) {
      const proceed = window.confirm('You have unsaved changes that will be lost. Continue?')
      if (!proceed) return
    }

    setLocalPolicy(clonePolicy(preset.policy))
    setSelectedPresetId(presetId)
    setIsDirty(true)
    setMessage(null)
  }

  const handleSave = async () => {
    if (!localPolicy) {
      return
    }

    setMessage(null)
    try {
      const result = await setPolicy.mutateAsync({
        agentId,
        policy: localPolicy,
      })
      setIsDirty(false)
      setSyncStatus({
        synced: result.synced,
        lastSyncAttempt: new Date(),
        error: result.syncError,
      })
      const presetName = selectedPreset?.name
      const label =
        presetName && !localPolicy.customized ? `Applied ${presetName} preset` : 'Policy saved'
      setMessage({
        type: 'success',
        text: result.synced
          ? `${label} and synced`
          : `${label} (sync pending: ${result.syncError})`,
      })
      await policyQuery.refetch()
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save policy',
      })
    }
  }

  const updateRule = (index: number, field: 'domain' | 'action', value: string) => {
    if (!localPolicy) {
      return
    }

    const rules = localPolicy.rules.map((rule, ruleIndex) =>
      ruleIndex === index
        ? {
            ...rule,
            ...(field === 'domain' ? { domain: value } : { action: value as 'allow' | 'deny' }),
          }
        : rule
    )

    setLocalPolicy({
      ...localPolicy,
      rules,
      customized: true,
    })
    setIsDirty(true)
  }

  const removeRule = (index: number) => {
    if (!localPolicy || localPolicy.rules.length <= 1) {
      return
    }
    const rules = localPolicy.rules.filter((_, ruleIndex) => ruleIndex !== index)
    setLocalPolicy({
      ...localPolicy,
      rules,
      customized: true,
    })
    setIsDirty(true)
  }

  const moveRule = (index: number, direction: 'up' | 'down') => {
    if (!localPolicy) {
      return
    }
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= localPolicy.rules.length) {
      return
    }

    const rules = [...localPolicy.rules]
    const [rule] = rules.splice(index, 1)
    if (!rule) {
      return
    }
    rules.splice(target, 0, rule)

    setLocalPolicy({
      ...localPolicy,
      rules,
      customized: true,
    })
    setIsDirty(true)
  }

  const addRule = () => {
    if (!localPolicy || !newDomain.trim()) {
      return
    }

    const incomingRule = {
      domain: newDomain.trim(),
      action: newAction,
    } as const

    const catchAllIndex = localPolicy.rules.findIndex((rule) => rule.domain === '*')
    const rules = [...localPolicy.rules]
    if (catchAllIndex === -1) {
      rules.push(incomingRule)
    } else {
      rules.splice(catchAllIndex, 0, incomingRule)
    }

    setLocalPolicy({
      ...localPolicy,
      rules,
      customized: true,
    })
    setNewDomain('')
    setNewAction('allow')
    setIsDirty(true)
  }

  const handleRetrySync = async () => {
    setMessage(null)
    try {
      const result = await retrySync.mutateAsync({ agentId })
      setSyncStatus({
        synced: result.synced,
        lastSyncAttempt: new Date(),
        error: result.error,
      })
      setMessage({
        type: result.synced ? 'success' : 'error',
        text: result.synced
          ? 'Policy synced successfully'
          : `Sync failed: ${result.error ?? 'Unknown error'}`,
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to retry sync',
      })
    }
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <IconLockAccess className="h-4 w-4 text-muted-foreground" />
          Network Policy
        </CardTitle>
        <CardDescription className="text-xs">
          Control which external domains this agent can access from its sprite sandbox.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {policyQuery.isLoading && !localPolicy ? (
          <div className="rounded-lg border border-dashed border-white/10 p-3 text-xs text-muted-foreground">
            Loading network policy...
          </div>
        ) : localPolicy ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Mode:</span>
              <span className="font-medium text-foreground">{getModeLabel(localPolicy.mode)}</span>
              <span className="text-muted-foreground">Rules:</span>
              <span className="font-medium text-foreground">{localPolicy.rules.length}</span>
              {selectedPreset ? (
                <>
                  <span className="text-muted-foreground">Preset:</span>
                  <span className="font-medium text-foreground">{selectedPreset.name}</span>
                </>
              ) : null}
              {localPolicy.customized ? (
                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[0.6rem] uppercase tracking-wide text-amber-300">
                  Customized
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 p-3 text-xs text-muted-foreground">
            No network policy configured yet. Apply a preset to get started.
          </div>
        )}

        {!syncStatus.synced ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="space-y-1">
              <p className="text-xs font-medium text-amber-300">Policy not synced</p>
              <p className="text-[0.7rem] text-amber-100/80">
                {syncStatus.error ?? 'Failed to sync policy to sprite'}
              </p>
              {syncStatus.lastSyncAttempt ? (
                <p className="text-[0.65rem] text-amber-100/60">
                  Last attempt: {syncStatus.lastSyncAttempt.toLocaleTimeString()}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleRetrySync}
              disabled={retrySync.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/20 px-3 py-1.5 text-[0.65rem] font-medium uppercase tracking-wide text-amber-100 transition hover:bg-amber-500/30 disabled:opacity-60"
            >
              <IconRefresh className="h-3.5 w-3.5" />
              {retrySync.isPending ? 'Retrying...' : 'Retry Sync'}
            </button>
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <IconShieldCheck className="h-3.5 w-3.5" />
            Presets
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {presets.map((preset: PolicyPreset) => {
              const active = selectedPresetId === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => selectPreset(preset.id)}
                  disabled={setPolicy.isPending}
                  className={`rounded-lg border p-3 text-left transition ${
                    active
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                  }`}
                >
                  <p className="text-xs font-medium text-foreground">{preset.name}</p>
                  <p className="mt-1 text-[0.7rem] text-muted-foreground">{preset.description}</p>
                </button>
              )
            })}
          </div>
        </div>

        {localPolicy ? (
          <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="text-xs font-medium text-foreground">Rules (first match wins)</p>
            <div className="space-y-2">
              {localPolicy.rules.map((rule, index) => (
                <div
                  key={`${rule.domain}-${index}`}
                  className="grid gap-2 md:grid-cols-[44px_1fr_120px_150px]"
                >
                  <div className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-2 text-center text-[0.65rem] text-muted-foreground">
                    {index + 1}
                  </div>
                  <Input
                    value={rule.domain}
                    onChange={(event) => updateRule(index, 'domain', event.target.value)}
                    placeholder="example.com or *.example.com"
                    className="h-8 border-white/10 bg-white/5 text-xs"
                  />
                  <select
                    value={rule.action}
                    onChange={(event) => updateRule(index, 'action', event.target.value)}
                    className="h-8 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-foreground"
                  >
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                  </select>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveRule(index, 'up')}
                      disabled={index === 0}
                      className="rounded-md border border-white/10 px-2 py-1 text-[0.65rem] text-muted-foreground transition hover:border-white/20 hover:text-foreground disabled:opacity-50"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRule(index, 'down')}
                      disabled={index === localPolicy.rules.length - 1}
                      className="rounded-md border border-white/10 px-2 py-1 text-[0.65rem] text-muted-foreground transition hover:border-white/20 hover:text-foreground disabled:opacity-50"
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRule(index)}
                      disabled={localPolicy.rules.length <= 1}
                      className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[0.65rem] text-destructive transition hover:bg-destructive/20 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-2 md:grid-cols-[1fr_120px_100px]">
              <Input
                value={newDomain}
                onChange={(event) => setNewDomain(event.target.value)}
                placeholder="Add domain pattern"
                className="h-8 border-white/10 bg-white/5 text-xs"
              />
              <select
                value={newAction}
                onChange={(event) => setNewAction(event.target.value as 'allow' | 'deny')}
                className="h-8 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-foreground"
              >
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </select>
              <button
                type="button"
                onClick={addRule}
                disabled={!newDomain.trim()}
                className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs text-foreground transition hover:border-white/20 hover:bg-white/10 disabled:opacity-50"
              >
                Add Rule
              </button>
            </div>

            <p className="text-[0.65rem] text-muted-foreground">
              Patterns: <code>example.com</code>, <code>*.example.com</code>, or <code>*</code> for
              catch-all.
            </p>
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          {isDirty ? (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={setPolicy.isPending}
                className="rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-xs font-medium text-primary transition hover:border-primary/60 hover:bg-primary/20 disabled:opacity-60"
              >
                {setPolicy.isPending
                  ? 'Applying...'
                  : selectedPreset && !localPolicy?.customized
                    ? 'Apply'
                    : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (policyQuery.data?.policy) {
                    const policy = clonePolicy(policyQuery.data.policy)
                    setLocalPolicy(policy)
                    setSelectedPresetId(policy.presetId ?? null)
                  } else {
                    setLocalPolicy(null)
                    setSelectedPresetId(null)
                  }
                  setIsDirty(false)
                  setMessage(null)
                }}
                disabled={setPolicy.isPending}
                className="rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-white/20 hover:text-foreground disabled:opacity-60"
              >
                Reset
              </button>
            </>
          ) : !localPolicy ? (
            <button
              type="button"
              onClick={() => selectPreset('development')}
              disabled={policyQuery.isLoading}
              className="rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-xs font-medium text-primary transition hover:border-primary/60 hover:bg-primary/20 disabled:opacity-60"
            >
              {policyQuery.isLoading ? 'Loading...' : 'Use Development Preset'}
            </button>
          ) : null}

          {message ? (
            <span
              className={`rounded-full px-3 py-1 text-[0.65rem] font-medium ${
                message.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-200'
                  : 'bg-destructive/10 text-destructive'
              }`}
            >
              {message.text}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
