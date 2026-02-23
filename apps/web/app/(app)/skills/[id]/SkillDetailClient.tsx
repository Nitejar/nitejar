'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  IconFile,
  IconFolder,
  IconLock,
  IconPlug,
  IconPlus,
  IconTrash,
  IconCopy,
  IconDownload,
  IconWorld,
  IconUsers,
  IconRobot,
  IconAlertTriangle,
  IconSettings,
  IconBrandTelegram,
  IconBrandGithub,
  IconBrandSlack,
  IconBrandDiscord,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { NativeSelect } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

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

const scopeIcons = {
  global: IconWorld,
  team: IconUsers,
  agent: IconRobot,
}

const pluginIconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  telegram: IconBrandTelegram,
  github: IconBrandGithub,
  slack: IconBrandSlack,
  discord: IconBrandDiscord,
}

// ============================================================================
// File Browser Sidebar (for directory skills)
// ============================================================================
function FileBrowser({
  files,
  selectedFile,
  onSelectFile,
  onSelectMain,
  isMainSelected,
}: {
  files: Array<{ id: string; relative_path: string; content: string }>
  selectedFile: string | null
  onSelectFile: (path: string) => void
  onSelectMain: () => void
  isMainSelected: boolean
}) {
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onSelectMain}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition ${
          isMainSelected
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
        }`}
      >
        <IconFile className="h-3.5 w-3.5" />
        SKILL.md
      </button>
      {files.map((file) => (
        <button
          key={file.id}
          type="button"
          onClick={() => onSelectFile(file.relative_path)}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition ${
            selectedFile === file.relative_path
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
          }`}
        >
          <IconFile className="h-3.5 w-3.5" />
          {file.relative_path}
        </button>
      ))}
    </div>
  )
}

// ============================================================================
// Assign Skill Dialog
// ============================================================================
function AssignDialog({ skillId, onAssigned }: { skillId: string; onAssigned: () => void }) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'global' | 'team' | 'agent'>('global')
  const [scopeId, setScopeId] = useState('')
  const [autoInject, setAutoInject] = useState(false)
  const [priority, setPriority] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const agentsQuery = trpc.org.listAgents.useQuery(undefined, {
    enabled: open && scope === 'agent',
  })

  const assignMutation = trpc.skills.assign.useMutation({
    onSuccess: () => {
      setOpen(false)
      setScopeId('')
      setAutoInject(false)
      setPriority(0)
      setError(null)
      onAssigned()
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  const handleAssign = () => {
    setError(null)
    if ((scope === 'team' || scope === 'agent') && !scopeId.trim()) {
      setError(`${scope === 'team' ? 'Team' : 'Agent'} ID is required.`)
      return
    }
    assignMutation.mutate({
      skillId,
      scope,
      scopeId: scope === 'global' ? undefined : scopeId.trim(),
      priority,
      autoInject,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <IconPlus className="mr-1 h-3 w-3" />
            Assign
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Skill</DialogTitle>
          <DialogDescription>Assign this skill to an agent, team, or globally.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Scope
            </Label>
            <NativeSelect
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as 'global' | 'team' | 'agent')
                setScopeId('')
              }}
              className="w-full text-xs"
            >
              <option value="global">Global (all agents)</option>
              <option value="team">Team</option>
              <option value="agent">Agent</option>
            </NativeSelect>
          </div>

          {scope === 'agent' && (
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Agent
              </Label>
              {agentsQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">Loading agents...</p>
              ) : agentsQuery.data && agentsQuery.data.length > 0 ? (
                <NativeSelect
                  value={scopeId}
                  onChange={(e) => setScopeId(e.target.value)}
                  className="w-full text-xs"
                >
                  <option value="">Select an agent...</option>
                  {agentsQuery.data.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} (@{agent.handle})
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <p className="text-xs text-muted-foreground">No agents found.</p>
              )}
            </div>
          )}

          {scope === 'team' && (
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Team ID
              </Label>
              <Input
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                placeholder="Enter team ID..."
                className="font-mono text-xs"
              />
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Priority
            </Label>
            <Input
              type="number"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
              className="w-20 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Higher priority = listed earlier in the system prompt.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={autoInject} onCheckedChange={setAutoInject} size="sm" />
            <Label className="text-xs">Auto-inject description into system prompt</Label>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button onClick={handleAssign} disabled={assignMutation.isPending}>
            {assignMutation.isPending ? 'Assigning...' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Duplicate Dialog
// ============================================================================
function DuplicateDialog({ skillId, originalSlug }: { skillId: string; originalSlug: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [newSlug, setNewSlug] = useState(`${originalSlug}-copy`)
  const [error, setError] = useState<string | null>(null)

  const duplicateMutation = trpc.skills.duplicate.useMutation({
    onSuccess: (data) => {
      setOpen(false)
      router.push(`/skills/${data.id}`)
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <IconCopy className="mr-1 h-3 w-3" />
            Duplicate
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate Skill</DialogTitle>
          <DialogDescription>Create a copy of this skill with a new slug.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              New Slug
            </Label>
            <Input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              setError(null)
              duplicateMutation.mutate({ skillId, newSlug })
            }}
            disabled={duplicateMutation.isPending}
          >
            {duplicateMutation.isPending ? 'Duplicating...' : 'Duplicate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Main Detail Client
// ============================================================================
export function SkillDetailClient({ skillId }: { skillId: string }) {
  const router = useRouter()
  const utils = trpc.useUtils()

  const skillQuery = trpc.skills.get.useQuery({ skillId })
  const assignmentsQuery = trpc.skills.listAssignments.useQuery({ skillId })

  // Edit state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('general')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagsInput, setTagsInput] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [dirty, setDirty] = useState(false)

  // Metadata disclosure
  const [showMetadata, setShowMetadata] = useState(false)

  // File editing
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileDirty, setFileDirty] = useState(false)
  const [isMainSelected, setIsMainSelected] = useState(true)

  // New file form
  const [showNewFile, setShowNewFile] = useState(false)
  const [newFilePath, setNewFilePath] = useState('')
  const [newFileContent, setNewFileContent] = useState('')

  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  // Initialize state from query data
  useEffect(() => {
    if (skillQuery.data) {
      const skill = skillQuery.data
      setName(skill.name)
      setDescription(skill.description ?? '')
      setCategory(skill.category)
      setContent(skill.content)
      setTags(skill.tags_json ? (JSON.parse(skill.tags_json) as string[]) : [])
      setEnabled(skill.enabled === 1)
      setDirty(false)
    }
  }, [skillQuery.data])

  const isPluginSkill = skillQuery.data?.source_kind === 'plugin'
  const isDirectory = skillQuery.data?.is_directory === 1
  const files = useMemo(() => skillQuery.data?.files ?? [], [skillQuery.data?.files])
  const pluginType = skillQuery.data?.pluginType ?? null
  const PluginIcon = pluginType ? (pluginIconMap[pluginType] ?? IconPlug) : IconPlug

  // Mutations
  const updateMutation = trpc.skills.update.useMutation({
    onSuccess: () => {
      void utils.skills.get.invalidate({ skillId })
      void utils.skills.list.invalidate()
      setSaveMessage({ type: 'success', text: 'Saved' })
      setDirty(false)
      setTimeout(() => setSaveMessage(null), 3000)
    },
    onError: (err) => {
      setSaveMessage({ type: 'error', text: err.message })
    },
  })

  const updateFileMutation = trpc.skills.updateFile.useMutation({
    onSuccess: () => {
      void utils.skills.get.invalidate({ skillId })
      setSaveMessage({ type: 'success', text: 'File saved' })
      setFileDirty(false)
      setTimeout(() => setSaveMessage(null), 3000)
    },
    onError: (err) => {
      setSaveMessage({ type: 'error', text: err.message })
    },
  })

  const addFileMutation = trpc.skills.addFile.useMutation({
    onSuccess: () => {
      void utils.skills.get.invalidate({ skillId })
      setShowNewFile(false)
      setNewFilePath('')
      setNewFileContent('')
    },
    onError: (err) => {
      setSaveMessage({ type: 'error', text: err.message })
    },
  })

  const removeFileMutation = trpc.skills.removeFile.useMutation({
    onSuccess: () => {
      void utils.skills.get.invalidate({ skillId })
      if (selectedFile) {
        setSelectedFile(null)
        setIsMainSelected(true)
      }
    },
    onError: (err) => {
      setSaveMessage({ type: 'error', text: err.message })
    },
  })

  const deleteMutation = trpc.skills.delete.useMutation({
    onSuccess: () => {
      router.push('/skills')
    },
  })

  const removeAssignmentMutation = trpc.skills.removeAssignment.useMutation({
    onSuccess: () => {
      void utils.skills.listAssignments.invalidate({ skillId })
    },
  })

  const exportMutation = trpc.skills.export.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${skillQuery.data?.slug ?? 'skill'}.nitejar-skill.json`
      a.click()
      URL.revokeObjectURL(url)
    },
  })

  const handleSave = () => {
    setSaveMessage(null)
    updateMutation.mutate({
      skillId,
      name: name.trim(),
      description: description.trim() || null,
      category: category as (typeof CATEGORIES)[number],
      content,
      tags: tags.length > 0 ? tags : undefined,
      enabled,
    })
  }

  const handleSaveFile = () => {
    if (!selectedFile) return
    updateFileMutation.mutate({
      skillId,
      relativePath: selectedFile,
      content: fileContent,
    })
  }

  const handleSelectFile = useCallback(
    (path: string) => {
      const file = files.find((f) => f.relative_path === path)
      if (file) {
        setSelectedFile(path)
        setFileContent(file.content)
        setIsMainSelected(false)
        setFileDirty(false)
      }
    },
    [files]
  )

  const handleSelectMain = useCallback(() => {
    setSelectedFile(null)
    setIsMainSelected(true)
    setFileDirty(false)
  }, [])

  const handleAddTag = useCallback(() => {
    const tag = tagsInput
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
    if (tag && !tags.includes(tag) && tags.length < 20) {
      setTags((prev) => [...prev, tag])
      setTagsInput('')
      setDirty(true)
    }
  }, [tagsInput, tags])

  const handleRemoveTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag))
    setDirty(true)
  }

  const handleDelete = () => {
    if (
      !confirm(
        'Are you sure you want to delete this skill? This cannot be undone. All assignments will be removed.'
      )
    )
      return
    deleteMutation.mutate({ skillId })
  }

  if (skillQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-white/5" />
        <div className="h-64 animate-pulse rounded-lg border border-white/5 bg-white/[0.02]" />
      </div>
    )
  }

  if (skillQuery.error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
        <p className="text-sm text-destructive">Skill not found.</p>
      </div>
    )
  }

  const skill = skillQuery.data
  if (!skill) return null

  const assignments = assignmentsQuery.data ?? []

  return (
    <div className="space-y-6">
      {/* Header — absorbs old Details sidebar */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5">
              {isPluginSkill ? (
                <PluginIcon className="h-6 w-6 text-muted-foreground" />
              ) : isDirectory ? (
                <IconFolder className="h-6 w-6 text-muted-foreground" />
              ) : (
                <IconFile className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-semibold">{skill.name}</h2>
                <span
                  className={`h-2 w-2 rounded-full ${skill.enabled ? 'bg-emerald-400' : 'bg-zinc-500'}`}
                  title={skill.enabled ? 'Active' : 'Inactive'}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                <Badge variant="secondary" className="mr-1.5 text-[10px]">
                  {skill.category}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">{skill.slug}</span>
              </p>
              {isPluginSkill && skill.pluginName && (
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                  <PluginIcon className="h-2.5 w-2.5" />
                  From{' '}
                  {pluginType ? (
                    <Link
                      href={`/plugins/${pluginType}`}
                      className="text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {skill.pluginName}
                    </Link>
                  ) : (
                    skill.pluginName
                  )}
                </p>
              )}
              <p className="text-[10px] text-muted-foreground/50" title={`Skill ID: ${skill.id}`}>
                Created {new Date(skill.created_at * 1000).toLocaleDateString()} · Updated{' '}
                {new Date(skill.updated_at * 1000).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* Right side: actions */}
        <div className="flex items-center gap-2">
          {!isPluginSkill && (
            <button
              type="button"
              className="rounded-md border border-white/10 p-1.5 text-muted-foreground transition hover:border-white/20 hover:text-foreground"
              onClick={() => setShowMetadata(!showMetadata)}
              title="Skill settings"
            >
              <IconSettings className="h-3.5 w-3.5" />
            </button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportMutation.mutate({ skillId })}
            disabled={exportMutation.isPending}
          >
            <IconDownload className="mr-1 h-3 w-3" />
            Export
          </Button>
          <DuplicateDialog skillId={skillId} originalSlug={skill.slug} />
        </div>
      </div>

      {/* Plugin info bar */}
      {isPluginSkill && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
          <IconLock className="h-4 w-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-amber-300">Read-only — managed by a plugin</p>
            <p className="text-[10px] text-amber-400/70">
              This skill&apos;s content is synced from a plugin and cannot be edited here.
            </p>
          </div>
          <Link
            href={pluginType ? `/plugins/${pluginType}` : '/plugins'}
            className="shrink-0 rounded-md border border-amber-500/30 px-2.5 py-1 text-[10px] font-medium text-amber-400 transition hover:border-amber-500/50 hover:bg-amber-500/10"
          >
            View Plugin
          </Link>
        </div>
      )}

      {/* Metadata disclosure (gear toggle) */}
      {showMetadata && !isPluginSkill && (
        <div className="space-y-4 rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground">Name</Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setDirty(true)
                }}
                className="text-xs"
                maxLength={128}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground">Category</Label>
              <NativeSelect
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value)
                  setDirty(true)
                }}
                className="w-full text-xs"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-foreground">Description</Label>
            <Input
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                setDirty(true)
              }}
              className="text-xs"
              placeholder="What does this skill do?"
            />
            <p className="text-[10px] text-muted-foreground">
              Short summary shown in the skills catalog and injected when auto-inject is on.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-foreground">Tags</Label>
            <div className="flex gap-1.5">
              <Input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddTag()
                  }
                }}
                placeholder="Add tag..."
                className="text-xs"
              />
              <Button variant="outline" size="default" onClick={handleAddTag}>
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="cursor-pointer text-[10px]"
                    onClick={() => handleRemoveTag(tag)}
                  >
                    {tag} &times;
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5 border-t border-white/5 pt-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs text-foreground">Active</Label>
                <p className="text-[10px] text-muted-foreground">
                  Inactive skills are hidden from agents.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(val) => {
                  setEnabled(val)
                  setDirty(true)
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-3">
            {saveMessage && (
              <span
                className={`text-[10px] ${
                  saveMessage.type === 'success' ? 'text-emerald-400' : 'text-destructive'
                }`}
              >
                {saveMessage.text}
              </span>
            )}
            <button
              type="button"
              className="h-7 rounded-md border border-primary/40 bg-primary/15 px-3 text-xs font-medium text-primary transition hover:border-primary/60 hover:bg-primary/20"
              onClick={handleSave}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? '...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Single-column flow */}
      <div className="space-y-6">
        {/* Editor section */}
        {isDirectory ? (
          <Card className="border-white/10 bg-white/[0.02]">
            <CardContent className="p-0">
              <div className="flex min-h-[400px]">
                {/* File browser sidebar */}
                <div className="w-48 shrink-0 border-r border-white/10 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Files ({files.length + 1})
                    </span>
                    {!isPluginSkill && (
                      <Button variant="ghost" size="icon-xs" onClick={() => setShowNewFile(true)}>
                        <IconPlus className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <FileBrowser
                    files={files}
                    selectedFile={selectedFile}
                    onSelectFile={handleSelectFile}
                    onSelectMain={handleSelectMain}
                    isMainSelected={isMainSelected}
                  />
                </div>

                {/* Editor area */}
                <div className="flex-1 p-3">
                  {isMainSelected ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">SKILL.md</span>
                        {!isPluginSkill && dirty && (
                          <Button
                            size="sm"
                            onClick={handleSave}
                            disabled={updateMutation.isPending}
                          >
                            {updateMutation.isPending ? 'Saving...' : 'Save'}
                          </Button>
                        )}
                      </div>
                      <Textarea
                        value={content}
                        onChange={(e) => {
                          setContent(e.target.value)
                          setDirty(true)
                        }}
                        className={`min-h-[350px] font-mono text-xs ${isPluginSkill ? 'cursor-not-allowed opacity-60' : ''}`}
                        readOnly={isPluginSkill}
                      />
                    </div>
                  ) : selectedFile ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-medium">{selectedFile}</span>
                        <div className="flex items-center gap-2">
                          {!isPluginSkill && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => {
                                if (confirm(`Delete ${selectedFile}?`)) {
                                  removeFileMutation.mutate({
                                    skillId,
                                    relativePath: selectedFile,
                                  })
                                }
                              }}
                            >
                              <IconTrash className="h-3 w-3 text-destructive" />
                            </Button>
                          )}
                          {!isPluginSkill && fileDirty && (
                            <Button
                              size="sm"
                              onClick={handleSaveFile}
                              disabled={updateFileMutation.isPending}
                            >
                              {updateFileMutation.isPending ? 'Saving...' : 'Save File'}
                            </Button>
                          )}
                        </div>
                      </div>
                      <Textarea
                        value={fileContent}
                        onChange={(e) => {
                          setFileContent(e.target.value)
                          setFileDirty(true)
                        }}
                        className={`min-h-[350px] font-mono text-xs ${isPluginSkill ? 'cursor-not-allowed opacity-60' : ''}`}
                        readOnly={isPluginSkill}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Select a file to edit.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          /* Simple skill: just the main editor */
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">SKILL.md Content</CardTitle>
              {!isPluginSkill && dirty && (
                <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <Textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  setDirty(true)
                }}
                className={`min-h-[400px] font-mono text-xs ${isPluginSkill ? 'cursor-not-allowed opacity-60' : ''}`}
                readOnly={isPluginSkill}
              />
            </CardContent>
          </Card>
        )}

        {/* Add new file dialog (inline) */}
        {showNewFile && !isPluginSkill && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Add Supporting File</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Relative Path
                </Label>
                <Input
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  placeholder="e.g., references/guide.md"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Content
                </Label>
                <Textarea
                  value={newFileContent}
                  onChange={(e) => setNewFileContent(e.target.value)}
                  placeholder="File content..."
                  className="min-h-[150px] font-mono text-xs"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    if (!newFilePath.trim()) return
                    addFileMutation.mutate({
                      skillId,
                      relativePath: newFilePath.trim(),
                      content: newFileContent,
                    })
                  }}
                  disabled={addFileMutation.isPending}
                >
                  {addFileMutation.isPending ? 'Adding...' : 'Add File'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowNewFile(false)
                    setNewFilePath('')
                    setNewFileContent('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Assigned To — dense rows */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base">Assigned To</CardTitle>
              <CardDescription className="text-xs">
                {assignments.length} assignment{assignments.length !== 1 ? 's' : ''}
              </CardDescription>
            </div>
            <AssignDialog
              skillId={skillId}
              onAssigned={() => void utils.skills.listAssignments.invalidate({ skillId })}
            />
          </CardHeader>
          <CardContent>
            {assignmentsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : assignments.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/10 py-4">
                <p className="text-xs text-muted-foreground">No assignments</p>
                <p className="mt-1 text-[10px] text-muted-foreground/60">
                  Assign this skill to agents, teams, or globally.
                </p>
              </div>
            ) : (
              <div className="max-h-[240px] overflow-y-auto rounded-md border border-white/10">
                {assignments.map((assignment, idx) => {
                  const ScopeIcon =
                    scopeIcons[assignment.scope as keyof typeof scopeIcons] ?? IconWorld
                  const isAgent = assignment.scope === 'agent'
                  const displayName =
                    isAgent && assignment.agentName
                      ? assignment.agentName
                      : assignment.scope === 'global'
                        ? 'All agents'
                        : assignment.scope
                  const displayHandle =
                    isAgent && assignment.agentHandle
                      ? `@${assignment.agentHandle}`
                      : assignment.scope_id
                        ? assignment.scope_id.slice(0, 8) + '...'
                        : null
                  return (
                    <div
                      key={assignment.id}
                      className={`group flex items-center gap-2 px-2.5 py-1.5 ${idx > 0 ? 'border-t border-white/5' : ''}`}
                    >
                      {isAgent && assignment.agentEmoji ? (
                        <span className="shrink-0 text-sm" title={assignment.scope}>
                          {assignment.agentEmoji}
                        </span>
                      ) : (
                        <ScopeIcon
                          className="h-3 w-3 shrink-0 text-muted-foreground"
                          title={assignment.scope}
                        />
                      )}
                      {isAgent && assignment.scope_id ? (
                        <Link
                          href={`/agents/${assignment.scope_id}`}
                          className="min-w-0 flex-1 truncate text-xs font-medium hover:text-primary"
                        >
                          {displayName}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {displayName}
                        </span>
                      )}
                      {displayHandle && (
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {displayHandle}
                        </span>
                      )}
                      {assignment.auto_inject === 1 && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">auto</span>
                      )}
                      <button
                        type="button"
                        className="shrink-0 p-0.5 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                        onClick={() =>
                          removeAssignmentMutation.mutate({
                            assignmentId: assignment.id,
                          })
                        }
                        disabled={removeAssignmentMutation.isPending}
                        title="Remove assignment"
                      >
                        <IconTrash className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Danger zone */}
        {!isPluginSkill && (
          <Card className="border-destructive/20 bg-destructive/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <IconAlertTriangle className="h-4 w-4" />
                Danger Zone
              </CardTitle>
              <CardDescription className="text-xs">
                Permanently delete this skill and all its assignments.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Skill'}
              </Button>
            </CardContent>
          </Card>
        )}

        {isPluginSkill && (
          <Card className="border-white/10 bg-white/[0.02]">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  To remove this skill, disable or uninstall the parent plugin.
                </p>
                <Link
                  href={pluginType ? `/plugins/${pluginType}` : '/plugins'}
                  className="shrink-0 text-xs text-primary hover:underline"
                >
                  Manage plugin &rarr;
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Save message toast (floating) */}
      {saveMessage && !dirty && !showMetadata && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-white/10 bg-background p-3 shadow-lg">
          <span
            className={`text-xs ${
              saveMessage.type === 'success' ? 'text-emerald-400' : 'text-destructive'
            }`}
          >
            {saveMessage.text}
          </span>
        </div>
      )}
    </div>
  )
}
