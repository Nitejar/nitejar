'use client'

import Link from 'next/link'
import { IconShieldCheck } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Grant = { action: string; resourceType: string | null }
type OpToggle = { op: string; grants: Grant[] }
type PermissionRow = { resource: string; ops: OpToggle[] }
type NetworkPolicyRule = { domain: string; action: 'allow' | 'deny' }
type NetworkPolicyDefault = {
  mode: string
  rules: NetworkPolicyRule[]
  presetId?: string | null
  customized?: boolean
}

interface RolesSectionProps {
  agentId: string
  permissionRows: PermissionRow[]
}

function isNetworkPolicyDefault(value: unknown): value is NetworkPolicyDefault {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { mode?: unknown; rules?: unknown }
  return (
    typeof candidate.mode === 'string' &&
    Array.isArray(candidate.rules) &&
    candidate.rules.every((rule) => {
      if (!rule || typeof rule !== 'object') return false
      const candidateRule = rule as { domain?: unknown; action?: unknown }
      return (
        typeof candidateRule.domain === 'string' &&
        (candidateRule.action === 'allow' || candidateRule.action === 'deny')
      )
    })
  )
}

function formatModeLabel(mode: string): string {
  if (mode === 'allow-list') return 'Allow list'
  if (mode === 'deny-list') return 'Deny list'
  if (mode === 'unrestricted') return 'Unrestricted'
  return mode
}

function formatDefaultValue(value: unknown): string {
  if (value == null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return '[unsupported value]'
  try {
    return JSON.stringify(value) ?? '[unsupported value]'
  } catch {
    return '[unserializable value]'
  }
}

export function RolesSection({ agentId, permissionRows }: RolesSectionProps) {
  const policyQuery = trpc.company.getAgentPolicy.useQuery({ agentId })
  const data = policyQuery.data

  if (policyQuery.isLoading) {
    return (
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <IconShieldCheck className="h-4 w-4 text-muted-foreground" />
            Roles &amp; Policy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-20 animate-pulse rounded-lg bg-white/5" />
        </CardContent>
      </Card>
    )
  }

  const hasRoles = data && data.effectiveRoles.length > 0
  const hasSuperuser = data?.effectiveGrants.some((g) => g.action === '*' && g.resourceType === '*')
  const grantActions = new Set(data?.effectiveGrants.map((g) => g.action) ?? [])

  function isGranted(row: PermissionRow, op: OpToggle): boolean {
    if (hasSuperuser) return true
    return op.grants.every((g) => grantActions.has(g.action))
  }

  return (
    <Card className="border-white/10 bg-white/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <IconShieldCheck className="h-4 w-4 text-muted-foreground" />
          Roles &amp; Policy
        </CardTitle>
        <CardDescription className="text-xs">
          Effective permissions from assigned roles.{' '}
          <Link href="/company/roles" className="text-primary hover:underline">
            Manage roles
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasRoles ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/10 py-6">
            <IconShieldCheck className="mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No roles assigned</p>
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              Assign a role in the Identity section above, or{' '}
              <Link href="/company/roles" className="text-primary hover:underline">
                manage roles
              </Link>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Role list */}
            <div className="space-y-2">
              {data.effectiveRoles.map((role) => (
                <div
                  key={`${role.id}-${role.sourceType}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href="/company/roles"
                      className="block truncate text-sm font-medium hover:text-primary hover:underline"
                    >
                      {role.name}
                    </Link>
                    {role.charter && (
                      <p
                        className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
                        title={role.charter}
                      >
                        {role.charter}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[9px] text-muted-foreground">
                    {role.sourceType === 'team_role_default'
                      ? `via ${role.teamName ?? 'team'}`
                      : 'Direct'}
                  </span>
                </div>
              ))}
            </div>

            {/* Superuser banner */}
            {hasSuperuser && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <p className="text-xs font-medium text-amber-300">Superuser — full access</p>
                <p className="text-[10px] text-amber-300/70">
                  All permissions granted. Individual toggles below are informational only.
                </p>
              </div>
            )}

            {/* Permission grid */}
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Effective permissions
              </p>
              <div className="rounded-lg border border-white/10 bg-white/[0.01]">
                {permissionRows.map((row) => (
                  <div
                    key={row.resource}
                    className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5 last:border-b-0"
                  >
                    <span className="w-20 shrink-0 text-[10px] text-muted-foreground">
                      {row.resource}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {row.ops.map((op) => {
                        const granted = isGranted(row, op)
                        return (
                          <span
                            key={op.op}
                            className={`rounded px-1.5 py-0.5 text-[9px] ${
                              granted
                                ? 'bg-emerald-500/10 text-emerald-300'
                                : 'bg-white/5 text-muted-foreground/40'
                            }`}
                          >
                            {op.op}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Effective defaults */}
            {data.effectiveDefaults.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Config defaults
                </p>
                <div className="rounded-lg border border-white/10 bg-white/[0.01] px-3 py-2">
                  {data.effectiveDefaults.map((d) => (
                    <div key={d.key} className="border-b border-white/5 py-2 last:border-b-0">
                      <div className="flex items-start justify-between gap-3 text-[10px]">
                        <span className="font-mono text-muted-foreground">{d.key}</span>
                        {isNetworkPolicyDefault(d.value) ? (
                          <div className="min-w-0 max-w-[70%] space-y-1 text-right">
                            <div className="space-x-1">
                              <span className="text-foreground">
                                {formatModeLabel(d.value.mode)}
                              </span>
                              <span className="text-muted-foreground">
                                · {d.value.rules.length} rule
                                {d.value.rules.length === 1 ? '' : 's'}
                              </span>
                              {d.value.presetId ? (
                                <span className="text-muted-foreground">· {d.value.presetId}</span>
                              ) : null}
                            </div>
                            {d.value.rules.length > 0 ? (
                              <div className="flex flex-wrap justify-end gap-1">
                                {d.value.rules.slice(0, 4).map((rule, index) => (
                                  <span
                                    key={`${rule.domain}-${index}`}
                                    className={`rounded px-1.5 py-0.5 text-[9px] ${
                                      rule.action === 'allow'
                                        ? 'bg-emerald-500/10 text-emerald-300'
                                        : 'bg-red-500/10 text-red-300'
                                    }`}
                                    title={`${rule.action} ${rule.domain}`}
                                  >
                                    <span className="mr-1 uppercase">{rule.action}</span>
                                    <span className="font-mono">{rule.domain}</span>
                                  </span>
                                ))}
                                {d.value.rules.length > 4 ? (
                                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] text-muted-foreground">
                                    +{d.value.rules.length - 4} more
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="max-w-[70%] break-words text-right text-foreground [overflow-wrap:anywhere]">
                            {formatDefaultValue(d.value)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
