'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  IconExternalLink,
  IconLoader2,
  IconCircleCheck,
  IconAlertTriangle,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { DynamicFields } from '../components/DynamicFields'

/** Render test result text, turning URLs into clickable links. */
function TestResultText({
  testResult,
}: {
  testResult: { ok: boolean; error?: string; message?: string }
}) {
  const text = testResult.ok
    ? (testResult.message ?? 'Connection verified')
    : (testResult.error ?? 'Connection failed')

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
  const [name, setName] = useState('')
  const [fields, setFields] = useState<Record<string, unknown>>({})
  const [testResult, setTestResult] = useState<{
    ok: boolean
    error?: string
    message?: string
  } | null>(null)

  const utils = trpc.useUtils()
  const setupConfigQuery = trpc.pluginInstances.setupConfig.useQuery({ type: pluginType })
  const createMutation = trpc.pluginInstances.createInstance.useMutation()
  const testDirectMutation = trpc.pluginInstances.testConnectionDirect.useMutation()

  const config = setupConfigQuery.data
  const isRedirect = config?.usesRedirectFlow === true
  const canTest = config?.supportsTestBeforeSave === true
  function setField(key: string, value: unknown) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  async function handleCreateAndRedirect() {
    if (!name.trim()) return

    try {
      const result = await createMutation.mutateAsync({
        type: pluginType,
        name: name.trim(),
        config: fields,
        enabled: !isRedirect,
      })

      if (isRedirect && pluginType === 'github') {
        // Fetch manifest imperatively using the new instance ID
        const manifest = await utils.github.getManifest.fetch({
          pluginInstanceId: result.id,
        })

        if (!manifest) {
          toast.error('Failed to generate GitHub App manifest')
          return
        }

        // Create a hidden form and submit it (GitHub manifest flow requires POST)
        const form = document.createElement('form')
        form.method = 'POST'
        form.action = config?.registrationUrl ?? 'https://github.com/settings/apps/new'

        const manifestInput = document.createElement('input')
        manifestInput.type = 'hidden'
        manifestInput.name = 'manifest'
        manifestInput.value = JSON.stringify(manifest)
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

      toast.success(`${displayName ?? pluginType} connection created`)
      onCreated(result.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create connection')
    }
  }

  async function handleTestThenCreate() {
    if (!name.trim()) return

    try {
      // Test connection with raw config first — no instance created yet
      const test = await testDirectMutation.mutateAsync({
        type: pluginType,
        config: fields,
      })
      setTestResult(test)

      if (!test.ok) {
        toast.error(`Connection test failed: ${test.error ?? 'Unknown error'}`)
        return
      }

      // Test passed — now create the instance
      const result = await createMutation.mutateAsync({
        type: pluginType,
        name: name.trim(),
        config: fields,
        enabled: true,
      })

      toast.success(`${displayName ?? pluginType} connection created and verified`)
      onCreated(result.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create connection')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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

  const isSubmitting = createMutation.isPending || testDirectMutation.isPending

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
          <TestResultText testResult={testResult} />
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
        <Button type="submit" size="sm" disabled={isSubmitting || !name.trim()}>
          {isSubmitting ? (
            <>
              <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              {testDirectMutation.isPending ? 'Testing...' : 'Creating...'}
            </>
          ) : isRedirect ? (
            `Register on ${displayName ?? pluginType}`
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
