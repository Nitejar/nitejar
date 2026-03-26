import type { ReactNode } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'

interface PageScrollShellProps {
  children: ReactNode
  className: string
}

export function PageScrollShell({ children, className }: PageScrollShellProps) {
  return (
    <div className="-mx-2 -mt-2 -mb-4 flex min-h-0 flex-1 flex-col overflow-hidden sm:-mx-6 sm:-mt-4 sm:-mb-6">
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pt-2 pb-4 sm:px-6 sm:pt-4 sm:pb-6">
          <div className={className}>{children}</div>
        </div>
      </ScrollArea>
    </div>
  )
}
