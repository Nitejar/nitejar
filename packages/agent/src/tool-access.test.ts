import { describe, expect, it } from 'vitest'
import type { ResolvedPolicyGrant } from '@nitejar/database'
import { deriveRuntimeToolAccess } from './tool-access'

function grant(action: string): ResolvedPolicyGrant {
  return {
    action,
    resourceType: '*',
    resourceId: null,
    sources: [
      {
        sourceType: 'agent_role',
        roleId: 'role-1',
        roleSlug: 'operator',
        roleName: 'Operator',
      },
    ],
  }
}

describe('deriveRuntimeToolAccess', () => {
  it('starts with all gated capabilities disabled without grants', () => {
    expect(deriveRuntimeToolAccess({})).toEqual({
      grantedActions: [],
      sandboxEphemeralCreate: false,
      routineManage: false,
      fleetAgentRead: false,
      fleetRunRead: false,
      fleetWorkRead: false,
      fleetAgentCreate: false,
      fleetAgentControl: false,
      fleetAgentDelete: false,
      fleetAgentWrite: false,
    })
  })

  it('enables routine tools from routine.self.manage grant', () => {
    expect(deriveRuntimeToolAccess({ grants: [grant('routine.self.manage')] }).routineManage).toBe(
      true
    )
  })

  it('enables routine tools from routine.manage grant', () => {
    expect(deriveRuntimeToolAccess({ grants: [grant('routine.manage')] }).routineManage).toBe(true)
  })

  it('enables ephemeral sandbox creation from policy grant', () => {
    expect(
      deriveRuntimeToolAccess({ grants: [grant('sandbox.ephemeral.create')] })
        .sandboxEphemeralCreate
    ).toBe(true)
  })

  it('maps fleet grants to the matching platform-control tool groups', () => {
    expect(
      deriveRuntimeToolAccess({
        grants: [
          grant('fleet.agent.read'),
          grant('fleet.run.read'),
          grant('fleet.work.read'),
          grant('fleet.agent.create'),
          grant('fleet.agent.control'),
          grant('fleet.agent.delete'),
          grant('fleet.agent.write'),
        ],
      })
    ).toEqual({
      grantedActions: [
        'fleet.agent.control',
        'fleet.agent.create',
        'fleet.agent.delete',
        'fleet.agent.read',
        'fleet.agent.write',
        'fleet.run.read',
        'fleet.work.read',
      ],
      sandboxEphemeralCreate: false,
      routineManage: false,
      fleetAgentRead: true,
      fleetRunRead: true,
      fleetWorkRead: true,
      fleetAgentCreate: true,
      fleetAgentControl: true,
      fleetAgentDelete: true,
      fleetAgentWrite: true,
    })
  })

  it('treats wildcard grants as enabling every gated tool group', () => {
    expect(deriveRuntimeToolAccess({ grants: [grant('*')] })).toEqual({
      grantedActions: ['*'],
      sandboxEphemeralCreate: true,
      routineManage: true,
      fleetAgentRead: true,
      fleetRunRead: true,
      fleetWorkRead: true,
      fleetAgentCreate: true,
      fleetAgentControl: true,
      fleetAgentDelete: true,
      fleetAgentWrite: true,
    })
  })
})
