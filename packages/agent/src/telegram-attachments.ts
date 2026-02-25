import type OpenAI from 'openai'
import type { WorkItem } from '@nitejar/database'
import {
  getPluginInstanceWithConfig,
  getFile as getTelegramFile,
  downloadTelegramFileAsDataUrl,
  downloadTelegramFile,
  type TelegramConfig,
} from '@nitejar/plugin-handlers'
import { agentLog, agentWarn } from './agent-logger'
import type { WorkItemPayload, WorkItemAttachment } from './types'
import { sanitize, wrapBoundary } from './prompt-sanitize'

export const MAX_TELEGRAM_IMAGES_PER_MESSAGE = 2
export const MAX_TELEGRAM_IMAGE_BYTES = 2 * 1024 * 1024
export const MAX_SLACK_IMAGES_PER_MESSAGE = 4
export const MAX_SLACK_IMAGE_BYTES = 4 * 1024 * 1024
export const TEXT_INLINE_THRESHOLD = 50 * 1024 // 50KB
export const MAX_TEXT_INLINE_ATTACHMENTS = 3

export function safeParsePayload(payload: string | null): WorkItemPayload | null {
  if (!payload) return null
  try {
    return JSON.parse(payload) as WorkItemPayload
  } catch {
    return null
  }
}

export function collectTelegramImageFileIds(payload: WorkItemPayload | null): string[] {
  if (!payload?.attachments || !Array.isArray(payload.attachments)) return []
  const fileIds = payload.attachments
    .map((attachment: WorkItemAttachment) => {
      if (
        (attachment.type === 'photo' ||
          attachment.type === 'document' ||
          attachment.type === 'image') &&
        attachment.fileId
      ) {
        return attachment.fileId
      }
      return null
    })
    .filter((fileId): fileId is string => Boolean(fileId))

  return Array.from(new Set(fileIds)).slice(0, MAX_TELEGRAM_IMAGES_PER_MESSAGE)
}

export function parseTelegramConfig(config: unknown): TelegramConfig | null {
  if (!config) return null
  if (typeof config === 'string') {
    try {
      return JSON.parse(config) as TelegramConfig
    } catch {
      return null
    }
  }
  if (typeof config === 'object') {
    return config as TelegramConfig
  }
  return null
}

const TEXT_MIME_PREFIXES = ['text/']
const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-yaml',
  'application/x-sh',
  'application/sql',
  'application/graphql',
  'application/toml',
])
const TEXT_EXTENSIONS = new Set([
  '.csv',
  '.json',
  '.txt',
  '.md',
  '.py',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.rb',
  '.sh',
  '.bash',
  '.yml',
  '.yaml',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.sql',
  '.toml',
  '.cfg',
  '.ini',
  '.conf',
  '.env',
  '.log',
  '.rs',
  '.go',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.swift',
  '.kt',
  '.r',
  '.m',
  '.pl',
  '.php',
  '.lua',
  '.ex',
  '.exs',
  '.clj',
  '.scala',
  '.hs',
  '.erl',
  '.elm',
  '.svelte',
  '.vue',
  '.graphql',
  '.proto',
])

export function isLikelyTextFile(mimeType?: string, fileName?: string): boolean {
  if (mimeType) {
    const lower = mimeType.toLowerCase()
    if (TEXT_MIME_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true
    if (TEXT_MIME_EXACT.has(lower)) return true
  }
  if (fileName) {
    const lower = fileName.toLowerCase()
    const lastDot = lower.lastIndexOf('.')
    if (lastDot >= 0) {
      const ext = lower.slice(lastDot)
      if (TEXT_EXTENSIONS.has(ext)) return true
    }
  }
  return false
}

export function collectTextInlineAttachments(
  payload: WorkItemPayload | null
): WorkItemAttachment[] {
  if (!payload?.attachments || !Array.isArray(payload.attachments)) return []
  return payload.attachments.filter(
    (a) =>
      a.type === 'document' &&
      a.fileId &&
      isLikelyTextFile(a.mimeType, a.fileName) &&
      (a.fileSize == null || a.fileSize <= TEXT_INLINE_THRESHOLD)
  )
}

export function collectDiscordImageUrls(payload: WorkItemPayload | null): string[] {
  if (!payload?.attachments || !Array.isArray(payload.attachments)) return []
  return payload.attachments
    .filter(
      (attachment: WorkItemAttachment) =>
        attachment.type === 'image' &&
        typeof attachment.fileUrl === 'string' &&
        attachment.fileUrl.length > 0
    )
    .map((attachment: WorkItemAttachment) => attachment.fileUrl!)
    .filter((url): url is string => Boolean(url))
}

const SLACK_IMAGE_MIME_PREFIXES = ['image/']

export function collectSlackImageAttachments(
  payload: WorkItemPayload | null
): WorkItemAttachment[] {
  if (!payload?.attachments || !Array.isArray(payload.attachments)) return []
  return payload.attachments
    .filter(
      (a: WorkItemAttachment) =>
        a.type === 'photo' &&
        typeof a.fileUrl === 'string' &&
        a.fileUrl.length > 0 &&
        (!a.mimeType || SLACK_IMAGE_MIME_PREFIXES.some((p) => a.mimeType!.startsWith(p)))
    )
    .slice(0, MAX_SLACK_IMAGES_PER_MESSAGE)
}

async function downloadSlackFileAsDataUrl(
  fileUrl: string,
  botToken: string,
  maxBytes: number
): Promise<string> {
  const response = await fetch(fileUrl, {
    headers: { Authorization: `Bearer ${botToken}` },
  })
  if (!response.ok) {
    throw new Error(`Slack file download failed: ${response.status} ${response.statusText}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > maxBytes) {
    throw new Error(`Slack file too large (${buffer.length} bytes, max ${maxBytes})`)
  }
  const contentType = response.headers.get('content-type') ?? 'image/jpeg'
  const base64 = buffer.toString('base64')
  return `data:${contentType};base64,${base64}`
}

function parseSlackConfig(
  config: string | Record<string, unknown> | null
): { botToken?: string } | null {
  if (!config) return null
  if (typeof config === 'string') {
    try {
      return JSON.parse(config) as { botToken?: string }
    } catch {
      return null
    }
  }
  return config as { botToken?: string }
}

/**
 * Collect pre-downloaded image data URLs (e.g. from GitHub attachments).
 */
export function collectPreDownloadedImageDataUrls(payload: WorkItemPayload | null): string[] {
  if (!payload?.attachments || !Array.isArray(payload.attachments)) return []
  return payload.attachments
    .filter(
      (a: WorkItemAttachment) =>
        (a.type === 'image' || a.type === 'photo') && typeof a.dataUrl === 'string'
    )
    .map((a: WorkItemAttachment) => a.dataUrl!)
}

export async function buildUserMessageForModel(
  workItem: WorkItem,
  textMessage: string
): Promise<OpenAI.ChatCompletionUserMessageParam> {
  if (!workItem.plugin_instance_id) {
    return { role: 'user', content: textMessage }
  }

  const payload = safeParsePayload(workItem.payload)

  // Collect pre-downloaded images (GitHub path — already base64 data URLs)
  const preDownloadedUrls = collectPreDownloadedImageDataUrls(payload)

  // Collect source-specific attachment references
  const imageFileIds = workItem.source === 'telegram' ? collectTelegramImageFileIds(payload) : []
  const discordImageUrls = workItem.source === 'discord' ? collectDiscordImageUrls(payload) : []
  const slackImageAttachments =
    workItem.source === 'slack' ? collectSlackImageAttachments(payload) : []
  const textInlineAttachments =
    workItem.source === 'telegram'
      ? collectTextInlineAttachments(payload).slice(0, MAX_TEXT_INLINE_ATTACHMENTS)
      : []

  if (
    preDownloadedUrls.length === 0 &&
    imageFileIds.length === 0 &&
    discordImageUrls.length === 0 &&
    slackImageAttachments.length === 0 &&
    textInlineAttachments.length === 0
  ) {
    return { role: 'user', content: textMessage }
  }

  try {
    const imageUrls: string[] = [...preDownloadedUrls, ...discordImageUrls]

    // Download Telegram images if applicable
    if (imageFileIds.length > 0) {
      const pluginInstance = await getPluginInstanceWithConfig(workItem.plugin_instance_id)
      if (pluginInstance?.type === 'telegram') {
        const telegramConfig = parseTelegramConfig(pluginInstance.config)
        if (telegramConfig?.botToken) {
          for (const fileId of imageFileIds) {
            try {
              const fileInfo = await getTelegramFile(telegramConfig, fileId)
              if (!fileInfo.file_path) continue
              const dataUrl = await downloadTelegramFileAsDataUrl(
                telegramConfig,
                fileInfo.file_path,
                { maxBytes: MAX_TELEGRAM_IMAGE_BYTES }
              )
              imageUrls.push(dataUrl)
            } catch (error) {
              agentWarn('Failed to resolve Telegram image attachment for model input', {
                workItemId: workItem.id,
                fileId,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }
        }
      }
    }

    // Download Slack images if applicable
    if (slackImageAttachments.length > 0) {
      const pluginInstance = await getPluginInstanceWithConfig(workItem.plugin_instance_id)
      if (pluginInstance?.type === 'slack') {
        const slackConfig = parseSlackConfig(
          pluginInstance.config as string | Record<string, unknown> | null
        )
        if (slackConfig?.botToken) {
          for (const attachment of slackImageAttachments) {
            try {
              const dataUrl = await downloadSlackFileAsDataUrl(
                attachment.fileUrl!,
                slackConfig.botToken,
                MAX_SLACK_IMAGE_BYTES
              )
              imageUrls.push(dataUrl)
            } catch (error) {
              agentWarn('Failed to resolve Slack image attachment for model input', {
                workItemId: workItem.id,
                fileUrl: attachment.fileUrl,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }
        }
      }
    }

    // Download and inline small text files (Telegram only)
    let enrichedText = textMessage
    if (textInlineAttachments.length > 0) {
      const pluginInstance = await getPluginInstanceWithConfig(workItem.plugin_instance_id)
      if (pluginInstance?.type === 'telegram') {
        const telegramConfig = parseTelegramConfig(pluginInstance.config)
        if (telegramConfig?.botToken) {
          for (const attachment of textInlineAttachments) {
            try {
              const fileInfo = await getTelegramFile(telegramConfig, attachment.fileId!)
              if (!fileInfo.file_path) continue
              const downloadResult = await downloadTelegramFile(
                telegramConfig,
                fileInfo.file_path,
                { maxBytes: TEXT_INLINE_THRESHOLD }
              )
              const textContent = downloadResult.buffer.toString('utf-8')
              const label = attachment.fileName || 'unnamed'
              const sizeLabel = formatInlineSize(downloadResult.fileSize)
              enrichedText +=
                '\n\n' +
                wrapBoundary(
                  'attachment',
                  `Inlined file: ${sanitize(label)} (${sizeLabel})\n${sanitize(textContent)}`,
                  { source: 'telegram' }
                )
              agentLog('Inlined text file into user message', {
                workItemId: workItem.id,
                fileName: label,
                size: downloadResult.fileSize,
              })
            } catch (error) {
              agentWarn('Failed to inline text attachment', {
                workItemId: workItem.id,
                fileId: attachment.fileId,
                fileName: attachment.fileName,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }
        }
      }
    }

    if (imageUrls.length === 0) {
      return { role: 'user', content: enrichedText }
    }

    const content = [
      { type: 'text', text: enrichedText },
      ...imageUrls.map((url) => ({
        type: 'image_url',
        image_url: { url },
      })),
    ] as unknown as OpenAI.ChatCompletionUserMessageParam['content']

    agentLog('Added images to model input', {
      workItemId: workItem.id,
      imageCount: imageUrls.length,
      source: workItem.source,
    })

    return {
      role: 'user',
      content,
    }
  } catch (error) {
    agentWarn('Failed to process attachments; falling back to text', {
      workItemId: workItem.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return { role: 'user', content: textMessage }
  }
}

function formatInlineSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  return `${kb.toFixed(1)} KB`
}
