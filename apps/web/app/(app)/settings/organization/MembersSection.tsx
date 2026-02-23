'use client'

import { useMemo, useState } from 'react'
import { IconPlus, IconX, IconDots } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { InviteMemberForm } from './InviteMemberForm'

const roleOptions = ['superadmin', 'admin', 'member'] as const
type Role = (typeof roleOptions)[number]

type MemberTeam = { id: string; name: string }
type Member = {
  kind: 'user' | 'invite'
  id: string
  name: string
  email: string
  avatar_url: string | null
  role: Role
  status: 'active' | 'invited' | 'disabled'
  teams: MemberTeam[]
}

type Team = {
  id: string
  name: string
}

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  const initials = name
    .split(/[-_\s]/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-white/10 to-white/5">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span className="text-[0.6rem] font-semibold text-white/60">{initials}</span>
      )}
    </div>
  )
}

function RoleDropdown({ member }: { member: Member }) {
  const utils = trpc.useUtils()
  const updateMember = trpc.org.updateMember.useMutation({
    onSuccess: () => void utils.org.listMembers.invalidate(),
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="group/role cursor-pointer outline-none"
        render={<button className="inline-flex items-center" />}
      >
        <Badge
          variant={member.role === 'superadmin' ? 'default' : 'outline'}
          className="pointer-events-none text-[0.6rem] transition group-hover/role:border-primary/30 group-hover/role:bg-primary/10"
        >
          {member.role}
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
            Change role
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {roleOptions.map((role) => (
            <DropdownMenuItem
              key={role}
              disabled={role === member.role || updateMember.isPending}
              onClick={() => updateMember.mutate({ id: member.id, role })}
              className="text-xs"
            >
              {role}
              {role === member.role && (
                <span className="ml-auto text-[0.55rem] text-muted-foreground">current</span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TeamBadges({ member, allTeams }: { member: Member; allTeams: Team[] }) {
  const utils = trpc.useUtils()
  const addTeamMember = trpc.org.addTeamMember.useMutation({
    onSuccess: () => {
      void utils.org.listMembers.invalidate()
      void utils.org.listTeams.invalidate()
    },
  })
  const removeTeamMember = trpc.org.removeTeamMember.useMutation({
    onSuccess: () => {
      void utils.org.listMembers.invalidate()
      void utils.org.listTeams.invalidate()
    },
  })

  const memberTeamIds = useMemo(() => new Set(member.teams.map((t) => t.id)), [member.teams])
  const availableTeams = useMemo(
    () => allTeams.filter((t) => !memberTeamIds.has(t.id)),
    [allTeams, memberTeamIds]
  )

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {member.teams.map((team) => (
        <span
          key={team.id}
          className="group/tag inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[0.6rem] text-white/60"
        >
          {team.name}
          <button
            onClick={() => removeTeamMember.mutate({ teamId: team.id, userId: member.id })}
            disabled={removeTeamMember.isPending}
            className="rounded text-white/20 opacity-0 transition hover:text-white/60 group-hover/tag:opacity-100 disabled:opacity-50"
          >
            <IconX className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      {availableTeams.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="outline-none"
            render={
              <button className="flex h-5 w-5 items-center justify-center rounded border border-dashed border-white/15 text-white/25 transition hover:border-primary/30 hover:bg-primary/10 hover:text-primary" />
            }
          >
            <IconPlus className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                Add to team
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableTeams.map((team) => (
                <DropdownMenuItem
                  key={team.id}
                  disabled={addTeamMember.isPending}
                  onClick={() => addTeamMember.mutate({ teamId: team.id, userId: member.id })}
                  className="text-xs"
                >
                  {team.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {member.teams.length === 0 && availableTeams.length === 0 && (
        <span className="text-[0.6rem] text-white/30">No teams</span>
      )}
    </div>
  )
}

function MemberActions({ member }: { member: Member }) {
  const utils = trpc.useUtils()
  const [confirmDisable, setConfirmDisable] = useState(false)
  const updateMember = trpc.org.updateMember.useMutation({
    onSuccess: () => void utils.org.listMembers.invalidate(),
  })

  const isDisabled = member.status === 'disabled'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="outline-none"
          render={
            <button className="flex h-7 w-7 items-center justify-center rounded-md text-white/20 transition hover:bg-white/[0.06] hover:text-white/60" />
          }
        >
          <IconDots className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {isDisabled ? (
            <DropdownMenuItem
              onClick={() => updateMember.mutate({ id: member.id, status: 'active' })}
              disabled={updateMember.isPending}
              className="text-xs"
            >
              Re-enable
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() => setConfirmDisable(true)}
              className="text-xs text-rose-400 focus:text-rose-400"
            >
              Disable account
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable {member.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revoke their access. They won&apos;t be able to log in or approve agent
              work. You can re-enable them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => updateMember.mutate({ id: member.id, status: 'disabled' })}
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function MemberRow({ member, allTeams }: { member: Member; allTeams: Team[] }) {
  const isInvite = member.kind === 'invite'

  return (
    <div className="group flex items-center gap-4 border-b border-white/5 px-4 py-3 last:border-0">
      <Avatar name={member.name} avatarUrl={member.avatar_url} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-white/90">{member.name}</p>
          {member.status === 'disabled' && (
            <Badge variant="destructive" className="text-[0.55rem]">
              disabled
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-white/40">{member.email}</p>
      </div>

      <div className="hidden min-w-[10rem] items-center sm:flex">
        {isInvite ? (
          <span className="text-[0.6rem] text-white/30">Pending invite</span>
        ) : (
          <TeamBadges member={member} allTeams={allTeams} />
        )}
      </div>

      <div className="flex items-center gap-2">
        {isInvite ? (
          <>
            <Badge variant="outline" className="text-[0.6rem]">
              {member.role}
            </Badge>
            <Badge variant="outline" className="text-[0.6rem]">
              invited
            </Badge>
          </>
        ) : (
          <RoleDropdown member={member} />
        )}
      </div>

      <div className="w-7 shrink-0">{!isInvite && <MemberActions member={member} />}</div>
    </div>
  )
}

export function MembersSection() {
  const { data, isLoading } = trpc.org.listMembers.useQuery()
  const { data: teamsData } = trpc.org.listTeams.useQuery()
  const members = (data ?? []) as Member[]
  const allTeams = useMemo(
    () =>
      ((teamsData ?? []) as Array<{ id: string; name: string }>).map((t) => ({
        id: t.id,
        name: t.name,
      })),
    [teamsData]
  )
  const [inviteOpen, setInviteOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Superadmins can approve anything. Team members approve what their teams own.
        </p>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger render={<Button size="sm" variant="outline" />}>
            Invite Member
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Invite Member</DialogTitle>
              <DialogDescription>Send a team invite to onboard new approvers.</DialogDescription>
            </DialogHeader>
            <InviteMemberForm onSuccess={() => setInviteOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.02] py-12">
          <p className="text-sm text-white/40">Loading members...</p>
        </div>
      ) : members.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-12">
          <p className="text-sm text-white/40">No members yet. Invite someone to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-4 border-b border-white/10 bg-white/[0.02] px-4 py-2">
            <div className="w-8 shrink-0" />
            <span className="min-w-0 flex-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white/40">
              Member
            </span>
            <span className="hidden min-w-[10rem] text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white/40 sm:flex">
              Teams
            </span>
            <span className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white/40">
              Role
            </span>
            <div className="w-7 shrink-0" />
          </div>

          {members.map((member) => (
            <MemberRow key={member.id} member={member} allTeams={allTeams} />
          ))}
        </div>
      )}
    </div>
  )
}
