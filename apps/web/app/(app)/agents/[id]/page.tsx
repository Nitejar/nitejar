import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import {
  findAgentById,
  deleteAgent,
  getPluginInstancesForAgent,
  getAgentIdsWithActiveJobs,
  getDb,
} from '@nitejar/database'
import { deprovisionSprite } from '@nitejar/sprites'
import { getMemorySettings, parseAgentConfig } from '@nitejar/agent/config'
import { DeleteButton } from '../../components/DeleteButton'
import { SoulSection } from './SoulSection'
import { ModelSection } from './ModelSection'
import { MemorySection } from './MemorySection'
import { SessionSection } from './SessionSection'
import { NetworkPolicySection } from './NetworkPolicySection'
import { SandboxesSection } from './SandboxesSection'
import { CapabilitiesSection } from './CapabilitiesSection'
import { FleetAccessSection } from './FleetAccessSection'
import { AgentIdentityForm } from './AgentIdentityForm'
import { StatusToggle } from './StatusToggle'
import { ExportProfileButton } from './ExportProfileButton'
import { ChatWithAgentButton } from './ChatWithAgentButton'
import { CostSection } from './CostSection'
import { SkillsSection } from './SkillsSection'
import { EvalsSection } from './EvalsSection'
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

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

async function deleteAgentAction(formData: FormData) {
  'use server'

  const id = formData.get('id') as string
  const agent = await findAgentById(id)
  if (agent?.sprite_id && process.env.SPRITES_TOKEN) {
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
  const db = getDb()

  const [agent, pluginInstances, allTeams, activeAgentIds] = await Promise.all([
    findAgentById(id),
    getPluginInstancesForAgent(id),
    db.selectFrom('teams').select(['id', 'name']).orderBy('name', 'asc').execute(),
    getAgentIdsWithActiveJobs(),
  ])

  if (!agent) {
    notFound()
  }

  const config = parseAgentConfig(agent.config)
  const effectiveMemorySettings = getMemorySettings(config)
  const dbStatus = agent.status as 'idle' | 'busy' | 'offline'
  const effectiveStatus = dbStatus !== 'offline' && activeAgentIds.has(agent.id) ? 'busy' : dbStatus

  // Get team assignments for this agent
  const teamAssignments = await db
    .selectFrom('agent_teams')
    .innerJoin('teams', 'teams.id', 'agent_teams.team_id')
    .select(['teams.id as id', 'teams.name as name'])
    .where('agent_teams.agent_id', '=', agent.id)
    .execute()

  const currentTeamId = teamAssignments[0]?.id ?? null

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
    <div className="space-y-6">
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
                {config.title ? (
                  <>
                    {config.title} · <span className="font-mono">@{agent.handle}</span>
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
                initialTitle={config.title}
                initialEmoji={config.emoji}
                initialAvatarUrl={config.avatarUrl}
                currentTeamId={currentTeamId}
                teams={allTeams}
              />
            </CardContent>
          </Card>

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
          <EvalsSection agentId={agent.id} />

          <NetworkPolicySection agentId={agent.id} />

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

          {/* Session Section */}
          <SessionSection agentId={agent.id} initialSettings={config.sessionSettings} />

          {/* Capabilities Section */}
          <CapabilitiesSection agentId={agent.id} />

          {/* Fleet Access Section */}
          <FleetAccessSection agentId={agent.id} />

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
    </div>
  )
}
