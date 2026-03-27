import type { ResolvedPolicyGrant } from '@nitejar/database'

export type RuntimeToolAccess = {
  grantedActions: string[]
  sandboxEphemeralCreate: boolean
  routineManage: boolean
  fleetAgentRead: boolean
  fleetAgentCreate: boolean
  fleetAgentControl: boolean
  fleetAgentDelete: boolean
  fleetAgentWrite: boolean
}

function hasGrant(grants: ResolvedPolicyGrant[], actions: string[]): boolean {
  return grants.some((grant) => grant.action === '*' || actions.includes(grant.action))
}

export function deriveRuntimeToolAccess(input: {
  grants?: ResolvedPolicyGrant[] | null
}): RuntimeToolAccess {
  const grants = input.grants ?? []
  const grantedActions = Array.from(new Set(grants.map((grant) => grant.action))).sort()

  return {
    grantedActions,
    sandboxEphemeralCreate: hasGrant(grants, ['sandbox.ephemeral.create']),
    routineManage: hasGrant(grants, ['routine.self.manage', 'routine.manage']),
    fleetAgentRead: hasGrant(grants, ['fleet.agent.read']),
    fleetAgentCreate: hasGrant(grants, ['fleet.agent.create']),
    fleetAgentControl: hasGrant(grants, ['fleet.agent.control']),
    fleetAgentDelete: hasGrant(grants, ['fleet.agent.delete']),
    fleetAgentWrite: hasGrant(grants, ['fleet.agent.write']),
  }
}
