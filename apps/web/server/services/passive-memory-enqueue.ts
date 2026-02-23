import { enqueuePassiveMemoryQueue, findAgentById } from '@nitejar/database'
import { getMemorySettings, parseAgentConfig } from '@nitejar/agent/config'

const DEFAULT_MAX_ATTEMPTS = 3

/**
 * Post-run hook: enqueue passive-memory extraction work for completed runs.
 * Uses unique job_id at the DB layer to enforce at-most-once semantics.
 */
export async function maybeEnqueuePassiveMemory(
  jobId: string,
  agentId: string,
  workItemId: string,
  dispatchId: string
): Promise<void> {
  const agent = await findAgentById(agentId)
  if (!agent) return

  const config = parseAgentConfig(agent.config)
  const memorySettings = getMemorySettings(config)

  if (memorySettings.enabled === false) return
  if (memorySettings.passiveUpdatesEnabled !== true) return

  await enqueuePassiveMemoryQueue({
    job_id: jobId,
    agent_id: agentId,
    work_item_id: workItemId,
    dispatch_id: dispatchId,
    status: 'pending',
    attempt_count: 0,
    max_attempts: DEFAULT_MAX_ATTEMPTS,
    next_attempt_at: null,
    claimed_by: null,
    lease_expires_at: null,
    last_error: null,
    summary_json: null,
    started_at: null,
    completed_at: null,
  })
}
