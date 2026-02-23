'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { IconInfoCircle } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from '@/components/ui/emoji-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface FormValues {
  handle: string // @mention ID (slug)
  name: string // Display name
  title: string // Role
  emoji?: string
  avatarUrl?: string
  teamId?: string
}

const DEFAULT_EMOJIS = ['🤖', '🔧', '📋', '🚀', '⚡', '🎯', '🔍', '💡', '🦾', '🧠', '⚙️', '🛠️']
const getRandomEmoji = () => DEFAULT_EMOJIS[Math.floor(Math.random() * DEFAULT_EMOJIS.length)]

export function NewAgentClient() {
  const router = useRouter()
  const { data: teamsData } = trpc.org.listTeams.useQuery()
  const teams = useMemo(() => (teamsData ?? []) as { id: string; name: string }[], [teamsData])
  const createAgent = trpc.org.createAgent.useMutation({
    onSuccess: (data: { id: string }) => {
      router.push(`/agents/${data.id}`)
    },
  })

  const form = useForm<FormValues>({
    defaultValues: {
      handle: '',
      name: '',
      title: '',
      emoji: getRandomEmoji(),
      avatarUrl: '',
      teamId: '',
    },
  })

  const [error, setError] = useState<string | null>(null)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const avatarUrl = form.watch('avatarUrl')
  const selectedEmoji = form.watch('emoji')
  const { setValue } = form

  const handleSubmit = form.handleSubmit((values) => {
    setError(null)
    const handle = values.handle.trim()
    const name = values.name.trim()

    if (!handle) {
      setError('Agent ID is required.')
      return
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(handle)) {
      setError('Agent ID can only contain letters, numbers, hyphens, and underscores.')
      return
    }
    if (!name) {
      setError('Name is required.')
      return
    }

    createAgent.mutate({
      handle,
      name,
      title: values.title?.trim() || null,
      emoji: values.emoji?.trim() || null,
      avatarUrl: values.avatarUrl?.trim() || null,
      teamId: values.teamId?.trim() || undefined,
    })
  })

  const teamsAvailable = teams.length > 0

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>
            How this agent appears in the system and to team members.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Name - display name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Name
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Input id="name" {...form.register('name', { required: true })} placeholder="Mary" />
            <p className="text-xs text-muted-foreground">The display name shown in the UI.</p>
          </div>

          {/* Agent ID - the @mention handle */}
          <div className="space-y-2">
            <Label htmlFor="handle">
              Agent ID
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Input
              id="handle"
              {...form.register('handle', { required: true })}
              placeholder="mary"
              pattern="^[a-zA-Z0-9_-]+$"
              title="Only letters, numbers, hyphens, and underscores"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Used for @mentions. Letters, numbers, hyphens, and underscores only.
            </p>
          </div>

          {/* Title - the agent's role */}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" {...form.register('title')} placeholder="Sr Eng" />
            <p className="text-xs text-muted-foreground">
              The agent&apos;s role or job description (optional).
            </p>
          </div>

          {/* Emoji and Avatar side by side */}
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Emoji</Label>
              <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                <PopoverTrigger className="flex h-10 w-20 items-center justify-center rounded-md border border-input bg-background text-2xl hover:bg-accent hover:text-accent-foreground">
                  {selectedEmoji}
                </PopoverTrigger>
                <PopoverContent className="w-fit p-0" align="start">
                  <EmojiPicker
                    className="h-[342px]"
                    onEmojiSelect={(emoji) => {
                      setValue('emoji', emoji.emoji)
                      setEmojiPickerOpen(false)
                    }}
                  >
                    <EmojiPickerSearch placeholder="Search emoji..." />
                    <EmojiPickerContent />
                    <EmojiPickerFooter />
                  </EmojiPicker>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                Click to pick an emoji for this agent.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="avatarUrl">Avatar URL</Label>
              <div className="flex items-start gap-3">
                <Input
                  id="avatarUrl"
                  {...form.register('avatarUrl')}
                  placeholder="https://example.com/avatar.png"
                  type="url"
                  className="flex-1"
                />
                {avatarUrl && (
                  <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={avatarUrl}
                      alt="Avatar preview"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Optional image URL for the agent&apos;s avatar.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Team Assignment
            <Tooltip>
              <TooltipTrigger className="cursor-help">
                <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right">
                Agents assigned to a team route their work for approval to that team&apos;s members.
                You can change this later.
              </TooltipContent>
            </Tooltip>
          </CardTitle>
          <CardDescription>Optional. Assign to a team for approval routing.</CardDescription>
        </CardHeader>
        <CardContent>
          <NativeSelect
            id="teamId"
            {...form.register('teamId')}
            className="w-full max-w-sm"
            disabled={!teamsAvailable}
          >
            <NativeSelectOption value="">
              {teamsAvailable ? 'No team (standalone agent)' : 'No teams available'}
            </NativeSelectOption>
            {teams.map((team) => (
              <NativeSelectOption key={team.id} value={team.id}>
                {team.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      {createAgent.isError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {createAgent.error.message}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Agent will be created in idle status. Configure plugin instances after creation.
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.push('/agents')}>
            Cancel
          </Button>
          <Button type="submit" disabled={createAgent.isPending}>
            {createAgent.isPending ? 'Creating...' : 'Create Agent'}
          </Button>
        </div>
      </div>
    </form>
  )
}
