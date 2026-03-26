'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from '@/components/ui/emoji-picker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface AgentIdentityFormProps {
  agentId: string
  handle: string
  name: string
  currentRoleId: string | null
  availableRoles: { id: string; name: string }[]
  initialEmoji?: string | null
  initialAvatarUrl?: string | null
  currentTeamId?: string | null
  teams: { id: string; name: string }[]
}

interface IdentityValues {
  name: string
  roleId: string
  emoji?: string
  avatarUrl?: string
  teamId?: string
}

export function AgentIdentityForm({
  agentId,
  handle: _handle,
  name,
  currentRoleId,
  availableRoles,
  initialEmoji,
  initialAvatarUrl,
  currentTeamId,
  teams,
}: AgentIdentityFormProps) {
  const router = useRouter()
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)

  const form = useForm<IdentityValues>({
    defaultValues: {
      name: name,
      roleId: currentRoleId ?? '',
      emoji: initialEmoji ?? '',
      avatarUrl: initialAvatarUrl ?? '',
      teamId: currentTeamId ?? '',
    },
  })

  const updateIdentity = trpc.org.updateAgentIdentity.useMutation({
    onSuccess: () => {
      setStatus({ type: 'success', text: 'Saved' })
      setTimeout(() => setStatus(null), 3000)
      router.refresh()
    },
    onError: (error) => {
      setStatus({ type: 'error', text: error.message })
    },
  })

  const assignRole = trpc.company.assignRoleToAgent.useMutation({
    onSuccess: () => {
      router.refresh()
    },
  })

  const removeRole = trpc.company.removeRoleFromAgent.useMutation({
    onSuccess: () => {
      router.refresh()
    },
  })

  const assignToTeam = trpc.org.assignAgentToTeam.useMutation({
    onSuccess: () => {
      router.refresh()
    },
  })

  const removeFromTeam = trpc.org.removeAgentFromTeam.useMutation({
    onSuccess: () => {
      router.refresh()
    },
  })

  const handleSubmit = form.handleSubmit((values) => {
    setStatus(null)

    // Update identity (name, emoji, avatar)
    updateIdentity.mutate({
      id: agentId,
      name: values.name?.trim() || null,
      emoji: values.emoji?.trim() || null,
      avatarUrl: values.avatarUrl?.trim() || null,
    })

    // Handle role change
    const newRoleId = values.roleId || null
    if (newRoleId !== currentRoleId) {
      if (newRoleId) {
        assignRole.mutate({ roleId: newRoleId, agentId })
      } else if (currentRoleId) {
        removeRole.mutate({ roleId: currentRoleId, agentId })
      }
    }

    // Handle team change
    const newTeamId = values.teamId || null
    if (newTeamId !== currentTeamId) {
      if (currentTeamId && !newTeamId) {
        removeFromTeam.mutate({ teamId: currentTeamId, agentId })
      } else if (newTeamId) {
        assignToTeam.mutate({ teamId: newTeamId, agentId })
      }
    }
  })

  const selectedEmoji = form.watch('emoji') || initialEmoji || null
  const previewAvatar = form.watch('avatarUrl') || initialAvatarUrl || null

  const isSaving =
    updateIdentity.isPending ||
    assignRole.isPending ||
    removeRole.isPending ||
    assignToTeam.isPending ||
    removeFromTeam.isPending

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-4">
        {/* Name (display name) */}
        <div className="space-y-2">
          <Label htmlFor="name" className="text-xs">
            Name
          </Label>
          <Input
            id="name"
            {...form.register('name')}
            placeholder="Mary"
            className="border-white/10 bg-white/5"
          />
          <p className="text-[10px] text-muted-foreground">The display name shown in the UI.</p>
        </div>

        {/* Role */}
        <div className="space-y-2">
          <Label htmlFor="roleId" className="text-xs">
            Role
          </Label>
          <NativeSelect
            id="roleId"
            {...form.register('roleId')}
            className="w-full border-white/10 bg-white/5"
          >
            <NativeSelectOption value="">No role assigned</NativeSelectOption>
            {availableRoles.map((role) => (
              <NativeSelectOption key={role.id} value={role.id}>
                {role.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <p className="text-[10px] text-muted-foreground">
            Defines this agent&apos;s permissions and policy.{' '}
            <Link href="/company/roles" className="text-primary hover:underline">
              Manage roles
            </Link>
          </p>
        </div>

        {/* Emoji and Avatar side by side */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs">Emoji</Label>
            <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
              <PopoverTrigger className="flex h-7 w-16 items-center justify-center rounded-md border border-white/10 bg-white/5 text-base transition hover:border-white/20 hover:bg-white/10">
                {selectedEmoji || <span className="text-xs text-muted-foreground">None</span>}
              </PopoverTrigger>
              <PopoverContent className="w-fit p-0" align="start">
                <EmojiPicker
                  className="h-[342px]"
                  onEmojiSelect={(emoji) => {
                    form.setValue('emoji', emoji.emoji)
                    setEmojiPickerOpen(false)
                  }}
                >
                  <EmojiPickerSearch placeholder="Search emoji..." />
                  <EmojiPickerContent />
                  <EmojiPickerFooter />
                </EmojiPicker>
              </PopoverContent>
            </Popover>
            <p className="text-[10px] text-muted-foreground">Click to pick an emoji.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="avatarUrl" className="text-xs">
              Avatar URL
            </Label>
            <div className="flex items-start gap-2">
              <Input
                id="avatarUrl"
                {...form.register('avatarUrl')}
                placeholder="https://..."
                className="flex-1 border-white/10 bg-white/5"
              />
              {previewAvatar && (
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewAvatar}
                    alt="Avatar preview"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Team Assignment */}
        <div className="space-y-2">
          <Label htmlFor="teamId" className="text-xs">
            Team
          </Label>
          <NativeSelect
            id="teamId"
            {...form.register('teamId')}
            className="w-full border-white/10 bg-white/5"
          >
            <NativeSelectOption value="">
              {teams.length > 0 ? 'No team (standalone agent)' : 'No teams available'}
            </NativeSelectOption>
            {teams.map((team) => (
              <NativeSelectOption key={team.id} value={team.id}>
                {team.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <p className="text-[10px] text-muted-foreground">
            Agents assigned to a team route their work for approval to that team&apos;s members.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md border border-primary/40 bg-primary/15 px-4 py-2 text-xs font-medium text-primary transition hover:border-primary/60 hover:bg-primary/20 disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Identity'}
        </button>

        {status && (
          <span
            className={`rounded-full px-3 py-1 text-[0.65rem] font-medium ${
              status.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-200'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {status.text}
          </span>
        )}
      </div>
    </form>
  )
}
