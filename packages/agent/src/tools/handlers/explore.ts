import type Anthropic from '@anthropic-ai/sdk'
import { createChildJob, findAgentById, findJobById, findWorkItemById } from '@nitejar/database'
import type { ExploreDepth } from '../../types'
import type { ToolHandler } from '../types'

const VALID_DEPTHS = new Set<ExploreDepth>(['quick', 'medium', 'thorough'])

export const exploreCodebaseDefinition: Anthropic.Tool = {
  name: 'explore_codebase',
  description:
    'Answer a repo understanding question in a separate child run using read-only code exploration. Returns a compact summary with key files.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      question: {
        type: 'string',
        description: 'The codebase question to answer.',
      },
      depth: {
        type: 'string',
        enum: ['quick', 'medium', 'thorough'],
        description:
          'How broadly to explore before answering. quick is targeted, medium is balanced, thorough traces more dependencies.',
      },
    },
    required: ['question'],
  },
}

export const exploreCodebaseTool: ToolHandler = async (input, context) => {
  const question = typeof input.question === 'string' ? input.question.trim() : ''
  if (!question) {
    return { success: false, error: 'question is required' }
  }
  if (!context.jobId || !context.agentId) {
    return { success: false, error: 'explore_codebase requires an active job and agent context' }
  }

  const depthInput = typeof input.depth === 'string' ? input.depth.trim() : 'medium'
  const depth: ExploreDepth = VALID_DEPTHS.has(depthInput as ExploreDepth)
    ? (depthInput as ExploreDepth)
    : 'medium'

  const [parentJob, agent] = await Promise.all([
    findJobById(context.jobId),
    findAgentById(context.agentId),
  ])
  if (!parentJob) {
    return { success: false, error: `Parent job not found: ${context.jobId}` }
  }
  if (!agent) {
    return { success: false, error: `Agent not found: ${context.agentId}` }
  }

  const workItem = await findWorkItemById(parentJob.work_item_id)
  if (!workItem) {
    return { success: false, error: `Work item not found: ${parentJob.work_item_id}` }
  }

  const childJob = await createChildJob(parentJob, {
    status: 'PENDING',
    run_kind: 'child_explore',
    origin_tool_name: 'explore_codebase',
    error_text: null,
    todo_state: null,
    final_response: null,
    started_at: null,
    completed_at: null,
  })

  try {
    const { runExploreChild } = await import('../../explore-runner')
    const output = await runExploreChild({
      agent,
      workItem,
      job: childJob,
      spriteName: context.spriteName,
      cwd: context.cwd ?? '/home/sprite',
      activeSandboxName: context.activeSandboxName,
      question,
      depth,
    })

    return {
      success: true,
      output: `${output}\n\n[child run: ${childJob.id}]`,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      output: `[child run: ${childJob.id}]`,
    }
  }
}
