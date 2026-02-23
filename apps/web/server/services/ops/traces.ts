import {
  countBackgroundTasksByJob,
  countExternalApiCallsByJob,
  countInferenceCallsByJob,
  countMessagesByJob,
  countSpansByJob,
  findJobById,
  getCostByJobs,
  getJobSpanSummary,
  listBackgroundTasksByJobPaged,
  listExternalApiCallsByJobPaged,
  listInferenceCallsByJobWithPayloadsPaged,
  listMessagesByJobPaged,
  listSpansByJobPaged,
  findRunDispatchByJobId,
} from '@nitejar/database'
import type { GetRunTraceInput } from '@/server/services/ops/schemas'
import { buildPageInfo, normalizeOffset, resolvePageLimit, truncateUtf8 } from './chunking'

export async function getRunTraceOp(input: GetRunTraceInput) {
  const run = await findJobById(input.jobId)
  if (!run) throw new Error('Run not found')

  const spanOffset = normalizeOffset(input.spanOffset)
  const messageOffset = normalizeOffset(input.messageOffset)
  const inferenceCallOffset = normalizeOffset(input.inferenceCallOffset)
  const backgroundTaskOffset = normalizeOffset(input.backgroundTaskOffset)
  const externalCallOffset = normalizeOffset(input.externalCallOffset)

  const [
    spanSummary,
    costs,
    spanTotal,
    messageTotal,
    inferenceCallTotal,
    backgroundTaskTotal,
    externalCallTotal,
    dispatch,
  ] = await Promise.all([
    getJobSpanSummary(run.id),
    getCostByJobs([run.id]),
    input.includeSpans ? countSpansByJob(run.id) : Promise.resolve(0),
    input.includeMessages ? countMessagesByJob(run.id) : Promise.resolve(0),
    input.includeInferenceCalls ? countInferenceCallsByJob(run.id) : Promise.resolve(0),
    input.includeBackgroundTasks ? countBackgroundTasksByJob(run.id) : Promise.resolve(0),
    input.includeExternalCalls ? countExternalApiCallsByJob(run.id) : Promise.resolve(0),
    input.includeDispatch ? findRunDispatchByJobId(run.id) : Promise.resolve(undefined),
  ])

  const spanLimit = resolvePageLimit(spanTotal, spanOffset, input.spanLimit, 1000)
  const messageLimit = resolvePageLimit(messageTotal, messageOffset, input.messageLimit, 500)
  const inferenceCallLimit = resolvePageLimit(
    inferenceCallTotal,
    inferenceCallOffset,
    input.inferenceCallLimit,
    500
  )
  const backgroundTaskLimit = resolvePageLimit(
    backgroundTaskTotal,
    backgroundTaskOffset,
    input.backgroundTaskLimit,
    500
  )
  const externalCallLimit = resolvePageLimit(
    externalCallTotal,
    externalCallOffset,
    input.externalCallLimit,
    500
  )

  const [spans, messages, inferenceCalls, backgroundTasks, externalCalls] = await Promise.all([
    input.includeSpans
      ? listSpansByJobPaged(run.id, {
          offset: spanOffset,
          limit: spanLimit,
        })
      : Promise.resolve(undefined),
    input.includeMessages
      ? listMessagesByJobPaged(run.id, {
          offset: messageOffset,
          limit: messageLimit,
        })
      : Promise.resolve(undefined),
    input.includeInferenceCalls
      ? listInferenceCallsByJobWithPayloadsPaged(run.id, {
          offset: inferenceCallOffset,
          limit: inferenceCallLimit,
        })
      : Promise.resolve(undefined),
    input.includeBackgroundTasks
      ? listBackgroundTasksByJobPaged(run.id, {
          offset: backgroundTaskOffset,
          limit: backgroundTaskLimit,
        })
      : Promise.resolve(undefined),
    input.includeExternalCalls
      ? listExternalApiCallsByJobPaged(run.id, {
          offset: externalCallOffset,
          limit: externalCallLimit,
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
    run,
    cost: costs[0] ?? null,
    summary: spanSummary,
    ...(spans
      ? {
          spans,
          spansPage: buildPageInfo({
            offset: spanOffset,
            limit: spanLimit,
            returned: spans.length,
            total: spanTotal,
          }),
        }
      : {}),
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
    ...(inferenceCalls
      ? {
          inferenceCalls,
          inferenceCallsPage: buildPageInfo({
            offset: inferenceCallOffset,
            limit: inferenceCallLimit,
            returned: inferenceCalls.length,
            total: inferenceCallTotal,
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
    ...(externalCalls
      ? {
          externalCalls,
          externalCallsPage: buildPageInfo({
            offset: externalCallOffset,
            limit: externalCallLimit,
            returned: externalCalls.length,
            total: externalCallTotal,
          }),
        }
      : {}),
    ...(dispatch ? { dispatch } : {}),
  }
}
