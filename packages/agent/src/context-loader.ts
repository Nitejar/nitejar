import { spriteExec, type ISpriteSession } from '@nitejar/sprites'
import type { SkillEntry } from './tools'
import { sanitize, wrapBoundary } from './prompt-sanitize'

/** Result of scanning a directory for context files */
export interface DirectoryContext {
  cwd: string
  /** Concatenated instruction content from AGENTS.md / .nitejar.md files (root-first) */
  instructions: string | null
  /** SKILL.md files discovered within the directory tree */
  skills: SkillEntry[]
}

/** Delimiter used in the batched shell output to separate instruction files */
const INSTRUCTION_DELIM = '___SLOPBOT_INSTR___'
/** Delimiter used in the batched shell output to separate the skills section */
const SKILL_SECTION_DELIM = '___SLOPBOT_SKILLS___'
/** Delimiter used between individual skill file outputs */
const SKILL_FILE_DELIM = '___SLOPBOT_SKILL_FILE___'

/** Conventional directories where SKILL.md files may live (relative to a project root) */
const SKILL_GLOBS = ['skills/*/SKILL.md', '.agents/skills/*/SKILL.md']

/**
 * Build a single shell command that walks from cwd upward to /home/sprite.
 * At each directory it collects:
 * 1. AGENTS.md and .nitejar.md instruction files
 * 2. SKILL.md files in conventional skill directories
 */
function buildScanCommand(cwd: string): string {
  // Build the glob patterns for skill discovery at each directory level
  const skillGlobChecks = SKILL_GLOBS.map(
    (glob) =>
      `  for _sf in "$_dir"/${glob}; do\n` +
      `    [ -f "$_sf" ] || continue\n` +
      `    echo "${SKILL_FILE_DELIM}$_sf"\n` +
      `    head -50 "$_sf"\n` +
      `  done`
  ).join('\n')

  return [
    `_dir="${cwd}"`,
    `while true; do`,
    `  for _f in "$_dir/AGENTS.md" "$_dir/.nitejar.md"; do`,
    `    if [ -f "$_f" ]; then`,
    `      echo "${INSTRUCTION_DELIM}$_f"`,
    `      cat "$_f"`,
    `    fi`,
    `  done`,
    skillGlobChecks,
    `  [ "$_dir" = "/home/sprite" ] && break`,
    `  _parent=$(dirname "$_dir")`,
    `  [ "$_parent" = "$_dir" ] && break`,
    `  _dir="$_parent"`,
    `done`,
    `echo "${SKILL_SECTION_DELIM}"`,
  ].join('\n')
}

/**
 * Parse the instruction files from the scan output.
 * Instructions and skills are interleaved during the upward walk, so each
 * instruction part is truncated at the first non-instruction delimiter.
 * Returns content in root-first order (reversed from the walk order).
 */
export function parseInstructionFiles(stdout: string): string | null {
  const parts = stdout.split(INSTRUCTION_DELIM).slice(1) // skip pre-delimiter content
  if (parts.length === 0) return null

  // Each part starts with the file path on the first line, then content.
  // Truncate at any skill or end-of-section delimiter that may follow.
  const files: { path: string; content: string }[] = []
  for (let part of parts) {
    for (const delim of [SKILL_FILE_DELIM, SKILL_SECTION_DELIM]) {
      const idx = part.indexOf(delim)
      if (idx !== -1) part = part.slice(0, idx)
    }

    const newlineIdx = part.indexOf('\n')
    if (newlineIdx === -1) continue
    const path = part.slice(0, newlineIdx).trim()
    const content = part.slice(newlineIdx + 1).trim()
    if (path && content) {
      files.push({ path, content })
    }
  }

  if (files.length === 0) return null

  // Reverse to root-first order (walk goes child → parent, we want parent → child)
  files.reverse()

  return files.map((f) => `# From ${f.path}\n\n${f.content}`).join('\n\n---\n\n')
}

/**
 * Parse SKILL.md frontmatter to extract name and description.
 * Supports simple YAML-style frontmatter between --- delimiters.
 */
function parseFrontmatter(text: string): { name?: string; description?: string } {
  const result: { name?: string; description?: string } = {}

  // Check for YAML frontmatter (--- delimited)
  const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!fmMatch) return result

  const fm = fmMatch[1]!
  const nameMatch = fm.match(/^name:\s*(.+)$/m)
  const descMatch = fm.match(/^description:\s*(.+)$/m)

  if (nameMatch) result.name = nameMatch[1]!.trim().replace(/^["']|["']$/g, '')
  if (descMatch) result.description = descMatch[1]!.trim().replace(/^["']|["']$/g, '')

  return result
}

/**
 * Parse skill files from scan output.
 * Skills are interleaved with instructions during the upward walk, so we
 * split on SKILL_FILE_DELIM across the entire output and truncate each
 * entry at the next non-skill delimiter.
 * Returns SkillEntry[] with name, description, path, and absolutePath.
 */
export function parseSkillFiles(cwd: string, stdout: string): SkillEntry[] {
  // Split on SKILL_FILE_DELIM; first element is pre-delimiter content, skip it
  const parts = stdout.split(SKILL_FILE_DELIM).slice(1)
  if (parts.length === 0) return []

  const skills: SkillEntry[] = []
  for (let part of parts) {
    // Truncate at any instruction or end-of-section delimiter that may follow
    for (const delim of [INSTRUCTION_DELIM, SKILL_SECTION_DELIM]) {
      const idx = part.indexOf(delim)
      if (idx !== -1) part = part.slice(0, idx)
    }

    const newlineIdx = part.indexOf('\n')
    if (newlineIdx === -1) continue
    const absolutePath = part.slice(0, newlineIdx).trim()
    const content = part.slice(newlineIdx + 1)
    if (!absolutePath) continue
    // Skip command echo fragments — real skill paths are absolute and end with SKILL.md.
    // Tmux session echo can leak the entire script text (including delimiter strings)
    // into stdout, producing fake entries with garbled paths.
    if (!absolutePath.startsWith('/') || !absolutePath.endsWith('/SKILL.md')) continue

    const fm = parseFrontmatter(content)
    // Derive name from frontmatter or directory name
    const name = fm.name || absolutePath.split('/').slice(-2, -1)[0] || 'unknown'
    const description = fm.description || ''
    // Make path relative to cwd
    const relativePath = absolutePath.startsWith(cwd + '/')
      ? absolutePath.slice(cwd.length + 1)
      : absolutePath

    skills.push({
      name,
      description,
      path: relativePath,
      absolutePath,
    })
  }

  return skills
}

/**
 * Format discovered context as a system message injection.
 * Returns null if nothing was found.
 */
export function formatContextInjection(context: DirectoryContext): string | null {
  const parts: string[] = []

  if (context.instructions) {
    parts.push(`## Project Instructions\n\n${sanitize(context.instructions)}`)
  }

  if (context.skills.length > 0) {
    const skillList = context.skills
      .map(
        (s) =>
          `- **${sanitize(s.name)}**: ${sanitize(s.description) || '(no description)'} — \`${s.path}\``
      )
      .join('\n')
    parts.push(
      `## Available Skills\n\nThe following skills are available in this project. Use the \`use_skill\` tool to load full instructions for any skill.\n\n${skillList}`
    )
  }

  if (parts.length === 0) return null

  return wrapBoundary(
    'context',
    `[Directory context loaded from ${context.cwd}]\n\n${parts.join('\n\n')}`,
    { source: 'directory' }
  )
}

/**
 * Scan a sprite directory for AGENTS.md instruction files and SKILL.md skill files.
 * Runs a single batched shell command to minimize exec calls.
 */
export async function scanDirectoryContext(
  spriteName: string,
  cwd: string,
  session?: ISpriteSession
): Promise<DirectoryContext> {
  const command = buildScanCommand(cwd)
  const result = await spriteExec(spriteName, command, { session })
  const stdout = result.stdout ?? ''

  const instructions = parseInstructionFiles(stdout)
  const skills = parseSkillFiles(cwd, stdout)

  return { cwd, instructions, skills }
}

/**
 * Load sprite environment documentation from the VM's built-in docs.
 * Reads /.sprite/llm.txt (short pointer) and /.sprite/docs/agent-context.md (comprehensive env doc).
 * Returns concatenated content or null on failure (sprite not ready, files missing, etc.).
 */
export async function loadSpriteEnvironmentContext(
  spriteName: string,
  session?: ISpriteSession
): Promise<string | null> {
  try {
    const result = await spriteExec(
      spriteName,
      `cat /.sprite/llm.txt && echo '---' && cat /.sprite/docs/agent-context.md`,
      { session, timeout: 10_000 }
    )
    const stdout = (result.stdout ?? '').trim()
    if (!stdout) return null
    return stdout
  } catch {
    return null
  }
}
