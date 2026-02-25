import { type NextRequest, NextResponse } from 'next/server'
import { findAgentById, listMemories, deleteMemory, toggleMemoryPermanent } from '@nitejar/database'
import { createMemoryWithEmbedding, updateMemoryWithEmbedding } from '@nitejar/agent/memory'
import { requireApiAuth, requireApiRole } from '@/lib/api-auth'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/agents/[id]/memories
 * List all memories for an agent
 */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const unauthorized = await requireApiAuth(request)
  if (unauthorized) return unauthorized

  const { id } = await context.params

  const agent = await findAgentById(id)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // Get optional minStrength filter
  const searchParams = request.nextUrl.searchParams
  const minStrength = parseFloat(searchParams.get('minStrength') || '0')

  const memories = await listMemories(id, minStrength)

  // Transform to API format (camelCase, parse permanent)
  const formatted = memories.map((m) => ({
    id: m.id,
    agentId: m.agent_id,
    content: m.content,
    strength: m.strength,
    accessCount: m.access_count,
    permanent: m.permanent === 1,
    memoryKind: m.memory_kind,
    lastAccessedAt: m.last_accessed_at,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  }))

  return NextResponse.json({ memories: formatted })
}

/**
 * POST /api/agents/[id]/memories
 * Create a new memory
 */
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const unauthorized = await requireApiRole(request)
  if (unauthorized) return unauthorized

  const { id } = await context.params

  const agent = await findAgentById(id)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  let body: { content?: string; permanent?: boolean }
  try {
    body = (await request.json()) as { content?: string; permanent?: boolean }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 })
  }

  const memory = await createMemoryWithEmbedding(id, body.content.trim(), body.permanent ?? false)

  return NextResponse.json({
    memory: {
      id: memory.id,
      agentId: memory.agent_id,
      content: memory.content,
      strength: memory.strength,
      accessCount: memory.access_count,
      permanent: memory.permanent === 1,
      memoryKind: memory.memory_kind,
      lastAccessedAt: memory.last_accessed_at,
      createdAt: memory.created_at,
      updatedAt: memory.updated_at,
    },
  })
}

/**
 * PUT /api/agents/[id]/memories
 * Update a memory (requires memoryId in body)
 */
export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const unauthorized = await requireApiRole(request)
  if (unauthorized) return unauthorized

  const { id } = await context.params

  const agent = await findAgentById(id)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  let body: { memoryId?: string; content?: string }
  try {
    body = (await request.json()) as { memoryId?: string; content?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.memoryId) {
    return NextResponse.json({ error: 'memoryId is required' }, { status: 400 })
  }

  if (!body.content || typeof body.content !== 'string' || !body.content.trim()) {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 })
  }

  const memory = await updateMemoryWithEmbedding(body.memoryId, body.content.trim())
  if (!memory) {
    return NextResponse.json({ error: 'Memory not found' }, { status: 404 })
  }

  return NextResponse.json({
    memory: {
      id: memory.id,
      agentId: memory.agent_id,
      content: memory.content,
      strength: memory.strength,
      accessCount: memory.access_count,
      permanent: memory.permanent === 1,
      memoryKind: memory.memory_kind,
      lastAccessedAt: memory.last_accessed_at,
      createdAt: memory.created_at,
      updatedAt: memory.updated_at,
    },
  })
}

/**
 * DELETE /api/agents/[id]/memories
 * Delete a memory (requires memoryId in body)
 */
export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const unauthorized = await requireApiRole(request)
  if (unauthorized) return unauthorized

  const { id } = await context.params

  const agent = await findAgentById(id)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  let body: { memoryId?: string }
  try {
    body = (await request.json()) as { memoryId?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.memoryId) {
    return NextResponse.json({ error: 'memoryId is required' }, { status: 400 })
  }

  const deleted = await deleteMemory(body.memoryId)
  if (!deleted) {
    return NextResponse.json({ error: 'Memory not found' }, { status: 404 })
  }

  return NextResponse.json({ deleted: true })
}

/**
 * PATCH /api/agents/[id]/memories
 * Toggle permanent status of a memory
 */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const unauthorized = await requireApiRole(request)
  if (unauthorized) return unauthorized

  const { id } = await context.params

  const agent = await findAgentById(id)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  let body: { memoryId?: string; action?: string }
  try {
    body = (await request.json()) as { memoryId?: string; action?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.memoryId) {
    return NextResponse.json({ error: 'memoryId is required' }, { status: 400 })
  }

  if (body.action === 'togglePermanent') {
    const memory = await toggleMemoryPermanent(body.memoryId)
    if (!memory) {
      return NextResponse.json({ error: 'Memory not found' }, { status: 404 })
    }

    return NextResponse.json({
      memory: {
        id: memory.id,
        agentId: memory.agent_id,
        content: memory.content,
        strength: memory.strength,
        accessCount: memory.access_count,
        permanent: memory.permanent === 1,
        memoryKind: memory.memory_kind,
        lastAccessedAt: memory.last_accessed_at,
        createdAt: memory.created_at,
        updatedAt: memory.updated_at,
      },
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
