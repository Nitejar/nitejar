'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import {
  IconActivity,
  IconBook2,
  IconChevronDown,
  IconChevronRight,
  IconCloud,
  IconCurrencyDollar,
  IconDatabase,
  IconHome,
  IconInbox,
  IconKey,
  IconLogout,
  IconMenu2,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPlug,
  IconPlayerPause,
  IconRadar,
  IconReportAnalytics,
  IconServer,
  IconSettings,
  IconUsers,
  IconWand,
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useSidebar } from './sidebar-context'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { authClient } from '@/lib/auth-client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  exact?: boolean
}

interface NavGroup {
  label: string
  items: NavItem[]
}

// ---------------------------------------------------------------------------
// Navigation structure
// ---------------------------------------------------------------------------

const navGroups: NavGroup[] = [
  {
    label: 'Interact',
    items: [{ label: 'Home', href: '/', icon: IconHome, exact: true }],
  },
  {
    label: 'Observe',
    items: [
      { label: 'Fleet', href: '/fleet', icon: IconRadar },
      { label: 'Activity', href: '/activity', icon: IconActivity },
      { label: 'Costs', href: '/costs', icon: IconCurrencyDollar },
    ],
  },
  {
    label: 'Configure',
    items: [
      { label: 'Plugins', href: '/plugins', icon: IconPlug },
      { label: 'Skills', href: '/skills', icon: IconBook2 },
      { label: 'Collections', href: '/collections', icon: IconDatabase },
    ],
  },
  {
    label: 'Evaluate',
    items: [{ label: 'Evals', href: '/evals', icon: IconReportAnalytics }],
  },
]

const settingsItems: NavItem[] = [
  { label: 'Gateway', href: '/settings/gateway', icon: IconCloud },
  { label: 'Capabilities', href: '/settings/capabilities', icon: IconWand },
  { label: 'Credentials', href: '/settings/credentials', icon: IconKey },
  { label: 'Routines', href: '/settings/routines', icon: IconPlayerPause },
  { label: 'Runtime', href: '/settings/runtime', icon: IconServer },
  { label: 'Organization', href: '/settings/organization', icon: IconUsers },
]

const debugItems: NavItem[] = [{ label: 'Event Log', href: '/work-items', icon: IconInbox }]

// ---------------------------------------------------------------------------
// Sidebar nav link
// ---------------------------------------------------------------------------

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname()
  const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href)
  const Icon = item.icon

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href={item.href}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-white/50 hover:bg-white/[0.06] hover:text-white/80'
              )}
            />
          }
        >
          <Icon className="h-4 w-4" />
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {item.label}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-[0.8rem] font-medium transition-colors',
        isActive
          ? 'bg-white/10 text-white'
          : 'text-white/50 hover:bg-white/[0.06] hover:text-white/80'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Sidebar nav content (shared between desktop and mobile sheet)
// ---------------------------------------------------------------------------

function SidebarNav({
  collapsed,
  user,
  onSignOut,
}: {
  collapsed: boolean
  user: { name: string; email: string }
  onSignOut: () => Promise<void>
}) {
  const pathname = usePathname()
  const [settingsOpen, setSettingsOpen] = useState(() =>
    settingsItems.some((item) => pathname.startsWith(item.href))
  )
  const { toggleCollapsed } = useSidebar()

  const isSettingsActive = settingsItems.some((item) => pathname.startsWith(item.href))
  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div
        className={cn(
          'flex h-14 shrink-0 items-center border-b border-white/[0.06]',
          collapsed ? 'justify-center px-2' : 'px-4'
        )}
      >
        <a href="/" className="flex items-center gap-2.5">
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-lg">
            <Image src="/icon.png" alt="Nitejar" width={32} height={32} className="h-full w-full object-cover" />
          </div>
          {!collapsed && (
            <div>
              <p className="text-[0.55rem] font-medium uppercase tracking-[0.25em] text-white/40">
                Nitejar
              </p>
              <p className="text-sm font-semibold leading-none text-white/90">Control</p>
            </div>
          )}
        </a>
      </div>

      {/* Main navigation */}
      <nav className={cn('flex-1 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}>
        <div className="space-y-6">
          {navGroups.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <p className="mb-1.5 px-3 text-[0.6rem] font-semibold uppercase tracking-wider text-white/30">
                  {group.label}
                </p>
              )}
              <div className={cn('space-y-0.5', collapsed && 'flex flex-col items-center')}>
                {group.items.map((item) => (
                  <SidebarLink key={item.href} item={item} collapsed={collapsed} />
                ))}
              </div>
            </div>
          ))}

          {/* Divider */}
          <div className="mx-3 border-t border-white/[0.06]" />

          {/* Settings section */}
          {collapsed ? (
            <div className="flex flex-col items-center space-y-0.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Link
                      href="/settings/gateway"
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                        isSettingsActive
                          ? 'bg-white/10 text-white'
                          : 'text-white/50 hover:bg-white/[0.06] hover:text-white/80'
                      )}
                    />
                  }
                >
                  <IconSettings className="h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Settings
                </TooltipContent>
              </Tooltip>
              {debugItems.map((item) => (
                <SidebarLink key={item.href} item={item} collapsed={collapsed} />
              ))}
            </div>
          ) : (
            <>
              {/* Settings disclosure */}
              <div>
                <button
                  onClick={() => setSettingsOpen(!settingsOpen)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[0.8rem] font-medium transition-colors',
                    isSettingsActive
                      ? 'text-white'
                      : 'text-white/50 hover:bg-white/[0.06] hover:text-white/80'
                  )}
                >
                  <IconSettings className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate text-left">Settings</span>
                  {settingsOpen ? (
                    <IconChevronDown className="h-3.5 w-3.5 text-white/30" />
                  ) : (
                    <IconChevronRight className="h-3.5 w-3.5 text-white/30" />
                  )}
                </button>
                {settingsOpen && (
                  <div className="mt-0.5 ml-4 space-y-0.5 border-l border-white/[0.06] pl-3">
                    {settingsItems.map((item) => (
                      <SidebarLink key={item.href} item={item} collapsed={false} />
                    ))}
                  </div>
                )}
              </div>

              {/* Debug */}
              <div>
                <p className="mb-1.5 px-3 text-[0.6rem] font-semibold uppercase tracking-wider text-white/30">
                  Debug
                </p>
                <div className="space-y-0.5">
                  {debugItems.map((item) => (
                    <SidebarLink key={item.href} item={item} collapsed={false} />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </nav>

      {/* Bottom: user menu + collapse toggle */}
      <div
        className={cn(
          'shrink-0 border-t border-white/[0.06]',
          collapsed ? 'px-2 py-3' : 'px-3 py-3'
        )}
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-[0.6rem] font-semibold text-primary ring-1 ring-white/10 cursor-default" />
                }
              >
                {initials}
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                <p className="font-medium">{user.name}</p>
                <p className="text-[0.65rem] opacity-70">{user.email}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={toggleCollapsed}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/70"
                  />
                }
              >
                <IconLayoutSidebarLeftExpand className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Expand sidebar
              </TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[0.6rem] font-semibold text-primary ring-1 ring-white/10">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-white/80">{user.name}</p>
                <p className="truncate text-[0.6rem] text-white/40">{user.email}</p>
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => void onSignOut()}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/60"
                    />
                  }
                >
                  <IconLogout className="h-3.5 w-3.5" />
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Sign out
                </TooltipContent>
              </Tooltip>
            </div>
            <button
              onClick={toggleCollapsed}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-[0.75rem] text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/60"
            >
              <IconLayoutSidebarLeftCollapse className="h-4 w-4 shrink-0" />
              <span>Collapse</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

interface AdminSidebarProps {
  user?: { name: string; email: string }
}

export function AdminSidebar({ user: userProp }: AdminSidebarProps) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar()
  const router = useRouter()
  const { data: session, isPending, refetch } = authClient.useSession()
  const [sessionRetried, setSessionRetried] = useState(false)

  useEffect(() => {
    if (userProp) return
    if (session?.user) return
    if (isPending || sessionRetried) return
    setSessionRetried(true)
    void refetch()
  }, [userProp, session, isPending, sessionRetried, refetch])

  const fallbackName = userProp || session?.user || sessionRetried ? 'Account' : 'Loading...'
  const user = userProp ?? {
    name: session?.user?.name ?? fallbackName,
    email: session?.user?.email ?? '',
  }

  const onSignOut = useCallback(async () => {
    try {
      await authClient.signOut()
    } finally {
      router.push('/login')
      router.refresh()
    }
  }, [router])

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex md:flex-col md:fixed md:inset-y-0 md:left-0 md:z-40 border-r border-white/[0.06] bg-background/95 backdrop-blur-xl transition-all duration-200',
          collapsed ? 'md:w-[56px]' : 'md:w-60'
        )}
      >
        <SidebarNav collapsed={collapsed} user={user} onSignOut={onSignOut} />
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-white/[0.06] bg-background/80 px-4 backdrop-blur-xl md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <IconMenu2 className="h-5 w-5" />
        </button>
        <a href="/" className="flex items-center gap-2">
          <div className="h-7 w-7 overflow-hidden rounded-lg">
            <Image src="/icon.png" alt="Nitejar" width={28} height={28} className="h-full w-full object-cover" />
          </div>
          <span className="text-sm font-semibold text-white/90">Nitejar</span>
        </a>
        <div className="w-9" /> {/* Spacer for centering */}
      </header>

      {/* Mobile sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-60 p-0" showCloseButton={false}>
          <SidebarNav collapsed={false} user={user} onSignOut={onSignOut} />
        </SheetContent>
      </Sheet>
    </>
  )
}
