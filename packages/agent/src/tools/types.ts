import type { ISpriteSession } from '@nitejar/sprites'
import type { BackgroundTaskManager } from '../background-task-manager'
import type { ResolvedSkill } from '../skill-resolver'
import type { EditToolMode, WorkItemAttachment } from '../types'

/** A discovered SKILL.md entry */
export interface SkillEntry {
  name: string
  description: string
  /** Path relative to the project root where the skill was found */
  path: string
  /** Absolute path on the sprite filesystem */
  absolutePath: string
}

export interface ToolContext {
  /** The sprite name to execute commands on */
  spriteName: string
  /** The active sandbox name for this run */
  activeSandboxName?: string
  /** Working directory for commands */
  cwd?: string
  /** Sprite session for stateful execution (shared across commands in a job) */
  session?: ISpriteSession
  /** Agent ID for capability checks */
  agentId?: string
  /** Job ID for run-scoped operations */
  jobId?: string
  /** Session key for the current conversation */
  sessionKey?: string
  /** Skills discovered from SKILL.md files in the working directory */
  discoveredSkills?: SkillEntry[]
  /** Resolved DB/plugin skills for this agent (loaded at run start) */
  resolvedDbSkills?: ResolvedSkill[]
  /** Plugin instance ID for response delivery (from originating webhook) */
  pluginInstanceId?: string
  /** Response context for response delivery (from originating webhook) */
  responseContext?: unknown
  /** Attachments from the work item payload */
  attachments?: WorkItemAttachment[]
  /** Edit tool mode resolved from agent config */
  editToolMode?: EditToolMode
  /** In-memory run-scoped background task manager */
  backgroundTaskManager?: BackgroundTaskManager
}

export interface ExternalApiCost {
  provider: string // e.g. 'tavily' | 'openrouter' | 'openai'
  operation: string // e.g. 'search' | 'extract' | 'generate_image'
  creditsUsed: number | null
  costUsd: number | null
  pricingStatus?: 'actual' | 'estimated' | 'unknown'
  pricingSource?: string | null
  mediaArtifactId?: string | null
  durationMs: number
  metadata?: Record<string, unknown>
}

export interface ToolResult {
  success: boolean
  output?: string
  error?: string
  /** Internal metadata (never shown to model) */
  _meta?: {
    cwd?: string
    sessionError?: boolean
    sessionInvalidated?: boolean
    externalApiCost?: ExternalApiCost
    editOperation?: string
    hashMismatch?: boolean
    sandboxSwitch?: {
      sandboxName: string
      spriteName: string
    }
  }
}

export type ToolInput = Record<string, unknown>

export type ToolHandler = (input: ToolInput, context: ToolContext) => Promise<ToolResult>
