'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  IconBrandTelegram,
  IconBrandGithub,
  IconBrandSlack,
  IconBrandDiscord,
  IconPlug,
  IconArrowRight,
  IconCircleCheck,
  IconCircleX,
  IconPlus,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { PluginSetupForm } from './PluginSetupForm'

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  'brand-telegram': IconBrandTelegram,
  'brand-github': IconBrandGithub,
  'brand-slack': IconBrandSlack,
  'brand-discord': IconBrandDiscord,
}

function statusPill(enabled: boolean) {
  if (enabled) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-300">
        <IconCircleCheck className="h-3.5 w-3.5" />
        Enabled
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-zinc-400">
      <IconCircleX className="h-3.5 w-3.5" />
      Disabled
    </span>
  )
}

export function PluginTypeClient({ pluginType }: { pluginType: string }) {
  const [showSetup, setShowSetup] = useState(false)
  const catalogTypeQuery = trpc.plugins.catalogType.useQuery({ type: pluginType })
  const instancesQuery = trpc.pluginInstances.list.useQuery({ types: [pluginType] })
  const utils = trpc.useUtils()

  const meta = catalogTypeQuery.data
  const instances = instancesQuery.data?.pluginInstances ?? []

  const Icon = meta?.icon ? iconMap[meta.icon] : undefined

  if (catalogTypeQuery.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-lg border border-white/5 bg-white/[0.02]" />
        <div className="h-48 animate-pulse rounded-lg border border-white/5 bg-white/[0.02]" />
      </div>
    )
  }

  if (catalogTypeQuery.error) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Plugin not found</EmptyTitle>
          <EmptyDescription>
            No plugin type &ldquo;{pluginType}&rdquo; is registered.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="space-y-6">
      {/* Plugin type header */}
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/5">
          {Icon ? (
            <Icon className="h-6 w-6 text-foreground" />
          ) : (
            <IconPlug className="h-6 w-6 text-foreground" />
          )}
        </div>
        <div>
          <h2 className="text-lg font-semibold">{meta?.displayName ?? pluginType}</h2>
          {meta?.description && <p className="text-sm text-muted-foreground">{meta.description}</p>}
        </div>
      </div>

      {/* Connections section */}
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Connections</CardTitle>
          <Button size="sm" onClick={() => setShowSetup(true)}>
            <IconPlus className="mr-1.5 h-3.5 w-3.5" />
            New Connection
          </Button>
        </CardHeader>
        <CardContent>
          {instancesQuery.isLoading ? (
            <div className="h-24 animate-pulse rounded border border-white/5 bg-white/[0.01]" />
          ) : instances.length === 0 ? (
            <Empty className="py-8">
              <EmptyMedia>
                <IconPlug className="h-6 w-6 text-muted-foreground" />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>No connections yet</EmptyTitle>
                <EmptyDescription>
                  Connect a {meta?.displayName ?? pluginType} account to get started.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-hidden rounded-lg border border-white/10">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Agents</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instances.map((instance) => (
                    <TableRow key={instance.id} className="border-white/10">
                      <TableCell>
                        <p className="text-sm font-medium">{instance.name}</p>
                      </TableCell>
                      <TableCell>
                        {instance.agents.length === 0 ? (
                          <span className="text-xs text-muted-foreground">None</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {instance.agents.map((agent) => (
                              <Link key={agent.id} href={`/agents/${agent.id}`}>
                                <Badge
                                  variant="outline"
                                  className="cursor-pointer hover:bg-white/5"
                                >
                                  {agent.name}
                                </Badge>
                              </Link>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{statusPill(instance.enabled)}</TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/plugins/instances/${instance.id}`}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          Open
                          <IconArrowRight className="h-3 w-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Setup dialog */}
      <Dialog open={showSetup} onOpenChange={setShowSetup}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New {meta?.displayName ?? pluginType} Connection</DialogTitle>
            <DialogDescription>
              Set up a new {meta?.displayName ?? pluginType} connection.
            </DialogDescription>
          </DialogHeader>
          <PluginSetupForm
            pluginType={pluginType}
            displayName={meta?.displayName}
            onCreated={() => {
              setShowSetup(false)
              void utils.pluginInstances.list.invalidate()
            }}
            onCancel={() => setShowSetup(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
