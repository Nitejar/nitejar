import type { ActivityLogEntry } from '@nitejar/database'

interface TriagePanelProps {
  entry: ActivityLogEntry
  /** When true, removes top border and border-radius to connect with sibling cards */
  connected?: boolean
}

function parseResources(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === 'string') : []
  } catch {
    return []
  }
}

function statusDotColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-400'
    case 'failed':
      return 'bg-red-400'
    case 'starting':
      return 'bg-blue-400 animate-pulse'
    case 'passed':
      return 'bg-yellow-400/60'
    default:
      return 'bg-white/30'
  }
}

export function TriagePanel({ entry, connected }: TriagePanelProps) {
  const resources = parseResources(entry.resources)

  return (
    <div
      className={`border border-white/10 bg-black/20 px-3 py-2.5 ${
        connected ? 'border-t-0' : 'rounded-lg'
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${statusDotColor(entry.status)}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-foreground/80">
            <span className="font-medium text-foreground/60">
              {entry.status === 'passed' ? 'Pass:' : 'Triage:'}
            </span>{' '}
            {entry.summary}
          </p>
          {resources.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {resources.map((resource) => (
                <span
                  key={resource}
                  className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[0.6rem] text-white/40"
                >
                  {resource}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
