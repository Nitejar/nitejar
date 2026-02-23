'use client'

import { useMemo, useState } from 'react'
import { IconChevronDown, IconLoader2, IconSearch } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export type ModelRecord = {
  externalId: string
  name: string
  source: string
  isCurated: boolean
  metadata: Record<string, unknown> | null
}

interface ModelSelectProps {
  value?: string
  onChange: (value: string) => void
  disabled?: boolean
  id?: string
  models?: ModelRecord[]
  isLoading?: boolean
}

export function ModelSelect({
  value,
  onChange,
  disabled,
  id,
  models: providedModels,
  isLoading: providedLoading,
}: ModelSelectProps) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('recommended')
  const [query, setQuery] = useState('')

  const internalQuery = trpc.gateway.listModels.useQuery(undefined, {
    enabled: providedModels === undefined,
  })
  const fetchedModels = internalQuery.data?.models
  const models = useMemo<ModelRecord[]>(
    () => providedModels ?? fetchedModels ?? [],
    [providedModels, fetchedModels]
  )
  const isLoading = providedLoading ?? internalQuery.isLoading

  const selectedModel = models.find((model) => model.externalId === value)

  const recommendedModels = useMemo(() => models.filter((model) => model.isCurated), [models])

  const filteredModels = useMemo(() => {
    const search = query.trim().toLowerCase()
    if (!search) return models

    return models.filter((model) => {
      const haystack = `${model.name} ${model.externalId}`.toLowerCase()
      return haystack.includes(search)
    })
  }, [models, query])

  const currentList = tab === 'recommended' ? recommendedModels : filteredModels

  const handleSelect = (modelId: string) => {
    onChange(modelId)
    setOpen(false)
  }

  const renderModelRow = (model: ModelRecord) => {
    const metadata = model.metadata ?? {}
    const contextLength = typeof metadata.contextLength === 'number' ? metadata.contextLength : null
    const supportsTools = Boolean(metadata.supportsTools)
    const provider = model.externalId.split('/')[0] ?? 'openrouter'

    return (
      <button
        key={model.externalId}
        type="button"
        onClick={() => handleSelect(model.externalId)}
        className={cn(
          'flex w-full items-center justify-between gap-3 rounded-md border border-transparent px-3 py-2 text-left text-xs transition',
          value === model.externalId
            ? 'border-primary/40 bg-primary/15'
            : 'hover:border-white/10 hover:bg-white/5'
        )}
      >
        <div className="min-w-0">
          <p className="text-sm text-foreground">{model.name}</p>
          <p className="text-[0.7rem] text-muted-foreground">{model.externalId}</p>
        </div>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="border-white/10 bg-white/5 text-white/70">
            {provider}
          </Badge>
          {contextLength ? (
            <Badge variant="outline" className="border-white/10 bg-white/5 text-white/70">
              {contextLength.toLocaleString()} ctx
            </Badge>
          ) : null}
          {supportsTools ? (
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            >
              tools
            </Badge>
          ) : null}
        </div>
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-between bg-black/20')}
        id={id}
        disabled={disabled}
      >
        <span className="truncate text-left">
          {selectedModel?.name ?? value ?? 'Select a model'}
        </span>
        <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <div className="border-b border-white/10 px-3 pt-3">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="recommended">Recommended</TabsTrigger>
              <TabsTrigger value="all">All Models</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="recommended" className="m-0 p-3">
            <ScrollArea className="h-64 pr-2">
              <div className="space-y-2">
                {isLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading recommended models...
                  </div>
                ) : recommendedModels.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No curated models yet.</p>
                ) : (
                  recommendedModels.map(renderModelRow)
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="all" className="m-0 p-3">
            <div className="mb-3 flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
              <IconSearch className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models"
                className="h-7 border-0 bg-transparent px-0 text-xs focus-visible:ring-0"
              />
            </div>
            <ScrollArea className="h-64 pr-2">
              <div className="space-y-2">
                {isLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading models...
                  </div>
                ) : currentList.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No models match your search.</p>
                ) : (
                  currentList.map(renderModelRow)
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}
