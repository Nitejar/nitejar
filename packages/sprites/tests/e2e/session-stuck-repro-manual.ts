#!/usr/bin/env npx tsx
/**
 * Manual e2e check for timeout-induced session reset behavior.
 *
 * Verifies we no longer leave a wedged persistent session behind after timeout.
 *
 * Usage:
 *   export $(grep -v '^#' apps/web/.env | xargs)
 *   export DATABASE_URL=$(pwd)/packages/database/data/nitejar.db
 *   npx tsx packages/sprites/tests/e2e/session-stuck-repro-manual.ts <sprite-name>
 *
 * Sprite name can also come from SLOPBOT_TEST_SPRITE or SPRITE_NAME.
 */

import { SpriteSessionManager } from '../../src/session'

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
  if (!process.env.SPRITES_TOKEN) {
    throw new Error('SPRITES_TOKEN not set')
  }

  const spriteName = resolveSpriteName()
  const manager = new SpriteSessionManager()

  const sessionKey = `manual-stuck-repro-${Date.now()}`
  const agentId = 'manual-e2e-stuck-repro'

  console.log('=== Session timeout reset check (manual e2e) ===')
  console.log('sprite:', spriteName)
  console.log('sessionKey:', sessionKey)

  const session = await manager.getOrCreateSession(spriteName, sessionKey, agentId, {
    cwd: '/home/sprite',
    tty: false,
  })

  try {
    console.log('\n1) Baseline check (should pass)')
    const baseline = await session.exec('pwd && echo ok', { timeout: 15_000 })
    console.log('   baseline:', baseline)

    if (
      baseline.exitCode !== 0 ||
      !baseline.stdout.includes('/home/sprite') ||
      !baseline.stdout.includes('ok')
    ) {
      throw new Error('Baseline command failed; cannot continue repro')
    }

    console.log('\n2) Start long-running foreground command and force local timeout')
    const blocker = await session.exec('echo __BLOCKER_STARTED__ && sleep 600', { timeout: 2_500 })
    console.log('   blocker:', blocker)

    if (blocker.exitCode !== 124) {
      throw new Error(`Expected blocker timeout exitCode=124, got ${blocker.exitCode}`)
    }

    console.log('\n3) Probe same session handle (should now be closed/reset)')
    const probe = await session.exec('pwd && echo ok', { timeout: 5_000 })
    console.log('   probe:', probe)

    const resetWorked =
      probe.exitCode === 1 &&
      probe.stderr === 'Session is closed' &&
      blocker.stderr.includes('Session reset after timeout to avoid a wedged shell.')

    if (!resetWorked) {
      throw new Error('Expected timeout-triggered session reset and closed stale handle')
    }

    console.log('\n✓ Timeout reset behavior verified (stale session handle closed)')
  } finally {
    console.log('\n4) Cleanup')
    await manager.closeSessionForConversation(sessionKey, agentId)
  }
}

main().catch((error) => {
  console.error('\nERROR:', error)
  process.exit(1)
})
