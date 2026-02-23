import { Badge } from '@/components/ui/badge'

type SchemaField = {
  name: string
  type: string
  required?: boolean
  description?: string | null
  enumValues?: string[]
}

type DiffEntry =
  | { kind: 'added'; field: SchemaField }
  | { kind: 'removed'; field: SchemaField }
  | { kind: 'modified'; current: SchemaField; proposed: SchemaField }
  | { kind: 'unchanged'; field: SchemaField }

function diffFields(current: SchemaField[], proposed: SchemaField[]): DiffEntry[] {
  const currentByName = new Map(current.map((f) => [f.name, f]))
  const proposedByName = new Map(proposed.map((f) => [f.name, f]))
  const entries: DiffEntry[] = []

  // Walk proposed fields in order
  for (const field of proposed) {
    const existing = currentByName.get(field.name)
    if (!existing) {
      entries.push({ kind: 'added', field })
    } else if (
      existing.type !== field.type ||
      (existing.required ?? false) !== (field.required ?? false) ||
      (existing.description ?? '') !== (field.description ?? '') ||
      JSON.stringify(existing.enumValues ?? []) !== JSON.stringify(field.enumValues ?? [])
    ) {
      entries.push({ kind: 'modified', current: existing, proposed: field })
    } else {
      entries.push({ kind: 'unchanged', field })
    }
  }

  // Fields removed (in current but not in proposed)
  for (const field of current) {
    if (!proposedByName.has(field.name)) {
      entries.push({ kind: 'removed', field })
    }
  }

  return entries
}

export function SchemaDiff({
  currentFields,
  proposedFields,
}: {
  currentFields: SchemaField[]
  proposedFields: SchemaField[]
}) {
  const entries = diffFields(currentFields, proposedFields)
  const hasChanges = entries.some((e) => e.kind !== 'unchanged')

  if (!hasChanges) {
    return <p className="text-sm text-muted-foreground">No schema changes detected.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/10 bg-white/[0.02] text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 w-8"></th>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Required</th>
            <th className="px-3 py-2">Description</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            if (entry.kind === 'added') {
              return (
                <tr key={entry.field.name} className="border-b border-white/5 bg-emerald-500/5">
                  <td className="px-3 py-2 text-xs font-bold text-emerald-400">+</td>
                  <td className="px-3 py-2 font-mono text-xs text-emerald-300">
                    {entry.field.name}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary" className="text-[11px]">
                      {entry.field.type}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {entry.field.required ? 'Yes' : '\u2014'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {entry.field.description || '\u2014'}
                  </td>
                </tr>
              )
            }

            if (entry.kind === 'removed') {
              return (
                <tr key={entry.field.name} className="border-b border-white/5 bg-red-500/5">
                  <td className="px-3 py-2 text-xs font-bold text-red-400">&minus;</td>
                  <td className="px-3 py-2 font-mono text-xs text-red-300 line-through">
                    {entry.field.name}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary" className="text-[11px] opacity-50">
                      {entry.field.type}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground/50">
                    {entry.field.required ? 'Yes' : '\u2014'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground/50">
                    {entry.field.description || '\u2014'}
                  </td>
                </tr>
              )
            }

            if (entry.kind === 'modified') {
              return (
                <tr key={entry.proposed.name} className="border-b border-white/5 bg-amber-500/5">
                  <td className="px-3 py-2 text-xs font-bold text-amber-400">~</td>
                  <td className="px-3 py-2 font-mono text-xs text-amber-300">
                    {entry.proposed.name}
                  </td>
                  <td className="px-3 py-2">
                    {entry.current.type !== entry.proposed.type ? (
                      <span className="flex items-center gap-1 text-xs">
                        <Badge variant="secondary" className="text-[11px] opacity-50">
                          {entry.current.type}
                        </Badge>
                        <span className="text-muted-foreground">&rarr;</span>
                        <Badge variant="secondary" className="text-[11px]">
                          {entry.proposed.type}
                        </Badge>
                      </span>
                    ) : (
                      <Badge variant="secondary" className="text-[11px]">
                        {entry.proposed.type}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {(entry.current.required ?? false) !== (entry.proposed.required ?? false) ? (
                      <span className="text-amber-300">
                        {entry.current.required ? 'Yes' : '\u2014'} &rarr;{' '}
                        {entry.proposed.required ? 'Yes' : '\u2014'}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {entry.proposed.required ? 'Yes' : '\u2014'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {entry.proposed.description || '\u2014'}
                  </td>
                </tr>
              )
            }

            // unchanged
            return (
              <tr key={entry.field.name} className="border-b border-white/5">
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {entry.field.name}
                </td>
                <td className="px-3 py-2">
                  <Badge variant="secondary" className="text-[11px] opacity-50">
                    {entry.field.type}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground/50">
                  {entry.field.required ? 'Yes' : '\u2014'}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground/50">
                  {entry.field.description || '\u2014'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
