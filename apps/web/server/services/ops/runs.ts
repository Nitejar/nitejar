import {
  countBackgroundTasksByJob,
  countMessagesByJob,
  findJobById,
  getCostByJobs,
  listChildJobs,
  listJobsByWorkItem,
  listBackgroundTasksByJobPaged,
  listMessagesByJobPaged,
  searchRuns,
} from '@nitejar/database'
import { type GetRunInput, type SearchRunsInput } from '@/server/services/ops/schemas'
import { getRunControlByJob } from '@/server/services/runtime-control'
import { buildJobCostRollups, toJobCostSummary } from '../run-cost-rollups'
import { buildPageInfo, normalizeOffset, resolvePageLimit, truncateUtf8 } from './chunking'
import { decodeCursor, encodeCursor } from './cursor'

export async function searchRunsOp(input: SearchRunsInput) {
  const cursor = decodeCursor(input.cursor)
  if (input.cursor && !cursor) {
    throw new Error('Invalid cursor')
  }

  const result = await searchRuns({
    q: input.q,
    statuses: input.statuses,
    agentId: input.agentId,
    workItemId: input.workItemId,
    sources: input.sources,
    pluginInstanceId: input.pluginInstanceId,
    sessionKey: input.sessionKey,
    sessionKeyPrefix: input.sessionKeyPrefix,
    routineId: input.routineId,
    createdAfter: input.createdAfter,
    createdBefore: input.createdBefore,
    limit: input.limit,
    cursor,
  })

  return {
    runs: result.runs,
    nextCursor: encodeCursor(result.nextCursor),
  }
}

export async function getRunOp(input: GetRunInput) {
  const job = await findJobById(input.jobId)
  if (!job) throw new Error('Run not found')

  const messageOffset = normalizeOffset(input.messageOffset)
  const backgroundTaskOffset = normalizeOffset(input.backgroundTaskOffset)

  const [messageTotal, backgroundTaskTotal, runControl, childRuns, workItemJobs] =
    await Promise.all([
      input.includeMessages ? countMessagesByJob(job.id) : Promise.resolve(0),
      input.includeBackgroundTasks ? countBackgroundTasksByJob(job.id) : Promise.resolve(0),
      input.includeControl ? getRunControlByJob(job.id) : Promise.resolve(undefined),
      listChildJobs(job.id),
      listJobsByWorkItem(job.work_item_id),
    ])

  const messageLimit = resolvePageLimit(messageTotal, messageOffset, input.messageLimit, 500)
  const backgroundTaskLimit = resolvePageLimit(
    backgroundTaskTotal,
    backgroundTaskOffset,
    input.backgroundTaskLimit,
    500
  )

  const costRows = await getCostByJobs(workItemJobs.map((workItemJob) => workItemJob.id))
  const directCostMap = new Map(costRows.map((entry) => [entry.job_id, entry]))
  const costRollups = buildJobCostRollups(workItemJobs, costRows)
  const runCostRollup = costRollups.get(job.id)

  const [messages, backgroundTasks] = await Promise.all([
    input.includeMessages
      ? listMessagesByJobPaged(job.id, {
          offset: messageOffset,
          limit: messageLimit,
        })
      : Promise.resolve(undefined),
    input.includeBackgroundTasks
      ? listBackgroundTasksByJobPaged(job.id, {
          offset: backgroundTaskOffset,
          limit: backgroundTaskLimit,
        })
      : Promise.resolve(undefined),
  ])

  const includeFullContent = input.includeFullMessageContent !== false
  const maxContentBytes = input.maxContentBytes
  const normalizedMessages = messages?.map((message) => {
    const content = message.content ?? ''
    const contentBytes = Buffer.byteLength(content, 'utf8')

    if (!includeFullContent) {
      return {
        ...message,
        content: null,
        contentMeta: {
          omitted: true,
          truncated: false,
          contentBytes,
          returnedBytes: 0,
        },
      }
    }

    if (typeof maxContentBytes === 'number' && content.length > 0) {
      const truncated = truncateUtf8(content, maxContentBytes)
      return {
        ...message,
        content: truncated.text,
        contentMeta: {
          omitted: false,
          truncated: truncated.truncated,
          contentBytes,
          returnedBytes: Buffer.byteLength(truncated.text, 'utf8'),
        },
      }
    }

    return {
      ...message,
      contentMeta: {
        omitted: false,
        truncated: false,
        contentBytes,
        returnedBytes: contentBytes,
      },
    }
  })

  return {
    run: job,
    cost: directCostMap.get(job.id) ?? null,
    rolledUpCost: runCostRollup ? toJobCostSummary(job.id, runCostRollup.inclusive) : null,
    descendantRunCount: runCostRollup?.descendantRunCount ?? 0,
    childRuns: childRuns.map((child) => {
      const childCostRollup = costRollups.get(child.id)
      return {
        run: child,
        cost: directCostMap.get(child.id) ?? null,
        rolledUpCost: childCostRollup
          ? toJobCostSummary(child.id, childCostRollup.inclusive)
          : null,
        descendantRunCount: childCostRollup?.descendantRunCount ?? 0,
        summaryPreview: child.final_response,
      }
    }),
    ...(normalizedMessages
      ? {
          messages: normalizedMessages,
          messagesPage: buildPageInfo({
            offset: messageOffset,
            limit: messageLimit,
            returned: normalizedMessages.length,
            total: messageTotal,
          }),
        }
      : {}),
    ...(backgroundTasks
      ? {
          backgroundTasks,
          backgroundTasksPage: buildPageInfo({
            offset: backgroundTaskOffset,
            limit: backgroundTaskLimit,
            returned: backgroundTasks.length,
            total: backgroundTaskTotal,
          }),
        }
      : {}),
    ...(runControl ? { runControl } : {}),
  }
}
