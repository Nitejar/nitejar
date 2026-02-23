'use client'

import Link from 'next/link'
import { IconPlug, IconBrandNpm, IconFolder } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'

export function CustomPluginsSection() {
  const listQuery = trpc.plugins.listPlugins.useQuery()

  if (listQuery.isLoading || !listQuery.data) return null

  const customPlugins = listQuery.data.plugins.filter((p) => p.sourceKind !== 'builtin')

  if (customPlugins.length === 0) return null

  return (
    <div>
      <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Custom Plugins
        <span className="ml-2 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-normal">
          {customPlugins.length}
        </span>
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {customPlugins.map((plugin) => (
          <Link
            key={plugin.id}
            href={`/plugins/custom/${plugin.id}`}
            className="group relative flex flex-col rounded-lg border border-white/10 bg-white/[0.02] p-4 transition hover:border-primary/40 hover:bg-white/[0.04]"
          >
            {/* Enabled dot */}
            <div className="absolute right-3 top-3 flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  plugin.enabled ? 'bg-emerald-400' : 'bg-zinc-500'
                }`}
              />
            </div>

            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-white/5">
              {plugin.sourceKind === 'npm' ? (
                <IconBrandNpm className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
              ) : plugin.sourceKind === 'local' ? (
                <IconFolder className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
              ) : (
                <IconPlug className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
              )}
            </div>

            <h3 className="font-medium">{plugin.name}</h3>

            <div className="mt-1.5 flex items-center gap-2">
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {plugin.sourceKind}
              </span>
              {plugin.currentVersion && (
                <span className="text-[10px] text-muted-foreground">v{plugin.currentVersion}</span>
              )}
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              {plugin.acknowledgedDisclosureCount}/{plugin.declaredCapabilityCount} disclosures
              acknowledged
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}
