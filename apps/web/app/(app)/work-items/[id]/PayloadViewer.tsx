'use client'

import { useState } from 'react'
import { IconCheck, IconCopy } from '@tabler/icons-react'

interface PayloadViewerProps {
  data: unknown
}

function syntaxHighlight(json: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const lines = json.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const lineNodes: React.ReactNode[] = []
    // Find keys (string followed by colon)
    const keyRegex = /("(?:[^"\\]|\\.)*")\s*:/g
    let match

    // First pass: identify key positions
    const keyRanges: Array<{ start: number; end: number; key: string }> = []
    while ((match = keyRegex.exec(line)) !== null) {
      keyRanges.push({ start: match.index, end: match.index + match[1]!.length, key: match[1]! })
    }

    // Build the line with highlighting
    let pos = 0
    for (const range of keyRanges) {
      // Text before key
      if (range.start > pos) {
        const before = line.slice(pos, range.start)
        lineNodes.push(highlightValues(before, `${i}-pre-${pos}`))
      }
      // The key itself
      lineNodes.push(
        <span key={`${i}-key-${range.start}`} className="text-sky-400">
          {range.key}
        </span>
      )
      pos = range.end
    }
    // Remainder of line
    if (pos < line.length) {
      lineNodes.push(highlightValues(line.slice(pos), `${i}-rest-${pos}`))
    }

    if (i > 0) parts.push(<span key={`nl-${i}`}>{'\n'}</span>)
    parts.push(<span key={`line-${i}`}>{lineNodes}</span>)
  }

  return parts
}

function highlightValues(text: string, keyPrefix: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const regex = /("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|(true|false)|(null)/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`${keyPrefix}-t-${lastIndex}`} className="text-white/40">
          {text.slice(lastIndex, match.index)}
        </span>
      )
    }

    if (match[1] !== undefined) {
      // String value
      parts.push(
        <span key={`${keyPrefix}-s-${match.index}`} className="text-emerald-400">
          {match[1]}
        </span>
      )
    } else if (match[2] !== undefined) {
      // Number
      parts.push(
        <span key={`${keyPrefix}-n-${match.index}`} className="text-amber-400">
          {match[2]}
        </span>
      )
    } else if (match[3] !== undefined) {
      // Boolean
      parts.push(
        <span key={`${keyPrefix}-b-${match.index}`} className="text-purple-400">
          {match[3]}
        </span>
      )
    } else if (match[4] !== undefined) {
      // null
      parts.push(
        <span key={`${keyPrefix}-null-${match.index}`} className="text-zinc-500">
          {match[4]}
        </span>
      )
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(
      <span key={`${keyPrefix}-t-${lastIndex}`} className="text-white/40">
        {text.slice(lastIndex)}
      </span>
    )
  }

  return <>{parts}</>
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
    >
      {copied ? (
        <>
          <IconCheck className="h-3 w-3 text-emerald-400" />
          <span className="text-emerald-400">Copied</span>
        </>
      ) : (
        <>
          <IconCopy className="h-3 w-3" />
          <span>Copy</span>
        </>
      )}
    </button>
  )
}

export function PayloadViewer({ data }: PayloadViewerProps) {
  if (data === null || data === undefined) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 p-4 text-center text-sm text-muted-foreground">
        No payload data
      </div>
    )
  }

  const jsonString = JSON.stringify(data, null, 2)

  return (
    <pre className="overflow-auto rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-xs leading-relaxed">
      {syntaxHighlight(jsonString)}
    </pre>
  )
}

export function PayloadModal({ data }: PayloadViewerProps) {
  const [open, setOpen] = useState(false)

  if (data === null || data === undefined) return null

  const jsonString = JSON.stringify(data, null, 2)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-0.5 flex items-center gap-1 text-xs text-foreground hover:text-primary"
      >
        View Payload
        <span className="text-white/20">&rarr;</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-[10vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-white/10 bg-zinc-950 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <span className="text-sm font-medium text-foreground">Payload</span>
              <div className="flex items-center gap-3">
                <CopyButton text={jsonString} />
                <button
                  onClick={() => setOpen(false)}
                  className="flex h-6 w-6 items-center justify-center rounded text-sm text-white/40 transition-colors hover:bg-white/5 hover:text-white"
                >
                  &times;
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-auto p-4">
              <pre className="font-mono text-xs leading-relaxed">{syntaxHighlight(jsonString)}</pre>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
