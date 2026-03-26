'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useSidebar } from './sidebar-context'

export function AdminShell({ children }: { children: ReactNode }) {
  const { collapsed } = useSidebar()

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden transition-[margin] duration-200',
        collapsed ? 'md:ml-[56px]' : 'md:ml-60'
      )}
    >
      <main className="relative flex min-h-0 flex-1 flex-col px-2 pt-2 pb-4 sm:px-6 sm:pt-4 sm:pb-6">
        {children}
      </main>
    </div>
  )
}
