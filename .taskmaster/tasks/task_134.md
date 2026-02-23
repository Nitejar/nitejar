# Task ID: 134

**Title:** Add error handling and retry sync functionality

**Status:** done

**Dependencies:** 131 ✓

**Priority:** medium

**Description:** Implement robust error handling for Sprites API sync failures, including UI feedback and retry capability when local and remote policies are out of sync.

**Details:**

Enhance the NetworkPolicySection to handle sync failures gracefully:

```typescript
// Add sync status tracking to the component
interface SyncStatus {
  synced: boolean;
  lastSyncAttempt?: Date;
  error?: string;
}

// In NetworkPolicySection:
const [syncStatus, setSyncStatus] = useState<SyncStatus>({ synced: true });

// Update sync status after policy operations
const handleSaveChanges = async () => {
  if (!localPolicy) return;
  try {
    const result = await setPolicy.mutateAsync({ agentId, policy: localPolicy });
    setSyncStatus({
      synced: result.synced,
      lastSyncAttempt: new Date(),
      error: result.syncError,
    });
    // ... existing success handling
  } catch (error: any) {
    // ... existing error handling
  }
};

const handleRetrySync = async () => {
  try {
    const result = await retrySync.mutateAsync({ agentId });
    setSyncStatus({
      synced: result.synced,
      lastSyncAttempt: new Date(),
      error: result.error,
    });
    if (result.synced) {
      setMessage({ type: 'success', text: 'Policy synced successfully' });
    } else {
      setMessage({ type: 'error', text: `Sync failed: ${result.error}` });
    }
  } catch (error: any) {
    setMessage({ type: 'error', text: error.message });
  }
};

// Add sync status banner in UI
{!syncStatus.synced && (
  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center justify-between">
    <div>
      <h5 className="font-medium text-yellow-800">Policy Not Synced</h5>
      <p className="text-sm text-yellow-700">
        {syncStatus.error || 'Failed to sync policy to Sprites sandbox'}
      </p>
      {syncStatus.lastSyncAttempt && (
        <p className="text-xs text-yellow-600 mt-1">
          Last attempt: {syncStatus.lastSyncAttempt.toLocaleTimeString()}
        </p>
      )}
    </div>
    <button
      onClick={handleRetrySync}
      disabled={retrySync.isPending}
      className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
    >
      {retrySync.isPending ? 'Retrying...' : 'Retry Sync'}
    </button>
  </div>
)}
```

Also add logging for debugging in the backend:

```typescript
// In syncAgentNetworkPolicy:
export async function syncAgentNetworkPolicy(
  spriteName: string,
  policy: NetworkPolicy
): Promise<{ synced: boolean; error?: string }> {
  try {
    console.log(`[NetworkPolicy] Syncing policy for sprite ${spriteName}:`, {
      mode: policy.mode,
      ruleCount: policy.rules.length,
    });
    
    await setSpriteNetworkPolicy(spriteName, { rules: policy.rules });
    
    console.log(`[NetworkPolicy] Successfully synced policy for sprite ${spriteName}`);
    return { synced: true };
  } catch (error: any) {
    console.error(`[NetworkPolicy] Failed to sync policy for sprite ${spriteName}:`, error);
    return {
      synced: false,
      error: error.response?.data?.message || error.message || 'Unknown error',
    };
  }
}
```

**Test Strategy:**

1. Test UI shows sync warning banner when synced=false
2. Test retry button triggers retrySync mutation
3. Test successful retry updates sync status and shows success message
4. Test failed retry shows error message with details
5. Test last sync attempt timestamp displays correctly
6. Test loading state on retry button during mutation
7. Test backend logging outputs correct information
8. Integration test: simulate Sprites API failure and verify retry flow
