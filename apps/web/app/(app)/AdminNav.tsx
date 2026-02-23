'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  IconActivity,
  IconPlug,
  IconInbox,
  IconUsers,
  IconSettings,
  IconChevronDown,
  IconCloud,
  IconCurrencyDollar,
  IconWand,
  IconPlayerPause,
  IconDatabase,
  IconKey,
  IconRadar,
  IconBook2,
  IconReportAnalytics,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'

const mainNavItems = [
  { label: 'Fleet', href: '/fleet', icon: IconRadar },
  { label: 'Activity', href: '/activity', icon: IconActivity },
  { label: 'Collections', href: '/collections', icon: IconDatabase },
  { label: 'Costs', href: '/costs', icon: IconCurrencyDollar },
  { label: 'Plugins', href: '/plugins', icon: IconPlug },
  { label: 'Skills', href: '/skills', icon: IconBook2 },
  { label: 'Evals', href: '/evals', icon: IconReportAnalytics },
]

const settingsNavItems = [
  { label: 'Gateway', href: '/settings/gateway', icon: IconCloud },
  { label: 'Capabilities', href: '/settings/capabilities', icon: IconWand },
  { label: 'Credentials', href: '/settings/credentials', icon: IconKey },
  { label: 'Routines', href: '/settings/routines', icon: IconPlayerPause },
  { label: 'Runtime', href: '/settings/runtime', icon: IconPlayerPause },
  { label: 'Organization', href: '/settings/organization', icon: IconUsers },
  { label: 'Event Log', href: '/work-items', icon: IconInbox },
]

function NavLink({
  href,
  icon: Icon,
  label,
  exact,
}: {
  href: string
  icon: typeof IconActivity
  label: string
  exact?: boolean
}) {
  const pathname = usePathname()
  const isActive = exact ? pathname === href : pathname.startsWith(href)

  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
        isActive ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white/80'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </Link>
  )
}

export function AdminNav() {
  const pathname = usePathname()
  const isSettingsActive = settingsNavItems.some((item) => pathname.startsWith(item.href))

  return (
    <nav className="hidden items-center gap-1 md:flex">
      {mainNavItems.map((item) => (
        <NavLink key={item.href} {...item} />
      ))}

      {/* Settings dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all outline-none',
            isSettingsActive
              ? 'bg-white/10 text-white'
              : 'text-white/50 hover:bg-white/5 hover:text-white/80'
          )}
        >
          <IconSettings className="h-3.5 w-3.5" />
          <span>Settings</span>
          <IconChevronDown className="h-3 w-3 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
              Settings
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {settingsNavItems.map((item) => (
              <MenuPrimitive.Item
                key={item.href}
                className="focus:bg-accent focus:text-accent-foreground min-h-7 gap-2 rounded-md px-2 py-1 text-xs/relaxed relative flex cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50"
                render={<Link href={item.href} />}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </MenuPrimitive.Item>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}
