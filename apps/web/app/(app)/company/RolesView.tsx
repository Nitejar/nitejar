'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Link2, Plus, Shield, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { trpc } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { DOMAIN_PRESET_SUMMARIES } from '@/lib/network-policy-presets'
import { AvatarCircle, InlinePicker, type InlinePickerItem } from '../work/shared'

/** Split a raw string into cleaned domain entries (comma, newline, or space separated). */
function parseDomains(raw: string): string[] {
  return raw
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Known permissions — the platform defines these, no custom options
// ---------------------------------------------------------------------------

/** One backend grant — action + resourceType for the DB */
type Grant = { action: string; resourceType: string | null }
type GitHubRepoCapability =
  | 'read_repo'
  | 'create_branch'
  | 'push_branch'
  | 'open_pr'
  | 'comment'
  | 'request_review'
  | 'label_issue_pr'
  | 'review_pr'
  | 'merge_pr'
type GitHubRepoCapabilityDescriptor = {
  id: string
  label: string
  hint: string
}
type PermissionRow = {
  resource: string
  hint: string
  ops: Array<{
    op: string
    grants: Grant[]
  }>
}

/** One UI toggle — maps a human label to one or more backend grants */
type OpToggle = PermissionRow['ops'][number]

// ---------------------------------------------------------------------------
// Config — operational defaults inherited by agents in this role
// ---------------------------------------------------------------------------

type ConfigOption = { value: string; label: string }
type ConfigRow = { key: string; label: string; hint: string; options: ConfigOption[] }

const NETWORK_MODES = [
  { value: 'unrestricted', label: 'unrestricted' },
  { value: 'allow-list', label: 'custom' },
] as const

const CONFIG_ROWS: ConfigRow[] = [
  {
    key: 'toolPosture.web',
    label: 'Web access',
    hint: 'Whether agents can make HTTP requests to external URLs',
    options: [
      { value: 'allow', label: 'allow' },
      { value: 'deny', label: 'deny' },
    ],
  },
  {
    key: 'toolPosture.filesystem',
    label: 'Filesystem',
    hint: 'Whether agents can read and write files in their sandbox',
    options: [
      { value: 'allow', label: 'allow' },
      { value: 'deny', label: 'deny' },
    ],
  },
  {
    key: 'queue.mode',
    label: 'Queue mode',
    hint: 'How the agent handles incoming messages: steer redirects in-flight work, collect batches, followup runs sequentially',
    options: [
      { value: 'steer', label: 'steer' },
      { value: 'collect', label: 'collect' },
      { value: 'followup', label: 'followup' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

// ---------------------------------------------------------------------------
// Inline editable heading (same pattern as GoalDetailClient)
// ---------------------------------------------------------------------------

function InlineEditableHeading({
  value,
  onSave,
  placeholder = 'Untitled',
}: {
  value: string
  onSave: (v: string) => void
  placeholder?: string
}) {
  const ref = useRef<HTMLHeadingElement>(null)
  const saved = useRef(value)

  useEffect(() => {
    if (!ref.current || document.activeElement === ref.current) return
    if (ref.current.textContent !== value) ref.current.textContent = value
    saved.current = value
  }, [value])

  useEffect(() => {
    if (ref.current && !ref.current.textContent) ref.current.textContent = value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = useCallback(() => {
    const text = ref.current?.textContent?.trim() ?? ''
    if (text && text !== saved.current) {
      saved.current = text
      onSave(text)
    } else if (!text && ref.current) {
      ref.current.textContent = saved.current
    }
  }, [onSave])

  return (
    <h1
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ref.current?.blur()
        }
        if (e.key === 'Escape') {
          if (ref.current) ref.current.textContent = saved.current
          ref.current?.blur()
        }
      }}
      data-placeholder={placeholder}
      className="min-h-[1.75rem] cursor-text text-xl font-semibold tracking-tight text-white outline-none empty:before:text-zinc-600 empty:before:content-[attr(data-placeholder)]"
    />
  )
}

function InlineEditableText({
  value,
  onSave,
  placeholder,
}: {
  value: string
  onSave: (v: string) => void
  placeholder: string
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  const saved = useRef(value)

  useEffect(() => {
    if (!ref.current || document.activeElement === ref.current) return
    if (ref.current.textContent !== value) {
      ref.current.textContent = value || ''
    }
    saved.current = value
  }, [value])

  useEffect(() => {
    if (ref.current && ref.current.textContent === '' && value) {
      ref.current.textContent = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = useCallback(() => {
    const text = ref.current?.textContent?.trim() ?? ''
    if (text !== saved.current) {
      saved.current = text
      onSave(text)
    }
  }, [onSave])

  return (
    <p
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          if (ref.current) ref.current.textContent = saved.current
          ref.current?.blur()
        }
      }}
      data-placeholder={placeholder}
      className="min-h-[1.5rem] cursor-text text-base leading-relaxed text-white/60 outline-none empty:before:text-zinc-600 empty:before:content-[attr(data-placeholder)]"
    />
  )
}

function InlineEditableLine({
  value,
  onSave,
  placeholder,
  className,
  mono,
}: {
  value: string
  onSave: (v: string) => void
  placeholder?: string
  className?: string
  mono?: boolean
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  const saved = useRef(value)

  useEffect(() => {
    if (!ref.current || document.activeElement === ref.current) return
    if (ref.current.textContent !== value) {
      ref.current.textContent = value || ''
    }
    saved.current = value
  }, [value])

  useEffect(() => {
    if (ref.current && ref.current.textContent === '' && value) {
      ref.current.textContent = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = useCallback(() => {
    const text = ref.current?.textContent?.trim() ?? ''
    if (text !== saved.current) {
      saved.current = text
      onSave(text)
    }
  }, [onSave])

  return (
    <p
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ref.current?.blur()
        }
        if (e.key === 'Escape') {
          if (ref.current) ref.current.textContent = saved.current
          ref.current?.blur()
        }
      }}
      data-placeholder={placeholder}
      className={cn(
        'min-h-[1.25rem] cursor-text text-sm leading-relaxed text-white/60 outline-none empty:before:text-zinc-600 empty:before:content-[attr(data-placeholder)]',
        mono && 'font-mono text-xs',
        className
      )}
    />
  )
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-24 shrink-0 text-xs text-white/35">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonRoleDetail() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-5">
      <div className="h-4 w-48 rounded bg-zinc-800/60" />
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 rounded bg-zinc-800/60" />
          <div className="h-6 w-64 rounded bg-zinc-800/60" />
        </div>
        <div className="flex gap-4 pl-8">
          <div className="h-3 w-24 rounded bg-zinc-800/40" />
          <div className="h-3 w-20 rounded bg-zinc-800/40" />
        </div>
      </div>
      <div className="grid grid-cols-[100px_1fr] gap-y-3">
        <div className="h-3 w-12 rounded bg-zinc-800/40" />
        <div className="h-6 w-40 rounded bg-zinc-800/40" />
        <div className="h-3 w-16 rounded bg-zinc-800/40" />
        <div className="h-6 w-48 rounded bg-zinc-800/40" />
      </div>
      {[1, 2].map((i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3 w-20 rounded bg-zinc-800/40" />
          <div className="h-16 w-full rounded-lg bg-zinc-800/30" />
        </div>
      ))}
      <div className="space-y-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-8 w-full rounded bg-zinc-800/20" />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Default domains quick-apply menu
// ---------------------------------------------------------------------------

const DOMAIN_PRESETS = DOMAIN_PRESET_SUMMARIES

function DefaultDomainsMenu({
  existingDomains,
  onSelect,
}: {
  existingDomains: string[]
  onSelect: (domains: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const existing = useMemo(() => new Set(existingDomains), [existingDomains])

  const presetsWithStatus = useMemo(
    () =>
      DOMAIN_PRESETS.map((preset) => {
        const newDomains = preset.domains.filter((d) => !existing.has(d))
        return { ...preset, newDomains, allApplied: newDomains.length === 0 }
      }),
    [existing]
  )

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition"
      >
        <Plus className="h-3 w-3" />
        add from preset
        <ChevronDown className={cn('h-3 w-3 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 min-w-[200px] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg">
          {presetsWithStatus.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={preset.allApplied}
              onClick={() => {
                onSelect(preset.newDomains)
                setOpen(false)
              }}
              className={cn(
                'flex w-full flex-col gap-0.5 px-3 py-1.5 text-left',
                preset.allApplied ? 'cursor-default opacity-35' : 'hover:bg-white/5'
              )}
            >
              <span className="text-[11px] text-white/70">{preset.label}</span>
              <span className="text-[10px] text-zinc-500">
                {preset.allApplied ? (
                  'all domains added'
                ) : (
                  <>
                    {preset.newDomains.slice(0, 3).join(', ')}
                    {preset.newDomains.length > 3 && ` +${preset.newDomains.length - 3} more`}
                  </>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RolesView({
  search,
  permissionRows,
  githubRepoCapabilities,
  onCreateRole,
}: {
  search: string
  permissionRows: PermissionRow[]
  githubRepoCapabilities: readonly GitHubRepoCapabilityDescriptor[]
  onCreateRole?: () => void
}) {
  const utils = trpc.useUtils()

  // Queries
  const rolesQuery = trpc.company.listRoles.useQuery()
  const agentsQuery = trpc.company.listAgents.useQuery()
  const overviewQuery = trpc.company.getOverview.useQuery()
  const githubReposQuery = trpc.capabilities.listRepos.useQuery()

  // State
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)

  // Derived
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data])
  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data])
  const teams = useMemo(
    () => overviewQuery.data?.organization ?? [],
    [overviewQuery.data?.organization]
  )
  const githubRepos = useMemo(() => githubReposQuery.data ?? [], [githubReposQuery.data])

  const normalizedSearch = search.trim().toLowerCase()
  const visibleRoles = useMemo(
    () =>
      roles.filter((role) =>
        normalizedSearch
          ? [role.name, role.slug, role.charter ?? '']
              .join(' ')
              .toLowerCase()
              .includes(normalizedSearch)
          : true
      ),
    [normalizedSearch, roles]
  )

  useEffect(() => {
    if (!visibleRoles.some((r) => r.id === selectedRoleId)) {
      setSelectedRoleId(visibleRoles[0]?.id ?? null)
    }
  }, [selectedRoleId, visibleRoles])

  const selectedRole = visibleRoles.find((r) => r.id === selectedRoleId) ?? visibleRoles[0] ?? null

  const roleDetailQuery = trpc.company.getRole.useQuery(
    { roleId: selectedRole?.id ?? '' },
    { enabled: !!selectedRole?.id }
  )
  const roleDetail = roleDetailQuery.data

  // Mutations
  const invalidateAll = useCallback(async () => {
    await Promise.all([utils.company.listRoles.invalidate(), utils.company.getRole.invalidate()])
  }, [utils])

  const createRole = trpc.company.createRole.useMutation({
    onSuccess: async ({ id }) => {
      await invalidateAll()
      setSelectedRoleId(id)
      toast.success('Role created')
    },
    onError: (error) => toast.error(error.message),
  })

  const updateRole = trpc.company.updateRole.useMutation({
    onMutate: async (input) => {
      await utils.company.getRole.cancel({ roleId: input.roleId })
      const previous = utils.company.getRole.getData({ roleId: input.roleId })
      if (previous) {
        utils.company.getRole.setData({ roleId: input.roleId }, (old) => {
          if (!old) return old
          return {
            ...old,
            ...(input.grants !== undefined
              ? {
                  grants: (
                    input.grants as Array<{ action: string; resourceType?: string | null }>
                  ).map((g) => ({
                    id: '',
                    action: g.action,
                    resourceType: g.resourceType ?? null,
                    resourceId: null as string | null,
                  })),
                }
              : {}),
            ...(input.defaults !== undefined
              ? {
                  defaults: (input.defaults as Array<{ key: string; value: unknown }>).map((d) => ({
                    id: '',
                    key: d.key,
                    value: d.value,
                  })),
                }
              : {}),
            ...(input.githubRepoPolicies !== undefined
              ? {
                  githubRepoPolicies: (
                    input.githubRepoPolicies as Array<{
                      githubRepoId: number
                      capabilities: GitHubRepoCapability[]
                    }>
                  ).map((policy) => {
                    const repo = githubRepos.find(
                      (candidate) => candidate.id === policy.githubRepoId
                    )
                    return {
                      githubRepoId: policy.githubRepoId,
                      repoFullName: repo?.full_name ?? `repo-${policy.githubRepoId}`,
                      repoHtmlUrl: repo?.html_url ?? null,
                      installationAccountLogin: repo?.account_login ?? null,
                      capabilities: [...policy.capabilities].sort(),
                    }
                  }),
                }
              : {}),
          }
        })
      }
      return { previous }
    },
    onError: (error, input, ctx) => {
      if (ctx?.previous) {
        utils.company.getRole.setData({ roleId: input.roleId }, ctx.previous)
      }
      toast.error(error.message)
    },
    onSettled: () => invalidateAll(),
  })

  const assignRoleToAgent = trpc.company.assignRoleToAgent.useMutation({
    onSuccess: async () => {
      await invalidateAll()
      toast.success('Agent assigned')
    },
    onError: (error) => toast.error(error.message),
  })

  const removeRoleFromAgent = trpc.company.removeRoleFromAgent.useMutation({
    onSuccess: async () => {
      await invalidateAll()
      toast.success('Agent removed')
    },
    onError: (error) => toast.error(error.message),
  })

  const assignRoleToTeam = trpc.company.assignDefaultRoleToTeam.useMutation({
    onSuccess: async () => {
      await invalidateAll()
      toast.success('Team default set')
    },
    onError: (error) => toast.error(error.message),
  })

  const removeRoleFromTeam = trpc.company.removeDefaultRoleFromTeam.useMutation({
    onSuccess: async () => {
      await invalidateAll()
      toast.success('Team default removed')
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteRole = trpc.company.deleteRole.useMutation({
    onSuccess: async (_, input) => {
      await utils.company.listRoles.invalidate()
      setSelectedRoleId((current) => {
        if (current !== input.roleId) return current
        const remainingRoles = utils.company.listRoles
          .getData()
          ?.filter((role) => role.id !== input.roleId)
        return remainingRoles?.[0]?.id ?? null
      })
      await utils.company.getRole.invalidate()
      toast.success('Role deleted')
    },
    onError: (error) => toast.error(error.message),
  })

  // Auto-save role fields
  const patchRole = useCallback(
    (patch: Record<string, unknown>) => {
      if (!selectedRole) return
      updateRole.mutate({ roleId: selectedRole.id, ...patch })
    },
    [selectedRole, updateRole]
  )

  // Granted actions (directly on the role)
  const grantedActions = useMemo(() => {
    if (!roleDetail) return new Set<string>()
    const actions = new Set<string>()
    for (const grant of roleDetail.grants) {
      actions.add(grant.action)
    }
    return actions
  }, [roleDetail])

  // Toggle an operation — each op maps to 1+ backend grants
  const isOpGranted = useCallback(
    (op: OpToggle) => op.grants.every((g) => grantedActions.has(g.action)),
    [grantedActions]
  )

  const toggleOp = useCallback(
    (op: OpToggle, enable: boolean) => {
      if (!roleDetail || !selectedRole) return
      const actionsToToggle = new Set(op.grants.map((g) => g.action))
      let newGrants: Grant[]
      if (enable) {
        const toAdd = op.grants.filter((g) => !grantedActions.has(g.action))
        if (toAdd.length === 0) return
        newGrants = [
          ...roleDetail.grants.map((g) => ({
            action: g.action,
            resourceType: g.resourceType,
          })),
          ...toAdd.map((g) => ({
            action: g.action,
            resourceType: g.resourceType,
          })),
        ]
      } else {
        newGrants = roleDetail.grants
          .filter((g) => !actionsToToggle.has(g.action))
          .map((g) => ({
            action: g.action,
            resourceType: g.resourceType,
          }))
      }
      updateRole.mutate({ roleId: selectedRole.id, grants: newGrants })
    },
    [roleDetail, selectedRole, grantedActions, updateRole]
  )

  const toggleSuperuser = useCallback(
    (enable: boolean) => {
      const fakeOp: OpToggle = { op: '*', grants: [{ action: '*', resourceType: '*' }] }
      toggleOp(fakeOp, enable)
    },
    [toggleOp]
  )

  const githubRepoCapabilityMap = useMemo(
    () =>
      new Map(
        (roleDetail?.githubRepoPolicies ?? []).map((policy) => [
          policy.githubRepoId,
          new Set(policy.capabilities),
        ])
      ),
    [roleDetail?.githubRepoPolicies]
  )

  const setGitHubRepoPolicy = useCallback(
    (githubRepoId: number, capabilities: GitHubRepoCapability[]) => {
      if (!roleDetail || !selectedRole) return
      const nextPolicies = [
        ...roleDetail.githubRepoPolicies
          .filter((policy) => policy.githubRepoId !== githubRepoId)
          .map((policy) => ({
            githubRepoId: policy.githubRepoId,
            capabilities: [...policy.capabilities] as GitHubRepoCapability[],
          })),
        ...(capabilities.length > 0 ? [{ githubRepoId, capabilities }] : []),
      ]
      updateRole.mutate({ roleId: selectedRole.id, githubRepoPolicies: nextPolicies })
    },
    [roleDetail, selectedRole, updateRole]
  )

  const githubReposByAccount = useMemo(() => {
    const groups = new Map<string, typeof githubRepos>()
    for (const repo of githubRepos) {
      const key = repo.account_login ?? 'Other'
      const current = groups.get(key) ?? []
      current.push(repo)
      groups.set(key, current)
    }
    return [...groups.entries()].map(([account, repos]) => ({
      account,
      repos: [...repos].sort((a, b) => a.full_name.localeCompare(b.full_name)),
    }))
  }, [githubRepos])

  // Config defaults — read current values from role defaults, write back
  const configValues = useMemo(() => {
    const map = new Map<string, string>()
    if (!roleDetail) return map
    for (const d of roleDetail.defaults) {
      if (typeof d.value === 'string') map.set(d.key, d.value)
      else if (typeof d.value === 'number') map.set(d.key, String(d.value))
    }
    return map
  }, [roleDetail])

  const setConfigValue = useCallback(
    (key: string, value: string) => {
      if (!roleDetail || !selectedRole) return
      const newDefaults = [
        ...roleDetail.defaults
          .filter((d) => d.key !== key)
          .map((d) => ({ key: d.key, value: d.value })),
        { key, value },
      ]
      updateRole.mutate({ roleId: selectedRole.id, defaults: newDefaults })
    },
    [roleDetail, selectedRole, updateRole]
  )

  // Network policy — stored as JSON in role default 'networkPolicy'
  const networkPolicy = useMemo(() => {
    if (!roleDetail)
      return {
        mode: 'unrestricted' as string,
        rules: [] as Array<{ domain: string; action: string }>,
      }
    for (const d of roleDetail.defaults) {
      if (d.key === 'networkPolicy' && typeof d.value === 'object' && d.value !== null) {
        const v = d.value as Record<string, unknown>
        return {
          mode: typeof v.mode === 'string' ? v.mode : 'unrestricted',
          rules: (Array.isArray(v.rules) ? v.rules : []) as Array<{
            domain: string
            action: string
          }>,
        }
      }
    }
    return { mode: 'unrestricted', rules: [] as Array<{ domain: string; action: string }> }
  }, [roleDetail])

  const [newDomain, setNewDomain] = useState('')

  const setNetworkPolicy = useCallback(
    (mode: string, rules: Array<{ domain: string; action: string }>) => {
      if (!roleDetail || !selectedRole) return
      const value = { mode, rules }
      const newDefaults = [
        ...roleDetail.defaults
          .filter((d) => d.key !== 'networkPolicy')
          .map((d) => ({ key: d.key, value: d.value })),
        { key: 'networkPolicy', value },
      ]
      updateRole.mutate({ roleId: selectedRole.id, defaults: newDefaults })
    },
    [roleDetail, selectedRole, updateRole]
  )

  // Handlers
  const handleCreateRole = () => {
    const index = roles.length + 1
    const name = `New role ${index}`
    createRole.mutate({
      name,
      slug: slugify(name),
      charter: '',
      escalationPosture: '',
      active: true,
    })
  }

  const handleDeleteRole = useCallback(() => {
    if (!selectedRole) return
    const confirmation = window.confirm(
      `Delete "${selectedRole.name}"? This removes the role, its grants, and its assignments.`
    )
    if (!confirmation) return
    deleteRole.mutate({ roleId: selectedRole.id })
  }, [deleteRole, selectedRole])

  // Picker items
  const assignedAgentIds = new Set(roleDetail?.assignedAgents.map((a) => a.id) ?? [])
  const availableAgents: InlinePickerItem[] = agents
    .filter((a) => !assignedAgentIds.has(a.id))
    .map((a) => ({ value: a.id, label: a.name, hint: `@${a.handle}` }))

  const assignedTeamIds = new Set(roleDetail?.defaultTeams.map((t) => t.id) ?? [])
  const availableTeams: InlinePickerItem[] = teams
    .filter((t) => !assignedTeamIds.has(t.id))
    .map((t) => ({ value: t.id, label: t.name }))

  const hasSuperuser = grantedActions.has('*')

  return (
    <div className="flex h-full min-h-0">
      {/* ----------------------------------------------------------------- */}
      {/* Left sidebar — role list                                          */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex w-[260px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/60">
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {visibleRoles.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-white/25">
              {normalizedSearch ? 'No roles match.' : 'No roles yet.'}
            </p>
          )}
          {visibleRoles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedRoleId(role.id)}
              className={cn(
                'mb-1 w-full rounded-md border px-3 py-2 text-left transition',
                selectedRole?.id === role.id
                  ? 'border-zinc-700 bg-white/[0.05]'
                  : 'border-transparent bg-transparent hover:border-zinc-800 hover:bg-white/[0.03]'
              )}
            >
              <div className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-zinc-500" />
                <span className="truncate text-sm text-white/85">{role.name}</span>
                {!role.active && (
                  <span className="ml-auto rounded-full bg-zinc-700/50 px-1.5 py-0.5 text-[9px] text-white/30">
                    off
                  </span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-white/25">@{role.slug}</div>
              <div className="mt-1.5 flex gap-3 text-[10px] text-white/25">
                <span>{role.assignedAgents.length} agents</span>
                <span>{role.defaultTeams.length} teams</span>
              </div>
            </button>
          ))}
        </div>
        <div className="border-t border-zinc-800 p-3">
          <button
            type="button"
            onClick={onCreateRole ?? handleCreateRole}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-700 py-2 text-xs text-white/40 transition hover:border-zinc-600 hover:bg-white/[0.02] hover:text-white/60 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            New role
          </button>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Right content — role detail                                       */}
      {/* ----------------------------------------------------------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedRole && roleDetail ? (
          <div className="mx-auto max-w-4xl space-y-6 px-6 py-5">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1.5 text-xs text-white/40">
              <Link
                href="/company/structure"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-white/5 hover:text-white/75"
              >
                Company
              </Link>
              <span className="text-white/20">/</span>
              <span className="text-white/50">Roles</span>
              <span className="text-white/20">/</span>
              <span className="text-white/60">{roleDetail.name}</span>
              <button
                type="button"
                className="ml-auto rounded p-1 text-white/25 transition hover:bg-white/5 hover:text-white/50"
                onClick={() => {
                  void navigator.clipboard.writeText(window.location.href)
                  toast.success('Link copied')
                }}
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
            </nav>

            {/* Title + active badge */}
            <div className="space-y-1.5">
              <div className="flex items-start gap-3">
                <Shield className="mt-1 h-5 w-5 shrink-0 text-zinc-500" />
                <div className="min-w-0 flex-1">
                  <InlineEditableHeading
                    value={roleDetail.name}
                    onSave={(name) => patchRole({ name, slug: slugify(name) })}
                    placeholder="Role name"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => patchRole({ active: !roleDetail.active })}
                  className={cn(
                    'mt-1 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition',
                    roleDetail.active
                      ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                      : 'bg-zinc-500/15 text-zinc-400 hover:bg-zinc-500/25'
                  )}
                >
                  {roleDetail.active ? 'Active' : 'Inactive'}
                </button>
                <button
                  type="button"
                  onClick={handleDeleteRole}
                  disabled={deleteRole.isPending}
                  className="mt-1 shrink-0 rounded-md border border-rose-500/30 px-2.5 py-1 text-[11px] font-medium text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deleteRole.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8 text-xs text-white/30">
                <span className="font-mono">@{roleDetail.slug}</span>
                <span>{grantedActions.size} grants</span>
                <span>{roleDetail.assignedAgents.length} agents</span>
                <span>{roleDetail.defaultTeams.length} teams</span>
              </div>
            </div>

            {/* Properties */}
            <section>
              <div className="mb-1.5">
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                  Properties
                </span>
              </div>
              <div className="divide-y divide-zinc-800/40">
                <PropRow label="Slug">
                  <InlineEditableLine
                    value={roleDetail.slug}
                    onSave={(slug) => patchRole({ slug })}
                    placeholder="role-slug"
                    mono
                    className="text-[11px] text-white/55"
                  />
                </PropRow>
              </div>
            </section>

            {/* Charter */}
            <div>
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                Charter
              </span>
              <div className="mt-1.5">
                <InlineEditableText
                  value={roleDetail.charter ?? ''}
                  onSave={(charter) => patchRole({ charter })}
                  placeholder="Describe what this role owns."
                />
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* Grants — one row per resource, operation pills inline          */}
            {/* ------------------------------------------------------------- */}
            <div>
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                Grants ({grantedActions.size})
              </span>

              {/* Superuser toggle */}
              <div className="mt-1.5 mb-2">
                <button
                  type="button"
                  onClick={() => void toggleSuperuser(!hasSuperuser)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs font-medium transition',
                    hasSuperuser
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                      : 'border-zinc-800 text-white/30 hover:border-zinc-700 hover:text-white/50'
                  )}
                >
                  {hasSuperuser ? 'Superuser — full access' : 'Grant superuser'}
                </button>
              </div>

              <div
                className={cn(
                  'space-y-px rounded-lg border border-zinc-800/40',
                  hasSuperuser && 'opacity-40'
                )}
              >
                {permissionRows.map((row) => {
                  const allGranted = row.ops.every((op) => isOpGranted(op))
                  const someGranted = row.ops.some((op) => isOpGranted(op))
                  return (
                    <div
                      key={row.resource}
                      className="flex items-center gap-3 border-t border-zinc-800/30 px-3 py-2 first:border-t-0"
                    >
                      <span
                        className={cn(
                          'w-20 shrink-0 text-xs font-medium',
                          allGranted
                            ? 'text-white/60'
                            : someGranted
                              ? 'text-white/45'
                              : 'text-white/25'
                        )}
                        title={row.hint}
                      >
                        {row.resource}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                        {row.ops.map((op) => {
                          const granted = isOpGranted(op)
                          const opKey = op.grants[0]?.action ?? op.op
                          return (
                            <button
                              key={opKey}
                              type="button"
                              disabled={hasSuperuser}
                              onClick={() => toggleOp(op, !granted)}
                              className={cn(
                                'rounded-md border px-2 py-0.5 text-[11px] transition',
                                granted
                                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                                  : 'border-zinc-800 text-white/25 hover:border-zinc-700 hover:text-white/50'
                              )}
                              title={op.grants.map((g) => g.action).join(', ')}
                            >
                              {op.op}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* Config — same pill-row pattern as grants                       */}
            {/* ------------------------------------------------------------- */}
            <div>
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                Config
              </span>
              <div className="mt-1.5 space-y-px rounded-lg border border-zinc-800/40">
                {/* Network policy — mode pills + domain list */}
                <div className="border-t border-zinc-800/30 px-3 py-2 first:border-t-0">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'w-20 shrink-0 text-xs font-medium',
                        networkPolicy.mode !== 'unrestricted' ? 'text-white/60' : 'text-white/25'
                      )}
                      title="Controls what external domains agents in this role can access"
                    >
                      Network
                    </span>
                    <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                      {NETWORK_MODES.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            if (opt.value === 'unrestricted') {
                              setNetworkPolicy('unrestricted', [{ domain: '*', action: 'allow' }])
                            } else {
                              // Keep existing non-catch-all rules, ensure * deny at end
                              const existing = networkPolicy.rules.filter((r) => r.domain !== '*')
                              setNetworkPolicy(opt.value, [
                                ...existing,
                                { domain: '*', action: 'deny' },
                              ])
                            }
                          }}
                          className={cn(
                            'rounded-md border px-2 py-0.5 text-[11px] transition',
                            networkPolicy.mode === opt.value
                              ? 'border-sky-500/25 bg-sky-500/10 text-sky-300'
                              : 'border-zinc-800 text-white/25 hover:border-zinc-700 hover:text-white/50'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {networkPolicy.mode !== 'unrestricted' && (
                    <div className="mt-2 ml-[calc(80px+0.75rem)] space-y-1">
                      {networkPolicy.rules
                        .map((rule, i) => ({ rule, i }))
                        .filter(({ rule }) => rule.domain !== '*')
                        .map(({ rule, i }) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const toggled = rule.action === 'allow' ? 'deny' : 'allow'
                                const next = networkPolicy.rules.map((r, j) =>
                                  j === i ? { ...r, action: toggled } : r
                                )
                                void setNetworkPolicy(networkPolicy.mode, next)
                              }}
                              className={cn(
                                'rounded px-1.5 py-0.5 text-[10px] transition cursor-pointer',
                                rule.action === 'allow'
                                  ? 'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
                              )}
                            >
                              {rule.action}
                            </button>
                            <span className="font-mono text-[11px] text-white/70">
                              {rule.domain}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const next = networkPolicy.rules.filter((_, j) => j !== i)
                                void setNetworkPolicy(networkPolicy.mode, next)
                              }}
                              className="ml-auto text-[10px] text-zinc-600 hover:text-rose-300"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          const domains = parseDomains(newDomain)
                          if (domains.length === 0) return
                          const withNew = [
                            ...networkPolicy.rules.filter((r) => r.domain !== '*'),
                            ...domains.map((d) => ({ domain: d, action: 'allow' as string })),
                            { domain: '*', action: 'deny' },
                          ]
                          void setNetworkPolicy(networkPolicy.mode, withNew)
                          setNewDomain('')
                        }}
                      >
                        <input
                          value={newDomain}
                          onChange={(e) => setNewDomain(e.target.value)}
                          onPaste={(e) => {
                            const text = e.clipboardData.getData('text')
                            const domains = parseDomains(text)
                            if (domains.length > 1) {
                              e.preventDefault()
                              const withNew = [
                                ...networkPolicy.rules.filter((r) => r.domain !== '*'),
                                ...domains.map((d) => ({ domain: d, action: 'allow' as string })),
                                { domain: '*', action: 'deny' },
                              ]
                              void setNetworkPolicy(networkPolicy.mode, withNew)
                              setNewDomain('')
                            }
                          }}
                          placeholder="*.example.com — comma or newline separated"
                          className="h-6 w-full rounded-sm border border-zinc-700 bg-transparent px-1.5 font-mono text-[11px] text-white/60 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
                        />
                      </form>
                      <DefaultDomainsMenu
                        existingDomains={networkPolicy.rules.map((r) => r.domain)}
                        onSelect={(domains) => {
                          const withNew = [
                            ...networkPolicy.rules.filter((r) => r.domain !== '*'),
                            ...domains.map((d) => ({ domain: d, action: 'allow' as string })),
                            { domain: '*', action: 'deny' },
                          ]
                          void setNetworkPolicy(networkPolicy.mode, withNew)
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Standard config rows */}
                {CONFIG_ROWS.map((row) => {
                  const current = configValues.get(row.key) ?? null
                  return (
                    <div
                      key={row.key}
                      className="flex items-center gap-3 border-t border-zinc-800/30 px-3 py-2 first:border-t-0"
                    >
                      <span
                        className={cn(
                          'w-20 shrink-0 text-xs font-medium',
                          current ? 'text-white/60' : 'text-white/25'
                        )}
                        title={row.hint}
                      >
                        {row.label}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                        {row.options.map((opt) => {
                          const selected = current === opt.value
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setConfigValue(row.key, opt.value)}
                              className={cn(
                                'rounded-md border px-2 py-0.5 text-[11px] transition',
                                selected
                                  ? 'border-sky-500/25 bg-sky-500/10 text-sky-300'
                                  : 'border-zinc-800 text-white/25 hover:border-zinc-700 hover:text-white/50'
                              )}
                            >
                              {opt.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div>
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                GitHub repo role defaults
              </span>
              <p className="mt-1 text-[11px] text-white/35">
                Reusable defaults that flow through role assignment. Direct per-agent repo access
                now lives on the GitHub plugin instance page.
              </p>
              <div className="mt-1.5 rounded-lg border border-zinc-800/40">
                {githubReposByAccount.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-zinc-500">No synced GitHub repos yet.</div>
                ) : (
                  githubReposByAccount.map((group) => (
                    <div
                      key={group.account}
                      className="border-t border-zinc-800/30 px-3 py-2 first:border-t-0"
                    >
                      <div className="mb-2 text-[10px] uppercase tracking-[0.16em] text-white/30">
                        {group.account}
                      </div>
                      <div className="space-y-2">
                        {group.repos.map((repo) => {
                          const selectedCapabilities =
                            githubRepoCapabilityMap.get(repo.id) ?? new Set<GitHubRepoCapability>()
                          return (
                            <div
                              key={repo.id}
                              className="rounded-md border border-zinc-800/50 bg-white/[0.01] px-2.5 py-2"
                            >
                              <div className="mb-1 flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-xs text-white/70">
                                  {repo.full_name}
                                </span>
                                {selectedCapabilities.size > 0 && (
                                  <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] text-white/35">
                                    {selectedCapabilities.size} ops
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {githubRepoCapabilities.map((capability) => {
                                  const capabilityId = capability.id as GitHubRepoCapability
                                  const selected = selectedCapabilities.has(capabilityId)
                                  return (
                                    <button
                                      key={capability.id}
                                      type="button"
                                      onClick={() => {
                                        const next = new Set(selectedCapabilities)
                                        if (selected) next.delete(capabilityId)
                                        else next.add(capabilityId)
                                        setGitHubRepoPolicy(
                                          repo.id,
                                          [...next].sort() as GitHubRepoCapability[]
                                        )
                                      }}
                                      className={cn(
                                        'rounded-md border px-2 py-0.5 text-[11px] transition',
                                        selected
                                          ? 'border-violet-500/25 bg-violet-500/10 text-violet-200'
                                          : 'border-zinc-800 text-white/25 hover:border-zinc-700 hover:text-white/50'
                                      )}
                                      title={capability.hint}
                                    >
                                      {capability.label}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* Agents                                                         */}
            {/* ------------------------------------------------------------- */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                  Assigned agents
                  {roleDetail.assignedAgents.length > 0
                    ? ` (${roleDetail.assignedAgents.length})`
                    : ''}
                </span>
              </div>

              {roleDetail.assignedAgents.length > 0 ? (
                <div className="rounded-lg border border-zinc-800/40">
                  {roleDetail.assignedAgents.map((agent) => (
                    <div
                      key={agent.id}
                      className="group flex items-center gap-2.5 border-t border-zinc-800/30 px-3 py-2 first:border-t-0 transition hover:bg-white/[0.02]"
                    >
                      <AvatarCircle name={agent.name} />
                      <span className="min-w-0 flex-1 truncate text-sm text-white/75">
                        {agent.name}
                        <span className="ml-1.5 text-white/25">@{agent.handle}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          removeRoleFromAgent.mutate({
                            roleId: selectedRole.id,
                            agentId: agent.id,
                          })
                        }
                        className="rounded p-1 text-zinc-600 opacity-0 transition hover:text-rose-300 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-600">No agents assigned.</p>
              )}

              {availableAgents.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-white/35">
                  <span>Assign</span>
                  <InlinePicker
                    value={null}
                    items={availableAgents}
                    placeholder="Select agent..."
                    onValueChange={(agentId) =>
                      assignRoleToAgent.mutate({ roleId: selectedRole.id, agentId })
                    }
                  />
                </div>
              )}
            </div>

            {/* ------------------------------------------------------------- */}
            {/* Teams                                                          */}
            {/* ------------------------------------------------------------- */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35">
                  Team defaults
                  {roleDetail.defaultTeams.length > 0 ? ` (${roleDetail.defaultTeams.length})` : ''}
                </span>
              </div>

              {roleDetail.defaultTeams.length > 0 ? (
                <div className="rounded-lg border border-zinc-800/40">
                  {roleDetail.defaultTeams.map((team) => (
                    <div
                      key={team.id}
                      className="group flex items-center gap-2.5 border-t border-zinc-800/30 px-3 py-2 first:border-t-0 transition hover:bg-white/[0.02]"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-white/75">
                        {team.name}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          removeRoleFromTeam.mutate({
                            roleId: selectedRole.id,
                            teamId: team.id,
                          })
                        }
                        className="rounded p-1 text-zinc-600 opacity-0 transition hover:text-rose-300 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-600">No team defaults.</p>
              )}

              {availableTeams.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-white/35">
                  <span>Add team</span>
                  <InlinePicker
                    value={null}
                    items={availableTeams}
                    placeholder="Select team..."
                    onValueChange={(teamId) =>
                      assignRoleToTeam.mutate({ roleId: selectedRole.id, teamId })
                    }
                  />
                </div>
              )}
            </div>
          </div>
        ) : selectedRole ? (
          <SkeletonRoleDetail />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-white/25">
            <Shield className="h-8 w-8 text-zinc-700" />
            <p>No roles yet.</p>
            <button
              type="button"
              onClick={onCreateRole ?? handleCreateRole}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-white/50 transition hover:border-zinc-600 hover:text-white"
            >
              Create first role
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
