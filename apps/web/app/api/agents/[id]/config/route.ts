import { type NextRequest, NextResponse } from 'next/server'
import { findAgentById, updateAgent } from '@nitejar/database'
import { parseAgentConfig, mergeAgentConfig, serializeAgentConfig } from '@nitejar/agent/config'
import type { AgentConfig } from '@nitejar/agent/types'
import { requireApiAuth, requireApiRole } from '@/lib/api-auth'
import { getModelCatalogRecordByExternalId } from '@/server/services/model-catalog'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/agents/[id]/config
 * Get the agent's configuration
 */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const unauthorized = await requireApiAuth(request)
  if (unauthorized) return unauthorized

  const { id } = await context.params

  const agent = await findAgentById(id)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const config = parseAgentConfig(agent.config)
  return NextResponse.json({ config })
}

/**
 * PUT /api/agents/[id]/config
 * Update the agent's configuration
 */
export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const unauthorized = await requireApiRole(request)
  if (unauthorized) return unauthorized

  const { id } = await context.params

  const agent = await findAgentById(id)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  let updates: Partial<AgentConfig>
  try {
    updates = (await request.json()) as Partial<AgentConfig>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Merge updates into existing config
  const existingConfig = parseAgentConfig(agent.config)
  const newConfig = mergeAgentConfig(existingConfig, updates)
  if (newConfig.model) {
    const modelRecord = await getModelCatalogRecordByExternalId(newConfig.model)
    if (modelRecord?.metadata?.supportsReasoningControl === false) {
      const normalizedTriageSettings = {
        ...newConfig.triageSettings,
        reasoningEffort: undefined,
      }
      newConfig.triageSettings =
        normalizedTriageSettings.maxTokens !== undefined ||
        normalizedTriageSettings.recentHistoryMaxChars !== undefined ||
        normalizedTriageSettings.recentHistoryLookbackMessages !== undefined ||
        normalizedTriageSettings.recentHistoryPerMessageMaxChars !== undefined
          ? normalizedTriageSettings
          : undefined
    }
  }
  const configJson = serializeAgentConfig(newConfig)

  // Update agent
  const updated = await updateAgent(id, { config: configJson })
  if (!updated) {
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 })
  }

  return NextResponse.json({ config: newConfig })
}

/**
 * PATCH /api/agents/[id]/config
 * Partially update the agent's configuration (same as PUT)
 */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return PUT(request, context)
}
