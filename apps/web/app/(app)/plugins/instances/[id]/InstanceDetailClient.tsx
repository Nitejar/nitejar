'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  IconBrandTelegram,
  IconBrandGithub,
  IconBrandSlack,
  IconBrandDiscord,
  IconPlug,
  IconCircleCheck,
  IconCircleX,
  IconLoader2,
  IconAlertTriangle,
  IconCopy,
  IconCheck,
  IconTrash,
  IconPencil,
  IconRefresh,
  IconX,
  IconPlus,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { toast } from 'sonner'

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  'brand-telegram': IconBrandTelegram,
  'brand-github': IconBrandGithub,
  'brand-slack': IconBrandSlack,
  'brand-discord': IconBrandDiscord,
}

export function InstanceDetailClient({ pluginInstanceId }: { pluginInstanceId: string }) {
  const instanceQuery = trpc.pluginInstances.get.useQuery({ pluginInstanceId })
  const catalogQuery = trpc.plugins.catalogType.useQuery(
    { type: instanceQuery.data?.pluginInstance.type ?? '' },
    { enabled: !!instanceQuery.data }
  )
  const agentsQuery = trpc.org.listAgents.useQuery()

  const instance = instanceQuery.data?.pluginInstance
  const assignedAgentIds = instanceQuery.data?.assignedAgentIds ?? []
  const meta = catalogQuery.data
  const allAgents = agentsQuery.data ?? []

  if (instanceQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (instanceQuery.error || !instance) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted-foreground">Plugin instance not found.</p>
        <Link href="/plugins" className="mt-2 text-xs text-primary hover:underline">
          Back to plugins
        </Link>
      </div>
    )
  }

  const Icon = meta?.icon ? iconMap[meta.icon] : undefined
  const pluginType = instance.type
  return (
    <div className="space-y-6">
      <PageHeader
        category="Plugins"
        title={instance.name}
        description={`${meta?.displayName ?? pluginType} connection`}
        backLink={{
          href: `/plugins/${pluginType}`,
          label: `Back to ${meta?.displayName ?? pluginType}`,
        }}
      />

      {/* Header card: name, type badge, enabled toggle */}
      <HeaderSection
        pluginInstanceId={pluginInstanceId}
        name={instance.name}
        displayName={meta?.displayName ?? pluginType}
        icon={Icon}
        enabled={instance.enabled}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Connection Status */}
        <ConnectionStatusCard pluginInstanceId={pluginInstanceId} type={pluginType} />

        {/* Webhook URL */}
        <WebhookUrlCard webhookUrl={instance.webhookUrl} pluginType={pluginType} />
      </div>

      {/* Agent Assignment */}
      <AgentAssignmentCard
        pluginInstanceId={pluginInstanceId}
        assignedAgentIds={assignedAgentIds}
        allAgents={allAgents}
      />

      {/* Type-specific settings */}
      {pluginType === 'github' && <GitHubSettingsCard pluginInstanceId={pluginInstanceId} />}

      {/* Danger zone */}
      <DangerZoneCard
        pluginInstanceId={pluginInstanceId}
        instanceName={instance.name}
        pluginType={pluginType}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// HeaderSection
// ---------------------------------------------------------------------------

function HeaderSection({
  pluginInstanceId,
  name,
  displayName,
  icon: Icon,
  enabled,
}: {
  pluginInstanceId: string
  name: string
  displayName: string
  icon?: React.ComponentType<{ className?: string }>
  enabled: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(name)
  const utils = trpc.useUtils()

  const updateMutation = trpc.pluginInstances.update.useMutation({
    onSuccess: () => void utils.pluginInstances.get.invalidate(),
  })
  const toggleMutation = trpc.pluginInstances.setEnabled.useMutation({
    onSuccess: () => void utils.pluginInstances.get.invalidate(),
  })

  async function saveName() {
    if (!editName.trim() || editName.trim() === name) {
      setEditing(false)
      return
    }
    await updateMutation.mutateAsync({ pluginInstanceId, name: editName.trim() })
    setEditing(false)
    toast.success('Name updated')
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardContent className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5">
            {Icon ? (
              <Icon className="h-5 w-5 text-foreground" />
            ) : (
              <IconPlug className="h-5 w-5 text-foreground" />
            )}
          </div>
          <div>
            {editing ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName((e.target as HTMLInputElement).value)}
                  className="h-7 w-48 text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveName()
                    if (e.key === 'Escape') setEditing(false)
                  }}
                />
                <Button size="icon-sm" variant="ghost" onClick={() => void saveName()}>
                  <IconCheck className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={() => setEditing(false)}>
                  <IconX className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{name}</h2>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => {
                    setEditName(name)
                    setEditing(true)
                  }}
                >
                  <IconPencil className="h-3 w-3" />
                </Button>
              </div>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="outline" className="text-[10px]">
                {displayName}
              </Badge>
              <code className="text-[10px] text-muted-foreground">{pluginInstanceId}</code>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{enabled ? 'Enabled' : 'Disabled'}</span>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) =>
              toggleMutation.mutate({ pluginInstanceId, enabled: checked })
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// ConnectionStatusCard
// ---------------------------------------------------------------------------

/** Render test result text, turning URLs into clickable links. */
function TestResultMessage({
  testResult,
}: {
  testResult: { ok: boolean; error?: string; message?: string }
}) {
  const text = testResult.ok
    ? (testResult.message ?? 'Connection verified')
    : (testResult.error ?? 'Connection failed')

  // Split on URLs and render them as links
  const parts = text.split(/(https?:\/\/\S+)/g)
  return (
    <span>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:opacity-80"
          >
            {testResult.ok ? part : 'Invite bot to server'}
          </a>
        ) : (
          part
        )
      )}
    </span>
  )
}

function ConnectionStatusCard({
  pluginInstanceId,
  type,
}: {
  pluginInstanceId: string
  type: string
}) {
  const testMutation = trpc.pluginInstances.testConnection.useMutation()
  const instanceQuery = trpc.pluginInstances.get.useQuery({ pluginInstanceId })
  const config = instanceQuery.data?.pluginInstance.config as Record<string, unknown> | null

  const isGitHub = type === 'github'
  const isDiscord = type === 'discord'
  const manifestPending = isGitHub && config?.manifestPending === true

  let statusLabel = 'Ready'
  let statusColor = 'text-emerald-300'

  if (isGitHub) {
    if (manifestPending) {
      statusLabel = 'Pending setup'
      statusColor = 'text-amber-400'
    } else if (config?.appId || config?.appId === '••••••••') {
      statusLabel = 'Connected'
      statusColor = 'text-emerald-300'
    } else {
      statusLabel = 'Unknown'
      statusColor = 'text-zinc-400'
    }
  } else if (isDiscord) {
    // Discord status: show "Needs endpoint" until user has run a successful test
    const hasCredentials = Boolean(
      config?.applicationId && config?.botToken && config?.publicKey && config?.guildId
    )
    if (hasCredentials) {
      statusLabel = 'Credentials saved'
      statusColor = 'text-emerald-300'
    } else {
      statusLabel = 'Incomplete'
      statusColor = 'text-amber-400'
    }
  }

  const testResult = testMutation.data as
    | { ok: boolean; error?: string; message?: string }
    | undefined

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="text-base">Connection Status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {statusColor.includes('emerald') ? (
            <IconCircleCheck className="h-4 w-4 text-emerald-300" />
          ) : statusColor.includes('amber') ? (
            <IconAlertTriangle className="h-4 w-4 text-amber-400" />
          ) : (
            <IconCircleX className="h-4 w-4 text-zinc-400" />
          )}
          <span className={`text-sm ${statusColor}`}>{statusLabel}</span>
        </div>

        {testResult && (
          <div
            className={`flex gap-2 rounded-md border px-3 py-2 text-xs ${
              testResult.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}
          >
            {testResult.ok ? (
              <IconCircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <TestResultMessage testResult={testResult} />
          </div>
        )}

        <Button
          size="sm"
          variant="outline"
          onClick={() => testMutation.mutate({ pluginInstanceId })}
          disabled={testMutation.isPending || manifestPending}
        >
          {testMutation.isPending ? (
            <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <IconRefresh className="mr-1.5 h-3.5 w-3.5" />
          )}
          Test Connection
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// WebhookUrlCard
// ---------------------------------------------------------------------------

function WebhookUrlCard({ webhookUrl, pluginType }: { webhookUrl: string; pluginType: string }) {
  const [copied, setCopied] = useState(false)
  const isDiscord = pluginType === 'discord'

  function handleCopy() {
    void navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="text-base">
          {isDiscord ? 'Interactions Endpoint URL' : 'Webhook URL'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isDiscord ? (
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>
              This goes in <span className="text-foreground">Interactions Endpoint URL</span> — not
              the Webhooks section.
            </p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>
                Open the{' '}
                <a
                  href="https://discord.com/developers/applications"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Discord Developer Portal
                </a>
              </li>
              <li>Select your application</li>
              <li>
                Go to <span className="text-foreground">General Information</span> (not
                &ldquo;Webhooks&rdquo;)
              </li>
              <li>
                Find <span className="text-foreground">Interactions Endpoint URL</span> and paste
                the URL below
              </li>
              <li>
                Click <span className="text-foreground">Save Changes</span> — Discord will verify
                the endpoint
              </li>
            </ol>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Point your webhook to this URL.</p>
        )}
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs">
            {webhookUrl}
          </code>
          <Button size="icon-sm" variant="outline" onClick={handleCopy}>
            {copied ? (
              <IconCheck className="h-3.5 w-3.5 text-emerald-300" />
            ) : (
              <IconCopy className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// AgentAssignmentCard
// ---------------------------------------------------------------------------

function AgentAssignmentCard({
  pluginInstanceId,
  assignedAgentIds,
  allAgents,
}: {
  pluginInstanceId: string
  assignedAgentIds: string[]
  allAgents: Array<{ id: string; name: string }>
}) {
  const [addingAgent, setAddingAgent] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const utils = trpc.useUtils()

  const assignMutation = trpc.pluginInstances.setAgentAssignment.useMutation({
    onSuccess: () => void utils.pluginInstances.get.invalidate(),
  })

  const assignedSet = new Set(assignedAgentIds)
  const unassignedAgents = allAgents.filter((a) => !assignedSet.has(a.id))
  const assignedAgents = allAgents.filter((a) => assignedSet.has(a.id))
  const selectedAgentName =
    allAgents.find((agent) => agent.id === selectedAgentId)?.name ?? 'Select agent...'

  function handleAdd() {
    if (!selectedAgentId) return
    assignMutation.mutate(
      { pluginInstanceId, agentId: selectedAgentId, enabled: true },
      {
        onSuccess: () => {
          setAddingAgent(false)
          setSelectedAgentId('')
          toast.success('Agent assigned')
        },
      }
    )
  }

  function handleRemove(agentId: string) {
    assignMutation.mutate(
      { pluginInstanceId, agentId, enabled: false },
      { onSuccess: () => toast.success('Agent removed') }
    )
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Agent Assignment</CardTitle>
        {!addingAgent && unassignedAgents.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setAddingAgent(true)}>
            <IconPlus className="mr-1.5 h-3.5 w-3.5" />
            Add Agent
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {addingAgent && (
          <div className="flex items-center gap-2">
            <Select value={selectedAgentId} onValueChange={(v) => setSelectedAgentId(v ?? '')}>
              <SelectTrigger className="w-48">
                <SelectValue>{selectedAgentName}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {unassignedAgents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={!selectedAgentId || assignMutation.isPending}
            >
              {assignMutation.isPending ? (
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                'Add'
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAddingAgent(false)}>
              Cancel
            </Button>
          </div>
        )}

        {assignedAgents.length === 0 ? (
          <p className="text-xs text-muted-foreground">No agents assigned to this connection.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {assignedAgents.map((agent) => (
              <div
                key={agent.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1"
              >
                <Link
                  href={`/agents/${agent.id}`}
                  className="text-xs hover:text-primary hover:underline"
                >
                  {agent.name}
                </Link>
                <button
                  type="button"
                  onClick={() => handleRemove(agent.id)}
                  className="text-muted-foreground hover:text-red-400"
                  disabled={assignMutation.isPending}
                >
                  <IconX className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// GitHubSettingsCard
// ---------------------------------------------------------------------------

function GitHubSettingsCard({ pluginInstanceId }: { pluginInstanceId: string }) {
  const settingsQuery = trpc.github.getSettings.useQuery({ pluginInstanceId })
  const installationsQuery = trpc.github.listInstallations.useQuery({ pluginInstanceId })
  const updateMutation = trpc.github.updateSettings.useMutation({
    onSuccess: () => {
      void settingsQuery.refetch()
      toast.success('Settings saved')
    },
  })
  const discoverMutation = trpc.github.discoverInstallations.useMutation({
    onSuccess: (data) => {
      void installationsQuery.refetch()
      toast.success(`Discovered ${data.discovered} new installation(s), ${data.total} total`)
    },
  })

  const settings = settingsQuery.data
  if (settingsQuery.isLoading || !settings) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardContent className="py-6">
          <div className="h-24 animate-pulse rounded bg-white/5" />
        </CardContent>
      </Card>
    )
  }

  if (settings.manifestPending) return null

  const permissionsPresetLabel =
    settings.permissionsPreset === 'minimal' ? 'Minimal (read-only)' : 'Robust (recommended)'
  const commentPolicyLabel =
    settings.commentPolicy === 'mentions' ? 'Mentions only' : 'Respond to all'

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="text-base">GitHub Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Permission Preset</Label>
            <Select
              value={settings.permissionsPreset}
              onValueChange={(v) =>
                updateMutation.mutate({
                  pluginInstanceId,
                  permissionsPreset: v as 'minimal' | 'robust',
                  commentPolicy: settings.commentPolicy,
                  mentionHandle: settings.mentionHandle,
                  trackIssueOpen: settings.trackIssueOpen,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>{permissionsPresetLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="robust">Robust (recommended)</SelectItem>
                <SelectItem value="minimal">Minimal (read-only)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Comment Policy</Label>
            <Select
              value={settings.commentPolicy}
              onValueChange={(v) =>
                updateMutation.mutate({
                  pluginInstanceId,
                  permissionsPreset: settings.permissionsPreset,
                  commentPolicy: v as 'all' | 'mentions',
                  mentionHandle: settings.mentionHandle,
                  trackIssueOpen: settings.trackIssueOpen,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>{commentPolicyLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Respond to all</SelectItem>
                <SelectItem value="mentions">Mentions only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gh-mention">Mention Handle</Label>
            <Input
              id="gh-mention"
              defaultValue={settings.mentionHandle}
              onBlur={(e) => {
                const val = (e.target as HTMLInputElement).value.trim()
                if (val && val !== settings.mentionHandle) {
                  updateMutation.mutate({
                    pluginInstanceId,
                    permissionsPreset: settings.permissionsPreset,
                    mentionHandle: val,
                  })
                }
              }}
            />
          </div>

          <div className="flex items-center gap-2 self-end pb-1">
            <Switch
              checked={settings.trackIssueOpen}
              onCheckedChange={(checked) =>
                updateMutation.mutate({
                  pluginInstanceId,
                  permissionsPreset: settings.permissionsPreset,
                  trackIssueOpen: checked,
                })
              }
            />
            <Label>Track new issues</Label>
          </div>
        </div>

        {/* Installations */}
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium">Installations</h4>
            <Button
              size="sm"
              variant="outline"
              onClick={() => discoverMutation.mutate({ pluginInstanceId })}
              disabled={discoverMutation.isPending}
            >
              {discoverMutation.isPending ? (
                <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <IconRefresh className="mr-1.5 h-3.5 w-3.5" />
              )}
              Sync Installations
            </Button>
          </div>

          {installationsQuery.isLoading ? (
            <div className="h-12 animate-pulse rounded bg-white/5" />
          ) : !installationsQuery.data || installationsQuery.data.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No installations found. Install the GitHub App on an organization or account, then
              sync.
            </p>
          ) : (
            <div className="space-y-1">
              {installationsQuery.data.map((inst) => (
                <div
                  key={inst.id}
                  className="flex items-center justify-between rounded border border-white/10 bg-white/[0.02] px-3 py-2"
                >
                  <div>
                    <p className="text-xs font-medium">{inst.account_login ?? 'Unknown'}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {inst.repos?.length ?? 0} repo(s)
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    #{inst.installation_id}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// DangerZoneCard
// ---------------------------------------------------------------------------

function DangerZoneCard({
  pluginInstanceId,
  instanceName,
  pluginType,
}: {
  pluginInstanceId: string
  instanceName: string
  pluginType: string
}) {
  const router = useRouter()
  const deleteMutation = trpc.pluginInstances.delete.useMutation({
    onSuccess: () => {
      toast.success('Connection deleted')
      router.push(`/plugins/${pluginType}`)
    },
  })

  return (
    <Card className="border-red-500/20 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="text-base text-red-300">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Delete this connection</p>
            <p className="text-xs text-muted-foreground">
              This permanently removes the connection and all its agent assignments.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="destructive" size="sm" />}>
              <IconTrash className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &ldquo;{instanceName}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this connection and remove all agent assignments.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={(e) => {
                    e.preventDefault()
                    deleteMutation.mutate({ pluginInstanceId })
                  }}
                  disabled={deleteMutation.isPending || deleteMutation.isSuccess}
                >
                  {deleteMutation.isPending || deleteMutation.isSuccess
                    ? 'Deleting...'
                    : 'Delete Connection'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}
