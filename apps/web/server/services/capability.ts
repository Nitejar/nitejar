import { getDb } from '@nitejar/database'

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

    const record = await db
      .selectFrom('agent_repo_capabilities')
      .select(['capabilities'])
      .where('agent_id', '=', agentId)
      .where('github_repo_id', '=', repoId)
      .executeTakeFirst()

    let allowed = false
    if (record?.capabilities) {
      try {
        const parsed = JSON.parse(record.capabilities) as string[]
        allowed = Array.isArray(parsed) && parsed.includes(capability)
      } catch {
        allowed = false
      }
    }

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
