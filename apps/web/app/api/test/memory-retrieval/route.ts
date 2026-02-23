import { type NextRequest, NextResponse } from 'next/server'
import { findAgentById } from '@nitejar/database'
import { parseAgentConfig } from '@nitejar/agent/config'
import { retrieveMemories } from '@nitejar/agent/memory'
import { buildSystemPrompt } from '@nitejar/agent/prompt-builder'
import { devGuard } from '@/lib/dev-guard'

/**
 * GET /api/test/memory-retrieval?agentId=xxx&context=xxx
 * Test memory retrieval and prompt building
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = devGuard()
  if (guard) return guard

  const agentId = request.nextUrl.searchParams.get('agentId')
  const context = request.nextUrl.searchParams.get('context') || 'test context'

  if (!agentId) {
    return NextResponse.json({ error: 'agentId required' }, { status: 400 })
  }

  const agent = await findAgentById(agentId)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const config = parseAgentConfig(agent.config)

  // Test memory retrieval
  const memories = await retrieveMemories(agentId, context, config)

  // Test prompt building with a mock work item
  const mockWorkItem = {
    id: 'test-work-item',
    plugin_instance_id: null,
    session_key: 'test',
    source: 'test',
    source_ref: 'test',
    status: 'NEW',
    title: context,
    payload: JSON.stringify({ body: 'Test body content' }),
    created_at: Math.floor(Date.now() / 1000),
    updated_at: Math.floor(Date.now() / 1000),
  }

  const systemPrompt = await buildSystemPrompt(agent, mockWorkItem)

  return NextResponse.json({
    agentName: agent.name,
    config,
    memoriesRetrieved: memories.length,
    memories: memories.map((m) => ({
      content: m.content,
      score: m.score,
      strength: m.strength,
      permanent: m.permanent,
      similarity: m.similarity,
    })),
    systemPromptLength: systemPrompt.length,
    systemPromptPreview: systemPrompt.slice(0, 500) + (systemPrompt.length > 500 ? '...' : ''),
  })
}
