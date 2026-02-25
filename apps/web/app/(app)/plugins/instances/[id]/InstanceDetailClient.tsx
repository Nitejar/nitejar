'use client'

import { useEffect, useState } from 'react'
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
  IconExternalLink,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
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
        <Link href="/admin/plugins" className="mt-2 text-xs text-primary hover:underline">
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
          href: `/admin/plugins/${pluginType}`,
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
        <WebhookUrlCard webhookUrl={instance.webhookUrl} />
      </div>

      {/* Agent Assignment */}
      <AgentAssignmentCard
        pluginInstanceId={pluginInstanceId}
        assignedAgentIds={assignedAgentIds}
        allAgents={allAgents}
      />

      {/* Type-specific settings */}
      {pluginType === 'github' && <GitHubSettingsCard pluginInstanceId={pluginInstanceId} />}
      {pluginType === 'slack' && <SlackSetupCard pluginInstanceId={pluginInstanceId} />}

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
  const isSlack = type === 'slack'
  const manifestPending = isGitHub && config?.manifestPending === true
  const slackPending = isSlack && config?.manifestPending === true
  const connected = isGitHub ? Boolean(config?.appId || config?.appId === '••••••••') : true

  let statusLabel = 'Unknown'
  let statusColor = 'text-zinc-400'
  if (isGitHub) {
    if (manifestPending) {
      statusLabel = 'Pending setup'
      statusColor = 'text-amber-400'
    } else if (connected) {
      statusLabel = 'Connected'
      statusColor = 'text-emerald-300'
    }
  } else if (isSlack) {
    if (slackPending) {
      statusLabel = 'Pending setup'
      statusColor = 'text-amber-400'
    } else {
      statusLabel = 'Ready'
      statusColor = 'text-emerald-300'
    }
  } else {
    statusLabel = 'Ready'
    statusColor = 'text-emerald-300'
  }

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

        {testMutation.data && (
          <div
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
              testMutation.data.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-red-500/30 bg-red-500/10 text-red-300'
            }`}
          >
            {testMutation.data.ok ? (
              <IconCircleCheck className="h-3.5 w-3.5" />
            ) : (
              <IconAlertTriangle className="h-3.5 w-3.5" />
            )}
            {testMutation.data.ok
              ? 'Connection verified'
              : (testMutation.data.error ?? 'Connection failed')}
          </div>
        )}

        <Button
          size="sm"
          variant="outline"
          onClick={() => testMutation.mutate({ pluginInstanceId })}
          disabled={testMutation.isPending || manifestPending || slackPending}
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

function WebhookUrlCard({ webhookUrl }: { webhookUrl: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="text-base">Webhook URL</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">Point your webhook to this URL.</p>
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
                  href={`/admin/agents/${agent.id}`}
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
// SlackSetupCard
// ---------------------------------------------------------------------------

function SlackSetupCard({ pluginInstanceId }: { pluginInstanceId: string }) {
  const utils = trpc.useUtils()
  const instanceQuery = trpc.pluginInstances.get.useQuery({ pluginInstanceId })
  const updateCredentialsMutation = trpc.pluginInstances.update.useMutation({
    onSuccess: () => void utils.pluginInstances.get.invalidate({ pluginInstanceId }),
  })
  const updatePolicyMutation = trpc.pluginInstances.update.useMutation({
    onSuccess: () => void utils.pluginInstances.get.invalidate({ pluginInstanceId }),
  })
  const updateSetupMutation = trpc.pluginInstances.update.useMutation({
    onSuccess: () => void utils.pluginInstances.get.invalidate({ pluginInstanceId }),
  })
  const testMutation = trpc.pluginInstances.testConnection.useMutation()
  const testDirectMutation = trpc.pluginInstances.testConnectionDirect.useMutation()
  const enableMutation = trpc.pluginInstances.setEnabled.useMutation({
    onSuccess: () => void utils.pluginInstances.get.invalidate({ pluginInstanceId }),
  })

  const config = instanceQuery.data?.pluginInstance.config as Record<string, unknown> | null
  const manifestPending = config?.manifestPending === true
  const manifestQuery = trpc.slack.getManifest.useQuery(
    { pluginInstanceId },
    { enabled: manifestPending }
  )

  const [botToken, setBotToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [inboundPolicy, setInboundPolicy] = useState<'mentions' | 'all'>('mentions')
  const [copiedItem, setCopiedItem] = useState<'manifest' | 'webhook' | null>(null)
  const isCredentialsSaving =
    updateCredentialsMutation.isPending ||
    testMutation.isPending ||
    testDirectMutation.isPending ||
    instanceQuery.isLoading
  const isPolicySaving = updatePolicyMutation.isPending || instanceQuery.isLoading
  const isSetupSaving =
    updateSetupMutation.isPending ||
    testMutation.isPending ||
    testDirectMutation.isPending ||
    enableMutation.isPending ||
    instanceQuery.isLoading

  useEffect(() => {
    const value = config?.inboundPolicy
    if (value === 'all' || value === 'mentions') {
      setInboundPolicy(value)
    }
  }, [config?.inboundPolicy])

  const persistedInboundPolicy: 'mentions' | 'all' =
    config?.inboundPolicy === 'all' ? 'all' : 'mentions'
  const trimmedBotToken = botToken.trim()
  const trimmedSigningSecret = signingSecret.trim()
  const credentialsReady = trimmedBotToken.length > 0 && trimmedSigningSecret.length > 0
  const policyChanged = inboundPolicy !== persistedInboundPolicy

  const getBaseConfig = (): Record<string, unknown> => {
    const baseConfig: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(config ?? {})) {
      if (key === 'botToken' || key === 'signingSecret' || key === 'manifestPending') continue
      baseConfig[key] = value
    }
    return baseConfig
  }

  async function saveCredentials() {
    if (!credentialsReady) {
      toast.error('Paste both Bot Token and Signing Secret to update credentials.')
      return
    }

    const baseConfig = getBaseConfig()
    const directTest = await testDirectMutation.mutateAsync({
      type: 'slack',
      config: {
        ...baseConfig,
        inboundPolicy: persistedInboundPolicy,
        botToken: trimmedBotToken,
        signingSecret: trimmedSigningSecret,
      },
    })
    if (!directTest.ok) {
      toast.error(`Connection test failed: ${directTest.error ?? 'Unknown error'}`)
      return
    }

    try {
      await updateCredentialsMutation.mutateAsync({
        pluginInstanceId,
        config: {
          botToken: trimmedBotToken,
          signingSecret: trimmedSigningSecret,
        },
      })

      const verify = await testMutation.mutateAsync({ pluginInstanceId })
      if (!verify.ok) {
        toast.error(`Connection test failed: ${verify.error ?? 'Unknown error'}`)
        return
      }

      setBotToken('')
      setSigningSecret('')
      toast.success('Slack credentials saved.')
      await utils.pluginInstances.get.invalidate({ pluginInstanceId })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save Slack credentials')
    }
  }

  async function saveInboundPolicy() {
    if (!policyChanged) return

    try {
      await updatePolicyMutation.mutateAsync({
        pluginInstanceId,
        config: { inboundPolicy },
      })
      toast.success('Slack message intake setting saved.')
      await utils.pluginInstances.get.invalidate({ pluginInstanceId })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save Slack message intake')
    }
  }

  if (!manifestPending) {
    return (
      <div className="space-y-4">
        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-base">Slack Credentials</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded border border-white/10 bg-black/20 px-2.5 py-2 text-[11px] text-muted-foreground">
              <p>Paste a new Bot Token and Signing Secret to rotate credentials.</p>
              <p>Bot Token: OAuth &amp; Permissions -&gt; Bot User OAuth Token</p>
              <p>Signing Secret: Basic Information -&gt; App Credentials -&gt; Signing Secret</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="slack-bot-token">Bot Token</Label>
                <Input
                  id="slack-bot-token"
                  type="password"
                  placeholder="xoxb-..."
                  value={botToken}
                  onChange={(event) => setBotToken((event.target as HTMLInputElement).value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="slack-signing-secret">Signing Secret</Label>
                <Input
                  id="slack-signing-secret"
                  type="password"
                  placeholder="abc123..."
                  value={signingSecret}
                  onChange={(event) => setSigningSecret((event.target as HTMLInputElement).value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => void saveCredentials()}
                disabled={isCredentialsSaving || !credentialsReady}
              >
                {isCredentialsSaving ? (
                  <>
                    <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Credentials'
                )}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Updates token + signing secret only.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-base">Message Intake</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Listen for</Label>
              <Select
                value={inboundPolicy}
                onValueChange={(value) => setInboundPolicy(value as 'mentions' | 'all')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mentions">Mentions only (recommended)</SelectItem>
                  <SelectItem value="all">All messages in allowed channels</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void saveInboundPolicy()}
                disabled={isPolicySaving || !policyChanged}
              >
                {isPolicySaving ? (
                  <>
                    <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Intake Setting'
                )}
              </Button>
              <p className="text-[11px] text-muted-foreground">Updates inbound policy only.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  async function copyValue(key: 'manifest' | 'webhook', value: string) {
    await navigator.clipboard.writeText(value)
    setCopiedItem(key)
    setTimeout(() => setCopiedItem(null), 2000)
  }

  async function completeSetup() {
    if (manifestQuery.data && !manifestQuery.data.isPublicBaseUrl) {
      toast.error(
        'Slack webhook URL is local. Set a public app URL in Settings -> Runtime, then retry setup.'
      )
      return
    }

    if (!trimmedBotToken || !trimmedSigningSecret) {
      toast.error('Paste both Bot Token and Signing Secret to continue.')
      return
    }

    const baseConfig = getBaseConfig()
    const readyConfig: Record<string, unknown> = {
      ...baseConfig,
      inboundPolicy,
      botToken: trimmedBotToken,
      signingSecret: trimmedSigningSecret,
      manifestPending: false,
    }

    try {
      await updateSetupMutation.mutateAsync({
        pluginInstanceId,
        config: readyConfig,
      })

      const testResult = await testMutation.mutateAsync({ pluginInstanceId })
      if (!testResult.ok) {
        await updateSetupMutation
          .mutateAsync({
            pluginInstanceId,
            config: {
              ...readyConfig,
              manifestPending: true,
            },
          })
          .catch(() => {})
        toast.error(`Connection test failed: ${testResult.error ?? 'Unknown error'}`)
        return
      }

      await enableMutation.mutateAsync({ pluginInstanceId, enabled: true })
      toast.success('Slack connection is live.')
      await utils.pluginInstances.get.invalidate({ pluginInstanceId })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to complete Slack setup')
    }
  }

  const createUrl = manifestQuery.data?.createUrl
  const manifestJson = manifestQuery.data?.manifestJson
  const requestUrl = manifestQuery.data?.requestUrl
  return (
    <Card className="border-amber-500/20 bg-amber-500/[0.04]">
      <CardHeader>
        <CardTitle className="text-base">Finish Slack Setup</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          This connection is waiting for Slack app registration. Follow these steps and we will
          verify credentials before enabling the connection.
        </div>

        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded border border-amber-400/40 bg-amber-500/20 px-2 py-0.5">
            Step 1: Create app
          </span>
          <span className="rounded border border-amber-400/40 bg-amber-500/10 px-2 py-0.5">
            Step 2: Install + invite
          </span>
          <span className="rounded border border-amber-400/40 bg-amber-500/10 px-2 py-0.5">
            Step 3: Paste + verify
          </span>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium">1. Create the Slack app with this manifest</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                if (!createUrl) return
                window.open(createUrl, '_blank', 'noopener,noreferrer')
              }}
              disabled={!createUrl}
            >
              <IconExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open Slack App Builder
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => manifestJson && void copyValue('manifest', manifestJson)}
              disabled={!manifestJson}
            >
              {copiedItem === 'manifest' ? (
                <IconCheck className="mr-1.5 h-3.5 w-3.5 text-emerald-300" />
              ) : (
                <IconCopy className="mr-1.5 h-3.5 w-3.5" />
              )}
              Copy Manifest JSON
            </Button>
          </div>
          {requestUrl && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Request URL</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs">
                  {requestUrl}
                </code>
                <Button
                  size="icon-sm"
                  variant="outline"
                  onClick={() => void copyValue('webhook', requestUrl)}
                >
                  {copiedItem === 'webhook' ? (
                    <IconCheck className="h-3.5 w-3.5 text-emerald-300" />
                  ) : (
                    <IconCopy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          )}
          {!manifestQuery.data?.isPublicBaseUrl && (
            <p className="text-xs font-medium text-amber-300">
              This app URL is local. Set a public app URL in Settings -&gt; Runtime, then retry
              setup.
            </p>
          )}
          {manifestJson && (
            <Textarea
              readOnly
              value={manifestJson}
              className="min-h-40 font-mono text-[11px]"
              aria-label="Slack app manifest JSON"
            />
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium">
            2. Install the app, then paste credentials from Slack App Settings
          </p>
          <div className="rounded border border-white/10 bg-black/20 px-2.5 py-2 text-[11px] text-muted-foreground">
            <p>
              Invite after install:{' '}
              <code className="rounded bg-white/10 px-1 py-0.5">
                {manifestQuery.data?.setupGuide?.inviteCommand ?? '/invite @your-bot-handle'}
              </code>
            </p>
            <p>
              Bot Token: {manifestQuery.data?.setupGuide?.botTokenPath ?? 'OAuth & Permissions'}
            </p>
            <p>
              Signing Secret:{' '}
              {manifestQuery.data?.setupGuide?.signingSecretPath ?? 'Basic Information'}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="slack-bot-token">Bot Token</Label>
              <Input
                id="slack-bot-token"
                type="password"
                placeholder="xoxb-..."
                value={botToken}
                onChange={(event) => setBotToken((event.target as HTMLInputElement).value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slack-signing-secret">Signing Secret</Label>
              <Input
                id="slack-signing-secret"
                type="password"
                placeholder="abc123..."
                value={signingSecret}
                onChange={(event) => setSigningSecret((event.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Listen for</Label>
            <Select
              value={inboundPolicy}
              onValueChange={(value) => setInboundPolicy(value as 'mentions' | 'all')}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mentions">Mentions only (recommended)</SelectItem>
                <SelectItem value="all">All messages in allowed channels</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void completeSetup()}
            disabled={isSetupSaving || manifestQuery.data?.isPublicBaseUrl === false}
          >
            {isSetupSaving ? (
              <>
                <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Verifying...
              </>
            ) : (
              'Verify & Enable Slack'
            )}
          </Button>
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
      router.push(`/admin/plugins/${pluginType}`)
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
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => deleteMutation.mutate({ pluginInstanceId })}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete Connection'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}
