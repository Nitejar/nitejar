'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SetupField } from '@nitejar/plugin-handlers'

interface DynamicFieldsProps {
  fields: SetupField[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  idPrefix?: string
}

export function DynamicFields({
  fields,
  values,
  onChange,
  idPrefix = 'field',
}: DynamicFieldsProps) {
  return (
    <>
      {fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-${field.key}`}>{field.label}</Label>
          {field.type === 'text' || field.type === 'password' ? (
            <Input
              id={`${idPrefix}-${field.key}`}
              type={field.type}
              value={(values[field.key] as string) ?? ''}
              onChange={(e) => onChange(field.key, (e.target as HTMLInputElement).value)}
              placeholder={field.placeholder}
              required={field.required}
            />
          ) : field.type === 'select' ? (
            (() => {
              const selectedValue = (values[field.key] as string) ?? field.options?.[0]?.value ?? ''
              const selectedLabel =
                field.options?.find((option) => option.value === selectedValue)?.label ??
                'Select option'

              return (
                <Select value={selectedValue} onValueChange={(value) => onChange(field.key, value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{selectedLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {field.options?.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            })()
          ) : field.type === 'boolean' ? (
            <div className="flex items-center gap-2">
              <Switch
                checked={Boolean(values[field.key])}
                onCheckedChange={(checked) => onChange(field.key, checked)}
              />
              <span className="text-xs text-muted-foreground">{field.helpText}</span>
            </div>
          ) : null}
          {field.helpText && field.type !== 'boolean' && (
            <p className="text-xs text-muted-foreground">{field.helpText}</p>
          )}
        </div>
      ))}
    </>
  )
}
