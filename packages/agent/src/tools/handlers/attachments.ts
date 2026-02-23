import type Anthropic from '@anthropic-ai/sdk'
import { getPluginInstanceWithConfig } from '@nitejar/plugin-handlers'
import { downloadTelegramFile, getFile as getTelegramFile } from '@nitejar/plugin-handlers'
import { mkdir, spriteExec, writeFile } from '@nitejar/sprites'
import { parseTelegramConfig } from '../../telegram-attachments'
import { guessExtension } from '../helpers'
import type { ToolHandler } from '../types'

export const downloadAttachmentDefinition: Anthropic.Tool = {
  name: 'download_attachment',
  description:
    'Download a file attachment from the user message to your sprite filesystem. Attachments are listed in the user message with their index numbers. Use this for non-image files like documents, audio, video, etc.',
  input_schema: {
    type: 'object' as const,
    properties: {
      index: {
        type: 'integer',
        description: 'The 1-based attachment index from the user message.',
      },
      save_path: {
        type: 'string',
        description:
          'Optional path to save the file on the sprite. Defaults to /tmp/attachments/<filename>.',
      },
    },
    required: ['index'],
  },
}

export const downloadAttachmentTool: ToolHandler = async (input, context) => {
  const index = input.index as number
  if (!Number.isInteger(index) || index < 1) {
    return { success: false, error: 'index must be a positive integer (1-based).' }
  }

  const attachments = context.attachments
  if (!attachments || attachments.length === 0) {
    return { success: false, error: 'No attachments available in the current message.' }
  }

  if (index > attachments.length) {
    return {
      success: false,
      error: `Attachment index ${index} out of range. There are ${attachments.length} attachment(s).`,
    }
  }

  const attachment = attachments[index - 1]!

  // Handle pre-downloaded data URL attachments (e.g. GitHub images)
  if (attachment.dataUrl) {
    const mimeMatch = attachment.dataUrl.match(/^data:([^;]+);base64,/)
    const mimeType = mimeMatch?.[1] ?? attachment.mimeType ?? 'application/octet-stream'
    const base64Data = attachment.dataUrl.replace(/^data:[^;]+;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')

    const fileName = attachment.fileName || `attachment_${index}${guessExtension(mimeType)}`
    const savePath =
      typeof input.save_path === 'string' && input.save_path.trim()
        ? input.save_path.trim()
        : `/tmp/attachments/${fileName}`

    const dirPath = savePath.substring(0, savePath.lastIndexOf('/'))
    if (dirPath) {
      await mkdir(context.spriteName, dirPath)
    }

    // Write base64, then decode on sprite
    const tmpBase64Path = `${savePath}.b64tmp`
    await writeFile(context.spriteName, tmpBase64Path, base64Data)
    const decodeResult = await spriteExec(
      context.spriteName,
      `base64 -d < "${tmpBase64Path}" > "${savePath}" && rm "${tmpBase64Path}"`,
      { session: context.session }
    )
    if (decodeResult.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to decode binary file: ${decodeResult.stderr || 'unknown error'}`,
      }
    }

    const sizeKb = (buffer.byteLength / 1024).toFixed(1)
    return {
      success: true,
      output: `Downloaded ${fileName} (${sizeKb} KB, ${mimeType}) to ${savePath}`,
    }
  }

  if (!attachment.fileId && !attachment.fileUrl) {
    return {
      success: false,
      error: 'This attachment has no downloadable file reference.',
    }
  }

  if (attachment.fileUrl && !attachment.fileId) {
    const response = await fetch(attachment.fileUrl)
    if (!response.ok) {
      return {
        success: false,
        error: `Failed to download attachment file: ${response.status} ${response.statusText}`,
      }
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const fileName =
      attachment.fileName || `attachment_${index}${guessExtension(attachment.mimeType ?? '')}`
    const savePath =
      typeof input.save_path === 'string' && input.save_path.trim()
        ? input.save_path.trim()
        : `/tmp/attachments/${fileName}`

    const dirPath = savePath.substring(0, savePath.lastIndexOf('/'))
    if (dirPath) {
      await mkdir(context.spriteName, dirPath)
    }

    const sizeKb = (buffer.byteLength / 1024).toFixed(1)
    if (attachment.mimeType?.startsWith('text/')) {
      await writeFile(context.spriteName, savePath, buffer.toString('utf-8'))
    } else {
      const base64Content = buffer.toString('base64')
      const tmpBase64Path = `${savePath}.b64tmp`
      await writeFile(context.spriteName, tmpBase64Path, base64Content)
      const decodeResult = await spriteExec(
        context.spriteName,
        `base64 -d < "${tmpBase64Path}" > "${savePath}" && rm "${tmpBase64Path}"`,
        { session: context.session }
      )
      if (decodeResult.exitCode !== 0) {
        return {
          success: false,
          error: `Failed to decode binary file: ${decodeResult.stderr || 'unknown error'}`,
        }
      }
    }

    return {
      success: true,
      output: `Downloaded ${fileName} (${sizeKb} KB${attachment.mimeType ? `, ${attachment.mimeType}` : ''}) to ${savePath}`,
    }
  }

  if (!attachment.fileId) {
    return { success: false, error: 'This attachment has no downloadable file ID.' }
  }

  if (!context.pluginInstanceId) {
    return { success: false, error: 'No plugin instance ID available for downloading.' }
  }

  // Resolve Telegram config
  const pluginInstance = await getPluginInstanceWithConfig(context.pluginInstanceId)
  if (!pluginInstance || pluginInstance.type !== 'telegram') {
    return { success: false, error: 'Plugin instance not found or not Telegram.' }
  }

  const telegramConfig = parseTelegramConfig(pluginInstance.config)
  if (!telegramConfig?.botToken) {
    return { success: false, error: 'Telegram bot token not configured.' }
  }

  // Download file from Telegram
  const fileInfo = await getTelegramFile(telegramConfig, attachment.fileId)
  if (!fileInfo.file_path) {
    return {
      success: false,
      error: 'Telegram returned no file path. The file may have expired.',
    }
  }

  const downloaded = await downloadTelegramFile(telegramConfig, fileInfo.file_path)

  // Determine save path
  const fileName =
    attachment.fileName || `attachment_${index}${guessExtension(downloaded.mimeType)}`
  const savePath =
    typeof input.save_path === 'string' && input.save_path.trim()
      ? input.save_path.trim()
      : `/tmp/attachments/${fileName}`

  // Ensure directory exists
  const dirPath = savePath.substring(0, savePath.lastIndexOf('/'))
  if (dirPath) {
    await mkdir(context.spriteName, dirPath)
  }

  // Write file to sprite
  const isText =
    downloaded.mimeType.startsWith('text/') ||
    ['application/json', 'application/xml', 'application/javascript'].includes(downloaded.mimeType)

  if (isText) {
    await writeFile(context.spriteName, savePath, downloaded.buffer.toString('utf-8'))
  } else {
    // For binary files: write base64, then decode on sprite
    const base64Content = downloaded.buffer.toString('base64')
    const tmpBase64Path = `${savePath}.b64tmp`
    await writeFile(context.spriteName, tmpBase64Path, base64Content)
    const decodeResult = await spriteExec(
      context.spriteName,
      `base64 -d < "${tmpBase64Path}" > "${savePath}" && rm "${tmpBase64Path}"`,
      { session: context.session }
    )
    if (decodeResult.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to decode binary file: ${decodeResult.stderr || 'unknown error'}`,
      }
    }
  }

  const sizeKb = (downloaded.fileSize / 1024).toFixed(1)
  return {
    success: true,
    output: `Downloaded ${fileName} (${sizeKb} KB, ${downloaded.mimeType}) to ${savePath}`,
  }
}
