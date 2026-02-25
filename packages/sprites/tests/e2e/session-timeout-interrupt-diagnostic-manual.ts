#!/usr/bin/env npx tsx
/**
 * Manual e2e diagnostic for timeout interrupt recovery.
 *
 * This script checks whether timeout handling can recover the same session via
 * interrupt+probe, or falls back to session reset.
 *
 * Usage:
 *   export $(grep -v '^#' apps/web/.env | xargs)
 *   export DATABASE_URL=$(pwd)/packages/database/data/nitejar.db
 *   npx tsx packages/sprites/tests/e2e/session-timeout-interrupt-diagnostic-manual.ts <sprite-name>
 *
 * Optional:
 *   --require-recovery  Exit non-zero unless same-session interrupt recovery works.
 */

import { SpriteSessionManager } from '../../src/session'

function parseArgs(): { spriteName: string; requireRecovery: boolean } {
  let spriteName = ''
  let requireRecovery = false

  for (const arg of process.argv.slice(2)) {
    if (arg === '--require-recovery') {
      requireRecovery = true
      continue
    }
    if (!spriteName) {
      spriteName = arg.trim()
    }
  }

  if (!spriteName) {
    spriteName = process.env.SLOPBOT_TEST_SPRITE?.trim() || process.env.SPRITE_NAME?.trim() || ''
  }

  if (!spriteName) {
    throw new Error(
      'Sprite name required. Pass as arg or set SLOPBOT_TEST_SPRITE/SPRITE_NAME environment variable.'
    )
  }

  return { spriteName, requireRecovery }
}

async function main() {
  const { spriteName, requireRecovery } = parseArgs()
  const manager = new SpriteSessionManager()

  const sessionKey = `manual-timeout-interrupt-diagnostic-${Date.now()}`
  const agentId = 'manual-e2e-timeout-interrupt-diagnostic'

  console.log('=== Timeout interrupt diagnostic (manual e2e) ===')
  console.log('sprite:', spriteName)
  console.log('sessionKey:', sessionKey)
  console.log('requireRecovery:', requireRecovery)

  const { session, reused: initialReused } = await manager.getOrCreateSessionWithMeta(
    spriteName,
    sessionKey,
    agentId,
    {
      cwd: '/home/sprite',
      tty: false,
    }
  )

  console.log('initial session reused existing?', initialReused)

  try {
    console.log('\n1) Baseline check')
    const baseline = await session.exec('pwd && echo ok', { timeout: 15_000 })
    console.log('   baseline:', baseline)

    if (baseline.exitCode !== 0) {
      throw new Error('Baseline command failed')
    }

    console.log('\n2) Force timeout on long-running foreground command')
    const blocker = await session.exec('echo __BLOCKER_STARTED__ && sleep 600', { timeout: 2_500 })
    console.log('   blocker:', blocker)

    if (blocker.exitCode !== 124) {
      throw new Error(`Expected timeout exitCode=124, got ${blocker.exitCode}`)
    }

    const recoveredInPlace = blocker.stderr.includes(
      'Session recovered via interrupt after timeout.'
    )
    const resetFallback = blocker.stderr.includes(
      'Session reset after timeout to avoid a wedged shell.'
    )

    if (!recoveredInPlace && !resetFallback) {
      throw new Error('Timeout outcome did not include recovery or reset marker')
    }

    console.log('\n3) Probe existing session handle')
    const probeSameHandle = await session.exec('pwd && echo ok', { timeout: 5_000 })
    console.log('   same-handle probe:', probeSameHandle)

    console.log('\n4) Re-fetch same session key and probe')
    const { session: refetchedSession, reused: refetchedReused } =
      await manager.getOrCreateSessionWithMeta(spriteName, sessionKey, agentId, {
        cwd: '/home/sprite',
        tty: false,
      })
    console.log('   refetched session reused existing?', refetchedReused)
    const probeRefetched = await refetchedSession.exec('pwd && echo ok', { timeout: 10_000 })
    console.log('   refetched probe:', probeRefetched)

    if (recoveredInPlace) {
      if (probeSameHandle.exitCode !== 0) {
        throw new Error('Expected same session handle to remain healthy after in-place recovery')
      }
      if (!refetchedReused || probeRefetched.exitCode !== 0) {
        throw new Error('Expected same session key to reuse healthy recovered session')
      }
      console.log('\n✓ Interrupt recovery worked in-place')
    } else {
      if (probeSameHandle.stderr !== 'Session is closed') {
        throw new Error('Expected stale handle to be closed after reset fallback')
      }
      if (refetchedReused || probeRefetched.exitCode !== 0) {
        throw new Error('Expected re-fetch to create a new healthy session after reset fallback')
      }
      console.log('\n! Interrupt recovery did not work; reset fallback engaged')
      if (requireRecovery) {
        throw new Error('Interrupt recovery required but fallback reset was used')
      }
    }
  } finally {
    console.log('\n5) Cleanup')
    await manager.closeSessionForConversation(sessionKey, agentId)
  }
}

main().catch((error) => {
  console.error('\nERROR:', error)
  process.exit(1)
})
