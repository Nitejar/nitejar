export interface SlackMessageTiming {
  secondMessageDelayMs?: number
  waitForRunningDispatchMs?: number
}

export interface SlackScenarioSpec {
  id: string
  description: string
  prompt: string
  expectedTools: string[]
  expectedQueueMode: 'steer'
  expectedFinalStatus: 'COMPLETED' | 'FAILED' | 'CANCELLED'
  expectedReplyPattern?: RegExp
  expectedChannelId?: string
  maxRepeatedToolErrorWarnThreshold: number
  messageTiming?: SlackMessageTiming
}

export interface SlackScenarioSuite {
  singleMessage: SlackScenarioSpec[]
  contextPair: {
    id: string
    description: string
    firstPrompt: string
    second: SlackScenarioSpec
  }
  concurrency: {
    id: string
    description: string
    firstPrompt: string
    second: SlackScenarioSpec
  }
}

function token(runId: string, id: string): string {
  return `sd-${runId}-${id}`
}

export function buildSlackScenarioSuite(input: {
  runId: string
  agentHandle: string
  channelId: string
}): SlackScenarioSuite {
  const mentionTarget = input.agentHandle.startsWith('@')
    ? input.agentHandle
    : `@${input.agentHandle}`
  const mentionToken = token(input.runId, 'mention')
  const retrievalToken = token(input.runId, 'retrieval')
  const writeToken = token(input.runId, 'write')
  const contextToken = token(input.runId, 'context')
  const steerAToken = token(input.runId, 'steer-a')
  const steerBToken = token(input.runId, 'steer-b')

  const mentionScenario: SlackScenarioSpec = {
    id: 'mention-channel-awareness',
    description: 'Checks channel mention formatting and context grounding.',
    prompt: `${mentionTarget} Deterministic mention check ${mentionToken}. Reply with: CHANNEL_ACK ${mentionToken} <#${input.channelId}>`,
    expectedTools: [],
    expectedQueueMode: 'steer',
    expectedFinalStatus: 'COMPLETED',
    expectedReplyPattern: new RegExp(`${mentionToken}.*<#${input.channelId}(?:\\|[^>]+)?>`, 'i'),
    expectedChannelId: input.channelId,
    maxRepeatedToolErrorWarnThreshold: 3,
  }

  const retrievalScenario: SlackScenarioSpec = {
    id: 'tool-call-retrieval',
    description: 'Requires Slack retrieval tools and token-grounded summary.',
    prompt: `${mentionTarget} Use Slack retrieval tools to summarize this thread in 2 bullets and include token ${retrievalToken}.`,
    expectedTools: [
      'slack_get_thread',
      'slack_get_channel_history',
      'slack_search_channel_messages',
      'slack_get_channel_info',
    ],
    expectedQueueMode: 'steer',
    expectedFinalStatus: 'COMPLETED',
    expectedReplyPattern: new RegExp(retrievalToken, 'i'),
    expectedChannelId: input.channelId,
    maxRepeatedToolErrorWarnThreshold: 3,
  }

  const writeScenario: SlackScenarioSpec = {
    id: 'write-request-no-write-tool',
    description: 'Asks for a write action and validates runtime/tool behavior is safe.',
    prompt: `${mentionTarget} Use exactly one read-only Slack retrieval tool to confirm channel context. Do NOT post anything. Then reply with: WRITE_GUARD ${writeToken}.`,
    expectedTools: ['slack_get_channel_info', 'slack_list_channels', 'slack_get_channel_history'],
    expectedQueueMode: 'steer',
    expectedFinalStatus: 'COMPLETED',
    expectedReplyPattern: new RegExp(`WRITE_GUARD\\s+${writeToken}`, 'i'),
    expectedChannelId: input.channelId,
    maxRepeatedToolErrorWarnThreshold: 3,
  }

  const contextSecond: SlackScenarioSpec = {
    id: 'context-sufficiency-followup',
    description: 'Checks follow-up context recall and no blind retries.',
    prompt: `${mentionTarget} Use Slack thread retrieval tools to read the previous message in this thread and reply exactly: CONTEXT_ACK ${contextToken}`,
    expectedTools: ['slack_get_thread', 'slack_get_channel_history'],
    expectedQueueMode: 'steer',
    expectedFinalStatus: 'COMPLETED',
    expectedReplyPattern: new RegExp(`CONTEXT_ACK\\s+${contextToken}`, 'i'),
    expectedChannelId: input.channelId,
    maxRepeatedToolErrorWarnThreshold: 3,
  }

  const steerSecond: SlackScenarioSpec = {
    id: 'steer-concurrency-second-message',
    description: 'Second message should steer or be policy-consistently queued.',
    prompt: `${mentionTarget} Ignore previous task and reply with STEER_ACK ${steerBToken}`,
    expectedTools: [],
    expectedQueueMode: 'steer',
    expectedFinalStatus: 'COMPLETED',
    expectedReplyPattern: new RegExp(`STEER_ACK\\s+${steerBToken}`, 'i'),
    expectedChannelId: input.channelId,
    maxRepeatedToolErrorWarnThreshold: 3,
    messageTiming: {
      secondMessageDelayMs: 0,
      waitForRunningDispatchMs: 35_000,
    },
  }

  return {
    singleMessage: [mentionScenario, retrievalScenario, writeScenario],
    contextPair: {
      id: 'context-sufficiency',
      description: 'Two-step context test in one thread.',
      firstPrompt: `${mentionTarget} Memorize this token for follow-up: ${contextToken}`,
      second: contextSecond,
    },
    concurrency: {
      id: 'steer-concurrency',
      description: 'Two messages in one thread while first run is active.',
      firstPrompt: `${mentionTarget} Start a deep analysis for token ${steerAToken}. Use Slack tools to inspect this channel and provide a detailed answer with 6 bullets before finishing.`,
      second: steerSecond,
    },
  }
}
