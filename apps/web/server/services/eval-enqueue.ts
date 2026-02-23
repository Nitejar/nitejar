import {
  listActiveEvaluatorsForAgent,
  getEvalSettings,
  countEvalRunsForAgentToday,
  countCompletedRunsForAgentToday,
  findJobById,
  findActivityByJobId,
  createEvalRun,
} from '@nitejar/database'

/**
 * Post-run hook: enqueues a single pipeline eval run if the agent has active evaluators.
 * Called from run-dispatch-worker after finalizeRunDispatch completes.
 *
 * This function is designed to be non-blocking: failures are caught by the caller
 * and do not affect the agent's response delivery.
 */
export async function maybeEnqueueEvalPipeline(
  jobId: string,
  agentId: string,
  workItemId: string
): Promise<void> {
  // 1. Check if agent has any active evaluators
  const assignments = await listActiveEvaluatorsForAgent(agentId)
  if (assignments.length === 0) return

  // 2. Check daily eval limit
  const settings = await getEvalSettings()
  const todayCount = await countEvalRunsForAgentToday(agentId)
  if (todayCount >= settings.max_daily_evals) return

  // 3. Check if this job was a triage-pass (no substantive work)
  const job = await findJobById(jobId)
  if (!job || job.status !== 'COMPLETED') return
  const activity = await findActivityByJobId(jobId)
  if (activity?.status === 'passed') return

  // 4. Apply pipeline-level sampling
  const todayRunCount = await countCompletedRunsForAgentToday(agentId)
  const effectiveSampleRate =
    todayRunCount < settings.sample_rate_high_volume_threshold
      ? settings.sample_rate_default
      : settings.sample_rate_high_volume
  if (Math.random() >= effectiveSampleRate) return

  // 5. Enqueue a single pipeline eval run
  await createEvalRun({
    job_id: jobId,
    agent_id: agentId,
    work_item_id: workItemId,
    trigger: 'auto',
    status: 'pending',
  })
}
