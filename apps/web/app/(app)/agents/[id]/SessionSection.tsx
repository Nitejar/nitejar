'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { IconHistory, IconChevronDown, IconChevronUp } from '@tabler/icons-react'

interface SessionSettings {
  enabled?: boolean
  maxTurns?: number
  maxTokens?: number
  resetTriggers?: string[]
  idleTimeoutMinutes?: number
  dailyResetHour?: number | null
  clearMemoriesOnReset?: boolean
  compaction?: {
    enabled?: boolean
    summaryMaxTokens?: number
    loadPreviousSummary?: boolean
    extractMemories?: boolean
  }
  messageEmbeddings?: boolean
}

interface SessionSectionProps {
  agentId: string
  initialSettings?: SessionSettings
}

function SettingsGroup({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string
  description?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {isOpen ? (
          <IconChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <IconChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {isOpen && <div className="border-t border-white/5 p-4 pt-4">{children}</div>}
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

export function SessionSection({ agentId, initialSettings }: SessionSectionProps) {
  const [enabled, setEnabled] = useState(initialSettings?.enabled !== false)
  const [maxTurns, setMaxTurns] = useState(String(initialSettings?.maxTurns ?? 10))
  const [maxTokens, setMaxTokens] = useState(String(initialSettings?.maxTokens ?? 4000))
  const [resetTriggers, setResetTriggers] = useState(
    (initialSettings?.resetTriggers ?? ['/clear']).join(', ')
  )
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(
    String(initialSettings?.idleTimeoutMinutes ?? 120)
  )
  const [dailyResetHour, setDailyResetHour] = useState(
    initialSettings?.dailyResetHour !== null && initialSettings?.dailyResetHour !== undefined
      ? String(initialSettings.dailyResetHour)
      : ''
  )
  const [clearMemoriesOnReset, setClearMemoriesOnReset] = useState(
    initialSettings?.clearMemoriesOnReset ?? false
  )

  const [compactionEnabled, setCompactionEnabled] = useState(
    initialSettings?.compaction?.enabled !== false
  )
  const [summaryMaxTokens, setSummaryMaxTokens] = useState(
    String(initialSettings?.compaction?.summaryMaxTokens ?? 500)
  )
  const [loadPreviousSummary, setLoadPreviousSummary] = useState(
    initialSettings?.compaction?.loadPreviousSummary !== false
  )
  const [extractMemories, setExtractMemories] = useState(
    initialSettings?.compaction?.extractMemories ?? false
  )

  const [messageEmbeddings, setMessageEmbeddings] = useState(
    initialSettings?.messageEmbeddings !== false
  )

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)

    const maxTurnsNum = parseInt(maxTurns, 10)
    const maxTokensNum = parseInt(maxTokens, 10)
    const idleTimeoutNum = parseInt(idleTimeoutMinutes, 10)
    const summaryMaxTokensNum = parseInt(summaryMaxTokens, 10)
    const dailyResetHourNum = dailyResetHour ? parseInt(dailyResetHour, 10) : null

    if (isNaN(maxTurnsNum) || maxTurnsNum < 1) {
      setMessage({ type: 'error', text: 'Max turns must be at least 1' })
      setSaving(false)
      return
    }

    if (isNaN(maxTokensNum) || maxTokensNum < 100) {
      setMessage({ type: 'error', text: 'Max tokens must be at least 100' })
      setSaving(false)
      return
    }

    if (isNaN(idleTimeoutNum) || idleTimeoutNum < 1) {
      setMessage({ type: 'error', text: 'Idle timeout must be at least 1 minute' })
      setSaving(false)
      return
    }

    if (dailyResetHourNum !== null && (dailyResetHourNum < 0 || dailyResetHourNum > 23)) {
      setMessage({ type: 'error', text: 'Daily reset hour must be 0-23' })
      setSaving(false)
      return
    }

    const triggers = resetTriggers
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)

    const settings: SessionSettings = {
      enabled,
      maxTurns: maxTurnsNum,
      maxTokens: maxTokensNum,
      resetTriggers: triggers,
      idleTimeoutMinutes: idleTimeoutNum,
      dailyResetHour: dailyResetHourNum,
      clearMemoriesOnReset,
      compaction: {
        enabled: compactionEnabled,
        summaryMaxTokens: summaryMaxTokensNum,
        loadPreviousSummary,
        extractMemories,
      },
      messageEmbeddings,
    }

    try {
      const response = await fetch(`/api/agents/${agentId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionSettings: settings }),
      })

      if (!response.ok) throw new Error('Failed to save')

      setMessage({ type: 'success', text: 'Saved' })
      setTimeout(() => setMessage(null), 3000)
    } catch {
      setMessage({ type: 'error', text: 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <IconHistory className="h-4 w-4 text-muted-foreground" />
          Session Settings
        </CardTitle>
        <CardDescription className="text-xs">
          Conversation history, compaction, and context management.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Master toggle */}
        <ToggleRow
          label="Enable conversation history"
          description="Maintain context across multiple messages."
          checked={enabled}
          onChange={setEnabled}
        />

        {enabled && (
          <div className="space-y-3">
            {/* Active Session Settings */}
            <SettingsGroup
              title="Active Session"
              description="Limits for ongoing conversations"
              defaultOpen={true}
            >
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Max Turns</Label>
                    <Input
                      type="number"
                      value={maxTurns}
                      onChange={(e) => setMaxTurns(e.target.value)}
                      min="1"
                      max="50"
                      className="border-white/10 bg-white/5"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Max Tokens</Label>
                    <Input
                      type="number"
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(e.target.value)}
                      min="100"
                      max="32000"
                      className="border-white/10 bg-white/5"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Idle Timeout (min)</Label>
                    <Input
                      type="number"
                      value={idleTimeoutMinutes}
                      onChange={(e) => setIdleTimeoutMinutes(e.target.value)}
                      min="1"
                      className="border-white/10 bg-white/5"
                    />
                  </div>
                </div>
              </div>
            </SettingsGroup>

            {/* Session Resets */}
            <SettingsGroup title="Session Resets" description="When to clear conversation history">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs">Reset Triggers</Label>
                  <Input
                    type="text"
                    value={resetTriggers}
                    onChange={(e) => setResetTriggers(e.target.value)}
                    placeholder="/clear, /reset"
                    className="border-white/10 bg-white/5"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Comma-separated commands that clear history
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Daily Reset Hour (0-23)</Label>
                  <Input
                    type="number"
                    value={dailyResetHour}
                    onChange={(e) => setDailyResetHour(e.target.value)}
                    min="0"
                    max="23"
                    placeholder="Disabled"
                    className="border-white/10 bg-white/5"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Leave empty to disable daily resets
                  </p>
                </div>

                <ToggleRow
                  label="Clear non-permanent memories"
                  description="Remove decayable memories on reset"
                  checked={clearMemoriesOnReset}
                  onChange={setClearMemoriesOnReset}
                />
              </div>
            </SettingsGroup>

            {/* Compaction */}
            <SettingsGroup
              title="Session Compaction"
              description="Summarize sessions for long-term context"
            >
              <div className="space-y-4">
                <ToggleRow
                  label="Enable automatic compaction"
                  description="Generate summaries when sessions end"
                  checked={compactionEnabled}
                  onChange={setCompactionEnabled}
                />

                {compactionEnabled && (
                  <>
                    <div className="space-y-2">
                      <Label className="text-xs">Summary Max Tokens</Label>
                      <Input
                        type="number"
                        value={summaryMaxTokens}
                        onChange={(e) => setSummaryMaxTokens(e.target.value)}
                        min="100"
                        max="2000"
                        className="border-white/10 bg-white/5"
                      />
                    </div>

                    <ToggleRow
                      label="Load previous summary"
                      description="Start new sessions with prior context"
                      checked={loadPreviousSummary}
                      onChange={setLoadPreviousSummary}
                    />

                    <ToggleRow
                      label="Extract memories (legacy)"
                      description="Deprecated: use Memory > Passive updates for extraction behavior"
                      checked={extractMemories}
                      onChange={setExtractMemories}
                    />
                  </>
                )}
              </div>
            </SettingsGroup>

            {/* Message Search */}
            <SettingsGroup title="Message Search" description="Semantic search across history">
              <ToggleRow
                label="Generate embeddings"
                description="Enable semantic message lookup"
                checked={messageEmbeddings}
                onChange={setMessageEmbeddings}
              />
            </SettingsGroup>
          </div>
        )}

        {/* Save button */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            className="rounded-md border border-primary/40 bg-primary/15 px-4 py-2 text-xs font-medium text-primary transition hover:border-primary/60 hover:bg-primary/20"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Session Settings'}
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
