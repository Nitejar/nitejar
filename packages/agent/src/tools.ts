import { getToolDefinitions, toolDefinitions } from './tools/definitions'
import { toolHandlers } from './tools/handlers'
import {
  CWD_MARKER,
  createLineHashTag,
  formatExecResultWithCwd,
  formatFileContent,
  formatFileContentWithHashes,
  generateUnifiedDiff,
  sanitizeFileWriteContent,
} from './tools/helpers'
import type { ToolContext, ToolHandler, ToolInput, ToolResult } from './tools/types'

export { getToolDefinitions, toolDefinitions }
export {
  CWD_MARKER,
  createLineHashTag,
  formatExecResultWithCwd,
  formatFileContent,
  formatFileContentWithHashes,
  generateUnifiedDiff,
  sanitizeFileWriteContent,
}

export type { ExternalApiCost, SkillEntry, ToolContext, ToolResult } from './tools/types'

/**
 * Execute a tool call.
 * Looks up the handler in the base registry first, then falls back to
 * additionalHandlers (used for provider-specific tools).
 */
export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolContext,
  additionalHandlers?: Record<string, ToolHandler>
): Promise<ToolResult> {
  const handler = toolHandlers[toolName] ?? additionalHandlers?.[toolName]
  if (!handler) {
    return { success: false, error: `Unknown tool: ${toolName}` }
  }

  try {
    return await handler(input as ToolInput, context)
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
