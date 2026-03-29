import type { Metadata } from 'next'
import loadable from 'next/dynamic'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import {
  buildPolicyPermissionRows,
  findAgentById,
  deleteAgent,
  getPluginInstancesForAgent,
  getAgentIdsWithActiveJobs,
  getDb,
  listAgentRoleAssignments,
  listRoles,
  listRoleDefaults,
} from '@nitejar/database'
import {
  deprovisionSprite,
  getSpritesTokenSettings,
  isSpritesExecutionAvailable,
} from '@nitejar/sprites'
import { getMemorySettings, parseAgentConfig } from '@nitejar/agent/config'
import type { NetworkPolicy } from '@nitejar/agent/types'
import { createPageMetadata } from '@/app/metadata'
import { getServerSession } from '@/lib/auth-server'
import { ADMIN_ROLES, hasRequiredRole } from '@/lib/api-auth'
import { RouteClientFallback } from '@/app/(app)/components/RouteClientFallback'
import { DeleteButton } from '../../components/DeleteButton'
import { ExportProfileButton } from './ExportProfileButton'
import { ChatWithAgentButton } from './ChatWithAgentButton'
import { PageScrollShell } from '../../components/PageScrollShell'
import { WorkSection } from './WorkSection'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  IconPlug,
  IconPlugConnected,
  IconExternalLink,
  IconBrandTelegram,
  IconBrandGithub,
  IconAlertTriangle,
  IconSparkles,
} from '@tabler/icons-react'

const StatusToggle = loadable(() => import('./StatusToggle').then((mod) => mod.StatusToggle), {
  loading: () => <RouteClientFallback label="Loading status..." className="min-h-[120px]" />,
})
const AgentIdentityForm = loadable(
  () => import('./AgentIdentityForm').then((mod) => mod.AgentIdentityForm),
  {
    loading: () => <RouteClientFallback label="Loading identity..." className="min-h-[240px]" />,
  }
)
const RolesSection = loadable(() => import('./RolesSection').then((mod) => mod.RolesSection), {
  loading: () => <RouteClientFallback label="Loading roles..." className="min-h-[220px]" />,
})
const SoulSection = loadable(() => import('./SoulSection').then((mod) => mod.SoulSection), {
  loading: () => <RouteClientFallback label="Loading soul..." className="min-h-[220px]" />,
})
const ModelSection = loadable(() => import('./ModelSection').then((mod) => mod.ModelSection), {
  loading: () => (
    <RouteClientFallback label="Loading model settings..." className="min-h-[280px]" />
  ),
})
const SkillsSection = loadable(() => import('./SkillsSection').then((mod) => mod.SkillsSection), {
  loading: () => <RouteClientFallback label="Loading skills..." className="min-h-[240px]" />,
})
const EvalsSection = loadable(() => import('./EvalsSection').then((mod) => mod.EvalsSection), {
  loading: () => <RouteClientFallback label="Loading evals..." className="min-h-[220px]" />,
})
const NetworkPolicySection = loadable(
  () => import('./NetworkPolicySection').then((mod) => mod.NetworkPolicySection),
  {
    loading: () => (
      <RouteClientFallback label="Loading network policy..." className="min-h-[320px]" />
    ),
  }
)
const MemorySection = loadable(() => import('./MemorySection').then((mod) => mod.MemorySection), {
  loading: () => <RouteClientFallback label="Loading memory..." className="min-h-[280px]" />,
})
const CostSection = loadable(() => import('./CostSection').then((mod) => mod.CostSection), {
  loading: () => <RouteClientFallback label="Loading costs..." className="min-h-[220px]" />,
})
const SessionSection = loadable(
  () => import('./SessionSection').then((mod) => mod.SessionSection),
  {
    loading: () => (
      <RouteClientFallback label="Loading session settings..." className="min-h-[260px]" />
    ),
  }
)
const SandboxesSection = loadable(
  () => import('./SandboxesSection').then((mod) => mod.SandboxesSection),
  {
    loading: () => <RouteClientFallback label="Loading sandboxes..." className="min-h-[180px]" />,
  }
)

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

function isNetworkPolicy(value: unknown): value is NetworkPolicy {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as { mode?: unknown; rules?: unknown }
  return (
    typeof candidate.mode === 'string' &&
    Array.isArray(candidate.rules) &&
    candidate.rules.every((rule) => {
      if (!rule || typeof rule !== 'object') {
        return false
      }

      const candidateRule = rule as { domain?: unknown; action?: unknown }
      return typeof candidateRule.domain === 'string' && typeof candidateRule.action === 'string'
    })
  )
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const agent = await findAgentById(id)
  return createPageMetadata(agent?.name ?? 'Agent')
}

async function deleteAgentAction(formData: FormData) {
  'use server'

  const id = formData.get('id') as string
  const agent = await findAgentById(id)
  const spriteSettings = await getSpritesTokenSettings()
  if (agent?.sprite_id && isSpritesExecutionAvailable(spriteSettings)) {
    try {
      await deprovisionSprite(agent)
    } catch (error) {
      console.warn(`[AgentDelete] Failed to deprovision sprite ${agent.sprite_id}`, error)
    }
  }
  await deleteAgent(id)
  redirect('/agents')
}

const pluginInstanceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  telegram: IconBrandTelegram,
  github: IconBrandGithub,
}

export default async function AgentDetailPage({ params }: Props) {
  const { id } = await params
  const session = await getServerSession()
  const db = getDb()
  const permissionRows = buildPolicyPermissionRows().map((row) => ({
    resource: row.resource,
    ops: row.ops,
  }))

  const [agent, pluginInstances, allTeams, activeAgentIds, roleAssignments, allRoles] =
    await Promise.all([
      findAgentById(id),
      getPluginInstancesForAgent(id),
      db.selectFrom('teams').select(['id', 'name']).orderBy('name', 'asc').execute(),
      getAgentIdsWithActiveJobs(),
      listAgentRoleAssignments(id),
      listRoles({ activeOnly: true }),
    ])

  if (!agent) {
    notFound()
  }

  const config = parseAgentConfig(agent.config)
  const effectiveMemorySettings = getMemorySettings(config)
  const dbStatus = agent.status as 'idle' | 'busy' | 'offline'
  const effectiveStatus = dbStatus !== 'offline' && activeAgentIds.has(agent.id) ? 'busy' : dbStatus

  const currentRole = roleAssignments[0]?.role ?? null

  // Get role network defaults if a role is assigned
  let roleNetworkDefaults: {
    roleName: string
    mode: string
    rules: Array<{ domain: string; action: string }>
  } | null = null
  if (currentRole) {
    const defaults = await listRoleDefaults(currentRole.id)
    const npDefault = defaults.find((d) => d.key === 'networkPolicy')
    if (npDefault?.value_json) {
      try {
        const parsed: unknown = JSON.parse(npDefault.value_json)
        if (isNetworkPolicy(parsed)) {
          roleNetworkDefaults = {
            roleName: currentRole.name,
            mode: parsed.mode ?? 'unrestricted',
            rules: parsed.rules,
          }
        }
      } catch {
        // ignore malformed JSON
      }
    }
  }

  // Get team assignments for this agent
  const teamAssignments = await db
    .selectFrom('agent_teams')
    .innerJoin('teams', 'teams.id', 'agent_teams.team_id')
    .select(['teams.id as id', 'teams.name as name'])
    .where('agent_teams.agent_id', '=', agent.id)
    .execute()

  const currentTeamId = teamAssignments[0]?.id ?? null
  const sessionRole =
    session?.user && typeof session.user === 'object' && 'role' in session.user
      ? session.user.role
      : null
  const canAccessEvals = hasRequiredRole(
    typeof sessionRole === 'string' ? sessionRole : null,
    ADMIN_ROLES
  )

  // Avatar/identity display
  const displayEmoji = config.emoji
  const displayAvatar = config.avatarUrl
  const initials = agent.name
    .split(/[-_\s]/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <PageScrollShell className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <Link href="/agents" className="text-xs text-muted-foreground hover:text-foreground">
            &larr; Back to Agents
          </Link>
          <div className="flex items-center gap-4">
            {/* Large avatar */}
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 text-2xl">
              {displayAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={displayAvatar}
                  alt={agent.name}
                  className="h-full w-full rounded-xl object-cover"
                />
              ) : displayEmoji ? (
                <span>{displayEmoji}</span>
              ) : (
                <span className="text-lg font-semibold text-white/60">{initials}</span>
              )}
            </div>
            <div>
              <h2 className="text-2xl font-semibold">{agent.name}</h2>
              <p className="text-sm text-muted-foreground">
                {currentRole ? (
                  <>
                    {currentRole.name} · <span className="font-mono">@{agent.handle}</span>
                  </>
                ) : (
                  <span className="font-mono">@{agent.handle}</span>
                )}
              </p>
              <p
                className="text-[10px] text-muted-foreground/50"
                title={`Agent ID: ${agent.id}${agent.sprite_id ? `\nSprite ID: ${agent.sprite_id}` : ''}`}
              >
                Created {new Date(agent.created_at * 1000).toLocaleDateString()} · Updated{' '}
                {new Date(agent.updated_at * 1000).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* Right side: Status toggle + Export */}
        <div className="flex items-center gap-3">
          <ChatWithAgentButton agentId={agent.id} agentName={agent.name} />
          <ExportProfileButton agentId={agent.id} agentHandle={agent.handle} />
          <StatusToggle agentId={agent.id} currentStatus={effectiveStatus} />
        </div>
      </div>

      {/* Main Content - Two Column Layout (Main on LEFT, Sidebar on RIGHT) */}
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        {/* Left Column - Main Configuration */}
        <div className="space-y-6">
          {/* Identity Section */}
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <IconSparkles className="h-4 w-4 text-muted-foreground" />
                Identity
              </CardTitle>
              <CardDescription className="text-xs">
                How this agent appears to users.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AgentIdentityForm
                agentId={agent.id}
                handle={agent.handle}
                name={agent.name}
                currentRoleId={currentRole?.id ?? null}
                availableRoles={allRoles.map((r) => ({ id: r.id, name: r.name }))}
                initialEmoji={config.emoji}
                initialAvatarUrl={config.avatarUrl}
                currentTeamId={currentTeamId}
                teams={allTeams}
              />
            </CardContent>
          </Card>

          {/* Roles & Policy Section */}
          <RolesSection agentId={agent.id} permissionRows={permissionRows} />

          {/* Soul Section */}
          <SoulSection agentId={agent.id} initialSoul={config.soul} />

          {/* Model Section */}
          <ModelSection
            agentId={agent.id}
            initialModel={config.model}
            initialTemperature={config.temperature}
            initialMaxTokens={config.maxTokens}
            initialEditToolMode={config.editToolMode}
            initialTriageMaxTokens={config.triageSettings?.maxTokens}
            initialTriageReasoningEffort={config.triageSettings?.reasoningEffort}
            initialTriageRecentHistoryMaxChars={config.triageSettings?.recentHistoryMaxChars}
            initialTriageRecentHistoryLookbackMessages={
              config.triageSettings?.recentHistoryLookbackMessages
            }
            initialTriageRecentHistoryPerMessageMaxChars={
              config.triageSettings?.recentHistoryPerMessageMaxChars
            }
          />

          {/* Skills Section */}
          <SkillsSection agentId={agent.id} />

          {/* Evals Section */}
          {canAccessEvals ? <EvalsSection agentId={agent.id} /> : null}

          <NetworkPolicySection agentId={agent.id} roleNetworkDefaults={roleNetworkDefaults} />

          {/* Memory Section */}
          <MemorySection
            agentId={agent.id}
            initialDecayRate={config.memorySettings?.decayRate}
            initialMaxMemories={config.memorySettings?.maxMemories}
            initialPassiveUpdatesEnabled={effectiveMemorySettings.passiveUpdatesEnabled}
            initialMaxStoredMemories={config.memorySettings?.maxStoredMemories}
            initialExtractionHint={config.memorySettings?.extractionHint}
          />

          {/* Inference Costs */}
          <CostSection agentId={agent.id} />

          <WorkSection agentId={agent.id} />

          {/* Session Section */}
          <SessionSection agentId={agent.id} initialSettings={config.sessionSettings} />

          {/* Danger Zone */}
          <Card className="border-destructive/20 bg-destructive/5">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <IconAlertTriangle className="h-4 w-4" />
                Danger Zone
              </CardTitle>
              <CardDescription className="text-xs">
                Permanently delete this agent. Work item history is preserved.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={deleteAgentAction}>
                <input type="hidden" name="id" value={agent.id} />
                <DeleteButton
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs font-medium text-destructive transition hover:bg-destructive/20"
                  confirmMessage={`Are you sure you want to delete "${agent.name}"? This cannot be undone.`}
                >
                  Delete Agent
                </DeleteButton>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Plugin Instances Card */}
          <Card className="border-white/10 bg-white/[0.02]">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <IconPlug className="h-4 w-4 text-muted-foreground" />
                Plugin Instances
              </CardTitle>
              <CardDescription className="text-xs">
                Sources this agent receives work from.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pluginInstances.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/10 py-6">
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                    <IconPlugConnected className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">No plugin instances</p>
                  <Link href="/plugins" className="mt-2 text-xs text-primary hover:underline">
                    Manage plugins &rarr;
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {pluginInstances.map((pluginInstance) => {
                    const Icon = pluginInstanceIcons[pluginInstance.type] || IconPlugConnected
                    return (
                      <Link
                        key={pluginInstance.id}
                        href={`/plugins/instances/${pluginInstance.id}`}
                        className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] p-3 transition hover:border-white/20 hover:bg-white/[0.04]"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{pluginInstance.name}</p>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              {pluginInstance.type}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {pluginInstance.enabled ? (
                            <div className="h-2 w-2 rounded-full bg-emerald-400" />
                          ) : (
                            <div className="h-2 w-2 rounded-full bg-zinc-500" />
                          )}
                          <IconExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </Link>
                    )
                  })}
                  <Link
                    href="/plugins"
                    className="block pt-2 text-center text-xs text-muted-foreground hover:text-foreground"
                  >
                    Manage plugins &rarr;
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <SandboxesSection agentId={agent.id} />
        </div>
      </div>
    </PageScrollShell>
  )
}
