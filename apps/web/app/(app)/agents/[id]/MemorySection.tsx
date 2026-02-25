'use client'

import { useState, useEffect, useCallback } from 'react'
import { AddMemoryModal } from './AddMemoryModal'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { IconBrain, IconSettings, IconPinned, IconTrash } from '@tabler/icons-react'

interface Memory {
  id: string
  agentId: string
  content: string
  strength: number
  accessCount: number
  permanent: boolean
  memoryKind?: string
  lastAccessedAt: number | null
  createdAt: number
  updatedAt: number
}

interface MemoriesResponse {
  memories: Memory[]
}

interface MemoryResponse {
  memory: Memory
}

interface MemorySectionProps {
  agentId: string
  initialDecayRate: number | undefined
  initialMaxMemories: number | undefined
  initialPassiveUpdatesEnabled: boolean | undefined
  initialMaxStoredMemories: number | undefined
  initialExtractionHint: string | undefined
}

export function MemorySection({
  agentId,
  initialDecayRate,
  initialMaxMemories,
  initialPassiveUpdatesEnabled,
  initialMaxStoredMemories,
  initialExtractionHint,
}: MemorySectionProps) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [filter, setFilter] = useState<'all' | 'permanent' | 'digest'>('all')
  const [decayRate, setDecayRate] = useState(
    initialDecayRate !== undefined ? String(initialDecayRate) : '0.1'
  )
  const [maxMemories, setMaxMemories] = useState(
    initialMaxMemories !== undefined ? String(initialMaxMemories) : '15'
  )
  const [maxStoredMemories, setMaxStoredMemories] = useState(
    initialMaxStoredMemories !== undefined ? String(initialMaxStoredMemories) : '200'
  )
  const [passiveUpdatesEnabled, setPassiveUpdatesEnabled] = useState(
    initialPassiveUpdatesEnabled ?? false
  )
  const [extractionHint, setExtractionHint] = useState(initialExtractionHint ?? '')
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const fetchMemories = useCallback(async () => {
    try {
      const response = await fetch(`/api/agents/${agentId}/memories`)
      if (response.ok) {
        const data = (await response.json()) as MemoriesResponse
        setMemories(data.memories)
      }
    } catch (err) {
      console.error('Failed to fetch memories:', err)
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    void fetchMemories()
  }, [fetchMemories])

  const handleTogglePermanent = async (memoryId: string) => {
    try {
      const response = await fetch(`/api/agents/${agentId}/memories`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memoryId, action: 'togglePermanent' }),
      })

      if (response.ok) {
        const data = (await response.json()) as MemoryResponse
        setMemories((prev) => prev.map((m) => (m.id === memoryId ? data.memory : m)))
      }
    } catch (err) {
      console.error('Failed to toggle permanent:', err)
    }
  }

  const handleDelete = async (memoryId: string) => {
    if (!confirm('Delete this memory?')) return

    try {
      const response = await fetch(`/api/agents/${agentId}/memories`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memoryId }),
      })

      if (response.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== memoryId))
      }
    } catch (err) {
      console.error('Failed to delete memory:', err)
    }
  }

  const handleAddMemory = async (content: string, permanent: boolean) => {
    try {
      const response = await fetch(`/api/agents/${agentId}/memories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, permanent }),
      })

      if (response.ok) {
        const data = (await response.json()) as MemoryResponse
        setMemories((prev) => [data.memory, ...prev])
        setShowAddModal(false)
      }
    } catch (err) {
      console.error('Failed to add memory:', err)
      throw err
    }
  }

  const handleSaveSettings = async () => {
    setSavingSettings(true)
    setSettingsMessage(null)

    const rate = parseFloat(decayRate)
    const max = parseInt(maxMemories, 10)
    const maxStored = parseInt(maxStoredMemories, 10)

    if (isNaN(rate) || rate < 0 || rate > 1) {
      setSettingsMessage({
        type: 'error',
        text: 'Decay rate must be between 0 and 1',
      })
      setSavingSettings(false)
      return
    }

    if (isNaN(max) || max < 1) {
      setSettingsMessage({
        type: 'error',
        text: 'Max memories must be at least 1',
      })
      setSavingSettings(false)
      return
    }

    if (isNaN(maxStored) || maxStored < 1) {
      setSettingsMessage({
        type: 'error',
        text: 'Stored memory cap must be at least 1',
      })
      setSavingSettings(false)
      return
    }

    try {
      const response = await fetch(`/api/agents/${agentId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memorySettings: {
            decayRate: rate,
            maxMemories: max,
            maxStoredMemories: maxStored,
            passiveUpdatesEnabled,
            extractionHint: extractionHint.trim() || undefined,
          },
        }),
      })

      if (!response.ok) throw new Error('Failed to save')

      setSettingsMessage({ type: 'success', text: 'Saved' })
      setTimeout(() => setSettingsMessage(null), 3000)
    } catch {
      setSettingsMessage({ type: 'error', text: 'Failed to save' })
    } finally {
      setSavingSettings(false)
    }
  }

  const formatTimeAgo = (timestamp: number | null): string => {
    if (!timestamp) return 'never'
    const seconds = Math.floor(Date.now() / 1000) - timestamp
    const days = Math.floor(seconds / 86400)
    if (days > 0) return `${days}d ago`
    const hours = Math.floor(seconds / 3600)
    if (hours > 0) return `${hours}h ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes > 0) return `${minutes}m ago`
    return 'just now'
  }

  const filteredMemories =
    filter === 'permanent'
      ? memories.filter((m) => m.permanent)
      : filter === 'digest'
        ? memories.filter((m) => m.memoryKind === 'digest')
        : memories
  const pinnedCount = memories.filter((m) => m.permanent).length
  const digestCount = memories.filter((m) => m.memoryKind === 'digest').length

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconBrain className="h-4 w-4 text-muted-foreground" />
            Memories
          </CardTitle>
          <CardDescription className="text-xs">
            {memories.length} memories{pinnedCount > 0 ? ` · ${pinnedCount} pinned` : ''}
          </CardDescription>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="rounded-md border border-white/10 p-1.5 text-muted-foreground transition hover:border-white/20 hover:text-foreground"
            onClick={() => setShowSettings(!showSettings)}
            title="Memory settings"
          >
            <IconSettings className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded-md border border-primary/40 bg-primary/15 px-2.5 py-1.5 text-xs font-medium text-primary transition hover:border-primary/60 hover:bg-primary/20"
            onClick={() => setShowAddModal(true)}
          >
            + Add
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Collapsible Settings */}
        {showSettings && (
          <div className="space-y-4 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-foreground">Fade speed</Label>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      value={decayRate}
                      onChange={(e) => setDecayRate(e.target.value)}
                      min="0"
                      max="1"
                      step="0.05"
                      className="h-7 w-16 border-white/10 bg-white/5 text-center text-xs"
                    />
                    <span className="text-[10px] text-muted-foreground">/wk</span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  How fast unpinned memories lose strength. 0 = never fade, 1 = gone in a week.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-foreground">Recall limit</Label>
                  <Input
                    type="number"
                    value={maxMemories}
                    onChange={(e) => setMaxMemories(e.target.value)}
                    min="1"
                    max="50"
                    className="h-7 w-16 border-white/10 bg-white/5 text-center text-xs"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Max memories included in the agent&apos;s context per run.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-foreground">Storage limit</Label>
                  <Input
                    type="number"
                    value={maxStoredMemories}
                    onChange={(e) => setMaxStoredMemories(e.target.value)}
                    min="1"
                    className="h-7 w-16 border-white/10 bg-white/5 text-center text-xs"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Total memories stored. Weakest are dropped when the limit is hit.
                </p>
              </div>
            </div>

            <div className="space-y-1.5 border-t border-white/5 pt-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs text-foreground">Learn from conversations</Label>
                  <p className="text-[10px] text-muted-foreground">
                    Automatically extract memories from agent interactions.
                  </p>
                </div>
                <Switch
                  checked={passiveUpdatesEnabled}
                  onCheckedChange={setPassiveUpdatesEnabled}
                />
              </div>
            </div>

            {passiveUpdatesEnabled && (
              <div className="space-y-1">
                <Label className="text-xs text-foreground">What to remember</Label>
                <textarea
                  value={extractionHint}
                  onChange={(e) => setExtractionHint(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  placeholder="e.g. Focus on user preferences, project details, and decisions."
                  className="w-full resize-y rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
                <p className="text-[10px] text-muted-foreground">
                  Guide what the agent pays attention to when learning.
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-3">
              {settingsMessage && (
                <span
                  className={`text-[10px] ${
                    settingsMessage.type === 'success' ? 'text-emerald-400' : 'text-destructive'
                  }`}
                >
                  {settingsMessage.text}
                </span>
              )}
              <button
                type="button"
                className="h-7 rounded-md border border-primary/40 bg-primary/15 px-3 text-xs font-medium text-primary transition hover:border-primary/60 hover:bg-primary/20"
                onClick={handleSaveSettings}
                disabled={savingSettings}
              >
                {savingSettings ? '...' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Filter */}
        {memories.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${
                filter === 'all'
                  ? 'bg-white/10 text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              All ({memories.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('permanent')}
              className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${
                filter === 'permanent'
                  ? 'bg-white/10 text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Pinned ({pinnedCount})
            </button>
            {digestCount > 0 && (
              <button
                type="button"
                onClick={() => setFilter('digest')}
                className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${
                  filter === 'digest'
                    ? 'bg-white/10 text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Digests ({digestCount})
              </button>
            )}
          </div>
        )}

        {/* Memory List */}
        {loading ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Loading memories...</p>
        ) : filteredMemories.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/10 py-6">
            <p className="text-sm text-muted-foreground">No memories yet</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Memories help your agent remember context across sessions.
            </p>
          </div>
        ) : (
          <div className="max-h-[320px] overflow-y-auto rounded-md border border-white/10">
            {filteredMemories.map((memory, idx) => (
              <div
                key={memory.id}
                className={`group flex items-start gap-2 px-2.5 py-2 ${idx > 0 ? 'border-t border-white/5' : ''}`}
              >
                {/* Strength indicator or pin */}
                <div className="mt-0.5 flex shrink-0 items-center">
                  {memory.permanent ? (
                    <IconPinned className="h-3 w-3 text-primary" />
                  ) : (
                    <div
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor: `oklch(${0.5 + memory.strength * 0.3} 0.15 150)`,
                        opacity: 0.4 + memory.strength * 0.6,
                      }}
                      title={`Strength: ${(memory.strength * 100).toFixed(0)}%`}
                    />
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-xs text-foreground">{memory.content}</p>
                  <span className="text-[10px] text-muted-foreground">
                    {memory.memoryKind && memory.memoryKind !== 'fact' && (
                      <span className="mr-1 inline-block rounded bg-white/[0.06] px-1 py-px text-[9px] uppercase tracking-wider text-muted-foreground">
                        {memory.memoryKind}
                      </span>
                    )}
                    {formatTimeAgo(memory.lastAccessedAt)}
                    {memory.accessCount > 0 ? ` · ${memory.accessCount}×` : ''}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    className="p-0.5 text-muted-foreground transition hover:text-primary"
                    onClick={() => handleTogglePermanent(memory.id)}
                    title={memory.permanent ? 'Unpin' : 'Pin'}
                  >
                    <IconPinned className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    className="p-0.5 text-muted-foreground transition hover:text-destructive"
                    onClick={() => handleDelete(memory.id)}
                    title="Delete"
                  >
                    <IconTrash className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {showAddModal && (
        <AddMemoryModal onClose={() => setShowAddModal(false)} onAdd={handleAddMemory} />
      )}
    </Card>
  )
}
