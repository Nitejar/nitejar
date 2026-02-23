# Task ID: 126

**Title:** Implement Sprites API network policy integration

**Status:** done

**Dependencies:** 124 ✓

**Priority:** high

**Description:** Add methods to the Sprites client to get and set network policies on sprites, enabling policy sync when agents are updated.

**Details:**

Extend `packages/sprites/src/client.ts` to add network policy methods:

```typescript
import { NetworkPolicyRule } from '@nitejar/agent';

export interface SpritesNetworkPolicy {
  rules: NetworkPolicyRule[];
}

// Add to SpritesClient class or create functions:

export async function getSpriteNetworkPolicy(spriteName: string): Promise<SpritesNetworkPolicy | null> {
  const client = getSpritesClient();
  try {
    const response = await client.get(`/v1/sprites/${spriteName}/policy/network`);
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) return null;
    throw error;
  }
}

export async function setSpriteNetworkPolicy(
  spriteName: string,
  policy: SpritesNetworkPolicy
): Promise<SpritesNetworkPolicy> {
  const client = getSpritesClient();
  const response = await client.post(`/v1/sprites/${spriteName}/policy/network`, {
    rules: policy.rules,
  });
  return response.data;
}
```

Create a higher-level sync function that handles the full workflow:

```typescript
export async function syncAgentNetworkPolicy(
  spriteName: string | null,
  policy: NetworkPolicy
): Promise<{ synced: boolean; error?: string }> {
  if (!spriteName) {
    return { synced: false, error: 'No sprite assigned to agent' };
  }
  
  try {
    await setSpriteNetworkPolicy(spriteName, { rules: policy.rules });
    return { synced: true };
  } catch (error: any) {
    console.error('Failed to sync network policy to Sprites:', error);
    return { synced: false, error: error.message || 'Failed to sync policy' };
  }
}
```

Export new functions from `packages/sprites/src/index.ts`.

**Test Strategy:**

1. Mock Sprites API client and test getSpriteNetworkPolicy returns policy on success
2. Test getSpriteNetworkPolicy returns null on 404
3. Test setSpriteNetworkPolicy sends correct payload format
4. Test syncAgentNetworkPolicy handles missing sprite gracefully
5. Test syncAgentNetworkPolicy handles API errors and returns appropriate error message
6. Integration test with actual Sprites API (if test environment available)
