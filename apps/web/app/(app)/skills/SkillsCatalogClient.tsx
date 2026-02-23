'use client'

import { useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
  IconBook2,
  IconPlus,
  IconUpload,
  IconSearch,
  IconFolder,
  IconFile,
  IconPlug,
  IconWorld,
  IconBrandTelegram,
  IconBrandGithub,
  IconBrandSlack,
  IconBrandDiscord,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { NativeSelect } from '@/components/ui/native-select'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

const CATEGORIES = [
  'general',
  'coding',
  'ops',
  'writing',
  'research',
  'design',
  'testing',
  'security',
  'custom',
] as const

interface Filters {
  source?: 'admin' | 'plugin'
  category?: string
  search?: string
}

const MAX_VISIBLE_AGENTS = 3

const pluginIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  telegram: IconBrandTelegram,
  github: IconBrandGithub,
  slack: IconBrandSlack,
  discord: IconBrandDiscord,
}

function SkillCard({
  skill,
}: {
  skill: {
    id: string
    name: string
    slug: string
    description: string | null
    category: string
    source_kind: string
    is_directory: number
    enabled: number
    tags_json: string | null
    assignmentCount: number
    assignedAgents: Array<{ id: string; name: string; emoji: string | null }>
    isGlobalAssignment: boolean
    pluginName: string | null
    pluginType: string | null
  }
}) {
  const tags: string[] = skill.tags_json ? (JSON.parse(skill.tags_json) as string[]) : []
  const isDisabled = !skill.enabled
  const isPlugin = skill.source_kind === 'plugin'
  const PluginIcon = skill.pluginType ? (pluginIconMap[skill.pluginType] ?? IconPlug) : IconPlug
  const visibleAgents = skill.assignedAgents.slice(0, MAX_VISIBLE_AGENTS)
  const extraAgentCount = skill.assignedAgents.length - MAX_VISIBLE_AGENTS

  return (
    <Link
      href={`/skills/${skill.id}`}
      className={`group relative flex flex-col rounded-lg border border-white/10 bg-white/[0.02] p-4 transition hover:border-primary/40 hover:bg-white/[0.04] ${isDisabled ? 'opacity-50' : ''}`}
    >
      {/* Top row: icon + agent avatars */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5">
            {isPlugin ? (
              <PluginIcon className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
            ) : skill.is_directory ? (
              <IconFolder className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
            ) : (
              <IconFile className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
            )}
          </div>
        </div>

        {/* Agent avatars — overlapping pill */}
        {(skill.assignedAgents.length > 0 || skill.isGlobalAssignment) && (
          <div className="flex items-center">
            {skill.isGlobalAssignment ? (
              <span
                className="flex h-6 items-center gap-1 rounded-full bg-white/5 px-2 text-[10px] text-muted-foreground"
                title="Assigned to all agents"
              >
                <IconWorld className="h-3 w-3" />
                All
              </span>
            ) : (
              <div className="flex items-center">
                <div className="flex -space-x-1.5">
                  {visibleAgents.map((agent) => (
                    <span
                      key={agent.id}
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-background bg-white/10 text-xs"
                      title={agent.name}
                    >
                      {agent.emoji ?? agent.name.charAt(0).toUpperCase()}
                    </span>
                  ))}
                </div>
                {extraAgentCount > 0 && (
                  <span className="ml-1 text-[10px] text-muted-foreground">+{extraAgentCount}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Name + description */}
      <h3 className="font-medium">{skill.name}</h3>
      {isPlugin && skill.pluginName && (
        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/60">
          <PluginIcon className="h-2.5 w-2.5" />
          From {skill.pluginName}
        </p>
      )}
      {skill.description && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{skill.description}</p>
      )}

      {/* Bottom metadata */}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        <Badge variant="secondary" className="text-[10px]">
          {skill.category}
        </Badge>
        {tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="outline" className="text-[10px] text-muted-foreground">
            {tag}
          </Badge>
        ))}
        {tags.length > 3 && (
          <span className="text-[10px] text-muted-foreground">+{tags.length - 3}</span>
        )}
      </div>
    </Link>
  )
}

function ImportDialog() {
  const [open, setOpen] = useState(false)
  const [importJson, setImportJson] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{
    name: string
    slug: string
    description?: string
    category?: string
    fileCount: number
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const utils = trpc.useUtils()
  const importMutation = trpc.skills.import.useMutation({
    onSuccess: () => {
      void utils.skills.list.invalidate()
      setOpen(false)
      setImportJson('')
      setPreview(null)
      setError(null)
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      setImportJson(text)
      tryParsePreview(text)
    }
    reader.readAsText(file)
  }, [])

  const tryParsePreview = (text: string) => {
    try {
      const data = JSON.parse(text) as {
        skill?: {
          name?: string
          slug?: string
          description?: string
          category?: string
          files?: unknown[]
        }
      }
      if (data.skill) {
        setPreview({
          name: data.skill.name ?? 'Unknown',
          slug: data.skill.slug ?? 'unknown',
          description: data.skill.description,
          category: data.skill.category,
          fileCount: data.skill.files?.length ?? 0,
        })
        setError(null)
      } else {
        setError('Invalid skill format: missing "skill" property.')
        setPreview(null)
      }
    } catch {
      setError('Invalid JSON.')
      setPreview(null)
    }
  }

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importJson) as Record<string, unknown>
      importMutation.mutate({ skill: parsed as never })
    } catch {
      setError('Invalid JSON.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="default">
            <IconUpload className="mr-1.5 h-3.5 w-3.5" />
            Import Skill
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Skill</DialogTitle>
          <DialogDescription>
            Upload a <code>.nitejar-skill.json</code> file or paste the JSON content.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.nitejar-skill.json"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button variant="outline" size="default" onClick={() => fileInputRef.current?.click()}>
              <IconUpload className="mr-1.5 h-3.5 w-3.5" />
              Choose File
            </Button>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Or paste JSON
            </Label>
            <Textarea
              value={importJson}
              onChange={(e) => {
                setImportJson(e.target.value)
                if (e.target.value.trim()) {
                  tryParsePreview(e.target.value)
                } else {
                  setPreview(null)
                  setError(null)
                }
              }}
              placeholder='{"formatVersion": 2, "skill": { ... }}'
              className="h-32 font-mono text-[11px]"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {preview && (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-1">
              <p className="text-xs font-medium">{preview.name}</p>
              <p className="text-[10px] text-muted-foreground">
                Slug: {preview.slug} | Category: {preview.category ?? 'general'} | Files:{' '}
                {preview.fileCount}
              </p>
              {preview.description && (
                <p className="text-[10px] text-muted-foreground">{preview.description}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="default"
            onClick={handleImport}
            disabled={!preview || importMutation.isPending}
          >
            {importMutation.isPending ? 'Importing...' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function SkillsCatalogClient() {
  const [filters, setFilters] = useState<Filters>({})

  const skillsQuery = trpc.skills.list.useQuery(
    {
      source: filters.source,
      category: filters.category,
      search: filters.search,
    },
    { placeholderData: (prev) => prev }
  )

  const skills = skillsQuery.data ?? []

  return (
    <div className="space-y-6">
      {/* Actions bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative">
            <IconSearch className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search skills..."
              value={filters.search ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value || undefined }))}
              className="h-7 w-48 pl-7 text-xs"
            />
          </div>

          {/* Category filter */}
          <NativeSelect
            value={filters.category ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value || undefined }))}
            className="text-xs"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </option>
            ))}
          </NativeSelect>

          {/* Source filter */}
          <NativeSelect
            value={filters.source ?? ''}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                source: (e.target.value || undefined) as 'admin' | 'plugin' | undefined,
              }))
            }
            className="text-xs"
          >
            <option value="">All sources</option>
            <option value="admin">Admin</option>
            <option value="plugin">Plugin</option>
          </NativeSelect>
        </div>

        <div className="flex items-center gap-2">
          <ImportDialog />
          <Button size="default" nativeButton={false} render={<Link href="/skills/new" />}>
            <IconPlus className="mr-1.5 h-3.5 w-3.5" />
            New Skill
          </Button>
        </div>
      </div>

      {/* Loading state */}
      {skillsQuery.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-lg border border-white/5 bg-white/[0.02]"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!skillsQuery.isLoading && skills.length === 0 && (
        <Empty>
          <EmptyMedia>
            <IconBook2 className="h-8 w-8 text-muted-foreground" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No skills yet</EmptyTitle>
            <EmptyDescription>
              Skills teach your agents how to do things. Create your first skill or import one.
            </EmptyDescription>
          </EmptyHeader>
          <Button size="default" nativeButton={false} render={<Link href="/skills/new" />}>
            <IconPlus className="mr-1.5 h-3.5 w-3.5" />
            Create First Skill
          </Button>
        </Empty>
      )}

      {/* Skills grid */}
      {!skillsQuery.isLoading && skills.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill) => (
            <SkillCard key={skill.id} skill={skill} />
          ))}
        </div>
      )}
    </div>
  )
}
