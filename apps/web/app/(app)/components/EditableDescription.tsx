'use client'

import { useEffect, useRef, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'

export function EditableDescription({
  body,
  onSave,
}: {
  body: string | null
  onSave: (body: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(body ?? '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Sync draft when data changes (e.g. after save)
  useEffect(() => {
    if (!editing) setDraft(body ?? '')
  }, [body, editing])

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  const save = () => {
    const trimmed = draft.trim()
    if (trimmed !== (body ?? '').trim()) {
      onSave(trimmed)
    }
    setEditing(false)
  }

  return (
    <div>
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5">
        Description
      </h3>
      {editing ? (
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(body ?? '')
              setEditing(false)
            }
            if (e.key === 'Enter' && e.metaKey) {
              save()
            }
          }}
          className="min-h-[60px] resize-y border-zinc-800 bg-white/[0.03] text-sm text-zinc-300 placeholder:text-zinc-600"
          placeholder="Add a description..."
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="w-full text-left rounded px-2 py-1.5 -mx-2 transition hover:bg-white/[0.04]"
        >
          {body ? (
            <p className="text-sm leading-relaxed text-zinc-400 whitespace-pre-wrap">{body}</p>
          ) : (
            <p className="text-sm text-zinc-600 italic">Add a description...</p>
          )}
        </button>
      )}
    </div>
  )
}
