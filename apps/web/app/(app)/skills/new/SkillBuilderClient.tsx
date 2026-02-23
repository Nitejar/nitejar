'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { IconFile, IconFolder, IconPlus, IconTrash, IconCheck, IconX } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

interface SupportingFile {
  path: string
  content: string
  contentType?: string
}

export function SkillBuilderClient() {
  const router = useRouter()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<string>('general')
  const [content, setContent] = useState(
    '# Skill Name\n\nDescribe what this skill teaches the agent.\n'
  )
  const [isDirectory, setIsDirectory] = useState(false)
  const [files, setFiles] = useState<SupportingFile[]>([])
  const [tagsInput, setTagsInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  // New file form state
  const [showNewFile, setShowNewFile] = useState(false)
  const [newFilePath, setNewFilePath] = useState('')
  const [newFileContent, setNewFileContent] = useState('')

  // Auto-generate slug from name
  useEffect(() => {
    if (!slugManual) {
      setSlug(slugify(name))
    }
  }, [name, slugManual])

  // Slug availability check (debounced)
  const slugCheck = trpc.skills.checkSlug.useQuery({ slug }, { enabled: slug.length > 0 })

  const createMutation = trpc.skills.create.useMutation({
    onSuccess: (data) => {
      router.push(`/skills/${data.id}`)
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  const createDirectoryMutation = trpc.skills.createDirectory.useMutation({
    onSuccess: (data) => {
      router.push(`/skills/${data.id}`)
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  const handleAddTag = useCallback(() => {
    const tag = tagsInput
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
    if (tag && !tags.includes(tag) && tags.length < 20) {
      setTags((prev) => [...prev, tag])
      setTagsInput('')
    }
  }, [tagsInput, tags])

  const handleRemoveTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag))
  }

  const handleAddFile = () => {
    if (!newFilePath.trim()) return
    if (files.some((f) => f.path === newFilePath.trim())) {
      setError('File path already exists.')
      return
    }
    setFiles((prev) => [...prev, { path: newFilePath.trim(), content: newFileContent }])
    setNewFilePath('')
    setNewFileContent('')
    setShowNewFile(false)
    setError(null)
  }

  const handleRemoveFile = (path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path))
  }

  const handleCreate = () => {
    setError(null)

    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    if (!slug.trim()) {
      setError('Slug is required.')
      return
    }
    if (!content.trim()) {
      setError('SKILL.md content is required.')
      return
    }
    if (slugCheck.data && !slugCheck.data.available) {
      setError('Slug is already in use.')
      return
    }

    if (isDirectory && files.length > 0) {
      createDirectoryMutation.mutate({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        category: category as (typeof CATEGORIES)[number],
        content: content,
        files: files,
        tags: tags.length > 0 ? tags : undefined,
      })
    } else {
      createMutation.mutate({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        category: category as (typeof CATEGORIES)[number],
        content: content,
        tags: tags.length > 0 ? tags : undefined,
      })
    }
  }

  const isPending = createMutation.isPending || createDirectoryMutation.isPending

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      {/* Left column: Content */}
      <div className="space-y-6">
        {/* Name & Slug */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Identity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Name
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Jira Triage"
                className="text-xs"
                maxLength={128}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Slug
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value)
                    setSlugManual(true)
                  }}
                  placeholder="e.g., jira-triage"
                  className="font-mono text-xs"
                  maxLength={64}
                />
                {slug.length > 0 && slugCheck.data && (
                  <span className="shrink-0">
                    {slugCheck.data.available ? (
                      <IconCheck className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <IconX className="h-4 w-4 text-destructive" />
                    )}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                URL-safe identifier. Auto-generated from name.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Description
              </Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description for catalog display"
                className="text-xs"
              />
            </div>
          </CardContent>
        </Card>

        {/* Skill Type Toggle */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Skill Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setIsDirectory(false)}
                className={`flex flex-1 items-center gap-3 rounded-lg border p-3 transition ${
                  !isDirectory
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                }`}
              >
                <IconFile className="h-5 w-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-xs font-medium">Simple</p>
                  <p className="text-[10px] text-muted-foreground">Single SKILL.md file</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setIsDirectory(true)}
                className={`flex flex-1 items-center gap-3 rounded-lg border p-3 transition ${
                  isDirectory
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                }`}
              >
                <IconFolder className="h-5 w-5 text-muted-foreground" />
                <div className="text-left">
                  <p className="text-xs font-medium">Directory</p>
                  <p className="text-[10px] text-muted-foreground">SKILL.md + supporting files</p>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Content */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">SKILL.md Content</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="# Skill Name\n\nWrite your skill instructions here..."
              className="min-h-[300px] font-mono text-xs"
            />
            {content.length > 50000 && (
              <p className="mt-1 text-[10px] text-amber-400">
                Content is over 50KB. Consider splitting into supporting files.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Supporting Files (only for directory) */}
        {isDirectory && (
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Supporting Files</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setShowNewFile(true)}>
                <IconPlus className="mr-1 h-3 w-3" />
                Add File
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {files.length === 0 && !showNewFile && (
                <p className="text-xs text-muted-foreground">
                  No supporting files yet. Add references, scripts, or templates.
                </p>
              )}

              {files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] p-3"
                >
                  <div className="flex items-center gap-2">
                    <IconFile className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-xs">{file.path}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {file.content.length} chars
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleRemoveFile(file.path)}
                  >
                    <IconTrash className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}

              {showNewFile && (
                <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
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
                      className="min-h-[100px] font-mono text-xs"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="default" size="sm" onClick={handleAddFile}>
                      Add
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
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Error + Create */}
        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button onClick={handleCreate} disabled={isPending}>
          {isPending ? 'Creating...' : 'Create Skill'}
        </Button>
      </div>

      {/* Right column: Metadata */}
      <div className="space-y-6">
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Metadata</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Category
              </Label>
              <NativeSelect
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-xs"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Tags
              </Label>
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
          </CardContent>
        </Card>

        {/* Preview card */}
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center gap-2">
                {isDirectory ? (
                  <IconFolder className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <IconFile className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-xs font-medium">{name || 'Untitled'}</span>
              </div>
              {description && <p className="text-[10px] text-muted-foreground">{description}</p>}
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-[10px]">
                  {category}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  admin
                </Badge>
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px] text-muted-foreground">
                    {tag}
                  </Badge>
                ))}
              </div>
              {isDirectory && files.length > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {files.length} supporting file{files.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
