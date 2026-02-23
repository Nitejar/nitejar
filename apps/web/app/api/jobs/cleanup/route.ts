import { type NextRequest, NextResponse } from 'next/server'
import { getSpriteSessionManager } from '@nitejar/sprites'
import { findIdleSessions } from '@nitejar/database'
import { compactSession } from '@nitejar/agent/session'
import { DEFAULT_COMPACTION_SETTINGS } from '@nitejar/agent/config'
import { devGuard } from '@/lib/dev-guard'

/**
 * POST /api/jobs/cleanup
 *
 * Cleans up:
 * 1. Idle conversation sessions (compacts them and cleans up sprite sessions)
 * 2. Orphaned sprite sessions that are stale
 * 3. Old closed/errored sprite session records
 *
 * Query params:
 * - idleThresholdSeconds: Sessions idle longer than this trigger compaction (default: 1800 = 30 min)
 * - maxAgeSeconds: Maximum age for active sprite sessions before considered stale (default: 3600 = 1 hour)
 * - deleteOlderThan: Delete closed/errored sessions older than this (default: 86400 = 24 hours)
 */
export async function POST(request: NextRequest) {
  const guard = devGuard()
  if (guard) return guard

  const url = new URL(request.url)
  const idleThresholdSeconds = parseInt(url.searchParams.get('idleThresholdSeconds') ?? '1800', 10)
  const maxAgeSeconds = parseInt(url.searchParams.get('maxAgeSeconds') ?? '3600', 10)
  const deleteOlderThan = parseInt(url.searchParams.get('deleteOlderThan') ?? '86400', 10)

  const results = {
    compactedSessions: 0,
    closedStale: 0,
    deleted: 0,
    errors: [] as string[],
  }

  try {
    // Step 1: Find and compact idle conversation sessions
    // This also cleans up their sprite sessions
    const idleSessions = await findIdleSessions(idleThresholdSeconds)

    for (const session of idleSessions) {
      try {
        await compactSession(session.sessionKey, session.agentId, DEFAULT_COMPACTION_SETTINGS)
        results.compactedSessions++
        console.log(
          `[cleanup] Compacted session: ${session.sessionKey} (agent: ${session.agentId})`
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        results.errors.push(`Failed to compact session ${session.sessionKey}: ${message}`)
        console.error(`[cleanup] Failed to compact session ${session.sessionKey}:`, error)
      }
    }

    // Step 2: Clean up orphaned/stale sprite sessions
    if (process.env.SPRITES_TOKEN) {
      try {
        const sessionManager = getSpriteSessionManager()
        const spriteCleanup = await sessionManager.cleanupStaleSessions(
          maxAgeSeconds,
          deleteOlderThan
        )
        results.closedStale = spriteCleanup.closedStale
        results.deleted = spriteCleanup.deleted

        console.log(
          `[cleanup] Sprite session cleanup: ${spriteCleanup.closedStale} stale closed, ${spriteCleanup.deleted} old records deleted`
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        results.errors.push(`Sprite cleanup failed: ${message}`)
        console.error('[cleanup] Sprite cleanup failed:', error)
      }
    }

    console.log(
      `[cleanup] Complete: ${results.compactedSessions} sessions compacted, ${results.closedStale} stale closed, ${results.deleted} deleted`
    )

    return NextResponse.json({
      ok: true,
      ...results,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[cleanup] Failed:', error)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

/**
 * GET /api/jobs/cleanup
 *
 * Returns info about the cleanup endpoint.
 */
export function GET() {
  const guard = devGuard()
  if (guard) return guard

  return NextResponse.json({
    endpoint: '/api/jobs/cleanup',
    method: 'POST',
    description: 'Compacts idle conversation sessions and cleans up sprite sessions',
    params: {
      idleThresholdSeconds:
        'Sessions idle longer than this trigger compaction (default: 1800 = 30 min)',
      maxAgeSeconds:
        'Maximum age for active sprite sessions before considered stale (default: 3600 = 1 hour)',
      deleteOlderThan:
        'Delete closed/errored sessions older than this in seconds (default: 86400 = 24 hours)',
    },
  })
}
