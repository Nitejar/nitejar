# Task ID: 129

**Title:** Implement PresetSelector component with preview

**Status:** done

**Dependencies:** 128 ✓

**Priority:** medium

**Description:** Create the PresetSelector sub-component that displays available presets as selectable cards with rule previews and apply functionality.

**Details:**

Create the PresetSelector component within the NetworkPolicySection file or as a separate component:

```typescript
interface PresetSelectorProps {
  presets: PolicyPreset[];
  selectedPresetId: string | null;
  onSelect: (presetId: string) => void;
  isLoading: boolean;
  hasCustomRules?: boolean;
}

function PresetSelector({
  presets,
  selectedPresetId,
  onSelect,
  isLoading,
  hasCustomRules,
}: PresetSelectorProps) {
  const [confirmingPreset, setConfirmingPreset] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState<string | null>(null);

  const handlePresetClick = (presetId: string) => {
    if (hasCustomRules && presetId !== selectedPresetId) {
      setConfirmingPreset(presetId);
    } else {
      onSelect(presetId);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <h4 className="text-md font-semibold mb-4">Policy Presets</h4>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {presets.map((preset) => (
          <div
            key={preset.id}
            className={`relative p-4 border rounded-lg cursor-pointer transition-all ${
              selectedPresetId === preset.id
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 hover:border-gray-300'
            }`}
            onClick={() => handlePresetClick(preset.id)}
          >
            <h5 className="font-medium">{preset.name}</h5>
            <p className="text-sm text-gray-500 mt-1">{preset.description}</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowPreview(showPreview === preset.id ? null : preset.id);
              }}
              className="text-xs text-blue-600 mt-2 hover:underline"
            >
              {showPreview === preset.id ? 'Hide rules' : 'Preview rules'}
            </button>
            
            {showPreview === preset.id && (
              <div className="mt-2 text-xs bg-gray-50 dark:bg-gray-900 rounded p-2 max-h-32 overflow-y-auto">
                {preset.policy.rules.map((rule, idx) => (
                  <div key={idx} className="flex justify-between py-0.5">
                    <code className="text-gray-700 dark:text-gray-300">{rule.domain}</code>
                    <span className={rule.action === 'allow' ? 'text-green-600' : 'text-red-600'}>
                      {rule.action}
                    </span>
                  </div>
                ))}
              </div>
            )}
            
            {selectedPresetId === preset.id && (
              <div className="absolute top-2 right-2">
                <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Confirmation Dialog */}
      {confirmingPreset && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md">
            <h4 className="font-semibold mb-2">Apply Preset?</h4>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              This will overwrite your custom rules. Are you sure?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmingPreset(null)}
                className="px-4 py-2 border rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onSelect(confirmingPreset);
                  setConfirmingPreset(null);
                }}
                disabled={isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded"
              >
                {isLoading ? 'Applying...' : 'Apply Preset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

Features:
- Grid of preset cards with name and description
- Visual indicator for currently selected preset
- 'Preview rules' toggle to show rules inline
- Confirmation dialog when overwriting custom rules
- Loading state during preset application

**Test Strategy:**

1. Test all presets render as cards with correct names and descriptions
2. Test clicking preset calls onSelect callback
3. Test selected preset shows visual indicator (checkmark, border)
4. Test preview toggle shows/hides rules list
5. Test confirmation dialog appears when hasCustomRules is true
6. Test confirmation dialog Cancel button closes without selecting
7. Test confirmation dialog Apply button calls onSelect and closes
8. Test loading state disables Apply button
