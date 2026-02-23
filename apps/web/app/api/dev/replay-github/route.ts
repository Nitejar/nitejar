import { type NextRequest, NextResponse } from 'next/server'
import {
  parseGithubEvent,
  sessionKeyFromIssue,
  sourceRefFromComment,
} from '@nitejar/connectors-github'
import { checkIdempotencyKey, recordIdempotencyKey } from '@nitejar/database'
import { getWorkItemStore } from '@/lib/store'
import { devGuard } from '@/lib/dev-guard'

interface WebhookPayload {
  action?: string
  comment?: {
    id?: number
    body?: string
  }
  issue?: {
    number?: number
    title?: string
  }
  repository?: {
    name?: string
    full_name?: string
    owner?: {
      login?: string
    }
  }
}

interface ReplayRequestBody {
  payload: WebhookPayload
  headers?: Record<string, string>
}

function extractOwnerRepo(payload: WebhookPayload): { owner: string; repo: string } | null {
  const repository = payload.repository
  if (!repository) return null

  if (repository.owner?.login && repository.name) {
    return { owner: repository.owner.login, repo: repository.name }
  }

  if (repository.full_name) {
    const parts = repository.full_name.split('/')
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts[1] }
    }
  }

  return null
}

export async function POST(request: NextRequest) {
  const guard = devGuard()
  if (guard) return guard

  let body: ReplayRequestBody
  try {
    body = (await request.json()) as ReplayRequestBody
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  if (!body.payload) {
    return NextResponse.json({ ok: false, error: 'payload_required' }, { status: 400 })
  }

  const payload = body.payload

  // Build mock headers
  const headers = new Headers()
  headers.set('x-github-event', body.headers?.['x-github-event'] ?? 'issue_comment')
  headers.set('x-github-delivery', body.headers?.['x-github-delivery'] ?? crypto.randomUUID())

  // Parse the event (skipping signature verification)
  const event = parseGithubEvent(headers, payload)

  // Only process issue_comment events
  if (event.eventName !== 'issue_comment') {
    return NextResponse.json({ ok: true, ignored: true, reason: 'not_issue_comment' })
  }

  // Extract required fields
  const ownerRepo = extractOwnerRepo(payload)
  const issueNumber = payload.issue?.number
  const commentId = payload.comment?.id

  if (!ownerRepo || issueNumber === undefined || commentId === undefined) {
    return NextResponse.json({ ok: true, ignored: true, reason: 'missing_fields' })
  }

  const { owner, repo } = ownerRepo

  const deliveryId = headers.get('x-github-delivery')!
  const sessionKey = sessionKeyFromIssue({ owner, repo, issueNumber })
  const sourceRef = sourceRefFromComment({ owner, repo, issueNumber, commentId })

  // Check idempotency using delivery ID (only when using Postgres)
  if (process.env.POSTGRES_URL) {
    const idempotencyResult = await checkIdempotencyKey(deliveryId)
    if (idempotencyResult.isDuplicate) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        workItemId: idempotencyResult.workItemId,
        sessionKey,
        deliveryId,
      })
    }
  }

  // Create work item
  const store = getWorkItemStore()
  const workItem = await store.create({
    sessionKey,
    source: 'github',
    sourceRef,
    title: payload.issue?.title ?? `Issue #${issueNumber}`,
    payload,
  })

  // Record idempotency key (only when using Postgres)
  if (process.env.POSTGRES_URL) {
    await recordIdempotencyKey(deliveryId, workItem.id)
  }

  return NextResponse.json({
    ok: true,
    workItemId: workItem.id,
    sessionKey,
    deliveryId,
  })
}
