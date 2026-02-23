'use client'

import { useState } from 'react'
import Link from 'next/link'
import { IconUpload, IconWand } from '@tabler/icons-react'
import { ImportAgentDialog } from './ImportAgentDialog'

export function AgentListActions() {
  const [importOpen, setImportOpen] = useState(false)

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="rounded-md border border-border/60 bg-white/5 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-white/30 hover:bg-white/10 hover:text-foreground"
        >
          <IconUpload className="mr-1.5 inline-block h-3.5 w-3.5" />
          Import Agent
        </button>
        <Link
          href="/agents/builder"
          className="rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-xs font-medium text-primary transition hover:border-primary/60 hover:bg-primary/25"
        >
          <IconWand className="mr-1.5 inline-block h-3.5 w-3.5" />
          Agent Builder
        </Link>
        <Link
          href="/agents/new"
          className="rounded-md border border-border/60 bg-white/5 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-white/30 hover:bg-white/10 hover:text-foreground"
        >
          Quick Create
        </Link>
      </div>
      <ImportAgentDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  )
}
