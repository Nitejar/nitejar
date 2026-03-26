'use client'

import Link from 'next/link'
import { IconShieldCheck } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Grant = { action: string; resourceType: string | null }
type OpToggle = { op: string; grants: Grant[] }
type PermissionRow = { resource: string; ops: OpToggle[] }

const PERMISSION_ROWS: PermissionRow[] = [
  {
    resource: 'Policy',
    ops: [
      { op: 'read', grants: [{ action: 'policy.read', resourceType: '*' }] },
      { op: 'write', grants: [{ action: 'policy.write', resourceType: '*' }] },
      { op: 'create', grants: [{ action: 'policy.create', resourceType: '*' }] },
      { op: 'delete', grants: [{ action: 'policy.delete', resourceType: '*' }] },
    ],
  },
  {
    resource: 'Goals',
    ops: [
      { op: 'read', grants: [{ action: 'work.goal.read', resourceType: 'goal' }] },
      { op: 'write', grants: [{ action: 'work.goal.write', resourceType: 'goal' }] },
      { op: 'create', grants: [{ action: 'work.goal.create', resourceType: 'goal' }] },
      { op: 'delete', grants: [{ action: 'work.goal.delete', resourceType: 'goal' }] },
    ],
  },
  {
    resource: 'Tickets',
    ops: [
      { op: 'read', grants: [{ action: 'work.ticket.read', resourceType: 'ticket' }] },
      { op: 'write', grants: [{ action: 'work.ticket.write', resourceType: 'ticket' }] },
      { op: 'create', grants: [{ action: 'work.ticket.create', resourceType: 'ticket' }] },
      { op: 'delete', grants: [{ action: 'work.ticket.delete', resourceType: 'ticket' }] },
    ],
  },
  {
    resource: 'Teams',
    ops: [
      { op: 'read', grants: [{ action: 'company.team.read', resourceType: 'team' }] },
      { op: 'write', grants: [{ action: 'company.team.write', resourceType: 'team' }] },
      { op: 'create', grants: [{ action: 'company.team.create', resourceType: 'team' }] },
      { op: 'delete', grants: [{ action: 'company.team.delete', resourceType: 'team' }] },
    ],
  },
  {
    resource: 'Agents',
    ops: [
      { op: 'read', grants: [{ action: 'fleet.agent.read', resourceType: 'agent' }] },
      { op: 'write', grants: [{ action: 'fleet.agent.write', resourceType: 'agent' }] },
      { op: 'create', grants: [{ action: 'fleet.agent.create', resourceType: 'agent' }] },
      { op: 'delete', grants: [{ action: 'fleet.agent.delete', resourceType: 'agent' }] },
      { op: 'control', grants: [{ action: 'fleet.agent.control', resourceType: 'agent' }] },
    ],
  },
  {
    resource: 'GitHub',
    ops: [
      { op: 'read', grants: [{ action: 'github.repo.read', resourceType: '*' }] },
      {
        op: 'branch',
        grants: [
          { action: 'github.repo.create_branch', resourceType: '*' },
          { action: 'github.repo.push_branch', resourceType: '*' },
        ],
      },
      { op: 'pr', grants: [{ action: 'github.repo.open_pr', resourceType: '*' }] },
      {
        op: 'review',
        grants: [
          { action: 'github.repo.review_pr', resourceType: '*' },
          { action: 'github.repo.comment', resourceType: '*' },
          { action: 'github.repo.label_issue_pr', resourceType: '*' },
          { action: 'github.repo.request_review', resourceType: '*' },
        ],
      },
      { op: 'merge', grants: [{ action: 'github.repo.merge_pr', resourceType: '*' }] },
    ],
  },
  {
    resource: 'Capabilities',
    ops: [
      { op: 'web search', grants: [{ action: 'capability.web_search', resourceType: '*' }] },
      { op: 'tools', grants: [{ action: 'capability.tool_execution', resourceType: '*' }] },
      { op: 'images', grants: [{ action: 'capability.image_generation', resourceType: '*' }] },
      {
        op: 'speech',
        grants: [
          { action: 'capability.speech_to_text', resourceType: '*' },
          { action: 'capability.text_to_speech', resourceType: '*' },
        ],
      },
    ],
  },
  {
    resource: 'Routines',
    ops: [
      { op: 'self-manage', grants: [{ action: 'routine.self.manage', resourceType: '*' }] },
      { op: 'manage all', grants: [{ action: 'routine.manage', resourceType: '*' }] },
    ],
  },
  {
    resource: 'Sandboxes',
    ops: [{ op: 'create', grants: [{ action: 'sandbox.ephemeral.create', resourceType: '*' }] }],
  },
]

interface RolesSectionProps {
  agentId: string
}

export function RolesSection({ agentId }: RolesSectionProps) {
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
                {PERMISSION_ROWS.map((row) => (
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
                    <div
                      key={d.key}
                      className="flex items-center justify-between py-0.5 text-[10px]"
                    >
                      <span className="font-mono text-muted-foreground">{d.key}</span>
                      <span className="text-foreground">{String(d.value)}</span>
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
