import {
  filterGitHubRepoCapabilitiesByPolicy,
  getDb,
  resolveEffectiveGitHubRepoCapabilities,
  resolveEffectivePolicy,
} from '@nitejar/database'

const now = () => Math.floor(Date.now() / 1000)

function uuid(): string {
  return crypto.randomUUID()
}

export class CapabilityService {
  static async verifyCapability(
    agentId: string,
    repoId: number,
    capability: string
  ): Promise<boolean> {
    const db = getDb()
    const [resolvedPolicy, effectiveCapabilities] = await Promise.all([
      resolveEffectivePolicy(agentId),
      resolveEffectiveGitHubRepoCapabilities(agentId, repoId),
    ])

    const allowedCapabilities = filterGitHubRepoCapabilitiesByPolicy({
      capabilities: effectiveCapabilities,
      grantedActions: resolvedPolicy.grants.map((grant) => grant.action),
    })
    const allowed = allowedCapabilities.includes(capability as never)

    await db
      .insertInto('audit_logs')
      .values({
        id: uuid(),
        event_type: allowed ? 'CAPABILITY_CHECK_PASS' : 'CAPABILITY_CHECK_FAIL',
        agent_id: agentId,
        github_repo_id: repoId,
        capability,
        result: allowed ? 'allowed' : 'denied',
        metadata: JSON.stringify({
          requestedCapability: capability,
          allowed,
          allowedCapabilities,
        }),
        created_at: now(),
      })
      .execute()

    return allowed
  }

  static async assertCapability(
    agentId: string,
    repoId: number,
    capability: string
  ): Promise<void> {
    const allowed = await this.verifyCapability(agentId, repoId, capability)
    if (!allowed) {
      throw new Error('Access denied: missing capability')
    }
  }
}
