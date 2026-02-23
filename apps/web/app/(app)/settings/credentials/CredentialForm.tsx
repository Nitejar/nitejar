'use client'

import { useEffect, useMemo, useState } from 'react'
import { IconTrash } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { HostPatternInput, isValidHostPattern } from './HostPatternInput'

const ALIAS_REGEX = /^[a-z][a-z0-9_-]*$/

export interface CredentialFormAgent {
  id: string
  name: string
  handle: string
  emoji?: string | null
}

export interface CredentialFormCredential {
  id: string
  alias: string
  provider: string
  allowedHosts: string[]
  enabled: boolean
  allowedInHeader: boolean
  allowedInQuery: boolean
  allowedInBody: boolean
  agents: Array<{ id: string; name: string }>
}

interface CredentialDraft {
  alias: string
  provider: string
  enabled: boolean
  secret: string
  rotateSecret: boolean
  allowedInHeader: boolean
  allowedInQuery: boolean
  allowedInBody: boolean
  allowedHosts: string[]
  assignedAgentIds: string[]
}

interface CredentialFormProps {
  credential: CredentialFormCredential | null
  agents: CredentialFormAgent[]
  onSaved: (credentialId: string, mode: 'create' | 'edit') => Promise<void> | void
  onDeleted: () => Promise<void> | void
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
  onCheckAlias: (alias: string, excludeCredentialId?: string) => Promise<boolean>
}

function createDefaultDraft(): CredentialDraft {
  return {
    alias: '',
    provider: '',
    enabled: true,
    secret: '',
    rotateSecret: false,
    allowedInHeader: true,
    allowedInQuery: false,
    allowedInBody: false,
    allowedHosts: [],
    assignedAgentIds: [],
  }
}

function draftFromCredential(credential: CredentialFormCredential): CredentialDraft {
  return {
    alias: credential.alias,
    provider: credential.provider,
    enabled: credential.enabled,
    secret: '',
    rotateSecret: false,
    allowedInHeader: credential.allowedInHeader,
    allowedInQuery: credential.allowedInQuery,
    allowedInBody: credential.allowedInBody,
    allowedHosts: credential.allowedHosts,
    assignedAgentIds: credential.agents.map((a) => a.id),
  }
}

function getDraftFingerprint(draft: CredentialDraft, mode: 'create' | 'edit'): string {
  return JSON.stringify({
    alias: draft.alias,
    provider: draft.provider,
    enabled: draft.enabled,
    allowedInHeader: draft.allowedInHeader,
    allowedInQuery: draft.allowedInQuery,
    allowedInBody: draft.allowedInBody,
    allowedHosts: draft.allowedHosts,
    assignedAgentIds: [...draft.assignedAgentIds].sort(),
    rotateSecret: draft.rotateSecret,
    secret: mode === 'create' || draft.rotateSecret ? draft.secret : '',
  })
}

function firstInvalidHost(hosts: string[]): string | null {
  for (const h of hosts) {
    if (!isValidHostPattern(h)) return h
  }
  return null
}

export function CredentialForm({
  credential,
  agents,
  onSaved,
  onDeleted,
  onCancel,
  onDirtyChange,
  onCheckAlias,
}: CredentialFormProps) {
  const mode = credential ? ('edit' as const) : ('create' as const)

  const [draft, setDraft] = useState<CredentialDraft>(
    credential ? draftFromCredential(credential) : createDefaultDraft()
  )
  const [initialFingerprint, setInitialFingerprint] = useState(() =>
    getDraftFingerprint(credential ? draftFromCredential(credential) : createDefaultDraft(), mode)
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [aliasCheck, setAliasCheck] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle')
  const [formStatus, setFormStatus] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)
  const [agentSearch, setAgentSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState('')

  const utils = trpc.useUtils()
  const createMut = trpc.credentials.create.useMutation()
  const updateMut = trpc.credentials.update.useMutation()
  const deleteMut = trpc.credentials.delete.useMutation()
  const assignMut = trpc.credentials.setAgentAssignment.useMutation()

  useEffect(() => {
    const next = credential ? draftFromCredential(credential) : createDefaultDraft()
    setDraft(next)
    setErrors({})
    setAliasCheck('idle')
    setFormStatus(null)
    setConfirmDelete('')
    setInitialFingerprint(getDraftFingerprint(next, credential ? 'edit' : 'create'))
  }, [credential])

  const fingerprint = useMemo(() => getDraftFingerprint(draft, mode), [draft, mode])
  const isDirty = fingerprint !== initialFingerprint

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase()
    if (!q) return agents
    return agents.filter(
      (a) => a.name.toLowerCase().includes(q) || a.handle.toLowerCase().includes(q)
    )
  }, [agentSearch, agents])

  const saving =
    createMut.isPending || updateMut.isPending || deleteMut.isPending || assignMut.isPending

  function setError(key: string, msg: string) {
    setErrors((prev) => ({ ...prev, [key]: msg }))
  }
  function clearError(key: string) {
    setErrors((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function checkAlias() {
    if (mode === 'edit') return
    const alias = draft.alias.trim()
    if (!ALIAS_REGEX.test(alias)) {
      setAliasCheck('invalid')
      setError('alias', 'Must start with a letter. Lowercase letters, numbers, _ and - only.')
      return
    }
    setAliasCheck('checking')
    const ok = await onCheckAlias(alias, credential?.id)
    setAliasCheck(ok ? 'available' : 'taken')
    if (ok) clearError('alias')
    else setError('alias', 'Already in use.')
  }

  async function save() {
    setFormStatus(null)

    const alias = draft.alias.trim()
    if (!alias) {
      setError('alias', 'Required.')
      return
    }
    if (!ALIAS_REGEX.test(alias)) {
      setError('alias', 'Must start with a letter. Lowercase letters, numbers, _ and - only.')
      return
    }
    if (!draft.provider.trim()) {
      setError('provider', 'Required.')
      return
    }
    if (mode === 'create' && !draft.secret.trim()) {
      setError('secret', 'Required.')
      return
    }
    if (draft.rotateSecret && !draft.secret.trim()) {
      setError('secret', 'Enter a new secret.')
      return
    }
    if (!draft.allowedInHeader && !draft.allowedInQuery && !draft.allowedInBody) {
      setError('allowedLocations', 'Select at least one allowed location.')
      return
    }
    if (draft.allowedHosts.length === 0) {
      setError('allowedHosts', 'Add at least one host.')
      return
    }
    const badHost = firstInvalidHost(draft.allowedHosts)
    if (badHost) {
      setError('allowedHosts', `Invalid pattern: ${badHost}`)
      return
    }
    if (mode === 'create' && draft.assignedAgentIds.length === 0) {
      setError('assignedAgents', 'Assign at least one agent.')
      return
    }

    try {
      if (mode === 'create') {
        const created = await createMut.mutateAsync({
          alias,
          provider: draft.provider.trim(),
          secret: draft.secret.trim(),
          allowedHosts: draft.allowedHosts,
          enabled: draft.enabled,
          allowedInHeader: draft.allowedInHeader,
          allowedInQuery: draft.allowedInQuery,
          allowedInBody: draft.allowedInBody,
        })

        await Promise.all(
          draft.assignedAgentIds.map((agentId) =>
            assignMut.mutateAsync({
              credentialId: created.id,
              agentId,
              enabled: true,
            })
          )
        )

        await utils.credentials.list.invalidate()
        await onSaved(created.id, 'create')
        setInitialFingerprint(getDraftFingerprint(draft, 'create'))
        return
      }

      if (!credential) return

      await updateMut.mutateAsync({
        credentialId: credential.id,
        provider: draft.provider.trim(),
        ...(draft.rotateSecret && draft.secret.trim() ? { secret: draft.secret.trim() } : {}),
        allowedHosts: draft.allowedHosts,
        enabled: draft.enabled,
        allowedInHeader: draft.allowedInHeader,
        allowedInQuery: draft.allowedInQuery,
        allowedInBody: draft.allowedInBody,
      })

      const currentIds = new Set(credential.agents.map((a) => a.id))
      const nextIds = new Set(draft.assignedAgentIds)
      const toEnable = draft.assignedAgentIds.filter((id) => !currentIds.has(id))
      const toDisable = credential.agents.map((a) => a.id).filter((id) => !nextIds.has(id))

      await Promise.all([
        ...toEnable.map((agentId) =>
          assignMut.mutateAsync({
            credentialId: credential.id,
            agentId,
            enabled: true,
          })
        ),
        ...toDisable.map((agentId) =>
          assignMut.mutateAsync({
            credentialId: credential.id,
            agentId,
            enabled: false,
          })
        ),
      ])

      await utils.credentials.list.invalidate()
      await onSaved(credential.id, 'edit')

      const refreshed = {
        ...credential,
        provider: draft.provider.trim(),
        allowedHosts: draft.allowedHosts,
        enabled: draft.enabled,
        allowedInHeader: draft.allowedInHeader,
        allowedInQuery: draft.allowedInQuery,
        allowedInBody: draft.allowedInBody,
        agents: agents
          .filter((a) => draft.assignedAgentIds.includes(a.id))
          .map((a) => ({ id: a.id, name: a.name })),
      }
      setDraft(draftFromCredential(refreshed))
      setInitialFingerprint(getDraftFingerprint(draftFromCredential(refreshed), 'edit'))
    } catch (err) {
      setFormStatus({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save.',
      })
    }
  }

  async function handleDelete() {
    if (!credential) return
    if (confirmDelete.trim() !== credential.alias) {
      setFormStatus({ type: 'error', text: 'Type the exact alias to confirm.' })
      return
    }
    try {
      await deleteMut.mutateAsync({ credentialId: credential.id })
      await utils.credentials.list.invalidate()
      await onDeleted()
    } catch (err) {
      setFormStatus({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete.',
      })
    }
  }

  const aliasHint =
    mode === 'edit'
      ? 'Immutable after creation.'
      : aliasCheck === 'checking'
        ? 'Checking availability...'
        : aliasCheck === 'available'
          ? 'Available.'
          : aliasCheck === 'taken'
            ? 'Already in use.'
            : aliasCheck === 'invalid'
              ? 'Invalid format.'
              : 'Lowercase slug for tool calls (e.g. instagram_graph_api)'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-sm font-medium">
          {mode === 'create' ? 'New Credential' : `Edit: ${credential?.alias}`}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {mode === 'create'
            ? 'Set up a credential for agent API access.'
            : 'Update credential settings. Alias cannot be changed.'}
        </p>
      </div>

      {/* Identity */}
      <section className="space-y-4">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Identity
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cred-alias">Alias</Label>
            <Input
              id="cred-alias"
              value={draft.alias}
              disabled={mode === 'edit'}
              placeholder="my_api_key"
              onChange={(e) => {
                setDraft((p) => ({ ...p, alias: e.target.value }))
                setAliasCheck('idle')
              }}
              onBlur={() => void checkAlias()}
            />
            <p
              className={`text-[11px] ${
                errors.alias
                  ? 'text-rose-300'
                  : aliasCheck === 'available'
                    ? 'text-emerald-300'
                    : 'text-muted-foreground'
              }`}
            >
              {errors.alias ?? aliasHint}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cred-provider">Provider</Label>
            <Input
              id="cred-provider"
              value={draft.provider}
              placeholder="Instagram Graph API"
              onChange={(e) => {
                setDraft((p) => ({ ...p, provider: e.target.value }))
                clearError('provider')
              }}
            />
            {errors.provider ? (
              <p className="text-[11px] text-rose-300">{errors.provider}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Human-readable name for this plugin instance.
              </p>
            )}
          </div>
        </div>
        {mode === 'edit' && (
          <div className="flex items-center justify-between rounded-md border border-white/10 bg-black/20 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-white/85">Enabled</p>
              <p className="text-[11px] text-muted-foreground">
                Disabled credentials are blocked from tool access.
              </p>
            </div>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(checked) => setDraft((p) => ({ ...p, enabled: checked }))}
            />
          </div>
        )}
      </section>

      {/* Authentication */}
      <section className="space-y-4 border-t border-white/10 pt-6">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Authentication
        </h3>

        <div className="space-y-1.5">
          <Label htmlFor="cred-secret">Secret</Label>
          {mode === 'edit' && !draft.rotateSecret ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-white/15 text-white/75">
                Current secret retained
              </Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDraft((p) => ({ ...p, rotateSecret: true }))}
              >
                Rotate
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Input
                id="cred-secret"
                type="password"
                value={draft.secret}
                placeholder={mode === 'create' ? 'API key or token' : 'New secret value'}
                onChange={(e) => {
                  setDraft((p) => ({ ...p, secret: e.target.value }))
                  clearError('secret')
                }}
              />
              {mode === 'edit' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setDraft((p) => ({
                      ...p,
                      rotateSecret: false,
                      secret: '',
                    }))
                  }
                >
                  Cancel rotation
                </Button>
              )}
            </div>
          )}
          {errors.secret && <p className="text-[11px] text-rose-300">{errors.secret}</p>}
          {mode === 'create' && !errors.secret && (
            <p className="text-[11px] text-muted-foreground">
              Encrypted at rest. Never exposed in logs or UI.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Allowed Locations</Label>
          <p className="text-[11px] text-muted-foreground">
            Where the agent can place this secret. The agent controls format (e.g.{' '}
            <code className="text-white/70">
              Bearer {'{'}
              {draft.alias || 'mySecret'}
              {'}'}
            </code>
            ). At least one required.
          </p>
          <div className="space-y-2 rounded-md border border-white/10 bg-black/20 p-3">
            <label className="flex items-center gap-2.5">
              <Checkbox
                checked={draft.allowedInHeader}
                onCheckedChange={(checked) => {
                  setDraft((p) => ({ ...p, allowedInHeader: !!checked }))
                  clearError('allowedLocations')
                }}
              />
              <div>
                <p className="text-sm text-white/90">Header</p>
                <p className="text-[11px] text-muted-foreground">Allow use in request headers.</p>
              </div>
            </label>
            <label className="flex items-center gap-2.5">
              <Checkbox
                checked={draft.allowedInQuery}
                onCheckedChange={(checked) => {
                  setDraft((p) => ({ ...p, allowedInQuery: !!checked }))
                  clearError('allowedLocations')
                }}
              />
              <div>
                <p className="text-sm text-white/90">Query string</p>
                <p className="text-[11px] text-muted-foreground">
                  Allow use as a URL query parameter.
                </p>
              </div>
            </label>
            <label className="flex items-center gap-2.5">
              <Checkbox
                checked={draft.allowedInBody}
                onCheckedChange={(checked) => {
                  setDraft((p) => ({ ...p, allowedInBody: !!checked }))
                  clearError('allowedLocations')
                }}
              />
              <div>
                <p className="text-sm text-white/90">Request body</p>
                <p className="text-[11px] text-muted-foreground">Allow use in the request body.</p>
              </div>
            </label>
          </div>
          {errors.allowedLocations && (
            <p className="text-[11px] text-rose-300">{errors.allowedLocations}</p>
          )}
        </div>
      </section>

      {/* Host Policy */}
      <section className="space-y-4 border-t border-white/10 pt-6">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Host Policy
        </h3>
        <HostPatternInput
          hosts={draft.allowedHosts}
          onChange={(hosts) => {
            setDraft((p) => ({ ...p, allowedHosts: hosts }))
            clearError('allowedHosts')
          }}
        />
        {errors.allowedHosts && <p className="text-[11px] text-rose-300">{errors.allowedHosts}</p>}
      </section>

      {/* Agent Access */}
      <section className="space-y-3 border-t border-white/10 pt-6">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Agent Access
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Only assigned agents can use this credential via{' '}
          <code className="text-white/70">secure_http_request</code>.
        </p>
        <Input
          value={agentSearch}
          placeholder="Search agents..."
          onChange={(e) => setAgentSearch(e.target.value)}
        />
        <div className="max-h-48 space-y-1.5 overflow-auto rounded-md border border-white/10 p-2">
          {filteredAgents.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-muted-foreground">No agents found.</p>
          ) : (
            filteredAgents.map((agent) => {
              const selected = draft.assignedAgentIds.includes(agent.id)
              return (
                <label
                  key={agent.id}
                  className="flex cursor-pointer items-center justify-between rounded-md border border-white/10 bg-black/20 px-3 py-2 transition-colors hover:bg-white/[0.03]"
                >
                  <div className="flex items-center gap-2">
                    {agent.emoji && <span className="text-base">{agent.emoji}</span>}
                    <div>
                      <p className="text-sm text-white/90">{agent.name}</p>
                      <p className="text-[11px] text-muted-foreground">@{agent.handle}</p>
                    </div>
                  </div>
                  <Checkbox
                    checked={selected}
                    onCheckedChange={(checked) => {
                      setDraft((p) => {
                        const ids = new Set(p.assignedAgentIds)
                        if (checked) ids.add(agent.id)
                        else ids.delete(agent.id)
                        return { ...p, assignedAgentIds: [...ids] }
                      })
                      clearError('assignedAgents')
                    }}
                  />
                </label>
              )
            })
          )}
        </div>
        {draft.assignedAgentIds.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {draft.assignedAgentIds.length} agent
            {draft.assignedAgentIds.length === 1 ? '' : 's'} selected
          </p>
        )}
        {errors.assignedAgents && (
          <p className="text-[11px] text-rose-300">{errors.assignedAgents}</p>
        )}
      </section>

      {/* Status */}
      {formStatus && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            formStatus.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
          }`}
        >
          {formStatus.text}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {mode === 'create' ? 'Create Credential' : 'Save Changes'}
        </Button>
      </div>

      {/* Delete zone */}
      {mode === 'edit' && credential && (
        <div className="space-y-2 rounded-md border border-rose-500/25 bg-rose-500/5 p-3">
          <p className="text-xs font-medium text-rose-200">Delete this credential</p>
          <p className="text-[11px] text-rose-200/80">
            Type <code className="font-mono">{credential.alias}</code> to confirm permanent
            deletion.
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={confirmDelete}
              placeholder={credential.alias}
              onChange={(e) => setConfirmDelete(e.target.value)}
              className="max-w-xs"
            />
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={deleteMut.isPending}
            >
              <IconTrash className="mr-1 h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
