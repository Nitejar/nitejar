import { router } from '../trpc'
import { orgRouter } from './org'
import { githubRouter } from './github'
import { capabilitiesRouter } from './capabilities'
import { capabilitySettingsRouter } from './capability-settings'
import { gatewayRouter } from './gateway'
import { pluginInstancesRouter } from './plugin-instances'
import { networkPolicyRouter } from './network-policy'
import { jobsRouter } from './jobs'
import { costsRouter } from './costs'
import { spansRouter } from './spans'
import { sandboxesRouter } from './sandboxes'
import { runtimeControlRouter } from './runtime-control'
import { dispatchesRouter } from './dispatches'
import { outboxRouter } from './outbox'
import { authSettingsRouter } from './auth-settings'
import { routinesRouter } from './routines'
import { pluginsRouter } from './plugins'
import { collectionsRouter } from './collections'
import { credentialsRouter } from './credentials'
import { commandCenterRouter } from './command-center'
import { agentBuilderRouter } from './agent-builder'
import { evalsRouter } from './evals'
import { skillsRouter } from './skills'
import { sessionsRouter } from './sessions'
import { mediaArtifactsRouter } from './media-artifacts'

export const appRouter = router({
  org: orgRouter,
  github: githubRouter,
  capabilities: capabilitiesRouter,
  capabilitySettings: capabilitySettingsRouter,
  gateway: gatewayRouter,
  pluginInstances: pluginInstancesRouter,
  networkPolicy: networkPolicyRouter,
  jobs: jobsRouter,
  costs: costsRouter,
  spans: spansRouter,
  sandboxes: sandboxesRouter,
  runtimeControl: runtimeControlRouter,
  dispatches: dispatchesRouter,
  outbox: outboxRouter,
  authSettings: authSettingsRouter,
  routines: routinesRouter,
  plugins: pluginsRouter,
  collections: collectionsRouter,
  credentials: credentialsRouter,
  commandCenter: commandCenterRouter,
  agentBuilder: agentBuilderRouter,
  evals: evalsRouter,
  skills: skillsRouter,
  sessions: sessionsRouter,
  mediaArtifacts: mediaArtifactsRouter,
})

export type AppRouter = typeof appRouter
