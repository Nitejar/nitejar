import type Anthropic from '@anthropic-ai/sdk'
import { listDir, mkdir, readFile, writeFile } from '@nitejar/sprites'
import {
  createLineHashTag,
  formatFileContent,
  formatFileContentWithHashes,
  generateUnifiedDiff,
  sanitizeFileWriteContent,
} from '../helpers'
import type { ToolHandler } from '../types'

export const filesystemDefinitions: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description:
      'Read the contents of a file on the sprite. Returns content with line numbers (e.g., "1: content"). Use start_line and max_lines to read specific sections of large files.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to read',
        },
        start_line: {
          type: 'integer',
          description: 'Line number to start reading from (1-indexed, default: 1)',
        },
        max_lines: {
          type: 'integer',
          description:
            'Maximum number of lines to return (default: 500). Use this to prevent context overflow on large files.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file on the sprite. Creates the file if it does not exist.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to write',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List the contents of a directory on the sprite.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The path to the directory to list',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a directory on the sprite. Creates parent directories if needed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The path to the directory to create',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Make a surgical edit to a file by replacing a specific string. The old_string must be unique in the file (appears exactly once) unless replace_all is true. Returns a diff showing what changed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to edit',
        },
        old_string: {
          type: 'string',
          description:
            'The exact string to find and replace. Must be unique in the file unless replace_all is true.',
        },
        new_string: {
          type: 'string',
          description: 'The string to replace old_string with',
        },
        replace_all: {
          type: 'boolean',
          description:
            'If true, replace all occurrences of old_string. If false (default), old_string must appear exactly once.',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'use_skill',
    description:
      'Look up a skill by name and get its location and file listing. For sandbox-installed skills, returns the path to the skill directory in /home/sprite/.skills/. For project skills, returns the path in the project tree. Use read_file to load the SKILL.md and any supporting files you need.',
    input_schema: {
      type: 'object' as const,
      properties: {
        skill_name: {
          type: 'string',
          description: 'The name of the skill to load (case-insensitive).',
        },
      },
      required: ['skill_name'],
    },
  },
]

export const hashlineReadFileDefinition: Anthropic.Tool = {
  name: 'read_file',
  description:
    'Read file contents with stable hashline anchors per line. Output format is "<line>:<hash>|<content>" (example: "12:a1b|const x = 1"). Use these hashes in edit_file operations. Use start_line and max_lines for large files.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to read',
      },
      start_line: {
        type: 'integer',
        description: 'Line number to start reading from (1-indexed, default: 1)',
      },
      max_lines: {
        type: 'integer',
        description:
          'Maximum number of lines to return (default: 500). Use this to prevent context overflow on large files.',
      },
    },
    required: ['path'],
  },
}

export const hashlineEditFileDefinition: Anthropic.Tool = {
  name: 'edit_file',
  description:
    'Edit a file using hashline anchors from read_file. Pass an edits array with operations: replace_line, delete_line, insert_after, or replace_range. Each operation must include line hash anchors. If hashes do not match current file content, the edit is rejected.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to edit',
      },
      edits: {
        type: 'array',
        description: 'Anchor-based edit operations to apply. Prefer non-overlapping operations.',
        items: {
          type: 'object',
          description:
            'One edit operation: replace_line, delete_line, insert_after, or replace_range.',
          properties: {
            type: {
              type: 'string',
              enum: ['replace_line', 'delete_line', 'insert_after', 'replace_range'],
              description: 'Operation type.',
            },
            line: {
              type: 'integer',
              description: '1-indexed line number for replace_line/delete_line/insert_after.',
            },
            hash: {
              type: 'string',
              description: 'Hash anchor for replace_line/delete_line/insert_after.',
            },
            content: {
              type: 'string',
              description:
                'New content for replace_line/insert_after/replace_range. May contain newlines.',
            },
            start_line: {
              type: 'integer',
              description: 'Start line for replace_range (1-indexed).',
            },
            start_hash: {
              type: 'string',
              description: 'Start hash anchor for replace_range.',
            },
            end_line: {
              type: 'integer',
              description: 'End line for replace_range (1-indexed).',
            },
            end_hash: {
              type: 'string',
              description: 'End hash anchor for replace_range.',
            },
          },
          required: ['type'],
        },
      },
    },
    required: ['path', 'edits'],
  },
}

export const readFileTool: ToolHandler = async (input, context) => {
  const path = input.path as string
  const startLine = (input.start_line as number) || 1
  const maxLines = (input.max_lines as number) || 500

  const content = await readFile(context.spriteName, path)
  const mode = context.editToolMode ?? 'hashline'
  const formattedOutput =
    mode === 'replace'
      ? formatFileContent(content, startLine, maxLines)
      : formatFileContentWithHashes(content, startLine, maxLines)
  return { success: true, output: formattedOutput }
}

export const writeFileTool: ToolHandler = async (input, context) => {
  const path = input.path as string
  const content = input.content as string
  const { sanitizedContent, removedCount } = sanitizeFileWriteContent(content)
  await writeFile(context.spriteName, path, sanitizedContent)
  return {
    success: true,
    output:
      `Wrote ${sanitizedContent.length} bytes to ${path}` +
      (removedCount > 0
        ? ` (removed ${removedCount} control character${removedCount === 1 ? '' : 's'})`
        : ''),
  }
}

export const listDirectoryTool: ToolHandler = async (input, context) => {
  const path = input.path as string
  const entries = await listDir(context.spriteName, path)
  return { success: true, output: entries.join('\n') }
}

export const createDirectoryTool: ToolHandler = async (input, context) => {
  const path = input.path as string
  await mkdir(context.spriteName, path)
  return { success: true, output: `Created directory ${path}` }
}

export const editFileTool: ToolHandler = async (input, context) => {
  if ((context.editToolMode ?? 'hashline') === 'replace') {
    return editFileWithReplace(input, context)
  }

  return editFileWithHashline(input, context)
}

const HASH_TAG_REGEX = /^[a-z0-9]{2,3}$/

type HashlineOperation =
  | {
      type: 'replace_line'
      line: number
      hash: string
      content: string
    }
  | {
      type: 'delete_line'
      line: number
      hash: string
    }
  | {
      type: 'insert_after'
      line: number
      hash: string
      content: string
    }
  | {
      type: 'replace_range'
      start_line: number
      start_hash: string
      end_line: number
      end_hash: string
      content: string
    }

type NormalizedHashlineOperation =
  | {
      kind: 'replace_line'
      order: number
      index: number
      contentLines: string[]
    }
  | {
      kind: 'delete_line'
      order: number
      index: number
    }
  | {
      kind: 'insert_after'
      order: number
      index: number
      contentLines: string[]
    }
  | {
      kind: 'replace_range'
      order: number
      startIndex: number
      endIndex: number
      contentLines: string[]
    }

function parseHashlineOperation(input: unknown): HashlineOperation | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  if (value.type === 'replace_line') {
    if (
      typeof value.line === 'number' &&
      typeof value.hash === 'string' &&
      typeof value.content === 'string'
    ) {
      return {
        type: 'replace_line',
        line: value.line,
        hash: value.hash,
        content: value.content,
      }
    }
    return null
  }
  if (value.type === 'delete_line') {
    if (typeof value.line === 'number' && typeof value.hash === 'string') {
      return {
        type: 'delete_line',
        line: value.line,
        hash: value.hash,
      }
    }
    return null
  }
  if (value.type === 'insert_after') {
    if (
      typeof value.line === 'number' &&
      typeof value.hash === 'string' &&
      typeof value.content === 'string'
    ) {
      return {
        type: 'insert_after',
        line: value.line,
        hash: value.hash,
        content: value.content,
      }
    }
    return null
  }
  if (value.type === 'replace_range') {
    if (
      typeof value.start_line === 'number' &&
      typeof value.start_hash === 'string' &&
      typeof value.end_line === 'number' &&
      typeof value.end_hash === 'string' &&
      typeof value.content === 'string'
    ) {
      return {
        type: 'replace_range',
        start_line: value.start_line,
        start_hash: value.start_hash,
        end_line: value.end_line,
        end_hash: value.end_hash,
        content: value.content,
      }
    }
    return null
  }

  return null
}

function validateHashlineAnchor(
  lines: string[],
  lineNumber: number,
  hash: string,
  label: string
): { ok: true; index: number } | { ok: false; error: string; hashMismatch: boolean } {
  if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lines.length) {
    return {
      ok: false,
      error: `${label} line ${lineNumber} is out of bounds. File has ${lines.length} lines.`,
      hashMismatch: false,
    }
  }
  if (!HASH_TAG_REGEX.test(hash)) {
    return {
      ok: false,
      error: `${label} hash "${hash}" is invalid. Expected a 2-3 char lowercase base36 hash.`,
      hashMismatch: false,
    }
  }

  const index = lineNumber - 1
  const expected = hash
  const actual = createLineHashTag(lines[index] ?? '')
  if (actual !== expected) {
    return {
      ok: false,
      error: `Hash mismatch at ${label} line ${lineNumber}: expected ${expected}, found ${actual}. Re-read the file before editing.`,
      hashMismatch: true,
    }
  }

  return { ok: true, index }
}

function normalizeHashlineOperations(
  lines: string[],
  rawOps: unknown[]
):
  | { ok: true; operations: NormalizedHashlineOperation[] }
  | { ok: false; error: string; hashMismatch: boolean } {
  const operations: NormalizedHashlineOperation[] = []

  for (const [order, raw] of rawOps.entries()) {
    const op = parseHashlineOperation(raw)
    if (!op) {
      return {
        ok: false,
        error:
          `Invalid edits[${order}] operation. Expected one of ` +
          `"replace_line", "delete_line", "insert_after", or "replace_range".`,
        hashMismatch: false,
      }
    }

    if (op.type === 'replace_line') {
      const anchor = validateHashlineAnchor(lines, op.line, op.hash, 'replace')
      if (!anchor.ok) return anchor
      operations.push({
        kind: 'replace_line',
        order,
        index: anchor.index,
        contentLines: op.content.split('\n'),
      })
      continue
    }

    if (op.type === 'delete_line') {
      const anchor = validateHashlineAnchor(lines, op.line, op.hash, 'delete')
      if (!anchor.ok) return anchor
      operations.push({
        kind: 'delete_line',
        order,
        index: anchor.index,
      })
      continue
    }

    if (op.type === 'insert_after') {
      const anchor = validateHashlineAnchor(lines, op.line, op.hash, 'insert')
      if (!anchor.ok) return anchor
      operations.push({
        kind: 'insert_after',
        order,
        index: anchor.index,
        contentLines: op.content.split('\n'),
      })
      continue
    }

    const startAnchor = validateHashlineAnchor(lines, op.start_line, op.start_hash, 'range start')
    if (!startAnchor.ok) return startAnchor
    const endAnchor = validateHashlineAnchor(lines, op.end_line, op.end_hash, 'range end')
    if (!endAnchor.ok) return endAnchor
    if (startAnchor.index > endAnchor.index) {
      return {
        ok: false,
        error: `Invalid replace_range in edits[${order}]: start_line must be <= end_line.`,
        hashMismatch: false,
      }
    }
    operations.push({
      kind: 'replace_range',
      order,
      startIndex: startAnchor.index,
      endIndex: endAnchor.index,
      contentLines: op.content.split('\n'),
    })
  }

  const occupiedRanges = operations
    .filter((op) => op.kind !== 'insert_after')
    .map((op) => {
      if (op.kind === 'replace_range') {
        return { start: op.startIndex, end: op.endIndex, order: op.order }
      }
      return { start: op.index, end: op.index, order: op.order }
    })
    .sort((a, b) => a.start - b.start || a.end - b.end)

  for (let i = 1; i < occupiedRanges.length; i++) {
    const prev = occupiedRanges[i - 1]
    const curr = occupiedRanges[i]
    if (!prev || !curr) continue
    if (curr.start <= prev.end) {
      return {
        ok: false,
        error:
          `Overlapping edits are not allowed (edits[${prev.order}] overlaps edits[${curr.order}]). ` +
          `Split these into separate edit_file calls.`,
        hashMismatch: false,
      }
    }
  }

  return { ok: true, operations }
}

function applyHashlineOperations(
  lines: string[],
  operations: NormalizedHashlineOperation[]
): string[] {
  const next = [...lines]
  const sorted = [...operations].sort((a, b) => {
    const aIndex = a.kind === 'replace_range' ? a.startIndex : a.index
    const bIndex = b.kind === 'replace_range' ? b.startIndex : b.index
    if (aIndex !== bIndex) return bIndex - aIndex
    return b.order - a.order
  })

  for (const op of sorted) {
    if (op.kind === 'replace_line') {
      next.splice(op.index, 1, ...op.contentLines)
      continue
    }
    if (op.kind === 'delete_line') {
      next.splice(op.index, 1)
      continue
    }
    if (op.kind === 'insert_after') {
      next.splice(op.index + 1, 0, ...op.contentLines)
      continue
    }
    next.splice(op.startIndex, op.endIndex - op.startIndex + 1, ...op.contentLines)
  }

  return next
}

async function editFileWithHashline(
  input: Record<string, unknown>,
  context: Parameters<ToolHandler>[1]
) {
  const path = input.path as string
  const rawEdits = input.edits

  if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
    return {
      success: false,
      error:
        'Hashline mode requires an "edits" array. Read the file first and anchor edits using line hashes.',
      _meta: { editOperation: 'unknown' },
    }
  }

  const oldContent = await readFile(context.spriteName, path)
  const oldLines = oldContent.split('\n')
  const normalized = normalizeHashlineOperations(oldLines, rawEdits)

  if (!normalized.ok) {
    return {
      success: false,
      error: normalized.error,
      _meta: {
        editOperation: rawEdits.length > 1 ? 'batch' : 'hashline',
        hashMismatch: normalized.hashMismatch,
      },
    }
  }

  const newLines = applyHashlineOperations(oldLines, normalized.operations)
  const newContent = newLines.join('\n')
  const { sanitizedContent, removedCount } = sanitizeFileWriteContent(newContent)
  await writeFile(context.spriteName, path, sanitizedContent)
  const diff = generateUnifiedDiff(path, oldContent, sanitizedContent)

  const editOperation =
    normalized.operations.length === 1 ? normalized.operations[0]!.kind : 'batch'

  return {
    success: true,
    output:
      `File edited successfully.` +
      (removedCount > 0
        ? ` Removed ${removedCount} control character${removedCount === 1 ? '' : 's'} from the final content.`
        : '') +
      `\n\n${diff}`,
    _meta: { editOperation },
  }
}

async function editFileWithReplace(
  input: Record<string, unknown>,
  context: Parameters<ToolHandler>[1]
) {
  const path = input.path as string
  const oldString = input.old_string as string
  const newString = input.new_string as string
  const replaceAll = (input.replace_all as boolean) || false

  // Read current content
  const oldContent = await readFile(context.spriteName, path)

  // Count occurrences
  const occurrences = oldContent.split(oldString).length - 1
  if (occurrences === 0) {
    return {
      success: false,
      error: `old_string not found in ${path}. Make sure you have the exact string including whitespace.`,
      _meta: { editOperation: 'replace_string' },
    }
  }

  if (occurrences > 1 && !replaceAll) {
    return {
      success: false,
      error: `old_string appears ${occurrences} times in ${path}. Include more context to make it unique, or set replace_all=true.`,
      _meta: { editOperation: 'replace_string' },
    }
  }

  // Perform replacement
  const newContent = replaceAll
    ? oldContent.split(oldString).join(newString)
    : oldContent.replace(oldString, newString)
  const { sanitizedContent, removedCount } = sanitizeFileWriteContent(newContent)

  // Write updated content
  await writeFile(context.spriteName, path, sanitizedContent)

  // Generate diff
  const diff = generateUnifiedDiff(path, oldContent, sanitizedContent)

  return {
    success: true,
    output:
      `File edited successfully.` +
      (removedCount > 0
        ? ` Removed ${removedCount} control character${removedCount === 1 ? '' : 's'} from the final content.`
        : '') +
      `\n\n${diff}`,
    _meta: { editOperation: 'replace_string' },
  }
}

export const useSkillTool: ToolHandler = async (input, context) => {
  const skillName = typeof input.skill_name === 'string' ? input.skill_name.trim() : ''
  if (!skillName) {
    return { success: false, error: 'skill_name is required.' }
  }

  const repoSkills = context.discoveredSkills ?? []
  const dbSkills = context.resolvedDbSkills ?? []

  if (repoSkills.length === 0 && dbSkills.length === 0) {
    return {
      success: false,
      error:
        'No skills available. Skills can be installed by an admin from the skill catalog, contributed by plugins, or discovered from SKILL.md files in project repos.',
    }
  }

  const lower = skillName.toLowerCase()

  // First check DB/plugin skills (higher priority)
  const dbMatch = dbSkills.find(
    (s) => s.id.toLowerCase() === lower || s.name.toLowerCase() === lower
  )
  if (dbMatch) {
    const lines: string[] = []
    lines.push(`Skill: ${dbMatch.name}`)

    if (dbMatch.sandboxPath) {
      lines.push(`Location: ${dbMatch.sandboxPath}/`)
      lines.push(`Entrypoint: ${dbMatch.sandboxPath}/SKILL.md`)
    } else if (dbMatch.absolutePath) {
      lines.push(`Location: ${dbMatch.absolutePath}`)
    }

    lines.push('')
    lines.push('Files:')
    lines.push('  SKILL.md (entrypoint)')
    if (dbMatch.supportingFiles) {
      for (const f of dbMatch.supportingFiles) {
        lines.push(`  ${f.relativePath}`)
      }
    }

    lines.push('')
    lines.push('Use read_file to load the SKILL.md for full instructions.')

    return { success: true, output: lines.join('\n') }
  }

  // Fall back to repo skills
  const repoMatch = repoSkills.find((s) => s.name.toLowerCase() === lower)
  if (repoMatch) {
    const content = await readFile(context.spriteName, repoMatch.absolutePath)
    const lines: string[] = []
    lines.push(`Skill: ${repoMatch.name}`)
    lines.push(`Location: ${repoMatch.absolutePath}`)
    lines.push(`Source: project repo`)
    lines.push('')
    lines.push(content)
    return { success: true, output: lines.join('\n') }
  }

  const allNames = [...dbSkills.map((s) => s.name), ...repoSkills.map((s) => s.name)]
  return {
    success: false,
    error: `Skill "${skillName}" not found. Available skills: ${allNames.join(', ')}`,
  }
}
