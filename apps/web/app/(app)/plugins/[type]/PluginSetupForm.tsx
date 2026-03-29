'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  IconExternalLink,
  IconLoader2,
  IconCircleCheck,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { DynamicFields } from '../components/DynamicFields'

interface PluginSetupFormProps {
  pluginType: string
  displayName?: string
  onCreated: (instanceId: string) => void
  onCancel: () => void
}

export function PluginSetupForm({
  pluginType,
  displayName,
  onCreated,
  onCancel,
}: PluginSetupFormProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [fields, setFields] = useState<Record<string, unknown>>({})
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [githubOwnerType, setGitHubOwnerType] = useState<'personal' | 'organization'>('personal')
  const [githubOwnerSlug, setGitHubOwnerSlug] = useState('')

  const utils = trpc.useUtils()
  const setupConfigQuery = trpc.pluginInstances.setupConfig.useQuery({ type: pluginType })
  const createMutation = trpc.pluginInstances.createInstance.useMutation()

  const config = setupConfigQuery.data
  const isRedirect = config?.usesRedirectFlow === true
  const canTest = config?.supportsTestBeforeSave === true

  function setField(key: string, value: unknown) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  async function handleCreateAndRedirect() {
    if (!name.trim()) return

    let slackWindow: Window | null = null
    if (isRedirect && pluginType === 'slack' && typeof window !== 'undefined') {
      slackWindow = window.open('about:blank', '_blank', 'noopener,noreferrer')
    }

    try {
      const result = await createMutation.mutateAsync({
        type: pluginType,
        name: name.trim(),
        config: fields,
        enabled: !isRedirect,
      })

      if (isRedirect && pluginType === 'github') {
        // Fetch manifest imperatively using the new instance ID
        const manifestResult = await utils.github.getManifest.fetch({
          pluginInstanceId: result.id,
          owner:
            githubOwnerType === 'organization'
              ? {
                  ownerType: 'organization',
                  ownerSlug: githubOwnerSlug.trim(),
                }
              : { ownerType: 'personal' },
        })

        if (!manifestResult?.manifest) {
          toast.error('Failed to generate GitHub App manifest')
          return
        }

        if (!manifestResult.isPublicBaseUrl) {
          toast.error(
            'GitHub webhook URL is local. Set a public app URL in Settings -> Runtime, then retry setup.'
          )
          return
        }

        // Create a hidden form and submit it (GitHub manifest flow requires POST)
        const form = document.createElement('form')
        form.method = 'POST'
        form.action = manifestResult.registrationUrl ?? 'https://github.com/settings/apps/new'

        const manifestInput = document.createElement('input')
        manifestInput.type = 'hidden'
        manifestInput.name = 'manifest'
        manifestInput.value = JSON.stringify(manifestResult.manifest)
        form.appendChild(manifestInput)

        // Pass instance ID as state so the callback knows which instance to update
        const stateInput = document.createElement('input')
        stateInput.type = 'hidden'
        stateInput.name = 'state'
        stateInput.value = result.id
        form.appendChild(stateInput)

        document.body.appendChild(form)
        form.submit()
        return
      }

      if (isRedirect && pluginType === 'slack') {
        const install = await utils.slack.getManifest.fetch({
          pluginInstanceId: result.id,
        })

        if (!install?.createUrl) {
          slackWindow?.close()
          toast.error('Failed to prepare Slack app install link')
          return
        }

        if (slackWindow) {
          slackWindow.location.href = install.createUrl
        } else {
          window.open(install.createUrl, '_blank', 'noopener,noreferrer')
        }

        toast.success('Slack connection created. Finish setup on the connection page.')
        onCreated(result.id)
        router.push(`/admin/plugins/instances/${result.id}`)
        return
      }

      toast.success(`${displayName ?? pluginType} connection created`)
      onCreated(result.id)
    } catch (error) {
      slackWindow?.close()
      toast.error(error instanceof Error ? error.message : 'Failed to create connection')
    }
  }

  async function handleTestThenCreate() {
    if (!name.trim()) return

    try {
      const result = await createMutation.mutateAsync({
        type: pluginType,
        name: name.trim(),
        config: fields,
        enabled: true,
      })
      setTestResult({ ok: true })
      toast.success(`${displayName ?? pluginType} connection created and verified`)
      onCreated(result.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create connection'
      setTestResult({ ok: false, error: message })
      toast.error(message)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isRedirect) {
      await handleCreateAndRedirect()
      return
    }

    if (canTest) {
      await handleTestThenCreate()
    } else {
      await handleCreateAndRedirect()
    }
  }

  if (setupConfigQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const isSubmitting = createMutation.isPending

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name field (universal) */}
      <div className="space-y-1.5">
        <Label htmlFor="setup-name">Connection Name</Label>
        <Input
          id="setup-name"
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder={`My ${displayName ?? pluginType}`}
          required
        />
      </div>

      {/* Dynamic fields from setupConfig */}
      {config?.fields && (
        <DynamicFields
          fields={config.fields}
          values={fields}
          onChange={setField}
          idPrefix="setup"
        />
      )}

      {isRedirect && pluginType === 'slack' && (
        <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <p className="font-medium">Slack setup journey</p>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded border border-amber-400/40 bg-amber-500/20 px-2 py-0.5">
              1. Create app from manifest
            </span>
            <span className="rounded border border-amber-400/40 bg-amber-500/10 px-2 py-0.5">
              2. Install app + invite to channel
            </span>
            <span className="rounded border border-amber-400/40 bg-amber-500/10 px-2 py-0.5">
              3. Paste token + secret, then verify
            </span>
          </div>
          <p>
            We create a pending Slack connection, open Slack with a prefilled manifest, and route
            you to the connection page to finish verification.
          </p>
        </div>
      )}

      {isRedirect && pluginType === 'github' && (
        <div className="space-y-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">GitHub App owner</p>
            <p className="text-xs text-muted-foreground">
              Choose where the GitHub App itself should be created before we open the manifest setup
              flow.
            </p>
          </div>

          <RadioGroup
            value={githubOwnerType}
            onValueChange={(value) =>
              setGitHubOwnerType(value === 'organization' ? 'organization' : 'personal')
            }
            className="gap-3"
          >
            <label className="flex items-start gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
              <RadioGroupItem value="personal" />
              <span className="space-y-0.5">
                <span className="block font-medium text-foreground">Personal account</span>
                <span className="block text-muted-foreground">
                  Creates the app in your personal GitHub developer settings.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
              <RadioGroupItem value="organization" />
              <span className="space-y-0.5">
                <span className="block font-medium text-foreground">Organization</span>
                <span className="block text-muted-foreground">
                  Creates the app directly under a GitHub organization you manage.
                </span>
              </span>
            </label>
          </RadioGroup>

          {githubOwnerType === 'organization' ? (
            <div className="space-y-1.5">
              <Label htmlFor="github-owner-slug">Organization slug</Label>
              <Input
                id="github-owner-slug"
                value={githubOwnerSlug}
                onChange={(e) => setGitHubOwnerSlug((e.target as HTMLInputElement).value)}
                placeholder="nitejar"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Example: <span className="text-foreground">nitejar</span>
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* Credential help link */}
      {config?.credentialHelpUrl && config?.credentialHelpLabel && (
        <a
          href={config.credentialHelpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {config.credentialHelpLabel}
          <IconExternalLink className="h-3 w-3" />
        </a>
      )}
      {/* Test result display */}
      {testResult && (
        <div
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
            testResult.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          {testResult.ok ? (
            <IconCircleCheck className="h-3.5 w-3.5" />
          ) : (
            <IconAlertTriangle className="h-3.5 w-3.5" />
          )}
          {testResult.ok ? 'Connection verified' : (testResult.error ?? 'Connection failed')}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={
            isSubmitting ||
            !name.trim() ||
            (isRedirect &&
              pluginType === 'github' &&
              githubOwnerType === 'organization' &&
              !githubOwnerSlug.trim())
          }
        >
          {isSubmitting ? (
            <>
              <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Creating...
            </>
          ) : isRedirect ? (
            pluginType === 'slack' ? (
              'Create Slack App'
            ) : (
              `Register on ${displayName ?? pluginType}`
            )
          ) : canTest ? (
            'Test & Create'
          ) : (
            'Create'
          )}
        </Button>
      </div>
    </form>
  )
}
