#!/usr/bin/env npx tsx
/**
 * Test script for sprite session execution - independent of the agent/model
 */

import { SpriteSessionManager } from '../../src/session'

async function main() {
  console.log('=== Testing Sprite Session ===\n')

  const spriteName = 'nitejar-fa61a8b7-8dd7-4182-ab74-aeb4e940e095'
  const sessionKey = `test-session-${Date.now()}`
  const agentId = 'test-agent-001'

  console.log('1. Creating session manager...')
  const manager = new SpriteSessionManager()

  console.log('2. Creating session for conversation:', sessionKey)
  let allPassed = true

  try {
    const session = await manager.getOrCreateSession(spriteName, sessionKey, agentId, {
      cwd: '/home/sprite',
      tty: false,
    })
    console.log('   Session created:', {
      sessionId: session.sessionId,
      spriteName: session.spriteName,
      recordId: session.recordId,
    })

    // Test 1: Basic echo
    console.log('\n3. Test: echo hello')
    const result1 = await session.exec('echo hello')
    console.log('   Result:', result1)
    if (result1.exitCode !== 0 || result1.stdout !== 'hello') {
      console.log('   ❌ FAILED: Expected exitCode=0, stdout="hello"')
      allPassed = false
    } else {
      console.log('   ✓ PASSED')
    }

    // Test 2: pwd in home
    console.log('\n4. Test: pwd (should be /home/sprite)')
    const result2 = await session.exec('pwd')
    console.log('   Result:', result2)
    if (result2.exitCode !== 0 || result2.stdout !== '/home/sprite') {
      console.log('   ❌ FAILED: Expected /home/sprite')
      allPassed = false
    } else {
      console.log('   ✓ PASSED')
    }

    // Test 3: cd persistence
    console.log('\n5. Test: cd /tmp persists')
    const result3 = await session.exec('cd /tmp')
    console.log('   cd result:', result3)
    const result4 = await session.exec('pwd')
    console.log('   pwd result:', result4)
    if (result4.stdout !== '/tmp') {
      console.log('   ❌ FAILED: Expected /tmp, got:', result4.stdout)
      allPassed = false
    } else {
      console.log('   ✓ PASSED')
    }

    // Test 4: Environment variable persistence
    console.log('\n6. Test: env var persistence')
    await session.exec('export MY_VAR=test123')
    const result5 = await session.exec('echo $MY_VAR')
    console.log('   echo $MY_VAR:', result5)
    if (result5.stdout !== 'test123') {
      console.log('   ❌ FAILED: Expected test123, got:', result5.stdout)
      allPassed = false
    } else {
      console.log('   ✓ PASSED')
    }

    // Test 5: Exit code for failed command
    // Note: Don't use 'exit N' as it kills the persistent bash session
    console.log('\n7. Test: exit code for failed command')
    const result6 = await session.exec('false')
    console.log('   false result:', result6)
    if (result6.exitCode !== 1) {
      console.log('   ❌ FAILED: Expected exitCode=1, got:', result6.exitCode)
      allPassed = false
    } else {
      console.log('   ✓ PASSED')
    }

    // Test with specific exit code using subshell
    console.log('\n7b. Test: specific exit code via subshell')
    const result7 = await session.exec('(exit 42)')
    console.log('   (exit 42) result:', result7)
    if (result7.exitCode !== 42) {
      console.log('   ❌ FAILED: Expected exitCode=42, got:', result7.exitCode)
      allPassed = false
    } else {
      console.log('   ✓ PASSED')
    }

    // Test 6: Multi-line output
    console.log('\n8. Test: multi-line output')
    const result8 = await session.exec('echo -e "line1\\nline2\\nline3"')
    console.log('   Result:', result8)
    const lines = result8.stdout.split('\n')
    if (lines.length !== 3 || lines[0] !== 'line1' || lines[2] !== 'line3') {
      console.log('   ❌ FAILED: Expected 3 lines')
      allPassed = false
    } else {
      console.log('   ✓ PASSED')
    }

    // Test 6b: Multi-line command input should not leak prompt/echo artifacts
    console.log('\n8b. Test: multiline command parsing cleanup')
    const result8b = await session.exec(
      'if [ -f ~/.nitejar/env ]; then . ~/.nitejar/env; fi\necho hello'
    )
    console.log('   Result:', result8b)
    if (
      result8b.exitCode !== 0 ||
      result8b.stdout !== 'hello' ||
      result8b.stdout.includes('__SLOPBOT_EXIT_') ||
      result8b.stdout.includes('sprite@sprite:')
    ) {
      console.log('   ❌ FAILED: Expected clean stdout "hello" without prompt/marker artifacts')
      allPassed = false
    } else {
      console.log('   ✓ PASSED')
    }

    // Test 6c: Terminal control sequences should be stripped from stdout
    console.log('\n8c. Test: terminal escape sequence cleanup')
    const result8c = await session.exec(String.raw`printf '\033]11;?\033\\[6n\033[?25l[Kvisible\n'`)
    console.log('   Result:', result8c)
    if (
      result8c.exitCode !== 0 ||
      result8c.stdout !== 'visible' ||
      result8c.stdout.includes(']11;') ||
      result8c.stdout.includes('[6n') ||
      result8c.stdout.includes('[?25l') ||
      result8c.stdout.includes('[K')
    ) {
      console.log('   ❌ FAILED: Expected clean stdout "visible" with control sequences removed')
      allPassed = false
    } else {
      console.log('   ✓ PASSED')
    }

    // Test 7: Rapid sequential commands (stress test keepalive)
    console.log('\n9. Test: rapid sequential commands')
    const rapidResults: number[] = []
    for (let i = 0; i < 5; i++) {
      const r = await session.exec(`echo ${i}`)
      rapidResults.push(r.exitCode)
    }
    if (rapidResults.every((code) => code === 0)) {
      console.log('   ✓ PASSED - all 5 rapid commands succeeded')
    } else {
      console.log('   ❌ FAILED - some rapid commands failed:', rapidResults)
      allPassed = false
    }

    // Test 8: Multi-job persistence (key new feature)
    console.log('\n10. Test: multi-job session persistence')
    console.log('    Setting state: cd /var, export MULTI_JOB=works')
    await session.exec('cd /var')
    await session.exec('export MULTI_JOB=works')

    // Simulate "job 2" - get session again with same sessionKey/agentId
    console.log('    Getting session again (simulating new job)...')
    const session2 = await manager.getOrCreateSession(spriteName, sessionKey, agentId, {
      cwd: '/home/sprite',
      tty: false,
    })
    console.log(
      '    Same session ID?',
      session.sessionId === session2.sessionId ? '✓ YES' : '✗ NO (new session created)'
    )

    const pwd2 = await session2.exec('pwd')
    const env2 = await session2.exec('echo $MULTI_JOB')
    console.log('    pwd:', pwd2.stdout, '(expected: /var)')
    console.log('    $MULTI_JOB:', env2.stdout, '(expected: works)')

    if (pwd2.stdout !== '/var' || env2.stdout !== 'works') {
      console.log('   ❌ FAILED: State not persisted across jobs')
      allPassed = false
    } else {
      console.log('   ✓ PASSED')
    }

    console.log('\n11. Closing session...')
    await session2.close()
    console.log('   Session closed')

    console.log('\n=== TEST COMPLETE ===')
    console.log(allPassed ? '✓ All tests passed!' : '❌ Some tests failed')
    process.exit(allPassed ? 0 : 1)
  } catch (error) {
    console.error('\nERROR:', error)
    process.exit(1)
  }
}

main()
