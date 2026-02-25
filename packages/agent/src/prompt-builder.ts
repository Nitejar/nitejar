import { listAgentSandboxes, type Agent, type WorkItem } from '@nitejar/database'
import { getSpritesTokenSettings, isSpritesExecutionAvailable } from '@nitejar/sprites'
import { parseAgentConfig, DEFAULT_SOUL_TEMPLATE } from './config'
import { retrieveMemories, formatMemoriesForPrompt } from './memory'
import { SANDBOX_STALE_SECONDS } from './sandboxes'
import type { AgentConfig, WorkItemAttachment, WorkItemPayload } from './types'
import {
  collectPromptSections,
  CriticalContextError,
  type IntegrationProvider,
} from './integrations/registry'
import { sanitize, sanitizeLabel, wrapBoundary } from './prompt-sanitize'
import type { ResolvedSkill } from './skill-resolver'

/**
 * Team context for multi-agent awareness in the system prompt.
 */
export interface TeamContext {
  teammates: Array<{
    handle: string
    name: string
    role: string | null
    status: string
  }>
  /** Optional human-readable description of dispatch info */
  dispatchInfo?: string
}

/**
 * Base capabilities prompt - describes what the agent can do
 */
const BASE_CAPABILITIES_PROMPT = `You have access to a persistent Linux environment where you can execute commands, read and write files, and perform various operations.
You can create managed long-running services (web servers, APIs, background processes) that persist beyond command execution. Use create_service to start one, and get_sprite_url to get a shareable public URL.
You can also run concurrent background tasks scoped to the current run. Use start_background_task/check_background_task/list_background_tasks/stop_background_task for run-local long commands. Background tasks are auto-cleaned up at run end by default unless cleanup_on_run_end is false.
Use services for persistent daemons that should survive across runs. Use background tasks for temporary concurrent work during this run.
For multi-step work, use run_todo to create an ephemeral checklist for the current run. Add items to plan your approach, check them off as you complete each step, and list remaining items to stay on track. The checklist is ephemeral — it only exists for this run and is not persisted across runs.

Guidelines:
- Be helpful and complete the task thoroughly
- Use the tools available to you to accomplish the task
- When a request asks for concrete artifacts (code changes, screenshots, test output), execute tools first and deliver the artifact. Do not claim inability if tooling exists.
- If a task fails, report the exact command/tool attempted and the error, then propose or attempt the next fix.
- If you encounter errors, try to diagnose and fix them
- If bash output shows "exit code: 127" or "command not found", treat it as an environment issue first (missing binary/PATH). Install or enable the missing tool, verify it is available, then retry the original command before changing strategy.
- Do not silently work around missing foundational CLI tools (for example rg, pnpm, npm, git, test runners) when they are required for correctness. Fix the environment unless blocked by policy/network.
- Do not pivot to a weaker/manual strategy just because a required CLI is missing. First attempt environment repair and a direct retry of the intended command; only fall back if repair is blocked, and explicitly report why.
- Provide clear explanations of what you're doing
- When finished, summarize what you accomplished`

const WORKSPACE_CONVENTIONS_PROMPT = `Filesystem and workspace conventions:
- Use /home/sprite/repos/<owner>/<repo> for persistent git clones. Use /tmp/nitejar/<task-name> for scratch work.
- Keep persistent credentials/config in /home/sprite/.nitejar.
- Project skills and instructions auto-discover when you cd into a repo. Navigate to the relevant repo early to unlock available skills and project context.
- Do not run broad recursive listings like ls -R over /home/sprite; list specific directories with limited depth.
- Prefer absolute paths in commands and status updates so locations are unambiguous.
- If a newly installed command is still not found, refresh shell environment (for example export PATH=..., hash -r, source ~/.nitejar/env) and verify with command -v before proceeding.
- For installed language runtimes and version managers, run: cat /.sprite/llm-dev.txt
`

const MEMORY_PROMPT = `Memory:
You have persistent long-term memory. If "Things You Remember" appears above, those are your stored memories. Memories marked 📌 are pinned and won't fade.
Memory is private per-agent: your memories are only yours. add_memory updates your memory only, not your teammates' memory.
Never imply that storing a memory updates other agents automatically.
Collections are shared structured data. Use define_collection / collection_describe / collection_query / collection_search / collection_get / collection_insert / collection_upsert for shared org data.
If you need field names or types before writing data, call collection_describe first.
Schema changes for collections require human review before they become active.

Use add_memory to store things worth remembering across sessions. Two conventions:

TASK — If you can't finish work this turn (waiting on CI, need to come back later):
  "TASK [open]: what you're doing — where you left off | ref: url"
  Update status as things change: open → in-progress → done.
  Pin active tasks (permanent=true). Unpin when done — they'll fade naturally.

FACT — Something useful you learned about the project, user, or environment:
  "FACT: what you learned"

Don't store trivial or easily re-derived information. Don't create duplicate memories — update existing ones instead.`

/**
 * Options for building the system prompt.
 */
export interface BuildSystemPromptOptions {
  activityContext?: string
  teamContext?: TeamContext
  /** Resolved context providers (from the runner). */
  contextProviders?: IntegrationProvider[]
  /** Resolved DB/plugin skills for this agent */
  resolvedDbSkills?: ResolvedSkill[]
}

export interface RequesterIdentity {
  displayName: string | null
  handle: string | null
  externalId: string | null
  source: string | null
}

/**
 * Build the complete system prompt for an agent
 * Assembles: agent identity + soul + memories + capabilities + channel context
 */
export async function buildSystemPrompt(
  agent: Agent,
  workItem: WorkItem,
  options?: BuildSystemPromptOptions
): Promise<string> {
  const { activityContext, teamContext, contextProviders, resolvedDbSkills } = options ?? {}
  const config = parseAgentConfig(agent.config)
  const sections: string[] = []

  // Section 1: Agent identity
  sections.push(`You are ${agent.name} (@${agent.handle}).`)

  // Inter-agent context: if this is a private DM or @mention, note it
  const payload = safeParsePayload(workItem.payload)
  if (payload?.source_type === 'agent_dm') {
    sections.push(
      'This is a private inter-agent conversation. Your response is NOT visible to users. ' +
        'Respond directly to the other agent.'
    )
  }

  // Section 2: Soul document (injected as-is)
  const soul = config.soul || DEFAULT_SOUL_TEMPLATE
  sections.push(soul)

  // Section 3: Memories (retrieved + formatted)
  if (config.memorySettings?.enabled !== false) {
    const contextText = buildContextTextForRetrieval(workItem)
    const memories = await retrieveMemories(agent.id, contextText, config)

    if (memories.length > 0) {
      const memorySection = formatMemoriesForPrompt(memories)
      sections.push(memorySection)
    }
  }

  // Section: Active work across agents (injected from triage)
  if (activityContext) {
    sections.push(wrapBoundary('activity', `## Active Work Across Agents\n${activityContext}`))
  }

  // Section: Team awareness (multi-agent context)
  if (teamContext && teamContext.teammates.length > 0) {
    const teammateLines = teamContext.teammates.map((t) => {
      const role = t.role ? ` — ${sanitize(t.role)}` : ''
      return `- @${sanitize(t.handle)} (${sanitize(t.name)})${role} — ${sanitize(t.status)}`
    })
    const teamSection = [
      '## Your Team',
      'You are part of a team of agents. Here are your teammates:',
      ...teammateLines,
      ...(teamContext.dispatchInfo ? ['', sanitize(teamContext.dispatchInfo)] : []),
      '',
      'Every agent on the team receives every message and triages independently. You never need to relay, forward, or hand off a message — if it is addressed to another agent, they already have it.',
      'Do not act as a coordinator or project manager for your teammates. Do not offer to "ping", "assign to", or "hand off to" another agent.',
      'If you want to pull a teammate into YOUR response (e.g. asking for their opinion), @mention them in your message.',
      'If a request is clearly assigned to a single agent and they already resolved it, defer instead of repeating their answer.',
      'If you have unique, high-signal information (correction, risk, missing constraint, or important context), chime in briefly with only that insight.',
    ].join('\n')
    sections.push(teamSection)
  }

  sections.push(MEMORY_PROMPT)

  // Section: Available Skills (DB/plugin skills with sandbox paths)
  if (resolvedDbSkills && resolvedDbSkills.length > 0) {
    const skillSection = buildSkillsPromptSection(resolvedDbSkills)
    if (skillSection) {
      sections.push(skillSection)
    }
  }

  // Section 4: Legacy system prompt (if set - for backwards compat)
  if (config.systemPrompt) {
    sections.push(config.systemPrompt)
  }

  // Section 5: Base capabilities
  sections.push(BASE_CAPABILITIES_PROMPT)

  // Section 6: Filesystem/workspace conventions
  sections.push(WORKSPACE_CONVENTIONS_PROMPT)

  // Section 7: Sandbox catalog
  const sandboxCatalog = await buildSandboxCatalogPrompt(agent.id)
  if (sandboxCatalog) {
    sections.push(sandboxCatalog)
  }

  // Section 8: Plugin context (platform prompts, workflow rules, repo access, etc.)
  // Collected from all resolved context providers, deduped and sorted by priority.
  if (contextProviders && contextProviders.length > 0) {
    const allProviderSections = await collectProviderSections(contextProviders, agent, workItem)
    for (const ps of allProviderSections) {
      sections.push(ps.content)
    }
  }

  return sections.join('\n\n')
}

/**
 * Collect prompt sections from all context providers.
 * Non-fatal: if a provider throws, its sections are skipped.
 * CriticalContextError is re-thrown.
 */
async function collectProviderSections(
  providers: IntegrationProvider[],
  agent: Agent,
  workItem: WorkItem
) {
  const allSections = []
  for (const provider of providers) {
    if (!provider.getSystemPromptSections) continue
    try {
      const providerSections = await provider.getSystemPromptSections(agent, workItem)
      allSections.push(...providerSections)
    } catch (error) {
      if (error instanceof CriticalContextError) throw error
      console.warn(
        `[AgentPrompt] Context provider "${provider.integrationType}" getSystemPromptSections failed, skipping`,
        error
      )
    }
  }
  return collectPromptSections(allSections)
}

/**
 * Build the sandbox catalog section for the system prompt.
 * Lists all sandboxes the agent has, marking ephemeral ones that are stale.
 */
async function buildSandboxCatalogPrompt(agentId: string): Promise<string | null> {
  try {
    const spriteSettings = await getSpritesTokenSettings()
    if (!isSpritesExecutionAvailable(spriteSettings)) return null

    const sandboxes = await listAgentSandboxes(agentId)
    if (sandboxes.length === 0) return null

    const nowTs = Math.floor(Date.now() / 1000)
    const lines = sandboxes.map((s) => {
      const stale = s.kind === 'ephemeral' && nowTs - s.last_used_at > SANDBOX_STALE_SECONDS
      const tags = [s.kind, stale ? 'stale' : null].filter(Boolean).join(', ')
      return `- ${s.name} (${tags}): ${s.description} [sprite=${s.sprite_name}]`
    })

    return `Your sandboxes:\n${lines.join('\n')}\n\nYou start each run on the "home" sandbox. Use switch_sandbox to change your active sandbox, or create_ephemeral_sandbox to spin up a new isolated environment.`
  } catch (error) {
    console.warn('[AgentPrompt] Failed to build sandbox catalog', error)
    return null
  }
}

/** Max chars for auto-inject skill descriptions in system prompt */
const AUTO_INJECT_BUDGET = 5000
/** Max skills to list in the summary section */
const MAX_SKILLS_IN_SUMMARY = 50

/**
 * Build the Available Skills section for the system prompt.
 * Includes brief summaries with sandbox paths (not full content).
 * For auto-inject skills, includes a brief description block.
 */
function buildSkillsPromptSection(skills: ResolvedSkill[]): string | null {
  if (skills.length === 0) return null

  const sandboxSkills = skills.filter((s) => s.sandboxPath)
  const repoSkills = skills.filter((s) => s.absolutePath && !s.sandboxPath)

  const parts: string[] = [
    '## Available Skills',
    '',
    'You have the following skills installed in your sandbox. Each skill directory contains a SKILL.md with full instructions and may include supporting files (references, scripts, templates). Use `read_file` to read the SKILL.md for any skill you want to use.',
  ]

  if (sandboxSkills.length > 0) {
    parts.push('')
    parts.push('Sandbox skills (in /home/sprite/.skills/):')
    const shown = sandboxSkills.slice(0, MAX_SKILLS_IN_SUMMARY)
    for (const s of shown) {
      const sourceTag = s.source === 'plugin' ? `plugin: ${s.sourceRef}` : s.source
      parts.push(
        `- **${sanitize(s.name)}** — ${sanitize(s.description) || '(no description)'}. Read: ${s.sandboxPath}/SKILL.md [${sourceTag}]`
      )
    }
    if (sandboxSkills.length > MAX_SKILLS_IN_SUMMARY) {
      parts.push(
        `[${sandboxSkills.length - MAX_SKILLS_IN_SUMMARY} more skills available — use use_skill to discover them]`
      )
    }
  }

  if (repoSkills.length > 0) {
    parts.push('')
    parts.push('Project skills (discovered from repo):')
    for (const s of repoSkills.slice(0, MAX_SKILLS_IN_SUMMARY)) {
      parts.push(
        `- **${sanitize(s.name)}** — ${sanitize(s.description) || '(no description)'}. Read: ${s.absolutePath} [repo]`
      )
    }
  }

  // Auto-inject section: include brief descriptions for skills with auto_inject=1
  const autoInjectSkills = skills.filter((s) => s.autoInject)
  if (autoInjectSkills.length > 0) {
    let budgetRemaining = AUTO_INJECT_BUDGET
    const injected: string[] = []
    for (const s of autoInjectSkills) {
      if (budgetRemaining <= 0) break
      const desc = sanitize(s.description || '(no description)')
      const path = s.sandboxPath ? `${s.sandboxPath}/SKILL.md` : s.absolutePath || ''
      const block = `<skill name="${sanitize(s.name)}" path="${path}">\n${desc}\nWhen you need to use this skill, read the full SKILL.md at the path above for detailed instructions.\n</skill>`
      if (block.length > budgetRemaining) break
      injected.push(block)
      budgetRemaining -= block.length
    }
    if (injected.length > 0) {
      parts.push('')
      parts.push(injected.join('\n'))
    }
  }

  return parts.join('\n')
}

/**
 * Build context text from work item for memory retrieval
 * Combines title and body for embedding generation
 */
function buildContextTextForRetrieval(workItem: WorkItem): string {
  const payload = safeParsePayload(workItem.payload)
  const parts: string[] = [workItem.title]

  if (payload?.body) {
    parts.push(payload.body)
  }

  return parts.join('\n')
}

/**
 * Build the user message from a work item
 * Includes metadata about the sender/source when available
 */
export function buildUserMessage(workItem: WorkItem): string {
  const payload = safeParsePayload(workItem.payload)
  const parts: string[] = []

  // Annotate agent DM messages
  if (payload?.source_type === 'agent_dm' && payload?.from_handle) {
    parts.push(`[Private message from @${sanitize(payload.from_handle)}]`)
  }

  // Add sender context if available
  if (payload?.senderName || payload?.senderUsername) {
    const senderParts: string[] = []
    if (payload.senderName) senderParts.push(sanitize(payload.senderName))
    if (payload.senderUsername) senderParts.push(`@${sanitize(payload.senderUsername)}`)

    const contextParts: string[] = [`From: ${senderParts.join(' ')}`]
    if (payload.chatName && payload.chatType !== 'private') {
      contextParts.push(`Channel: ${sanitize(payload.chatName)}`)
    }
    if (payload.source) {
      contextParts.push(`Via: ${payload.source}`)
    }

    parts.push(`[${contextParts.join(' | ')}]`)
  }

  if (payload?.messageThreadId !== undefined && payload?.messageThreadId !== null) {
    parts.push(`[Thread Context | message_thread_id: ${payload.messageThreadId}]`)
  }

  // Slack thread context: indicate when message is a reply in a thread
  if (
    payload?.source === 'slack' &&
    payload?.threadTs &&
    payload?.messageTs &&
    payload.threadTs !== payload.messageTs
  ) {
    parts.push(`[Thread Context | thread_ts: ${payload.threadTs}]`)
  }

  // Add reply context metadata if present
  if (payload?.replyToMessageId || payload?.replyToMessageText) {
    const replyParts: string[] = []
    if (payload.replyToMessageId !== undefined && payload.replyToMessageId !== null) {
      replyParts.push(`reply_to_message_id: ${payload.replyToMessageId}`)
    }
    if (payload.replyToMessageText) {
      replyParts.push(`reply_to_message_text: ${sanitize(payload.replyToMessageText)}`)
    }
    if (replyParts.length > 0) {
      parts.push(`[Reply Context | ${replyParts.join(' | ')}]`)
    }
  }

  // Add the actual message content
  if (payload?.body) {
    parts.push(sanitize(payload.body))
  } else {
    parts.push(sanitize(workItem.title))
  }

  // Add attachments summary if available
  if (
    payload?.attachments &&
    Array.isArray(payload.attachments) &&
    payload.attachments.length > 0
  ) {
    const attachmentLines = payload.attachments.map((attachment, index) =>
      formatAttachmentLine(attachment, index + 1)
    )
    parts.push(`Attachments:\n${attachmentLines.join('\n')}`)

    // Add download hint if there are non-image, non-text-inlined attachments
    const hasDownloadable = payload.attachments.some((a) => !['photo', 'image'].includes(a.type))
    if (hasDownloadable) {
      parts.push(
        'Use the download_attachment tool with the attachment index to download files to your filesystem.'
      )
    }
  }

  return parts.join('\n')
}

/**
 * Build an issue/PR preamble for GitHub sessions.
 * Delegates to the GitHub context provider's implementation.
 * Kept here as a thin re-export so triage.ts doesn't need changes.
 */
export { buildIssuePreamble } from './integrations/github'

/**
 * Safely parse work item payload
 */
function safeParsePayload(payload: string | null): WorkItemPayload | null {
  if (!payload) return null

  try {
    return JSON.parse(payload) as WorkItemPayload
  } catch {
    return null
  }
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeOptionalExternalId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return normalizeOptionalText(value)
}

function getRequesterIdentityFromPayload(
  payload: WorkItemPayload | null
): RequesterIdentity | null {
  if (!payload) return null

  const actor = payload.actor
  const displayName =
    normalizeOptionalText(actor?.displayName) ?? normalizeOptionalText(payload.senderName)
  const handle =
    normalizeOptionalText(actor?.handle) ?? normalizeOptionalText(payload.senderUsername)
  const externalId =
    normalizeOptionalExternalId(actor?.externalId) ?? normalizeOptionalExternalId(payload.senderId)
  const source = normalizeOptionalText(actor?.source) ?? normalizeOptionalText(payload.source)

  if (!displayName && !handle && !externalId) {
    return null
  }

  return {
    displayName,
    handle,
    externalId,
    source,
  }
}

/**
 * Extract structured requester identity from a work item's payload.
 * Uses the same payload strategy as prompt-builder sender labeling.
 */
export function getRequesterIdentity(workItem: WorkItem): RequesterIdentity | null {
  return getRequesterIdentityFromPayload(safeParsePayload(workItem.payload))
}

/**
 * Extract a human-readable requester label from a work item's payload.
 * Prefers "Name (@username)", falls back to just name or username, then "Requester".
 */
export function getRequesterLabel(workItem: WorkItem): string {
  const identity = getRequesterIdentity(workItem)
  if (!identity) return 'Requester'

  const { displayName, handle, externalId } = identity
  let label: string
  if (displayName && handle) {
    label = `${displayName} (@${handle})`
  } else if (displayName) {
    label = displayName
  } else if (handle) {
    label = `@${handle}`
  } else if (externalId) {
    label = `#${externalId}`
  } else {
    return 'Requester'
  }
  return sanitizeLabel(label, 'Requester')
}

const ATTACHMENT_TYPE_LABELS: Record<string, string> = {
  photo: 'Photo',
  document: 'Document',
  image: 'Image',
  audio: 'Audio',
  voice: 'Voice message',
  video: 'Video',
  video_note: 'Video note',
  animation: 'GIF',
  sticker: 'Sticker',
}

function formatAttachmentLine(attachment: WorkItemAttachment, index: number): string {
  const typeLabel = ATTACHMENT_TYPE_LABELS[attachment.type] || attachment.type

  const details: string[] = [typeLabel]
  if (attachment.title) details.push(attachment.title)
  if (attachment.performer) details.push(`by ${attachment.performer}`)
  if (attachment.fileName) details.push(attachment.fileName)
  if (attachment.emoji) details.push(attachment.emoji)
  if (attachment.width && attachment.height) {
    details.push(`${attachment.width}x${attachment.height}`)
  }
  if (attachment.duration != null) {
    details.push(formatDuration(attachment.duration))
  }
  const sizeLabel = formatBytes(attachment.fileSize)
  if (sizeLabel) details.push(sizeLabel)
  if (attachment.mimeType) details.push(attachment.mimeType)

  return `Attachment ${index}: ${details.join(' | ')}`
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

function formatBytes(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

/**
 * Build a lightweight system prompt for post-processing the agent's final response.
 * Only includes agent identity + soul + synthesis instruction — no tools, no capabilities,
 * no workspace conventions (the agent is just writing prose, not using tools).
 */
export function buildPostProcessingPrompt(
  agent: Agent,
  options?: { hitLimit?: boolean; requesterLabel?: string }
): string {
  const config = parseAgentConfig(agent.config)
  const soul = config.soul || DEFAULT_SOUL_TEMPLATE
  const requester = options?.requesterLabel ?? 'Requester'

  const sections = [
    `You are ${agent.name} (@${agent.handle}).`,
    soul,
    [
      `Your task: write the final response to ${requester} using the work transcript below.`,
      ``,
      `The transcript (wrapped in <transcript> tags) is a record of work YOU already performed — tool calls, reasoning, and results from this run. Human speakers may be labeled per person (for example [Name (@handle)]), and your messages are labeled [${agent.name}].`,
      ``,
      `Rules:`,
      `- Write as yourself (${agent.name}). You are the agent who did the work.`,
      `- Reply directly to ${requester}; this message is sent back in the same conversation.`,
      `- Summarize what you accomplished, found, or built. Focus on outcomes.`,
      `- Keep your own voice and perspective; do not write as if you are ${requester}.`,
      `- Keep it concise and outcome-first instead of step-by-step process narration.`,
      `- Cover only this run's work.`,
      `- Output clean markdown suitable for posting publicly.`,
    ].join('\n'),
  ]

  if (options?.hitLimit) {
    sections.push(
      `IMPORTANT: You hit your tool use limit before completing the task. Your response MUST clearly state what was completed, what was NOT completed, and that you ran out of turns. Do not present incomplete work as finished.`
    )
  }

  return sections.join('\n\n')
}

/**
 * Get model configuration from agent config
 * Returns model name, temperature, and max tokens with defaults
 *
 * NOTE: The model MUST be set in the agent config (database).
 * There is no runtime fallback - the default is applied at agent creation time.
 */
export function getModelConfig(config: AgentConfig): {
  model: string
  temperature: number
  maxTokens: number | undefined
} {
  if (!config.model) {
    throw new Error(
      'Agent model is not configured. The model must be set in the agent config. ' +
        'This is likely an agent created before per-agent model support was added. ' +
        'Please update the agent configuration to set a model.'
    )
  }

  return {
    model: config.model,
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens,
  }
}
