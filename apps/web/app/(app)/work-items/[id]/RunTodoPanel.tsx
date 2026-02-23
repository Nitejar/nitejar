'use client'

interface RunTodoItem {
  id: string
  text: string
  status: 'open' | 'done'
  created_at: number
  done_at: number | null
}

interface RunTodoState {
  version: number
  updated_at: number
  items: RunTodoItem[]
}

interface RunTodoPanelProps {
  todoState: string | null | undefined
  /** When true, removes top border and border-radius to connect with sibling cards */
  connected?: boolean
  /** Adds bottom border-radius (use when this is the last connected element) */
  roundedBottom?: boolean
}

function parseRunTodoState(raw: string | null | undefined): {
  state: RunTodoState
  malformed: boolean
} {
  const emptyState: RunTodoState = { version: 1, updated_at: 0, items: [] }
  if (!raw) return { state: emptyState, malformed: false }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const itemsRaw = parsed.items
    if (!Array.isArray(itemsRaw)) {
      return { state: emptyState, malformed: true }
    }

    const items: RunTodoItem[] = []
    for (const row of itemsRaw) {
      if (!row || typeof row !== 'object') {
        return { state: emptyState, malformed: true }
      }

      const item = row as Record<string, unknown>
      if (
        typeof item.id !== 'string' ||
        typeof item.text !== 'string' ||
        (item.status !== 'open' && item.status !== 'done') ||
        typeof item.created_at !== 'number' ||
        (typeof item.done_at !== 'number' && item.done_at !== null)
      ) {
        return { state: emptyState, malformed: true }
      }

      items.push({
        id: item.id,
        text: item.text,
        status: item.status,
        created_at: item.created_at,
        done_at: item.done_at,
      })
    }

    return {
      state: {
        version: typeof parsed.version === 'number' ? parsed.version : 1,
        updated_at: typeof parsed.updated_at === 'number' ? parsed.updated_at : 0,
        items,
      },
      malformed: false,
    }
  } catch {
    return { state: emptyState, malformed: true }
  }
}

export function RunTodoPanel({ todoState, connected, roundedBottom }: RunTodoPanelProps) {
  const { state, malformed } = parseRunTodoState(todoState)
  const openItems = state.items.filter((item) => item.status === 'open')
  const doneItems = state.items.filter((item) => item.status === 'done')

  if (state.items.length === 0 && !malformed) return null

  return (
    <div
      className={`border border-white/10 bg-black/20 p-3 ${
        connected ? 'border-t-0' : 'rounded-lg'
      } ${roundedBottom ? 'rounded-b-lg' : ''}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Run Todo</span>
        <span className="text-[10px] text-muted-foreground">
          {openItems.length} open · {doneItems.length} done
        </span>
      </div>

      {malformed && (
        <p className="mb-2 text-[10px] text-amber-400">Stored todo state is malformed.</p>
      )}

      {state.items.length > 0 && (
        <div className="space-y-2">
          {openItems.length > 0 && (
            <div className="space-y-1">
              {openItems.map((item) => (
                <div key={item.id} className="text-xs text-foreground/90">
                  <span className="mr-2 text-emerald-400">[ ]</span>
                  {item.text}
                </div>
              ))}
            </div>
          )}
          {doneItems.length > 0 && (
            <div className="space-y-1">
              {doneItems.map((item) => (
                <div key={item.id} className="text-xs text-muted-foreground line-through">
                  <span className="mr-2 text-muted-foreground">[x]</span>
                  {item.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
