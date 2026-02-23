'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  IconLoader2,
  IconPlug,
  IconBrandNpm,
  IconFolder,
  IconChevronDown,
  IconEye,
} from '@tabler/icons-react'
import { trpc, type RouterOutputs } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { PageHeader } from '@/app/(app)/components/PageHeader'
import { RelativeTime } from '@/app/(app)/components/RelativeTime'
import { toast } from 'sonner'

export function CustomPluginDetailClient({ pluginId }: { pluginId: string }) {
  const pluginQuery = trpc.plugins.getPlugin.useQuery({ pluginId })

  if (pluginQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (pluginQuery.error || !pluginQuery.data) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">Plugin not found.</p>
        <Link href="/plugins" className="mt-2 text-xs text-primary hover:underline">
          Back to plugins
        </Link>
      </div>
    )
  }

  const data = pluginQuery.data

  return (
    <div className="space-y-6">
      <PageHeader
        category="Plugins"
        title={data.plugin.name}
        description={`Custom plugin \u00b7 ${data.plugin.sourceKind}`}
        backLink={{ href: '/plugins', label: 'Back to plugins' }}
      />

      <OverviewCard pluginId={pluginId} data={data} />
      <DisclosuresCard data={data} />
      <VersionsCard data={data} />
      <EventsCard pluginId={pluginId} data={data} />
      <DangerZoneCard pluginId={pluginId} data={data} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginData = RouterOutputs['plugins']['getPlugin']

// ---------------------------------------------------------------------------
// OverviewCard
// ---------------------------------------------------------------------------

function OverviewCard({ pluginId, data }: { pluginId: string; data: PluginData }) {
  const utils = trpc.useUtils()
  const enableMutation = trpc.plugins.enablePlugin.useMutation({
    onSuccess: () => {
      toast.success('Plugin enabled')
      void utils.plugins.getPlugin.invalidate({ pluginId })
      void utils.plugins.listPlugins.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })
  const disableMutation = trpc.plugins.disablePlugin.useMutation({
    onSuccess: () => {
      toast.success('Plugin disabled')
      void utils.plugins.getPlugin.invalidate({ pluginId })
      void utils.plugins.listPlugins.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const { plugin, runtimeBadgeLabel, trustMode } = data

  const SourceIcon =
    plugin.sourceKind === 'npm'
      ? IconBrandNpm
      : plugin.sourceKind === 'local'
        ? IconFolder
        : IconPlug

  function handleToggle(checked: boolean) {
    if (checked) {
      // Enable requires consent — the AlertDialog handles this
      return
    }
    disableMutation.mutate({ pluginId })
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardContent className="space-y-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5">
              <SourceIcon className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">{plugin.name}</h2>
              <div className="mt-0.5 flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {plugin.sourceKind}
                </Badge>
                {plugin.sourceRef && (
                  <code className="text-[10px] text-muted-foreground">{plugin.sourceRef}</code>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {plugin.enabled ? 'Enabled' : 'Disabled'}
            </span>
            {plugin.enabled ? (
              <Switch checked onCheckedChange={handleToggle} disabled={disableMutation.isPending} />
            ) : (
              <AlertDialog>
                <AlertDialogTrigger
                  render={<Switch checked={false} disabled={enableMutation.isPending} />}
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Enable &ldquo;{plugin.name}&rdquo;?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This is a third-party plugin. Enabling it will allow it to execute code and
                      access capabilities per its declared disclosures. Make sure you trust the
                      source before proceeding.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => enableMutation.mutate({ pluginId, consentAccepted: true })}
                      disabled={enableMutation.isPending}
                    >
                      {enableMutation.isPending ? 'Enabling...' : 'Enable Plugin'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Plugin ID</p>
            <code className="text-[11px]">{plugin.id}</code>
          </div>
          <div>
            <p className="text-muted-foreground">Trust Level</p>
            <p>{plugin.trustLevel}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Version</p>
            <p>{plugin.currentVersion ?? 'n/a'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Runtime</p>
            <Badge variant="outline" className="text-[10px]">
              {runtimeBadgeLabel}
            </Badge>
          </div>
        </div>

        {plugin.currentChecksum && (
          <div className="text-xs">
            <p className="text-muted-foreground">Checksum</p>
            <code className="break-all text-[10px] text-muted-foreground/80">
              {plugin.currentChecksum}
            </code>
          </div>
        )}

        <div className="flex gap-4 text-xs text-muted-foreground">
          {plugin.installedAt && (
            <RelativeTime
              timestamp={
                typeof plugin.installedAt === 'number'
                  ? plugin.installedAt
                  : Math.floor(new Date(plugin.installedAt).getTime() / 1000)
              }
              prefix="Installed"
            />
          )}
          {plugin.updatedAt && (
            <RelativeTime
              timestamp={
                typeof plugin.updatedAt === 'number'
                  ? plugin.updatedAt
                  : Math.floor(new Date(plugin.updatedAt).getTime() / 1000)
              }
              prefix="Updated"
            />
          )}
        </div>

        {trustMode === 'saas_locked' && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Third-party plugins are restricted in the current trust mode.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// DisclosuresCard
// ---------------------------------------------------------------------------

function DisclosuresCard({ data }: { data: PluginData }) {
  const { declaredCapabilities } = data

  if (declaredCapabilities.length === 0) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconEye className="h-4 w-4" />
            Disclosures
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            This plugin does not declare any disclosures.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconEye className="h-4 w-4" />
          Disclosures
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="divide-y divide-white/5">
          {declaredCapabilities.map((cap) => {
            const key = `${cap.permission}:${cap.scope ?? '*'}`
            return (
              <div key={key} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-xs font-medium">{cap.permission}</p>
                  {cap.scope && (
                    <code className="text-[10px] text-muted-foreground">{cap.scope}</code>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={
                    cap.acknowledged
                      ? 'border-emerald-500/30 text-emerald-300 text-[10px]'
                      : 'border-amber-500/30 text-amber-300 text-[10px]'
                  }
                >
                  {cap.acknowledged ? 'Acknowledged' : 'Pending review'}
                </Badge>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// VersionsCard
// ---------------------------------------------------------------------------

function VersionsCard({ data }: { data: PluginData }) {
  const { versions } = data

  if (versions.length === 0) return null

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="text-base">Versions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-white/5">
          {versions.map((v) => (
            <div
              key={`${v.version}-${v.checksum}`}
              className="flex items-center justify-between py-2"
            >
              <div>
                <p className="text-xs font-medium">v{v.version}</p>
                <code className="text-[10px] text-muted-foreground">
                  {v.checksum?.slice(0, 12)}...
                </code>
              </div>
              <div className="text-right">
                {v.installPath && (
                  <p className="text-[10px] text-muted-foreground truncate max-w-48">
                    {v.installPath}
                  </p>
                )}
                {v.installedAt && (
                  <RelativeTime
                    timestamp={
                      typeof v.installedAt === 'number'
                        ? v.installedAt
                        : Math.floor(new Date(v.installedAt).getTime() / 1000)
                    }
                    className="text-[10px] text-muted-foreground"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// EventsCard
// ---------------------------------------------------------------------------

interface NormalizedEvent {
  id: string
  kind: string
  status: string
  createdAt: number
  detailJson: string | null
}

function normalizeEvents(
  raw: Array<{
    id: string
    kind: string
    status: string
    created_at: number
    detail_json: string | null
  }>
): NormalizedEvent[] {
  return raw.map((e) => ({
    id: e.id,
    kind: e.kind,
    status: e.status,
    createdAt: e.created_at,
    detailJson: e.detail_json,
  }))
}

function EventsCard({ pluginId, data }: { pluginId: string; data: PluginData }) {
  const [showAll, setShowAll] = useState(false)
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)

  const lastEvent = data.recentEvents[data.recentEvents.length - 1] as NormalizedEvent | undefined

  const olderEventsQuery = trpc.plugins.listPluginEvents.useQuery(
    {
      pluginId,
      limit: 50,
      cursor: lastEvent ? { createdAt: lastEvent.createdAt, id: lastEvent.id } : undefined,
    },
    { enabled: showAll }
  )

  const olderNormalized = olderEventsQuery.data?.events
    ? normalizeEvents(olderEventsQuery.data.events)
    : []

  const events: NormalizedEvent[] = showAll
    ? [...data.recentEvents, ...olderNormalized]
    : data.recentEvents

  if (events.length === 0) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <CardTitle className="text-base">Events</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">No events recorded yet.</p>
        </CardContent>
      </Card>
    )
  }

  const kindColors: Record<string, string> = {
    install: 'bg-blue-500/20 text-blue-300',
    enable: 'bg-emerald-500/20 text-emerald-300',
    disable: 'bg-zinc-500/20 text-zinc-300',
    disclosure_acknowledge: 'bg-purple-500/20 text-purple-300',
    permission_grant: 'bg-purple-500/20 text-purple-300', // legacy events
  }

  const statusColors: Record<string, string> = {
    ok: 'bg-emerald-500/20 text-emerald-300',
    blocked: 'bg-red-500/20 text-red-300',
    error: 'bg-red-500/20 text-red-300',
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="text-base">Events</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {events.map((event) => (
          <div key={event.id}>
            <div
              role="button"
              tabIndex={0}
              className="flex w-full cursor-pointer items-center justify-between rounded px-2 py-1.5 text-left transition hover:bg-white/[0.03]"
              onClick={() => setExpandedEvent(expandedEvent === event.id ? null : event.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setExpandedEvent(expandedEvent === event.id ? null : event.id)
                }
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${kindColors[event.kind] ?? 'bg-white/10 text-muted-foreground'}`}
                >
                  {event.kind}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusColors[event.status] ?? 'bg-white/10 text-muted-foreground'}`}
                >
                  {event.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <RelativeTime
                  timestamp={
                    typeof event.createdAt === 'number'
                      ? event.createdAt
                      : Math.floor(new Date(event.createdAt).getTime() / 1000)
                  }
                  className="text-[10px] text-muted-foreground"
                />
                <IconChevronDown
                  className={`h-3 w-3 text-muted-foreground transition ${expandedEvent === event.id ? 'rotate-0' : '-rotate-90'}`}
                />
              </div>
            </div>
            {expandedEvent === event.id && event.detailJson && (
              <pre className="mt-1 max-h-48 overflow-auto rounded border border-white/5 bg-black/30 p-2 text-[10px] text-muted-foreground">
                {JSON.stringify(JSON.parse(event.detailJson), null, 2)}
              </pre>
            )}
          </div>
        ))}

        {!showAll && data.recentEvents.length >= 30 && (
          <Button
            size="sm"
            variant="ghost"
            className="w-full text-xs"
            onClick={() => setShowAll(true)}
          >
            {olderEventsQuery.isLoading ? (
              <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            Load older events
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// DangerZoneCard
// ---------------------------------------------------------------------------

function DangerZoneCard({ pluginId, data }: { pluginId: string; data: PluginData }) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const disableMutation = trpc.plugins.disablePlugin.useMutation({
    onSuccess: () => {
      toast.success('Plugin disabled')
      void utils.plugins.getPlugin.invalidate({ pluginId })
      void utils.plugins.listPlugins.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })
  const deleteMutation = trpc.plugins.deletePlugin.useMutation({
    onSuccess: () => {
      toast.success('Plugin deleted')
      void utils.plugins.listPlugins.invalidate()
      router.push('/plugins')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card className="border-red-500/20 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="text-base text-red-300">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Disable this plugin</p>
            <p className="text-xs text-muted-foreground">
              The plugin will stop executing. No data is deleted.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={!data.plugin.enabled || disableMutation.isPending}
            onClick={() => disableMutation.mutate({ pluginId })}
          >
            {disableMutation.isPending ? 'Disabling...' : 'Disable Plugin'}
          </Button>
        </div>

        <div className="border-t border-white/5" />

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Delete this plugin</p>
            <p className="text-xs text-muted-foreground">
              Permanently removes the plugin, all versions, disclosures, and event history.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="destructive" size="sm" disabled={deleteMutation.isPending}>
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete Plugin'}
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &ldquo;{data.plugin.name}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this plugin and all associated data (versions,
                  disclosures, events, cached artifacts). This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteMutation.mutate({ pluginId })}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Yes, delete permanently'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}
