import { deleteAgent, getDb } from '@nitejar/database'

const MAX_AGE_SECONDS = 60 * 60 // 1 hour

/**
 * Sweep orphaned test agents created by the Agent Builder wizard.
 * Test agents have a `_test-` handle prefix and are created with published = false.
 * Any such agent older than 1 hour is considered orphaned and deleted.
 *
 * Called from the periodic background worker every 30 minutes.
 */
export async function sweepOrphanedTestAgents(): Promise<number> {
  const db = getDb()
  const cutoff = Math.floor(Date.now() / 1000) - MAX_AGE_SECONDS

  const orphaned = await db
    .selectFrom('agents')
    .select('id')
    .where('handle', 'like', '_test-%')
    .where('created_at', '<', cutoff)
    .execute()

  let deleted = 0

  for (const agent of orphaned) {
    try {
      // Clean up associated data
      await db.deleteFrom('agent_memories').where('agent_id', '=', agent.id).execute()
      await db.deleteFrom('agent_sandboxes').where('agent_id', '=', agent.id).execute()
      await db.deleteFrom('agent_teams').where('agent_id', '=', agent.id).execute()
      await db.deleteFrom('agent_plugin_instances').where('agent_id', '=', agent.id).execute()
      await db.deleteFrom('cost_limits').where('agent_id', '=', agent.id).execute()
      await db
        .deleteFrom('skill_assignments')
        .where('scope', '=', 'agent')
        .where('scope_id', '=', agent.id)
        .execute()

      // Delete jobs and messages
      const jobs = await db
        .selectFrom('jobs')
        .select('id')
        .where('agent_id', '=', agent.id)
        .execute()

      if (jobs.length > 0) {
        const jobIds = jobs.map((j) => j.id)
        await db.deleteFrom('messages').where('job_id', 'in', jobIds).execute()
        await db.deleteFrom('jobs').where('agent_id', '=', agent.id).execute()
      }

      // Delete work items
      await db
        .deleteFrom('work_items')
        .where('source_ref', 'like', `builder:${agent.id}%`)
        .execute()

      // Delete the agent
      await deleteAgent(agent.id)
      deleted++
    } catch (error) {
      console.warn(`[AgentBuilderCleanup] Failed to delete orphaned test agent ${agent.id}:`, error)
    }
  }

  if (deleted > 0) {
    console.log(`[AgentBuilderCleanup] Swept ${deleted} orphaned test agent(s)`)
  }

  return deleted
}
