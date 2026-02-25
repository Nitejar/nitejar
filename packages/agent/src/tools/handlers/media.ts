import { createHash } from 'node:crypto'
import type Anthropic from '@anthropic-ai/sdk'
import { insertMediaArtifact, insertMediaArtifactBlob, type MediaArtifact } from '@nitejar/database'
import { appendFile, mkdir, spriteExec, writeFile } from '@nitejar/sprites'
import {
  getImageGenModel,
  getSTTModel,
  getTTSModel,
  getTTSProvider,
  getTTSSettings,
} from '../../media-settings'
import { getGatewayClient } from '../../gateway-openai-client'
import { openRouterTrace } from '../../openrouter-trace'
import type { ToolHandler } from '../types'

const TTS_FORMATS = new Set(['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'])
const SPRITE_WRITE_CHUNK_SIZE = 8_192
/**
 * v0.1 default for durable media receipts:
 * we copy generated binary media out of the sprite sandbox and persist bytes in DB blobs.
 * TODO(v0.2): move binary payloads to object storage (S3/R2/GCS) and keep DB metadata-only.
 */
const MEDIA_BINARY_RECEIPT_STORAGE_BACKEND = 'db_blob'

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function parseImageSize(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return /^\d{2,4}x\d{2,4}$/i.test(trimmed) ? trimmed.toLowerCase() : ''
}

function getOutputPath(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback
  const trimmed = input.trim()
  return trimmed || fallback
}

function outputDir(path: string): string | null {
  const idx = path.lastIndexOf('/')
  if (idx <= 0) return null
  return path.slice(0, idx)
}

function fileNameFromPath(path: string | null): string | null {
  if (!path) return null
  const normalized = path.trim()
  if (!normalized) return null
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

async function ensureDir(spriteName: string, path: string): Promise<void> {
  const dir = outputDir(path)
  if (!dir) return
  await mkdir(spriteName, dir)
}

async function writeBinaryFile(params: {
  spriteName: string
  outputPath: string
  base64: string
}): Promise<void> {
  await ensureDir(params.spriteName, params.outputPath)
  const tempPath = `${params.outputPath}.b64tmp`
  await writeTextFileChunked(params.spriteName, tempPath, params.base64)
  const decodeResult = await spriteExec(
    params.spriteName,
    `base64 -d < ${shellQuote(tempPath)} > ${shellQuote(params.outputPath)} && rm ${shellQuote(tempPath)}`
  )
  if (decodeResult.exitCode !== 0) {
    throw new Error(`Failed to write binary file: ${decodeResult.stderr || 'unknown error'}`)
  }
}

async function writeTextFileChunked(
  spriteName: string,
  path: string,
  content: string
): Promise<void> {
  if (content.length <= SPRITE_WRITE_CHUNK_SIZE) {
    await writeFile(spriteName, path, content)
    return
  }

  await writeFile(spriteName, path, '')
  for (let offset = 0; offset < content.length; offset += SPRITE_WRITE_CHUNK_SIZE) {
    const chunk = content.slice(offset, offset + SPRITE_WRITE_CHUNK_SIZE)
    await appendFile(spriteName, path, chunk)
  }
}

function collectDataUrls(value: unknown, urls: Set<string>, depth = 0): void {
  if (depth > 8 || value == null) return

  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) urls.add(value)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) collectDataUrls(item, urls, depth + 1)
    return
  }

  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'b64_json' && typeof child === 'string' && child.length > 0) {
        urls.add(`data:image/png;base64,${child}`)
      }
      collectDataUrls(child, urls, depth + 1)
    }
  }
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/)
  if (!match) return null
  const mimeType = match[1] ?? 'image/png'
  const base64 = match[2]?.trim() ?? ''
  if (!base64) return null
  return { mimeType, base64 }
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes('jpeg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('gif')) return 'gif'
  if (mimeType.includes('bmp')) return 'bmp'
  return 'png'
}

function extensionFromTTSFormat(format: string): string {
  if (format === 'pcm') return 'pcm'
  return format
}

function mimeTypeFromTTSFormat(format: string): string {
  switch (format) {
    case 'wav':
      return 'audio/wav'
    case 'opus':
      return 'audio/opus'
    case 'aac':
      return 'audio/aac'
    case 'flac':
      return 'audio/flac'
    case 'pcm':
      return 'audio/L16'
    case 'mp3':
    default:
      return 'audio/mpeg'
  }
}

function inferAudioFormat(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (!ext) return 'wav'
  if (ext === 'mp3') return 'mp3'
  if (ext === 'm4a') return 'mp4'
  if (ext === 'ogg' || ext === 'oga') return 'ogg'
  if (ext === 'webm') return 'webm'
  if (ext === 'flac') return 'flac'
  if (ext === 'wav') return 'wav'
  return 'wav'
}

function extractTextFromResponse(response: unknown): string {
  const message = (response as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message
  const content = message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part)
      continue
    }
    if (part && typeof part === 'object') {
      const record = part as Record<string, unknown>
      if (typeof record.text === 'string') {
        parts.push(record.text)
        continue
      }
      if (typeof record.output_text === 'string') {
        parts.push(record.output_text)
      }
    }
  }
  return parts.join('\n').trim()
}

function extractUsageMetrics(response: unknown): { tokensUsed: number; costUsd: number | null } {
  const usage = (response as { usage?: Record<string, unknown> })?.usage ?? {}
  const promptTokens =
    typeof usage.prompt_tokens === 'number' && Number.isFinite(usage.prompt_tokens)
      ? usage.prompt_tokens
      : 0
  const completionTokens =
    typeof usage.completion_tokens === 'number' && Number.isFinite(usage.completion_tokens)
      ? usage.completion_tokens
      : 0
  const totalTokens =
    typeof usage.total_tokens === 'number' && Number.isFinite(usage.total_tokens)
      ? usage.total_tokens
      : promptTokens + completionTokens

  const explicitCost =
    typeof usage.cost === 'number' && Number.isFinite(usage.cost)
      ? usage.cost
      : typeof usage.total_cost === 'number' && Number.isFinite(usage.total_cost)
        ? usage.total_cost
        : null

  return { tokensUsed: totalTokens, costUsd: explicitCost }
}

function parseTTSFormat(input: unknown): string {
  if (typeof input !== 'string') return 'mp3'
  const format = input.trim().toLowerCase()
  return TTS_FORMATS.has(format) ? format : ''
}

async function recordArtifact(params: {
  jobId: string
  agentId: string
  artifactType: 'image' | 'audio' | 'transcript'
  provider: string
  model: string
  operation: 'generate_image' | 'transcribe' | 'synthesize_speech'
  filePath: string | null
  fileName?: string | null
  mimeType?: string | null
  fileSizeBytes: number | null
  transcriptText?: string | null
  metadata: Record<string, unknown>
  costUsd: number | null
}): Promise<MediaArtifact> {
  const artifact = await insertMediaArtifact({
    job_id: params.jobId,
    agent_id: params.agentId,
    artifact_type: params.artifactType,
    provider: params.provider,
    model: params.model,
    operation: params.operation,
    file_path: params.filePath,
    file_name: params.fileName ?? fileNameFromPath(params.filePath),
    mime_type: params.mimeType ?? null,
    file_size_bytes: params.fileSizeBytes,
    transcript_text: params.transcriptText ?? null,
    metadata: JSON.stringify(params.metadata),
    cost_usd: params.costUsd,
  })
  return artifact
}

async function persistArtifactBlob(artifactId: string, buffer: Buffer): Promise<string> {
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  await insertMediaArtifactBlob({
    artifact_id: artifactId,
    blob_data: buffer,
    sha256,
  })
  return sha256
}

export const generateImageDefinition: Anthropic.Tool = {
  name: 'generate_image',
  description:
    'Generate an image from a text prompt and save it to your sprite filesystem. Returns the output file path.',
  input_schema: {
    type: 'object' as const,
    properties: {
      prompt: {
        type: 'string',
        description: 'Image prompt describing what to generate.',
      },
      size: {
        type: 'string',
        description: 'Optional size in WIDTHxHEIGHT format (for example: 1024x1024).',
      },
      model: {
        type: 'string',
        description: 'Optional OpenRouter image model override.',
      },
      output_path: {
        type: 'string',
        description:
          'Optional output path on sprite filesystem. Defaults to /tmp/media/images/generated-<timestamp>.png',
      },
    },
    required: ['prompt'],
  },
}

export const transcribeAudioDefinition: Anthropic.Tool = {
  name: 'transcribe_audio',
  description:
    'Transcribe an audio file from your sprite filesystem into text. Returns only the transcript.',
  input_schema: {
    type: 'object' as const,
    properties: {
      input_path: {
        type: 'string',
        description: 'Path to the audio file on sprite filesystem.',
      },
      model: {
        type: 'string',
        description: 'Optional OpenRouter model override for transcription.',
      },
      language: {
        type: 'string',
        description: 'Optional language hint (for example: en, es, fr).',
      },
    },
    required: ['input_path'],
  },
}

export const synthesizeSpeechDefinition: Anthropic.Tool = {
  name: 'synthesize_speech',
  description:
    'Synthesize speech audio from text and save it to your sprite filesystem. Requires text-to-speech capability API key.',
  input_schema: {
    type: 'object' as const,
    properties: {
      text: {
        type: 'string',
        description: 'Text to convert into speech audio.',
      },
      voice: {
        type: 'string',
        description: 'Provider voice name (for OpenAI, examples: alloy, aria, verse).',
      },
      model: {
        type: 'string',
        description: 'Optional TTS model override.',
      },
      format: {
        type: 'string',
        enum: ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'],
        description: 'Audio format for output file (default: mp3).',
      },
      output_path: {
        type: 'string',
        description:
          'Optional output path on sprite filesystem. Defaults to /tmp/media/audio/speech-<timestamp>.<format>',
      },
    },
    required: ['text', 'voice'],
  },
}

export const generateImageTool: ToolHandler = async (input, context) => {
  if (!context.jobId || !context.agentId) {
    return { success: false, error: 'Missing job or agent context for media receipts.' }
  }

  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  if (!prompt) return { success: false, error: 'prompt is required.' }

  const parsedSize = parseImageSize(input.size)
  if (parsedSize === '') {
    return { success: false, error: 'size must be WIDTHxHEIGHT (for example: 1024x1024).' }
  }

  const configuredModel = await getImageGenModel()
  const model =
    typeof input.model === 'string' && input.model.trim() ? input.model.trim() : configuredModel
  const requestPrompt = parsedSize ? `${prompt}\n\nImage size preference: ${parsedSize}.` : prompt

  const client = await getGatewayClient()
  const startedAt = Date.now()
  const response = await client.chat.completions.create({
    model,
    modalities: ['image', 'text'],
    messages: [{ role: 'user', content: requestPrompt }],
    ...openRouterTrace('image-generation'),
  } as never)
  const durationMs = Date.now() - startedAt

  const imageUrls = new Set<string>()
  collectDataUrls(response, imageUrls)
  const firstDataUrl = Array.from(imageUrls)[0]
  if (!firstDataUrl) {
    return { success: false, error: 'Provider did not return an image payload.' }
  }

  const parsedDataUrl = parseDataUrl(firstDataUrl)
  if (!parsedDataUrl) {
    return { success: false, error: 'Provider returned an invalid image payload.' }
  }

  const extension = extensionFromMimeType(parsedDataUrl.mimeType)
  const defaultPath = `/tmp/media/images/generated-${Date.now()}.${extension}`
  const outputPath = getOutputPath(input.output_path, defaultPath)

  await writeBinaryFile({
    spriteName: context.spriteName,
    outputPath,
    base64: parsedDataUrl.base64,
  })

  const imageBuffer = Buffer.from(parsedDataUrl.base64, 'base64')
  const imageBytes = imageBuffer.byteLength
  const usage = extractUsageMetrics(response)
  const artifact = await recordArtifact({
    jobId: context.jobId,
    agentId: context.agentId,
    artifactType: 'image',
    provider: 'openrouter',
    model,
    operation: 'generate_image',
    filePath: outputPath,
    fileName: fileNameFromPath(outputPath),
    mimeType: parsedDataUrl.mimeType,
    fileSizeBytes: imageBytes,
    metadata: {
      prompt,
      requested_size: parsedSize ?? null,
      mime_type: parsedDataUrl.mimeType,
    },
    costUsd: usage.costUsd,
  })
  const blobSha256 = await persistArtifactBlob(artifact.id, imageBuffer)
  const pricingStatus = usage.costUsd != null ? 'actual' : 'unknown'

  return {
    success: true,
    output: `Image generated at ${outputPath} (${(imageBytes / 1024).toFixed(1)} KB).`,
    _meta: {
      externalApiCost: {
        provider: 'openrouter',
        operation: 'generate_image',
        creditsUsed: usage.tokensUsed,
        costUsd: usage.costUsd,
        pricingStatus,
        pricingSource: usage.costUsd != null ? 'openrouter_usage' : 'openrouter_usage_missing',
        mediaArtifactId: artifact.id,
        durationMs,
        metadata: {
          model,
          size: parsedSize ?? null,
          outputPath,
          blobSha256,
          receiptStorageBackend: MEDIA_BINARY_RECEIPT_STORAGE_BACKEND,
        },
      },
    },
  }
}

export const transcribeAudioTool: ToolHandler = async (input, context) => {
  if (!context.jobId || !context.agentId) {
    return { success: false, error: 'Missing job or agent context for media receipts.' }
  }

  const inputPath = typeof input.input_path === 'string' ? input.input_path.trim() : ''
  if (!inputPath) return { success: false, error: 'input_path is required.' }

  const configuredModel = await getSTTModel()
  const model =
    typeof input.model === 'string' && input.model.trim() ? input.model.trim() : configuredModel
  const language =
    typeof input.language === 'string' && input.language.trim() ? input.language.trim() : null

  const readResult = await spriteExec(context.spriteName, `base64 -w0 ${shellQuote(inputPath)}`, {
    session: context.session,
  })
  if (readResult.exitCode !== 0) {
    return {
      success: false,
      error: `Failed to read audio file: ${readResult.stderr || 'unknown error'}`,
    }
  }

  const audioBase64 = readResult.stdout.trim()
  if (!audioBase64) {
    return { success: false, error: 'Audio file is empty or unreadable.' }
  }

  const audioFormat = inferAudioFormat(inputPath)
  const instruction = language
    ? `Transcribe this audio accurately. Language hint: ${language}. Return only the transcript.`
    : 'Transcribe this audio accurately. Return only the transcript.'

  const client = await getGatewayClient()
  const startedAt = Date.now()
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          { type: 'input_audio', input_audio: { data: audioBase64, format: audioFormat } },
        ],
      },
    ],
    ...openRouterTrace('transcription'),
  } as never)
  const durationMs = Date.now() - startedAt

  const transcript = extractTextFromResponse(response)
  if (!transcript) {
    return { success: false, error: 'Transcription model returned no transcript.' }
  }

  const usage = extractUsageMetrics(response)
  const audioBytes = Buffer.from(audioBase64, 'base64').byteLength

  const artifact = await recordArtifact({
    jobId: context.jobId,
    agentId: context.agentId,
    artifactType: 'transcript',
    provider: 'openrouter',
    model,
    operation: 'transcribe',
    filePath: null,
    fileSizeBytes: null,
    transcriptText: transcript,
    metadata: {
      input_path: inputPath,
      input_size_bytes: audioBytes,
      format: audioFormat,
      language_hint: language,
      transcript_chars: transcript.length,
    },
    costUsd: usage.costUsd,
  })
  const pricingStatus = usage.costUsd != null ? 'actual' : 'unknown'

  return {
    success: true,
    output: transcript,
    _meta: {
      externalApiCost: {
        provider: 'openrouter',
        operation: 'transcribe',
        creditsUsed: usage.tokensUsed,
        costUsd: usage.costUsd,
        pricingStatus,
        pricingSource: usage.costUsd != null ? 'openrouter_usage' : 'openrouter_usage_missing',
        mediaArtifactId: artifact.id,
        durationMs,
        metadata: {
          model,
          inputPath,
          language,
        },
      },
    },
  }
}

export const synthesizeSpeechTool: ToolHandler = async (input, context) => {
  if (!context.jobId || !context.agentId) {
    return { success: false, error: 'Missing job or agent context for media receipts.' }
  }

  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (!text) return { success: false, error: 'text is required.' }

  const voice = typeof input.voice === 'string' ? input.voice.trim() : ''
  if (!voice) return { success: false, error: 'voice is required.' }

  const parsedFormat = parseTTSFormat(input.format)
  if (parsedFormat === '') {
    return {
      success: false,
      error: 'format must be one of: mp3, wav, opus, aac, flac, pcm.',
    }
  }

  const format = parsedFormat || 'mp3'
  const configuredModel = await getTTSModel()
  const model =
    typeof input.model === 'string' && input.model.trim() ? input.model.trim() : configuredModel
  const provider = await getTTSProvider()

  if (provider !== 'openai') {
    return { success: false, error: `Unsupported TTS provider: ${provider}` }
  }

  const ttsSettings = await getTTSSettings()
  if (!ttsSettings.enabled) {
    return { success: false, error: 'Text-to-speech capability is disabled in settings.' }
  }
  if (!ttsSettings.apiKey) {
    return { success: false, error: 'Text-to-speech API key is not configured.' }
  }

  const startedAt = Date.now()
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ttsSettings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      response_format: format,
    }),
  })
  const durationMs = Date.now() - startedAt

  if (!response.ok) {
    const body = await response.text()
    return {
      success: false,
      error: `TTS provider request failed (${response.status}): ${body.slice(0, 300)}`,
    }
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer())
  const defaultPath = `/tmp/media/audio/speech-${Date.now()}.${extensionFromTTSFormat(format)}`
  const outputPath = getOutputPath(input.output_path, defaultPath)

  await writeBinaryFile({
    spriteName: context.spriteName,
    outputPath,
    base64: audioBuffer.toString('base64'),
  })

  let estimatedCostUsd: number | null = null
  let pricingStatus: 'actual' | 'estimated' | 'unknown' = 'unknown'
  let pricingSource: string | null = null
  if (ttsSettings.costPer1kCharsUsd != null) {
    estimatedCostUsd = (text.length / 1000) * ttsSettings.costPer1kCharsUsd
    pricingStatus = 'estimated'
    pricingSource = 'tts_config_per_1k_chars'
  }

  const artifact = await recordArtifact({
    jobId: context.jobId,
    agentId: context.agentId,
    artifactType: 'audio',
    provider: 'openai',
    model,
    operation: 'synthesize_speech',
    filePath: outputPath,
    fileName: fileNameFromPath(outputPath),
    mimeType: mimeTypeFromTTSFormat(format),
    fileSizeBytes: audioBuffer.byteLength,
    metadata: {
      voice,
      format,
      text_chars: text.length,
      estimated_cost_per_1k_chars_usd: ttsSettings.costPer1kCharsUsd,
    },
    costUsd: estimatedCostUsd,
  })
  const blobSha256 = await persistArtifactBlob(artifact.id, audioBuffer)

  return {
    success: true,
    output: `Audio synthesized at ${outputPath} (${(audioBuffer.byteLength / 1024).toFixed(1)} KB).`,
    _meta: {
      externalApiCost: {
        provider: 'openai',
        operation: 'synthesize_speech',
        creditsUsed: text.length,
        costUsd: estimatedCostUsd,
        pricingStatus,
        pricingSource,
        mediaArtifactId: artifact.id,
        durationMs,
        metadata: {
          model,
          voice,
          format,
          estimated: pricingStatus === 'estimated',
          blobSha256,
          receiptStorageBackend: MEDIA_BINARY_RECEIPT_STORAGE_BACKEND,
        },
      },
    },
  }
}
