'use client'

import Link from 'next/link'
import { IconLogout, IconUsers } from '@tabler/icons-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface UserMenuProps {
  user: {
    name: string
    email: string
    role?: string
  }
  signOutAction: () => Promise<void>
}

function UserAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-[0.6rem] font-semibold text-primary ring-1 ring-white/10">
      {initials}
    </div>
  )
}

export function UserMenu({ user, signOutAction }: UserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-all outline-none hover:bg-white/5">
        <UserAvatar name={user.name} />
        <span className="hidden text-xs font-medium text-white/70 sm:block">{user.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        <div className="px-2 py-2">
          <p className="text-xs font-medium text-white/90">{user.name}</p>
          <p className="text-[0.65rem] text-white/40">{user.email}</p>
          {user.role && (
            <span className="mt-1.5 inline-flex items-center rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[0.6rem] font-medium text-white/50 ring-1 ring-white/[0.08]">
              {user.role}
            </span>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
            Manage
          </DropdownMenuLabel>
          <DropdownMenuItem render={<Link href="/settings/organization" />}>
            <IconUsers className="h-3.5 w-3.5" />
            Organization
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void signOutAction()}>
          <IconLogout className="h-3.5 w-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
