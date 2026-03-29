import path from 'node:path'
import type OpenAI from 'openai'
import {
  appendMessage,
  completeJob,
  failJob,
  startJob,
  updateJob,
  type Agent,
  type Job,
  type WorkItem,
} from '@nitejar/database'
import { listDir, readFile, spriteExec } from '@nitejar/sprites'
import { parseAgentConfig } from './config'
import { scanDirectoryContext } from './context-loader'
import { agentWarn } from './agent-logger'
import {
  buildToolResultContent,
  prepareMessagesForModel,
  truncateWithNotice,
} from './message-utils'
import { getClient, withProviderRetry } from './model-client'
import { recordInferenceCallReceipt } from './model-call-receipts'
import { normalizeOpenRouterChatCompletionUsage } from './openrouter-usage'
import { sanitize } from './prompt-sanitize'
import { formatFileContent } from './tools/helpers'
import type { ExploreDepth } from './types'

const EXPLORE_MAX_TURNS: Record<ExploreDepth, number> = {
  quick: 4,
  medium: 7,
  thorough: 10,
}

const DEFAULT_READ_MAX_LINES = 220
const DEFAULT_SEARCH_MAX_RESULTS = 50
const DEFAULT_GIT_DIFF_MAX_LINES = 400

type ExploreToolName =
  | 'explore_list_directory'
  | 'explore_read_file'
  | 'explore_search_code'
  | 'explore_git_status'
  | 'explore_git_diff'

interface ExploreRunInput {
  agent: Agent
  workItem: WorkItem
  job: Job
  spriteName: string
  cwd: string
  activeSandboxName?: string
  question: string
  depth: ExploreDepth
}

interface ExploreToolExecutionContext {
  spriteName: string
  cwd: string
}

interface ExploreSummaryShape {
  answer?: unknown
  keyFiles?: Array<{ path?: unknown; why?: unknown }>
  evidence?: unknown[]
  openQuestions?: unknown[]
}

const exploreToolDefinitions: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'explore_list_directory',
      description:
        'List the contents of a directory in the current repo. Use for orientation before reading files.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: {
            type: 'string',
            description:
              'Absolute or repo-relative path to inspect. Omit to list the current working directory.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explore_read_file',
      description:
        'Read a file with line numbers. Prefer targeted reads over loading very large files.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'Absolute or repo-relative file path.' },
          start_line: { type: 'integer', description: '1-indexed starting line.' },
          max_lines: {
            type: 'integer',
            description: `Maximum lines to read. Defaults to ${DEFAULT_READ_MAX_LINES}.`,
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explore_search_code',
      description:
        'Search the current repo with ripgrep. Best for finding symbols, strings, or ownership clues.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', description: 'Literal or regex search query.' },
          path: {
            type: 'string',
            description:
              'Optional absolute or repo-relative path to constrain the search. Defaults to cwd.',
          },
          max_results: {
            type: 'integer',
            description: `Maximum matches to return. Defaults to ${DEFAULT_SEARCH_MAX_RESULTS}.`,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explore_git_status',
      description:
        'Inspect the current branch and dirty working tree from the current cwd. Use when WIP may matter.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explore_git_diff',
      description:
        'Inspect the current uncommitted diff from the current cwd. Use when local WIP may answer the question.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          max_lines: {
            type: 'integer',
            description: `Maximum diff lines to return. Defaults to ${DEFAULT_GIT_DIFF_MAX_LINES}.`,
          },
        },
      },
    },
  },
]

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function resolveExplorePath(cwd: string, candidate?: unknown): string {
  if (typeof candidate !== 'string' || candidate.trim().length === 0) return cwd
  const trimmed = candidate.trim()
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed)
}

function safeParsePayload(payload: string | null): Record<string, unknown> | null {
  if (!payload) return null
  try {
    const parsed = JSON.parse(payload) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function buildWorkContextSummary(workItem: WorkItem): string {
  const payload = safeParsePayload(workItem.payload)
  const body = typeof payload?.body === 'string' ? payload.body.trim() : ''
  const ticketId = typeof payload?.ticketId === 'string' ? payload.ticketId : null
  const ticketTitle = typeof payload?.ticketTitle === 'string' ? payload.ticketTitle : null
  const goalId = typeof payload?.goalId === 'string' ? payload.goalId : null
  const goalTitle = typeof payload?.goalTitle === 'string' ? payload.goalTitle : null
  const parts = [
    `source: ${workItem.source}`,
    `session_key: ${workItem.session_key}`,
    `source_ref: ${workItem.source_ref}`,
    `work_item_title: ${workItem.title}`,
    ticketId ? `ticket: ${ticketId}${ticketTitle ? ` (${ticketTitle})` : ''}` : null,
    goalId ? `goal: ${goalId}${goalTitle ? ` (${goalTitle})` : ''}` : null,
    body ? `payload_body: ${sanitize(body.slice(0, 1200))}` : null,
  ].filter(Boolean)

  return parts.join('\n')
}

function buildExploreSystemPrompt(input: {
  cwd: string
  sandboxName?: string
  depth: ExploreDepth
  directoryInstructions: string | null
  skillHints: string[]
  gitReceipt: string
  workContext: string
}): string {
  const depthGuidance =
    input.depth === 'quick'
      ? 'quick means answer directly with minimal probing. Prefer 1-3 focused tool calls.'
      : input.depth === 'thorough'
        ? 'thorough means trace dependencies broadly before concluding. Use more tools when evidence is needed.'
        : 'medium means balance speed and coverage. Inspect the most likely files, then stop once the answer is well-supported.'

  const skillSection =
    input.skillHints.length > 0
      ? `Available project skills discovered near cwd:\n${input.skillHints.map((line) => `- ${line}`).join('\n')}`
      : 'No project skills were discovered near the current cwd.'

  return [
    'You are the internal explore runner for Nitejar.',
    'Your job is to answer a codebase question using only read-only local repo inspection.',
    'You are running in a separate context window from the parent run. Keep the work scoped to exploration only.',
    'Do not edit files. Do not propose shell commands for the parent to run. Do not use network assumptions.',
    'Start from the project instructions already loaded below before doing broader code probes.',
    depthGuidance,
    '',
    `Working directory: ${input.cwd}`,
    `Sandbox: ${input.sandboxName ?? 'home'}`,
    '',
    'Work context:',
    input.workContext,
    '',
    'Git receipt:',
    input.gitReceipt,
    '',
    'Project instructions:',
    input.directoryInstructions ? sanitize(input.directoryInstructions) : '(none found)',
    '',
    skillSection,
    '',
    'Return a compact JSON object with this exact shape:',
    '{',
    '  "answer": "short direct answer",',
    '  "keyFiles": [{"path": "absolute/or/repo path", "why": "why it matters"}],',
    '  "evidence": ["specific supporting fact"],',
    '  "openQuestions": ["remaining uncertainty if any"]',
    '}',
  ].join('\n')
}

async function collectGitStatus(ctx: ExploreToolExecutionContext): Promise<string> {
  const command = [
    'branch=$(git branch --show-current 2>/dev/null || true)',
    'printf "branch: %s\\n" "${branch:-unknown}"',
    'git status --short --branch 2>/dev/null || true',
  ].join('\n')
  const result = await spriteExec(ctx.spriteName, command, { cwd: ctx.cwd })
  const stdout = (result.stdout ?? '').trim()
  if (!stdout) return 'branch: unavailable'
  return truncateWithNotice(stdout, 6_000, 'git status')
}

async function executeExploreTool(
  toolName: ExploreToolName,
  rawInput: Record<string, unknown>,
  ctx: ExploreToolExecutionContext
): Promise<{ success: boolean; output?: string; error?: string }> {
  try {
    if (toolName === 'explore_list_directory') {
      const target = resolveExplorePath(ctx.cwd, rawInput.path)
      const entries = await listDir(ctx.spriteName, target)
      return {
        success: true,
        output: [`Directory: ${target}`, ...entries].join('\n'),
      }
    }

    if (toolName === 'explore_read_file') {
      const target = resolveExplorePath(ctx.cwd, rawInput.path)
      const startLine =
        typeof rawInput.start_line === 'number' && rawInput.start_line > 0 ? rawInput.start_line : 1
      const maxLines =
        typeof rawInput.max_lines === 'number' && rawInput.max_lines > 0
          ? Math.min(rawInput.max_lines, 500)
          : DEFAULT_READ_MAX_LINES
      const content = await readFile(ctx.spriteName, target)
      return {
        success: true,
        output: `File: ${target}\n${formatFileContent(content, startLine, maxLines)}`,
      }
    }

    if (toolName === 'explore_search_code') {
      const query = typeof rawInput.query === 'string' ? rawInput.query.trim() : ''
      if (!query) {
        return { success: false, error: 'query is required' }
      }
      const target = resolveExplorePath(ctx.cwd, rawInput.path)
      const maxResults =
        typeof rawInput.max_results === 'number' && rawInput.max_results > 0
          ? Math.min(rawInput.max_results, 200)
          : DEFAULT_SEARCH_MAX_RESULTS
      const command = [
        'if ! command -v rg >/dev/null 2>&1; then',
        '  echo "ripgrep (rg) is unavailable in this environment" >&2',
        '  exit 127',
        'fi',
        `rg -n --column --no-heading --color never --hidden --glob '!.git' --glob '!node_modules' --glob '!dist' --glob '!.next' --max-count ${maxResults} -- ${shellQuote(query)} ${shellQuote(target)}`,
      ].join('\n')
      const result = await spriteExec(ctx.spriteName, command, { cwd: ctx.cwd })
      const stdout = (result.stdout ?? '').trim()
      const stderr = (result.stderr ?? '').trim()
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        return {
          success: false,
          error: stderr || `search failed with exit code ${result.exitCode}`,
        }
      }
      return {
        success: true,
        output: stdout
          ? `Search root: ${target}\n${truncateWithNotice(stdout, 12_000, 'search results')}`
          : `Search root: ${target}\n(no matches)`,
      }
    }

    if (toolName === 'explore_git_status') {
      return {
        success: true,
        output: await collectGitStatus(ctx),
      }
    }

    const maxLines =
      typeof rawInput.max_lines === 'number' && rawInput.max_lines > 0
        ? Math.min(rawInput.max_lines, 800)
        : DEFAULT_GIT_DIFF_MAX_LINES
    const command = [
      'printf "stat:\\n"',
      'git diff --stat -- . 2>/dev/null || true',
      'printf "\\npatch:\\n"',
      `git diff --no-ext-diff --unified=0 -- . 2>/dev/null | sed -n '1,${maxLines}p'`,
    ].join('\n')
    const result = await spriteExec(ctx.spriteName, command, { cwd: ctx.cwd })
    const stdout = (result.stdout ?? '').trim()
    return {
      success: true,
      output: stdout ? truncateWithNotice(stdout, 18_000, 'git diff') : 'No uncommitted diff.',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function extractChoiceOrThrow(
  response: OpenAI.ChatCompletion
): OpenAI.ChatCompletion['choices'][number] {
  const choice = response.choices?.[0]
  if (!choice) {
    throw new Error('Explore model returned no choices')
  }
  return choice
}

function appendEncounteredErrors(lines: string[], errorsEncountered: string[]): void {
  if (errorsEncountered.length === 0) return

  lines.push('Errors encountered:')
  for (const error of errorsEncountered) {
    lines.push(`- ${error}`)
  }
}

export function formatExploreSummary(raw: string, errorsEncountered: string[] = []): string {
  try {
    const parsed = JSON.parse(raw) as ExploreSummaryShape
    const lines: string[] = []
    const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : ''
    if (answer) lines.push(`Answer: ${answer}`)

    const keyFiles = Array.isArray(parsed.keyFiles)
      ? parsed.keyFiles
          .map((entry) => {
            const filePath = typeof entry?.path === 'string' ? entry.path.trim() : ''
            const why = typeof entry?.why === 'string' ? entry.why.trim() : ''
            if (!filePath) return null
            return `- ${filePath}${why ? ` — ${why}` : ''}`
          })
          .filter((entry): entry is string => Boolean(entry))
      : []
    if (keyFiles.length > 0) {
      lines.push('Key files:')
      lines.push(...keyFiles)
    }

    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => `- ${entry.trim()}`)
      : []
    if (evidence.length > 0) {
      lines.push('Evidence:')
      lines.push(...evidence)
    }

    const openQuestions = Array.isArray(parsed.openQuestions)
      ? parsed.openQuestions
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => `- ${entry.trim()}`)
      : []
    if (openQuestions.length > 0) {
      lines.push('Open questions:')
      lines.push(...openQuestions)
    }

    appendEncounteredErrors(lines, errorsEncountered)

    return lines.join('\n').trim() || raw.trim()
  } catch {
    const lines = [raw.trim()].filter(Boolean)
    appendEncounteredErrors(lines, errorsEncountered)
    return lines.join('\n\n').trim()
  }
}

export async function runExploreChild(input: ExploreRunInput): Promise<string> {
  const agentConfig = parseAgentConfig(input.agent.config)
  const model = agentConfig.exploreSettings?.model?.trim() || agentConfig.model
  if (!model) {
    throw new Error('Explore run requires an agent model to be configured')
  }

  const directoryContext = await scanDirectoryContext(input.spriteName, input.cwd)
  const gitReceipt = await collectGitStatus({ spriteName: input.spriteName, cwd: input.cwd })
  const workContext = buildWorkContextSummary(input.workItem)
  const systemPrompt = buildExploreSystemPrompt({
    cwd: input.cwd,
    sandboxName: input.activeSandboxName,
    depth: input.depth,
    directoryInstructions: directoryContext.instructions,
    skillHints: directoryContext.skills.map(
      (skill) => `${skill.name}: ${skill.description || '(no description)'} — ${skill.path}`
    ),
    gitReceipt,
    workContext,
  })

  const client = await getClient()
  const maxTurns = EXPLORE_MAX_TURNS[input.depth]
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Question: ${input.question}\n\nAnswer using repo evidence. Prefer current WIP when relevant.`,
    },
  ]

  await startJob(input.job.id)
  await appendMessage(input.job.id, 'system', { text: systemPrompt })
  await appendMessage(input.job.id, 'system', {
    text: `[Explore context] sandbox=${input.activeSandboxName ?? 'home'} cwd=${input.cwd}`,
  })
  await appendMessage(input.job.id, 'system', { text: `[Git receipt]\n${gitReceipt}` })
  await appendMessage(input.job.id, 'user', { text: input.question })

  let lastAssistantText = ''
  const encounteredErrors: string[] = []
  try {
    for (let turn = 1; turn <= maxTurns; turn++) {
      const prepared = prepareMessagesForModel(messages)
      const requestPayload = {
        model,
        temperature: 0.2,
        tools: exploreToolDefinitions,
        tool_choice: 'auto' as const,
        messages: prepared.messages,
      }
      const startedAt = Date.now()
      const response = await withProviderRetry(
        () =>
          client.chat.completions.create({
            model,
            temperature: 0.2,
            max_tokens: 1_600,
            tools: exploreToolDefinitions,
            tool_choice: 'auto',
            messages: prepared.messages,
          }),
        { label: 'explore child run' }
      )
      const choice = extractChoiceOrThrow(response)
      const usage = await normalizeOpenRouterChatCompletionUsage(response, {
        warn: agentWarn,
      })
      const toolCallNames =
        choice.message.tool_calls
          ?.filter(
            (toolCall): toolCall is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
              toolCall.type === 'function'
          )
          .map((toolCall) => toolCall.function.name)
          .filter(Boolean) ?? []

      await recordInferenceCallReceipt(
        {
          jobId: input.job.id,
          agentId: input.agent.id,
          turn,
          model: response.model || model,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          costUsd: usage.costUsd,
          toolCallNames,
          finishReason: choice.finish_reason ?? null,
          isFallback: false,
          durationMs: Date.now() - startedAt,
          attemptKind: 'explore',
          attemptIndex: 1,
          requestPayload,
          responsePayload: response,
        },
        { warn: agentWarn }
      )

      messages.push({
        role: 'assistant',
        content: choice.message.content ?? '',
        ...(choice.message.tool_calls ? { tool_calls: choice.message.tool_calls } : {}),
      })

      if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
        const functionToolCalls = choice.message.tool_calls.filter(
          (call): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
            call.type === 'function'
        )
        await appendMessage(input.job.id, 'assistant', {
          text:
            choice.message.content?.trim() ||
            `[Explore tool batch] ${functionToolCalls.map((call) => call.function.name).join(', ')}`,
        })
        for (const toolCall of functionToolCalls) {
          const toolName = toolCall.function.name as ExploreToolName
          let parsedInput: Record<string, unknown> = {}
          try {
            parsedInput = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>
          } catch {
            parsedInput = {}
          }
          const result = await executeExploreTool(toolName, parsedInput, {
            spriteName: input.spriteName,
            cwd: input.cwd,
          })
          if (!result.success) {
            const errorMessage = result.error?.trim() || 'unknown error'
            const formattedError = `${toolName}: ${errorMessage}`
            if (!encounteredErrors.includes(formattedError)) {
              encounteredErrors.push(formattedError)
            }
          }
          const resultContent = truncateWithNotice(
            buildToolResultContent(result),
            20_000,
            `${toolName} result`
          )
          await appendMessage(input.job.id, 'tool', {
            tool_name: toolName,
            input: parsedInput,
            text: resultContent,
          })
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: resultContent,
          })
        }
        continue
      }

      lastAssistantText = (choice.message.content ?? '').trim()
      await appendMessage(input.job.id, 'assistant', { text: lastAssistantText })
      break
    }

    const summary = formatExploreSummary(
      lastAssistantText || 'Answer: Explore run finished without a final summary.',
      encounteredErrors
    )
    await updateJob(input.job.id, { final_response: summary })
    await completeJob(input.job.id)
    return summary
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendMessage(input.job.id, 'assistant', { text: `Explore failed: ${message}` })
    await failJob(input.job.id, message)
    agentWarn('Explore child run failed', { jobId: input.job.id, error: message })
    throw error
  }
}

export const __exploreRunnerTest = {
  resolveExplorePath,
  buildWorkContextSummary,
  collectGitStatus,
  executeExploreTool,
}
