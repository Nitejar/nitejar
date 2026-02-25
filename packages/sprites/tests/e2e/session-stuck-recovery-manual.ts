#!/usr/bin/env npx tsx
/**
 * Manual e2e recovery checks for stuck persistent sprite sessions.
 *
 * This script validates timeout recovery behavior:
 * 1) timeout invalidates the stale session handle,
 * 2) re-fetching the same session key creates a fresh healthy session,
 * 3) fresh session key succeeds,
 * 4) stateless HTTP exec succeeds.
 *
 * Usage:
 *   export $(grep -v '^#' apps/web/.env | xargs)
 *   export DATABASE_URL=$(pwd)/packages/database/data/nitejar.db
 *   npx tsx packages/sprites/tests/e2e/session-stuck-recovery-manual.ts <sprite-name>
 *
 * Sprite name can also come from SLOPBOT_TEST_SPRITE or SPRITE_NAME.
 */

import { SpriteSessionManager } from '../../src/session'
import { spriteExecHttp } from '../../src/exec'

function resolveSpriteName(): string {
  const fromArg = process.argv[2]?.trim()
  const fromEnv = process.env.SLOPBOT_TEST_SPRITE?.trim() || process.env.SPRITE_NAME?.trim()
  const spriteName = fromArg || fromEnv

  if (!spriteName) {
    throw new Error(
      'Sprite name required. Pass as arg or set SLOPBOT_TEST_SPRITE/SPRITE_NAME environment variable.'
    )
  }

  return spriteName
}

async function main() {
  const spriteName = resolveSpriteName()
  const manager = new SpriteSessionManager()

  const stuckSessionKey = `manual-stuck-recovery-${Date.now()}`
  const freshSessionKey = `${stuckSessionKey}-fresh`
  const agentId = 'manual-e2e-stuck-recovery'

  console.log('=== Session stuck recovery checks (manual e2e) ===')
  console.log('sprite:', spriteName)
  console.log('stuckSessionKey:', stuckSessionKey)
  console.log('freshSessionKey:', freshSessionKey)

  try {
    const { session: stuckSession } = await manager.getOrCreateSessionWithMeta(
      spriteName,
      stuckSessionKey,
      agentId,
      {
        cwd: '/home/sprite',
        tty: false,
      }
    )

    console.log('\n1) Wedge the persistent session (timeout while foreground command continues)')
    const blocker = await stuckSession.exec('echo __BLOCKER_STARTED__ && sleep 600', {
      timeout: 2_500,
    })
    console.log('   blocker:', blocker)

    console.log('\n2) Re-fetch and probe same session key (should recreate and recover)')
    const { session: sameKeySession, reused: sameKeyReused } =
      await manager.getOrCreateSessionWithMeta(spriteName, stuckSessionKey, agentId, {
        cwd: '/home/sprite',
        tty: false,
      })
    console.log('   same session reused existing?', sameKeyReused)
    const probeSame = await sameKeySession.exec('pwd && echo ok', { timeout: 5_000 })
    console.log('   probe same:', probeSame)

    const sameKeyRecoveredAsExpected =
      sameKeyReused === false &&
      probeSame.exitCode === 0 &&
      probeSame.stdout.includes('/home/sprite')

    if (!sameKeyRecoveredAsExpected) {
      throw new Error('Expected same-session-key re-fetch to recover with a new healthy session')
    }

    console.log('\n3) Probe fresh session key (should recover)')
    const { session: freshSession, reused } = await manager.getOrCreateSessionWithMeta(
      spriteName,
      freshSessionKey,
      agentId,
      {
        cwd: '/home/sprite',
        tty: false,
      }
    )

    console.log('   fresh session reused existing?', reused)
    const probeFresh = await freshSession.exec('pwd && echo ok', { timeout: 15_000 })
    console.log('   probe fresh:', probeFresh)

    if (probeFresh.exitCode !== 0 || !probeFresh.stdout.includes('/home/sprite')) {
      throw new Error('Expected fresh session key to succeed')
    }

    console.log('\n4) Stateless HTTP exec check (should also succeed)')
    const stateless = await spriteExecHttp(spriteName, 'pwd && echo ok', {
      cwd: '/home/sprite',
      timeout: 15_000,
    })
    console.log('   stateless:', stateless)

    if (stateless.exitCode !== 0 || !stateless.stdout.includes('/home/sprite')) {
      throw new Error('Expected stateless HTTP exec to succeed')
    }

    console.log('\n✓ Recovery checks passed (fresh session + stateless execution still healthy)')
  } finally {
    console.log('\n5) Cleanup')
    await manager.closeSessionForConversation(stuckSessionKey, agentId)
    await manager.closeSessionForConversation(freshSessionKey, agentId)
  }
}

main().catch((error) => {
  console.error('\nERROR:', error)
  process.exit(1)
})
