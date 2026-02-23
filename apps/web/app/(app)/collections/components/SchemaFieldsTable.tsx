import { Badge } from '@/components/ui/badge'

export function SchemaFieldsTable({
  fields,
}: {
  fields: Array<{
    name: string
    type: string
    required?: boolean
    description?: string | null
    enumValues?: string[]
  }>
}) {
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">No fields defined.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/10 bg-white/[0.02] text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Required</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2">Enum Values</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.name} className="border-b border-white/5">
              <td className="px-3 py-2 font-mono text-xs">{field.name}</td>
              <td className="px-3 py-2">
                <Badge variant="secondary" className="text-[11px]">
                  {field.type}
                </Badge>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {field.required ? 'Yes' : '\u2014'}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {field.description || '\u2014'}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {field.enumValues?.join(', ') || '\u2014'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
