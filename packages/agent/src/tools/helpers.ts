import { createTwoFilesPatch } from 'diff'
import { spriteExec, type ExecResult } from '@nitejar/sprites'
import { parsePositiveIntEnv } from '../message-utils'
import type { ToolContext, ToolResult } from './types'

const DEFAULT_EXEC_STREAM_MAX_CHARS = 40_000

const EXEC_STREAM_MAX_CHARS = parsePositiveIntEnv(
  'AGENT_EXEC_STREAM_MAX_CHARS',
  DEFAULT_EXEC_STREAM_MAX_CHARS
)

// Strip non-printable control bytes that can corrupt source files (e.g. SOH \x01).
// eslint-disable-next-line no-control-regex
const INVALID_FILE_CONTROL_CHARS_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export const CWD_MARKER = '__SLOPBOT_CWD__'

export function sanitizeFileWriteContent(content: string): {
  sanitizedContent: string
  removedCount: number
} {
  let removedCount = 0
  const sanitizedContent = content.replace(INVALID_FILE_CONTROL_CHARS_REGEX, () => {
    removedCount += 1
    return ''
  })
  return { sanitizedContent, removedCount }
}

function truncateExecStream(text: string, label: 'stdout' | 'stderr'): string {
  if (text.length <= EXEC_STREAM_MAX_CHARS) return text

  const notice = `[${label} truncated: omitted ${(text.length - EXEC_STREAM_MAX_CHARS).toLocaleString()} chars]`
  const head = Math.floor(EXEC_STREAM_MAX_CHARS * 0.75)
  const tail = EXEC_STREAM_MAX_CHARS - head
  return `${text.slice(0, head)}\n${notice}\n${text.slice(text.length - tail)}`
}

function formatExecResult(result: ExecResult): ToolResult {
  const stdout = result.stdout ? truncateExecStream(result.stdout, 'stdout') : ''
  const stderr = result.stderr ? truncateExecStream(result.stderr, 'stderr') : ''

  const output = [
    stdout && `stdout:\n${stdout}`,
    stderr && `stderr:\n${stderr}`,
    `exit code: ${result.exitCode}`,
    `duration: ${result.duration}ms`,
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    success: result.exitCode === 0,
    output,
    error: result.exitCode !== 0 ? `Command failed with exit code ${result.exitCode}` : undefined,
  }
}

/**
 * Format an exec result while extracting the CWD marker from stdout.
 * Strips the marker line so the model never sees it, and populates `_meta.cwd`.
 */
export function formatExecResultWithCwd(result: ExecResult): ToolResult {
  let rawStdout = result.stdout ?? ''
  let cwd: string | undefined

  const markerIdx = rawStdout.lastIndexOf(CWD_MARKER)
  if (markerIdx !== -1) {
    const afterMarker = rawStdout.slice(markerIdx + CWD_MARKER.length)
    // The path is everything until the next newline (or end of string)
    const newlineIdx = afterMarker.indexOf('\n')
    cwd = (newlineIdx === -1 ? afterMarker : afterMarker.slice(0, newlineIdx)).trim() || undefined
    // Strip the marker line from stdout
    // Find the start of the marker line (after the preceding newline)
    const lineStart = rawStdout.lastIndexOf('\n', markerIdx)
    rawStdout = rawStdout.slice(0, lineStart === -1 ? markerIdx : lineStart).trimEnd()
  }

  // Strip any remaining CWD plumbing leaked via TTY command echo.
  // The terminal may echo the command text (e.g. `__nitejar_ec=$?; echo "..."`)
  // before execution. Filter out lines containing our internal markers.
  rawStdout = rawStdout
    .split('\n')
    .filter((line) => !line.includes(CWD_MARKER) && !line.includes('__nitejar_ec'))
    .join('\n')

  const base = formatExecResult({ ...result, stdout: rawStdout })
  const meta: NonNullable<ToolResult['_meta']> = {}
  if (cwd) {
    meta.cwd = cwd
  }
  // Tag session-level failures using the raw stderr before it gets formatted.
  // The @fly/sprites SDK emits errors like "WebSocket error" and
  // "WebSocket keepalive timeout" when the session connection fails.
  // "Timeout connecting to session" comes from our own reconnection logic.
  // "before start marker was observed" means the shell never began the
  // wrapped command, which usually indicates a wedged/busy session.
  const stderr = result.stderr ?? ''
  if (stderr.includes('Session reset after timeout to avoid a wedged shell.')) {
    meta.sessionInvalidated = true
  }
  if (
    result.exitCode !== 0 &&
    (stderr.startsWith('WebSocket') ||
      stderr === 'Timeout connecting to session' ||
      stderr === 'Session is closed' ||
      stderr.includes('before start marker was observed'))
  ) {
    meta.sessionError = true
  }
  if (Object.keys(meta).length > 0) {
    base._meta = meta
  }
  return base
}

export async function runSpriteCommand(
  context: ToolContext,
  command: string,
  cwd?: string
): Promise<void> {
  const result = await spriteExec(context.spriteName, command, {
    cwd: cwd ?? context.cwd,
    session: context.session,
  })

  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${command}`)
  }
}

/**
 * Format file content with line numbers and optional truncation
 * Output format matches Anthropic's text editor tool: "1: content"
 */
export function formatFileContent(content: string, startLine: number, maxLines: number): string {
  return formatFileContentWithPrefix(
    content,
    startLine,
    maxLines,
    (line, lineNum) => `${lineNum}: ${line}`
  )
}

export function createLineHashTag(line: string): string {
  // FNV-1a 32-bit hash; compact to three base36 chars for short stable anchors.
  let hash = 2166136261
  for (let i = 0; i < line.length; i++) {
    hash ^= line.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  const token = (hash >>> 0).toString(36)
  return token.padStart(3, '0').slice(0, 3)
}

export function formatFileContentWithHashes(
  content: string,
  startLine: number,
  maxLines: number
): string {
  return formatFileContentWithPrefix(
    content,
    startLine,
    maxLines,
    (line, lineNum) => `${lineNum}:${createLineHashTag(line)}|${line}`
  )
}

function formatFileContentWithPrefix(
  content: string,
  startLine: number,
  maxLines: number,
  renderLine: (line: string, lineNumber: number) => string
): string {
  const lines = content.split('\n')
  const totalLines = lines.length

  // Adjust startLine to be 1-indexed and within bounds
  const start = Math.max(1, Math.min(startLine, totalLines))
  const startIndex = start - 1

  // Calculate end index
  const endIndex = Math.min(startIndex + maxLines, totalLines)
  const selectedLines = lines.slice(startIndex, endIndex)

  // Format each line with line numbers
  const formattedLines = selectedLines.map((line, idx) => {
    const lineNum = start + idx
    return renderLine(line, lineNum)
  })

  // Check if content was truncated
  const wasTruncated = endIndex < totalLines
  const hasMoreBefore = startIndex > 0

  // Build output
  const parts: string[] = []

  if (hasMoreBefore) {
    parts.push(`... [Lines 1-${start - 1} omitted]`)
  }

  parts.push(formattedLines.join('\n'))

  if (wasTruncated) {
    const remainingLines = totalLines - endIndex
    parts.push(`... [Truncated. ${remainingLines} more lines. File has ${totalLines} total lines]`)
  }

  return parts.join('\n')
}

/**
 * Generate a unified diff between old and new content
 */
export function generateUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string
): string {
  return createTwoFilesPatch(filePath, filePath, oldContent, newContent, 'original', 'modified', {
    context: 3,
  })
}

export function guessExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/mp4': '.m4a',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'application/zip': '.zip',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/json': '.json',
  }
  return map[mimeType] || ''
}
