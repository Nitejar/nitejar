# Task ID: 128

**Title:** Create NetworkPolicySection admin UI component

**Status:** done

**Dependencies:** 127 ✓

**Priority:** high

**Description:** Build the main NetworkPolicySection React component for the agent detail page, including policy overview card showing current mode, preset, and rule count.

**Details:**

Create `apps/web/app/admin/agents/[id]/NetworkPolicySection.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { NetworkPolicy, NetworkPolicyRule, PolicyPreset } from '@nitejar/agent';

interface NetworkPolicySectionProps {
  agentId: string;
}

export function NetworkPolicySection({ agentId }: NetworkPolicySectionProps) {
  const [localPolicy, setLocalPolicy] = useState<NetworkPolicy | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const policyQuery = trpc.networkPolicy.get.useQuery({ agentId });
  const presetsQuery = trpc.networkPolicy.listPresets.useQuery();
  const setPolicy = trpc.networkPolicy.set.useMutation();
  const applyPreset = trpc.networkPolicy.applyPreset.useMutation();
  const retrySync = trpc.networkPolicy.retrySync.useMutation();

  useEffect(() => {
    if (policyQuery.data?.policy) {
      setLocalPolicy(policyQuery.data.policy);
      setSelectedPresetId(policyQuery.data.policy.presetId || null);
    }
  }, [policyQuery.data]);

  const handlePresetSelect = async (presetId: string) => {
    try {
      const result = await applyPreset.mutateAsync({ agentId, presetId });
      setLocalPolicy(result.preset.policy);
      setSelectedPresetId(presetId);
      setIsDirty(false);
      setMessage({
        type: 'success',
        text: result.synced
          ? `Applied ${result.preset.name} preset`
          : `Applied ${result.preset.name} preset (sync pending: ${result.syncError})`,
      });
      policyQuery.refetch();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const handleSaveChanges = async () => {
    if (!localPolicy) return;
    try {
      const result = await setPolicy.mutateAsync({ agentId, policy: localPolicy });
      setIsDirty(false);
      setMessage({
        type: 'success',
        text: result.synced
          ? 'Policy saved and synced'
          : `Policy saved (sync pending: ${result.syncError})`,
      });
      policyQuery.refetch();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'unrestricted': return 'Unrestricted';
      case 'allow-list': return 'Allow List';
      case 'deny-list': return 'Deny List';
      default: return mode;
    }
  };

  if (policyQuery.isLoading) return <div>Loading policy...</div>;

  return (
    <div className="space-y-6">
      {/* Policy Overview Card */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4">Network Policy</h3>
        
        {localPolicy ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Mode:</span>
              <span className="font-medium">{getModeLabel(localPolicy.mode)}</span>
            </div>
            {localPolicy.presetId && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Preset:</span>
                <span className="font-medium">
                  {presetsQuery.data?.find(p => p.id === localPolicy.presetId)?.name || localPolicy.presetId}
                </span>
                {localPolicy.customized && (
                  <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">Customized</span>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Rules:</span>
              <span className="font-medium">{localPolicy.rules.length} rule(s)</span>
            </div>
          </div>
        ) : (
          <p className="text-gray-500">No network policy configured. Select a preset below.</p>
        )}
        
        {message && (
          <div className={`mt-4 p-3 rounded ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {message.text}
          </div>
        )}
      </div>

      {/* Preset Selector */}
      <PresetSelector
        presets={presetsQuery.data || []}
        selectedPresetId={selectedPresetId}
        onSelect={handlePresetSelect}
        isLoading={applyPreset.isPending}
        hasCustomRules={localPolicy?.customized}
      />

      {/* Rules Editor */}
      {localPolicy && (
        <RulesEditor
          rules={localPolicy.rules}
          onChange={(rules) => {
            setLocalPolicy({ ...localPolicy, rules, customized: true });
            setIsDirty(true);
          }}
        />
      )}

      {/* Actions */}
      {isDirty && (
        <div className="flex gap-3">
          <button
            onClick={handleSaveChanges}
            disabled={setPolicy.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {setPolicy.isPending ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={() => {
              setLocalPolicy(policyQuery.data?.policy || null);
              setIsDirty(false);
            }}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
```

The component follows the established patterns from ModelSection.tsx and SoulSection.tsx with:
- Local state for editing
- tRPC mutations with loading states
- Success/error message feedback
- Dirty state tracking

**Test Strategy:**

1. Test component renders loading state while fetching policy
2. Test component shows 'No policy configured' for new agents
3. Test component displays current policy mode, preset, and rule count
4. Test preset selection triggers applyPreset mutation
5. Test success and error messages display correctly
6. Test dirty state tracking when rules are modified
7. Test Save Changes button triggers set mutation with local policy
8. Test Cancel button reverts to server state
9. Visual testing with agent-browser skill to verify UI renders correctly
