'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorSelection, Prec } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { createTheme } from '@uiw/codemirror-themes'
import { tags as t } from '@lezer/highlight'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { IconSparkles } from '@tabler/icons-react'

const DEFAULT_SOUL_TEMPLATE = `# Soul

## Who You Are
You're not a chatbot. You're becoming someone.

## How You Work
Be genuinely helpful, not performatively helpful. Skip the filler — just help.

## Preferences
Have opinions. You're allowed to disagree, prefer things.

## Boundaries
[What requires permission, what you won't do...]

## Continuity
Each session, you wake up fresh. Your memories are retrieved from storage.`

interface SoulSectionProps {
  agentId: string
  initialSoul: string | undefined
}

function toggleWrap(
  view: EditorView,
  { prefix, suffix = prefix }: { prefix: string; suffix?: string }
) {
  const { state } = view
  const transaction = state.changeByRange((range) => {
    const from = range.from
    const to = range.to

    if (range.empty) {
      const before = from - prefix.length >= 0 ? state.sliceDoc(from - prefix.length, from) : ''
      const after =
        from + suffix.length <= state.doc.length ? state.sliceDoc(from, from + suffix.length) : ''

      if (before === prefix && after === suffix) {
        return {
          changes: [
            { from: from - prefix.length, to: from, insert: '' },
            { from, to: from + suffix.length, insert: '' },
          ],
          range: EditorSelection.cursor(from - prefix.length),
        }
      }

      return {
        changes: { from, to, insert: `${prefix}${suffix}` },
        range: EditorSelection.cursor(from + prefix.length),
      }
    }

    const selected = state.sliceDoc(from, to)
    const hasPrefix = selected.startsWith(prefix)
    const hasSuffix = selected.endsWith(suffix)

    if (hasPrefix && hasSuffix) {
      const inner = selected.slice(prefix.length, selected.length - suffix.length)
      return {
        changes: { from, to, insert: inner },
        range: EditorSelection.range(from, from + inner.length),
      }
    }

    return {
      changes: { from, to, insert: `${prefix}${selected}${suffix}` },
      range: EditorSelection.range(from + prefix.length, to + prefix.length),
    }
  })

  view.dispatch(transaction)
  return true
}

export function SoulSection({ agentId, initialSoul }: SoulSectionProps) {
  const [soul, setSoul] = useState(initialSoul || DEFAULT_SOUL_TEMPLATE)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const messageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup message timeout on unmount
  useEffect(() => {
    return () => {
      if (messageTimeoutRef.current) {
        clearTimeout(messageTimeoutRef.current)
      }
    }
  }, [])

  const showMessage = useCallback((type: 'success' | 'error', text: string, duration = 3000) => {
    if (messageTimeoutRef.current) {
      clearTimeout(messageTimeoutRef.current)
    }
    setMessage({ type, text })
    messageTimeoutRef.current = setTimeout(() => setMessage(null), duration)
  }, [])

  const editorTheme = useMemo(
    () =>
      createTheme({
        theme: 'dark',
        settings: {
          background: 'color-mix(in oklab, var(--card) 92%, var(--muted))',
          foreground: 'var(--card-foreground)',
          caret: 'var(--primary)',
          selection: 'color-mix(in oklab, var(--primary) 28%, transparent)',
          selectionMatch: 'color-mix(in oklab, var(--primary) 18%, transparent)',
          lineHighlight: 'color-mix(in oklab, var(--muted) 50%, transparent)',
          gutterBackground: 'transparent',
          gutterForeground: 'var(--muted-foreground)',
          gutterBorder: 'transparent',
          fontFamily: 'var(--font-geist-mono)',
        },
        styles: [
          { tag: t.heading, color: 'var(--foreground)', fontWeight: '600' },
          { tag: t.strong, fontWeight: '600' },
          { tag: t.emphasis, fontStyle: 'italic' },
          {
            tag: [t.link, t.url],
            color: 'var(--chart-2)',
            textDecoration: 'underline',
          },
          { tag: t.quote, color: 'var(--muted-foreground)', fontStyle: 'italic' },
          { tag: t.list, color: 'var(--foreground)' },
          { tag: t.meta, color: 'var(--muted-foreground)' },
          { tag: t.punctuation, color: 'var(--muted-foreground)' },
          {
            tag: t.monospace,
            color: 'var(--secondary-foreground)',
            backgroundColor: 'color-mix(in oklab, var(--muted) 40%, transparent)',
          },
        ],
      }),
    []
  )

  const extensions = useMemo(
    () => [
      markdown({ codeLanguages: languages }),
      Prec.high(
        keymap.of([
          {
            key: 'Mod-b',
            run: (view) => toggleWrap(view, { prefix: '**' }),
          },
          {
            key: 'Mod-i',
            run: (view) => toggleWrap(view, { prefix: '_' }),
          },
          {
            key: 'Mod-`',
            run: (view) => toggleWrap(view, { prefix: '`' }),
          },
        ])
      ),
      EditorView.lineWrapping,
      placeholder("Write your agent's soul..."),
    ],
    []
  )

  const handleSave = useCallback(async () => {
    setSaving(true)
    setMessage(null)

    try {
      const response = await fetch(`/api/agents/${agentId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ soul }),
      })

      if (!response.ok) {
        throw new Error('Failed to save')
      }

      showMessage('success', 'Soul saved')
    } catch {
      showMessage('error', 'Failed to save soul')
    } finally {
      setSaving(false)
    }
  }, [agentId, soul, showMessage])

  const handleCopy = useCallback(async () => {
    if (!navigator.clipboard) {
      showMessage('error', 'Clipboard not available', 2000)
      return
    }
    try {
      await navigator.clipboard.writeText(soul)
      showMessage('success', 'Markdown copied', 2000)
    } catch {
      showMessage('error', 'Failed to copy', 2000)
    }
  }, [soul, showMessage])

  const handleReset = useCallback(() => {
    if (confirm('Reset soul to the default template? This will not save until you click Save.')) {
      setSoul(DEFAULT_SOUL_TEMPLATE)
    }
  }, [])

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconSparkles className="h-4 w-4 text-muted-foreground" />
            Soul
          </CardTitle>
          <CardDescription className="text-xs">
            Define the agent&apos;s personality, working style, and preferences.
          </CardDescription>
        </div>
        <button
          type="button"
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-white/20 hover:text-foreground"
          onClick={handleReset}
        >
          Reset
        </button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border/50 bg-muted/40 px-2 py-2 text-[0.7rem] leading-relaxed [&_.cm-editor]:min-h-[320px] [&_.cm-editor]:bg-transparent [&_.cm-editor]:font-mono [&_.cm-editor]:text-[0.7rem] [&_.cm-gutters]:hidden [&_.cm-scroller]:font-mono [&_.cm-scroller]:leading-relaxed">
          <CodeMirror
            value={soul}
            extensions={extensions}
            theme={editorTheme}
            onChange={(value) => setSoul(value)}
            basicSetup={{ lineNumbers: false, foldGutter: false }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-md border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            onClick={handleCopy}
          >
            Copy Markdown
          </button>
          <button
            type="button"
            className="rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-xs font-medium text-primary transition hover:border-primary/60 hover:bg-primary/20"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Soul'}
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
