# Task ID: 135

**Title:** Write integration tests for network policy feature

**Status:** done

**Dependencies:** 132 ✓, 134 ✓

**Priority:** medium

**Description:** Create comprehensive integration tests covering the full network policy flow including CRUD operations, preset application, and Sprites sync.

**Details:**

Create test file `packages/integration-tests/tests/network-policy.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, parseAgentConfig } from '@nitejar/database';
import { NETWORK_POLICY_PRESETS, DEFAULT_NETWORK_POLICY, validateNetworkPolicy } from '@nitejar/agent';

describe('Network Policy Feature', () => {
  let testAgentId: string;

  beforeEach(async () => {
    // Create test agent
    testAgentId = `test-agent-${Date.now()}`;
    await db.insertInto('agents').values({
      id: testAgentId,
      handle: 'test-agent',
      name: 'Test Agent',
      config: '{}',
      status: 'idle',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).execute();
  });

  afterEach(async () => {
    // Clean up test agent
    await db.deleteFrom('agents').where('id', '=', testAgentId).execute();
  });

  describe('Policy Presets', () => {
    it('should have all required presets defined', () => {
      const presetIds = NETWORK_POLICY_PRESETS.map(p => p.id);
      expect(presetIds).toContain('unrestricted');
      expect(presetIds).toContain('github-only');
      expect(presetIds).toContain('development');
      expect(presetIds).toContain('lockdown');
    });

    it('should validate all presets as valid policies', () => {
      for (const preset of NETWORK_POLICY_PRESETS) {
        const result = validateNetworkPolicy(preset.policy);
        expect(result.valid, `Preset ${preset.id} should be valid`).toBe(true);
      }
    });

    it('development preset should be the default', () => {
      expect(DEFAULT_NETWORK_POLICY.presetId).toBe('development');
    });
  });

  describe('Policy Storage', () => {
    it('should save policy to agent config', async () => {
      const policy = NETWORK_POLICY_PRESETS.find(p => p.id === 'github-only')!.policy;
      
      // Simulate setting policy (would be done via tRPC in real usage)
      const agent = await db.selectFrom('agents').where('id', '=', testAgentId).executeTakeFirst();
      const config = parseAgentConfig(agent!.config);
      config.networkPolicy = policy;
      
      await db.updateTable('agents')
        .set({ config: JSON.stringify(config) })
        .where('id', '=', testAgentId)
        .execute();
      
      // Verify saved
      const updated = await db.selectFrom('agents').where('id', '=', testAgentId).executeTakeFirst();
      const savedConfig = parseAgentConfig(updated!.config);
      
      expect(savedConfig.networkPolicy).toBeDefined();
      expect(savedConfig.networkPolicy?.presetId).toBe('github-only');
      expect(savedConfig.networkPolicy?.rules.length).toBeGreaterThan(0);
    });

    it('should handle agent without network policy', async () => {
      const agent = await db.selectFrom('agents').where('id', '=', testAgentId).executeTakeFirst();
      const config = parseAgentConfig(agent!.config);
      
      expect(config.networkPolicy).toBeUndefined();
    });
  });

  describe('Policy Validation', () => {
    it('should reject empty rules array', () => {
      const result = validateNetworkPolicy({
        mode: 'allow-list',
        rules: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Policy must have at least one rule');
    });

    it('should reject invalid domain patterns', () => {
      const result = validateNetworkPolicy({
        mode: 'allow-list',
        rules: [{ domain: '', action: 'allow' }],
      });
      expect(result.valid).toBe(false);
    });

    it('should warn about missing catch-all rule', () => {
      const result = validateNetworkPolicy({
        mode: 'allow-list',
        rules: [{ domain: 'github.com', action: 'allow' }],
      });
      expect(result.errors).toContain('Policy should include a catch-all (*) rule as the last entry');
    });
  });

  // Note: Sprites API sync tests would require mocking or a test Sprites instance
  describe('Sprites Sync', () => {
    it.skip('should sync policy when sprite exists', async () => {
      // Would test actual Sprites API integration
    });
  });
});
```

Run tests with: `pnpm --filter @nitejar/integration-tests test`

**Test Strategy:**

Meta: This task IS the test strategy implementation.

1. Run all tests pass in CI/CD pipeline
2. Verify test coverage meets minimum threshold (aim for 80%+ on new code)
3. Tests should be deterministic and not flaky
4. Tests should clean up after themselves (no test pollution)
5. Consider adding E2E tests with agent-browser for UI flows
