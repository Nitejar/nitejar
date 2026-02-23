'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useSidebar } from './sidebar-context'

export function AdminShell({ children }: { children: ReactNode }) {
  const { collapsed } = useSidebar()

  return (
    <div
      className={cn('transition-[margin] duration-200', collapsed ? 'md:ml-[56px]' : 'md:ml-60')}
    >
      {/* Decorative gradient */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.08),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(14,165,233,0.06),transparent_50%)]" />

      <main className="relative mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  )
}
