#!/usr/bin/env npx tsx
/**
 * Manual e2e POC for timeout reset + cwd restore.
 *
 * Validates:
 * 1) timeout triggers reset fallback,
 * 2) same session key re-fetch creates a new session,
 * 3) new session starts in last known good cwd when passed as create cwd.
 *
 * Usage:
 *   export $(grep -v '^#' apps/web/.env | xargs)
 *   export DATABASE_URL=$(pwd)/packages/database/data/nitejar.db
 *   npx tsx packages/sprites/tests/e2e/session-timeout-cwd-restore-poc-manual.ts <sprite-name>
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
  const spriteName = resolveSpriteName()
  const manager = new SpriteSessionManager()
  const sessionKey = `manual-timeout-cwd-restore-poc-${Date.now()}`
  const agentId = 'manual-e2e-timeout-cwd-restore-poc'
  const targetCwd = '/tmp'

  console.log('=== Timeout reset + cwd restore POC ===')
  console.log('sprite:', spriteName)
  console.log('sessionKey:', sessionKey)
  console.log('targetCwd:', targetCwd)

  const { session } = await manager.getOrCreateSessionWithMeta(spriteName, sessionKey, agentId, {
    cwd: '/home/sprite',
    tty: false,
  })

  try {
    console.log('\n1) Prime session with last known good cwd')
    const prep = await session.exec(`cd ${targetCwd} && pwd`, { timeout: 10_000 })
    console.log('   prep:', prep)
    if (prep.exitCode !== 0 || prep.stdout.trim() !== targetCwd) {
      throw new Error(`Failed to prime cwd to ${targetCwd}`)
    }

    console.log('\n2) Force timeout so session gets invalidated/reset')
    const blocker = await session.exec('echo __BLOCKER_STARTED__ && sleep 600', { timeout: 2_500 })
    console.log('   blocker:', blocker)
    if (
      blocker.exitCode !== 124 ||
      !blocker.stderr.includes('Session reset after timeout to avoid a wedged shell.')
    ) {
      throw new Error('Expected timeout reset fallback did not occur')
    }

    console.log('\n3) Re-fetch same session key with restored cwd and verify start dir')
    const { session: recreated, reused } = await manager.getOrCreateSessionWithMeta(
      spriteName,
      sessionKey,
      agentId,
      {
        cwd: targetCwd,
        tty: false,
      }
    )
    console.log('   recreated reused existing?', reused)
    const pwd = await recreated.exec('pwd', { timeout: 10_000 })
    console.log('   pwd:', pwd)

    if (reused) {
      throw new Error('Expected new session after reset, but session was reused')
    }
    if (pwd.exitCode !== 0 || pwd.stdout.trim() !== targetCwd) {
      throw new Error(`Expected recreated session cwd=${targetCwd}, got "${pwd.stdout.trim()}"`)
    }

    console.log('\n✓ POC passed: reset fallback + cwd restore works')
  } finally {
    console.log('\n4) Cleanup')
    await manager.closeSessionForConversation(sessionKey, agentId)
  }
}

main().catch((error) => {
  console.error('\nERROR:', error)
  process.exit(1)
})
