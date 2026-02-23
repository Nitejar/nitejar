'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  IconCheck,
  IconCircleCheck,
  IconCopy,
  IconLoader2,
  IconPackage,
  IconBrandGithub,
  IconFolder,
  IconPlug,
  IconPlus,
  IconUpload,
  IconX,
} from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { DynamicFields } from '../components/DynamicFields'
import { PermissionsList, type PluginPermissions } from '../components/PermissionsList'
import { UpdateConfirmationPanel } from '../components/UpdateConfirmationPanel'

type FlowState = 'idle' | 'uploading' | 'preview' | 'installing' | 'configuring' | 'done'

const sourceKindIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  npm: IconPackage,
  github: IconBrandGithub,
  local: IconFolder,
  upload: IconUpload,
}

interface UploadPreview {
  uploadToken: string
  pluginId: string
  version: string
  name: string
  description: string
  permissions: PluginPermissions | undefined
  sourceKind: string
  sourceRef: string
  isUpdate: boolean
  existingPlugin?: {
    name: string
    version: string
    description: string
    permissions: Record<string, unknown> | undefined
  }
}

export function PluginInstallWizard() {
  const router = useRouter()
  const [flowState, setFlowState] = useState<FlowState>('idle')

  // Input state
  const [source, setSource] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Preview state (from upload or resolve)
  const [preview, setPreview] = useState<UploadPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Configure state
  const [installedPluginType, setInstalledPluginType] = useState<string | null>(null)
  const [connectionName, setConnectionName] = useState('')
  const [configFields, setConfigFields] = useState<Record<string, unknown>>({})
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const [addingAgent, setAddingAgent] = useState(false)
  const [pendingAgentId, setPendingAgentId] = useState('')

  // Done state
  const [createdInstanceId, setCreatedInstanceId] = useState<string | null>(null)
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null)

  // Queries
  const resolveQuery = trpc.plugins.resolveSource.useQuery(
    { source: source.trim() },
    { enabled: false }
  )
  const agentsQuery = trpc.org.listAgents.useQuery()
  const setupConfigQuery = trpc.pluginInstances.setupConfig.useQuery(
    { type: installedPluginType ?? '' },
    { enabled: !!installedPluginType }
  )

  // Mutations
  const installMutation = trpc.plugins.installPlugin.useMutation()
  const installFromUploadMutation = trpc.plugins.installFromUpload.useMutation()
  const enableMutation = trpc.plugins.enablePlugin.useMutation()
  const createInstanceMutation = trpc.pluginInstances.createInstance.useMutation()
  const assignAgentMutation = trpc.pluginInstances.setAgentAssignment.useMutation()
  const testConnectionMutation = trpc.pluginInstances.testConnection.useMutation()

  const allAgents = agentsQuery.data ?? []
  const assignedSet = new Set(selectedAgentIds)
  const unassignedAgents = allAgents.filter((a) => !assignedSet.has(a.id))
  const assignedAgents = allAgents.filter((a) => assignedSet.has(a.id))

  // -----------------------------------------------------------------------
  // File drop/select handlers
  // -----------------------------------------------------------------------

  function handleFileSelect(file: File | null) {
    if (!file) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.tgz') && !name.endsWith('.tar.gz') && !name.endsWith('.zip')) {
      setError('File must be a .tgz, .tar.gz, or .zip archive.')
      return
    }
    setError(null)
    void handleUpload(file)
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -----------------------------------------------------------------------
  // Upload → preview
  // -----------------------------------------------------------------------

  async function handleUpload(file: File) {
    setFlowState('uploading')
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/admin/plugins/upload', {
        method: 'POST',
        body: formData,
      })

      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        uploadToken?: string
        pluginId?: string
        version?: string
        name?: string
        description?: string
        permissions?: PluginPermissions
        isUpdate?: boolean
        existingPlugin?: {
          name: string
          version: string
          description: string
          permissions: Record<string, unknown> | undefined
        }
      }

      if (!res.ok || !data.ok || !data.uploadToken || !data.pluginId) {
        setError(data.error ?? 'Upload failed.')
        setFlowState('idle')
        return
      }

      setPreview({
        uploadToken: data.uploadToken,
        pluginId: data.pluginId,
        version: data.version ?? '1.0.0',
        name: data.name ?? data.pluginId,
        description: data.description ?? '',
        permissions: data.permissions,
        sourceKind: 'upload',
        sourceRef: file.name,
        isUpdate: data.isUpdate ?? false,
        existingPlugin: data.existingPlugin,
      })
      setConnectionName(data.name ?? data.pluginId)
      setFlowState('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
      setFlowState('idle')
    }
  }

  // -----------------------------------------------------------------------
  // URL/package resolve → preview
  // -----------------------------------------------------------------------

  async function handleResolve() {
    setError(null)
    setFlowState('uploading') // reuse uploading state for resolve spinner

    try {
      const result = await resolveQuery.refetch()
      if (result.data) {
        if (result.data.error) {
          setError(result.data.error)
          setFlowState('idle')
        } else {
          setPreview({
            uploadToken: '', // URL flow uses installPlugin, not uploadToken
            pluginId: result.data.pluginId,
            version: result.data.version || '1.0.0',
            name: result.data.displayName,
            description: result.data.description,
            permissions: undefined,
            sourceKind: result.data.sourceKind,
            sourceRef: result.data.sourceRef,
            isUpdate: false,
          })
          setConnectionName(result.data.displayName)
          setFlowState('preview')
        }
      } else {
        setFlowState('idle')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resolution failed unexpectedly.')
      setFlowState('idle')
    }
  }

  // -----------------------------------------------------------------------
  // Install (from preview)
  // -----------------------------------------------------------------------

  async function handleInstall(confirmUpdate = false) {
    if (!preview) return
    setFlowState('installing')
    setError(null)

    try {
      if (preview.uploadToken) {
        // Upload flow — use installFromUpload
        await installFromUploadMutation.mutateAsync({
          uploadToken: preview.uploadToken,
          confirmUpdate,
        })
      } else {
        // URL/npm/local flow — use the existing installPlugin + enable
        const installResult = await installMutation.mutateAsync({
          pluginId: preview.pluginId,
          name: preview.name,
          sourceKind: preview.sourceKind as 'npm' | 'local',
          sourceRef: preview.sourceRef,
          version: preview.version,
          declaredCapabilities: [],
        })

        await enableMutation.mutateAsync({
          pluginId: installResult.plugin.id,
          consentAccepted: true,
        })
      }

      setInstalledPluginType(preview.pluginId)
      setFlowState('configuring')
      toast.success(`${preview.name} installed`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Install failed.'
      if (message.includes('npm pack')) {
        setError(`Package install failed. Is '${preview.sourceRef}' a valid npm package?`)
      } else if (message.includes('ENOENT') || message.includes('does not exist')) {
        setError("That folder doesn't exist. Check the path and try again.")
      } else if (message.includes('No valid plugin manifest')) {
        setError("This package doesn't look like a Nitejar plugin — no nitejar-plugin.json found.")
      } else {
        setError(message)
      }
      setFlowState('preview')
    }
  }

  // -----------------------------------------------------------------------
  // Configure + create connection
  // -----------------------------------------------------------------------

  function handleAddAgent() {
    if (!pendingAgentId) return
    setSelectedAgentIds((prev) => [...prev, pendingAgentId])
    setPendingAgentId('')
    setAddingAgent(false)
  }

  function handleRemoveAgent(agentId: string) {
    setSelectedAgentIds((prev) => prev.filter((id) => id !== agentId))
  }

  async function handleCreateConnection() {
    if (!connectionName.trim() || !installedPluginType) return

    try {
      const instance = await createInstanceMutation.mutateAsync({
        type: installedPluginType,
        name: connectionName.trim(),
        config: configFields,
        enabled: true,
      })

      for (const agentId of selectedAgentIds) {
        await assignAgentMutation.mutateAsync({
          pluginInstanceId: instance.id,
          agentId,
          enabled: true,
        })
      }

      if (setupConfigQuery.data?.supportsTestBeforeSave) {
        try {
          const testResult = await testConnectionMutation.mutateAsync({
            pluginInstanceId: instance.id,
          })
          if (!testResult.ok) {
            toast.error(`Connection test: ${testResult.error ?? 'failed'}`)
          }
        } catch {
          // non-fatal
        }
      }

      setCreatedInstanceId(instance.id)
      setWebhookUrl(
        `${window.location.origin}/api/webhooks/plugins/${installedPluginType}/${instance.id}`
      )
      setFlowState('done')
      toast.success('Connection created')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create connection.')
    }
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  function resetWizard() {
    setFlowState('idle')
    setSource('')
    setPreview(null)
    setError(null)
    setInstalledPluginType(null)
    setConnectionName('')
    setConfigFields({})
    setSelectedAgentIds([])
    setAddingAgent(false)
    setPendingAgentId('')
    setCreatedInstanceId(null)
    setWebhookUrl(null)
  }

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  const isResolving = resolveQuery.isFetching
  const isInstalling =
    installFromUploadMutation.isPending || installMutation.isPending || enableMutation.isPending
  const isCreating = createInstanceMutation.isPending || assignAgentMutation.isPending
  const showInputZone = flowState === 'idle' || flowState === 'uploading'
  const showPreview = flowState === 'preview' || flowState === 'installing'
  const showConfigure = flowState === 'configuring'
  const showDone = flowState === 'done'

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardContent className="space-y-6 py-6">
        {/* ============================================================= */}
        {/* Section 1: Smart input zone */}
        {/* ============================================================= */}
        {showInputZone && (
          <div className="space-y-4">
            {/* Drop zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-10 transition ${
                isDragging
                  ? 'border-emerald-500/50 bg-emerald-500/5'
                  : 'border-white/15 hover:border-white/30'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".tgz,.tar.gz,.zip"
                className="hidden"
                onChange={(e) => {
                  const file = (e.target as HTMLInputElement).files?.[0]
                  if (file) handleFileSelect(file)
                }}
              />
              {flowState === 'uploading' ? (
                <>
                  <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Processing...</p>
                </>
              ) : (
                <>
                  <IconUpload className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Drop a plugin package here</p>
                  <p className="text-xs text-muted-foreground">.tgz, .tar.gz, or .zip</p>
                </>
              )}
            </div>

            {/* URL/package input */}
            <div className="space-y-1.5">
              <Label htmlFor="plugin-source" className="text-xs text-muted-foreground">
                Or paste a link / package name
              </Label>
              <div className="flex gap-2">
                <Input
                  id="plugin-source"
                  value={source}
                  onChange={(e) => setSource((e.target as HTMLInputElement).value)}
                  placeholder="https://github.com/user/plugin or nitejar-plugin-foo"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && source.trim()) {
                      e.preventDefault()
                      void handleResolve()
                    }
                  }}
                  disabled={flowState === 'uploading'}
                />
                <Button
                  onClick={() => void handleResolve()}
                  disabled={!source.trim() || isResolving || flowState === 'uploading'}
                  variant="outline"
                >
                  {isResolving ? <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Resolve
                </Button>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
          </div>
        )}

        {/* ============================================================= */}
        {/* Section 2: Preview card */}
        {/* ============================================================= */}
        {showPreview && preview && (
          <div className="space-y-4">
            <PluginPreviewCard preview={preview} />

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            {/* Update confirmation panel */}
            {preview.isUpdate && preview.existingPlugin ? (
              <UpdateConfirmationPanel
                newPlugin={{
                  name: preview.name,
                  version: preview.version,
                  description: preview.description,
                  permissions: preview.permissions as Record<string, unknown> | undefined,
                }}
                existingPlugin={preview.existingPlugin}
                onConfirm={() => void handleInstall(true)}
                onCancel={resetWizard}
                isConfirming={isInstalling}
              />
            ) : (
              <div className="flex items-center gap-2">
                <Button onClick={() => void handleInstall()} disabled={isInstalling}>
                  {isInstalling ? (
                    <>
                      <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Installing...
                    </>
                  ) : (
                    'Install'
                  )}
                </Button>
                <Button variant="outline" onClick={resetWizard} disabled={isInstalling}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ============================================================= */}
        {/* Section 3: Configure + Assign */}
        {/* ============================================================= */}
        {showConfigure && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <IconCheck className="h-4 w-4 text-emerald-400" />
              <span className="text-sm text-emerald-300">
                {preview?.name ?? 'Plugin'} installed — now set up a connection.
              </span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="connection-name">Connection Name</Label>
              <Input
                id="connection-name"
                value={connectionName}
                onChange={(e) => setConnectionName((e.target as HTMLInputElement).value)}
                placeholder="My Plugin Connection"
                required
              />
            </div>

            {setupConfigQuery.isLoading ? (
              <div className="flex items-center justify-center py-4">
                <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : setupConfigQuery.data?.fields && setupConfigQuery.data.fields.length > 0 ? (
              <DynamicFields
                fields={setupConfigQuery.data.fields}
                values={configFields}
                onChange={(key, value) => setConfigFields((prev) => ({ ...prev, [key]: value }))}
                idPrefix="wizard"
              />
            ) : (
              <p className="text-xs text-muted-foreground">No configuration needed.</p>
            )}

            {/* Agent assignment */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Assign Agents</Label>
                {!addingAgent && unassignedAgents.length > 0 && (
                  <Button size="sm" variant="outline" onClick={() => setAddingAgent(true)}>
                    <IconPlus className="mr-1.5 h-3.5 w-3.5" />
                    Add Agent
                  </Button>
                )}
              </div>

              {addingAgent && (
                <div className="flex items-center gap-2">
                  <Select value={pendingAgentId} onValueChange={(v) => setPendingAgentId(v ?? '')}>
                    <SelectTrigger className="w-48">
                      <SelectValue>
                        {allAgents.find((a) => a.id === pendingAgentId)?.name ?? 'Select agent...'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {unassignedAgents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={handleAddAgent} disabled={!pendingAgentId}>
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAddingAgent(false)
                      setPendingAgentId('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}

              {assignedAgents.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No agents assigned yet. You can add them now or later.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {assignedAgents.map((agent) => (
                    <div
                      key={agent.id}
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1"
                    >
                      <span className="text-xs">{agent.name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAgent(agent.id)}
                        className="text-muted-foreground hover:text-red-400"
                      >
                        <IconX className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={() => void handleCreateConnection()}
                disabled={!connectionName.trim() || isCreating}
              >
                {isCreating ? (
                  <>
                    <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Connection'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ============================================================= */}
        {/* Section 4: Done */}
        {/* ============================================================= */}
        {showDone && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
              <IconCircleCheck className="h-8 w-8 text-emerald-400" />
              <div>
                <h3 className="font-medium text-emerald-300">Plugin installed and connected</h3>
                <p className="text-sm text-emerald-300/70">
                  {preview?.name ?? 'Plugin'} is ready to use.
                </p>
              </div>
            </div>

            <div className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs">
              <div className="grid gap-2 sm:grid-cols-2">
                <p className="text-white/70">
                  Plugin: <span className="text-white/90">{preview?.name}</span>
                </p>
                <p className="text-white/70">
                  Connection: <span className="text-white/90">{connectionName}</span>
                </p>
                <p className="text-white/70">
                  Agents:{' '}
                  <span className="text-white/90">
                    {assignedAgents.length > 0
                      ? assignedAgents.map((a) => a.name).join(', ')
                      : 'None assigned'}
                  </span>
                </p>
                {preview?.version && (
                  <p className="text-white/70">
                    Version: <span className="text-white/90">v{preview.version}</span>
                  </p>
                )}
              </div>
            </div>

            {webhookUrl && <WebhookUrlDisplay url={webhookUrl} />}

            <div className="flex items-center gap-2 pt-2">
              {createdInstanceId && (
                <Button onClick={() => router.push(`/plugins/instances/${createdInstanceId}`)}>
                  Go to Plugin
                </Button>
              )}
              <Button variant="outline" onClick={resetWizard}>
                Install Another
              </Button>
              <Button variant="outline" nativeButton={false} render={<Link href="/plugins" />}>
                Back to Catalog
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// PluginPreviewCard
// ---------------------------------------------------------------------------

function PluginPreviewCard({ preview }: { preview: UploadPreview }) {
  const Icon = sourceKindIcons[preview.sourceKind] ?? IconPlug
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium">{preview.name}</h3>
            <Badge variant="outline" className="text-[10px]">
              {preview.sourceKind}
            </Badge>
            {preview.version && (
              <span className="text-[10px] text-muted-foreground">v{preview.version}</span>
            )}
          </div>
          {preview.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{preview.description}</p>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground">
            Plugin ID: <code>{preview.pluginId}</code>
          </p>
        </div>
      </div>

      {/* Permissions */}
      <div className="border-t border-white/5 pt-2">
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-white/40">
          Permissions
        </p>
        <PermissionsList permissions={preview.permissions} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// WebhookUrlDisplay
// ---------------------------------------------------------------------------

function WebhookUrlDisplay({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-1.5">
      <Label>Webhook URL</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs">
          {url}
        </code>
        <Button size="icon-sm" variant="outline" onClick={handleCopy}>
          {copied ? (
            <IconCheck className="h-3.5 w-3.5 text-emerald-300" />
          ) : (
            <IconCopy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Point your external service&apos;s webhook to this URL.
      </p>
    </div>
  )
}
