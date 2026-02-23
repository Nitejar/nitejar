'use client'

import Link from 'next/link'
import {
  IconBrandTelegram,
  IconBrandGithub,
  IconBrandSlack,
  IconBrandDiscord,
  IconPlug,
  IconPlus,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import type { IntegrationCategory } from '@nitejar/plugin-handlers'
import { CustomPluginsSection } from './CustomPluginsSection'

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  'brand-telegram': IconBrandTelegram,
  'brand-github': IconBrandGithub,
  'brand-slack': IconBrandSlack,
  'brand-discord': IconBrandDiscord,
}

interface ComingSoonCard {
  displayName: string
  description: string
  icon: string
  category: IntegrationCategory
}

const comingSoonPlugins: ComingSoonCard[] = [
  {
    displayName: 'Slack',
    description: 'Connect to Slack workspaces for team messaging.',
    icon: 'brand-slack',
    category: 'messaging',
  },
]

const categoryLabels: Record<IntegrationCategory, string> = {
  messaging: 'Messaging',
  code: 'Developer Tools',
  productivity: 'Productivity',
}

const categoryOrder: IntegrationCategory[] = ['messaging', 'code', 'productivity']

interface CatalogEntry {
  type: string
  displayName: string
  description: string
  icon: string
  category: string
  instanceCount: number
  enabledCount: number
}

function PluginCard({ type, displayName, description, icon, instanceCount }: CatalogEntry) {
  const Icon = iconMap[icon]

  return (
    <Link
      href={`/plugins/${type}`}
      className="group relative flex flex-col rounded-lg border border-white/10 bg-white/[0.02] p-4 transition hover:border-primary/40 hover:bg-white/[0.04]"
    >
      {instanceCount > 0 && (
        <div className="absolute right-3 top-3 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
          {instanceCount} connected
        </div>
      )}
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-white/5">
        {Icon ? (
          <Icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
        ) : (
          <IconPlug className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
        )}
      </div>
      <h3 className="font-medium">{displayName}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </Link>
  )
}

function ComingSoonPluginCard({ displayName, description, icon }: ComingSoonCard) {
  const Icon = iconMap[icon]

  return (
    <div className="relative flex flex-col rounded-lg border border-white/5 bg-white/[0.01] p-4 opacity-60">
      <div className="absolute right-3 top-3 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        Coming Soon
      </div>
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-white/5">
        {Icon ? (
          <Icon className="h-5 w-5 text-muted-foreground/60" />
        ) : (
          <IconPlug className="h-5 w-5 text-muted-foreground/60" />
        )}
      </div>
      <h3 className="font-medium text-muted-foreground">{displayName}</h3>
      <p className="mt-1 text-sm text-muted-foreground/70">{description}</p>
    </div>
  )
}

export function PluginCatalogClient() {
  const catalogQuery = trpc.plugins.catalog.useQuery()

  if (catalogQuery.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-36 animate-pulse rounded-lg border border-white/5 bg-white/[0.02]"
          />
        ))}
      </div>
    )
  }

  const entries = catalogQuery.data?.entries ?? []

  if (entries.length === 0 && comingSoonPlugins.length === 0) {
    return (
      <Empty>
        <EmptyMedia>
          <IconPlug className="h-8 w-8 text-muted-foreground" />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>No plugins available</EmptyTitle>
          <EmptyDescription>
            Plugins connect external platforms and services to your agents.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  // Group entries by category
  const groupedEntries = categoryOrder.reduce(
    (acc, category) => {
      acc[category] = entries.filter((e) => e.category === category)
      return acc
    },
    {} as Record<string, CatalogEntry[]>
  )

  // Group coming soon by category
  const groupedComingSoon = categoryOrder.reduce(
    (acc, category) => {
      acc[category] = comingSoonPlugins.filter((c) => c.category === category)
      return acc
    },
    {} as Record<string, ComingSoonCard[]>
  )

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href="/plugins/install" />}
        >
          <IconPlus className="mr-1.5 h-3.5 w-3.5" />
          Add a Plugin
        </Button>
      </div>

      {categoryOrder.map((category) => {
        const categoryEntries = groupedEntries[category] || []
        const categoryComingSoon = groupedComingSoon[category] || []
        const hasContent = categoryEntries.length > 0 || categoryComingSoon.length > 0

        if (!hasContent) return null

        return (
          <div key={category}>
            <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {categoryLabels[category]}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {categoryEntries.map((entry) => (
                <PluginCard key={entry.type} {...entry} />
              ))}
              {categoryComingSoon.map((card) => (
                <ComingSoonPluginCard key={card.displayName} {...card} />
              ))}
            </div>
          </div>
        )
      })}

      <CustomPluginsSection />
    </div>
  )
}
