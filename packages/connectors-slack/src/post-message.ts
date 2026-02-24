import type { SlackApiInvoker } from './types'

export interface PostSlackMessageOptions {
  threadTs?: string
  mrkdwn?: boolean
  unfurlLinks?: boolean
  unfurlMedia?: boolean
}

export async function postSlackMessage(
  invoke: SlackApiInvoker,
  channel: string,
  text: string,
  options?: PostSlackMessageOptions
): Promise<string> {
  const response = await invoke<{ ts?: string }>('chat.postMessage', {
    channel,
    text,
    ...(options?.threadTs ? { thread_ts: options.threadTs } : {}),
    ...(options?.mrkdwn !== undefined ? { mrkdwn: options.mrkdwn } : {}),
    ...(options?.unfurlLinks !== undefined ? { unfurl_links: options.unfurlLinks } : {}),
    ...(options?.unfurlMedia !== undefined ? { unfurl_media: options.unfurlMedia } : {}),
  })

  if (!response.ts) {
    throw new Error('Slack chat.postMessage did not return ts')
  }

  return response.ts
}

export async function updateSlackMessage(
  invoke: SlackApiInvoker,
  channel: string,
  ts: string,
  text: string,
  options?: { mrkdwn?: boolean }
): Promise<void> {
  await invoke('chat.update', {
    channel,
    ts,
    text,
    ...(options?.mrkdwn !== undefined ? { mrkdwn: options.mrkdwn } : {}),
  })
}
