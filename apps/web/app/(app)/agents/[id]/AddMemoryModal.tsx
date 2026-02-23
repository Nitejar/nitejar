'use client'

import { useState, useCallback } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface AddMemoryModalProps {
  onClose: () => void
  onAdd: (content: string, permanent: boolean) => Promise<void>
}

export function AddMemoryModal({ onClose, onAdd }: AddMemoryModalProps) {
  const [content, setContent] = useState('')
  const [permanent, setPermanent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      if (!content.trim()) {
        setError('Content is required')
        return
      }

      setSaving(true)
      setError(null)

      try {
        await onAdd(content.trim(), permanent)
      } catch {
        setError('Failed to add memory')
        setSaving(false)
      }
    },
    [content, permanent, onAdd]
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border/60 bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
              Memory
            </p>
            <h3 className="text-lg font-semibold">Add Memory</h3>
          </div>
          <button
            type="button"
            className="rounded-full border border-border/50 px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="content">Content</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What should the agent remember?"
              rows={4}
              autoFocus
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/40 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-foreground">Permanent</p>
              <p className="text-xs text-muted-foreground">Won&apos;t decay over time.</p>
            </div>
            <Switch checked={permanent} onCheckedChange={setPermanent} />
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-xs font-medium text-primary transition hover:border-primary/60 hover:bg-primary/20"
              disabled={saving}
            >
              {saving ? 'Adding...' : 'Add Memory'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
