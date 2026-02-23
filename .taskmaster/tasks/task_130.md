# Task ID: 130

**Title:** Implement RulesEditor component with drag-to-reorder

**Status:** done

**Dependencies:** 128 ✓

**Priority:** medium

**Description:** Create the RulesEditor sub-component that allows viewing, adding, removing, and reordering network policy rules with a sortable list interface.

**Details:**

Create the RulesEditor component:

```typescript
import { useState } from 'react';
import { NetworkPolicyRule } from '@nitejar/agent';

interface RulesEditorProps {
  rules: NetworkPolicyRule[];
  onChange: (rules: NetworkPolicyRule[]) => void;
}

function RulesEditor({ rules, onChange }: RulesEditorProps) {
  const [newDomain, setNewDomain] = useState('');
  const [newAction, setNewAction] = useState<'allow' | 'deny'>('allow');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleAddRule = () => {
    if (!newDomain.trim()) return;
    
    // Insert before catch-all rule if exists
    const catchAllIndex = rules.findIndex(r => r.domain === '*');
    const newRules = [...rules];
    const newRule = { domain: newDomain.trim(), action: newAction };
    
    if (catchAllIndex >= 0) {
      newRules.splice(catchAllIndex, 0, newRule);
    } else {
      newRules.push(newRule);
    }
    
    onChange(newRules);
    setNewDomain('');
  };

  const handleRemoveRule = (index: number) => {
    const newRules = rules.filter((_, i) => i !== index);
    onChange(newRules);
  };

  const handleDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === targetIndex) return;
    
    const newRules = [...rules];
    const [draggedRule] = newRules.splice(dragIndex, 1);
    newRules.splice(targetIndex, 0, draggedRule);
    onChange(newRules);
    setDragIndex(targetIndex);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex justify-between items-center mb-4">
        <h4 className="text-md font-semibold">Policy Rules</h4>
        <DomainPatternHelp />
      </div>

      {/* Rules List */}
      <div className="space-y-2 mb-4">
        {rules.length === 0 ? (
          <p className="text-gray-500 text-sm">No rules configured</p>
        ) : (
          rules.map((rule, index) => (
            <div
              key={index}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-3 p-3 border rounded group cursor-move ${
                dragIndex === index ? 'opacity-50 border-blue-500' : 'border-gray-200'
              }`}
            >
              <div className="text-gray-400 cursor-grab">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                </svg>
              </div>
              <span className="text-sm text-gray-500 w-6">{index + 1}.</span>
              <code className="flex-1 font-mono text-sm">{rule.domain}</code>
              <span
                className={`px-2 py-1 text-xs rounded ${
                  rule.action === 'allow'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}
              >
                {rule.action}
              </span>
              <button
                onClick={() => handleRemoveRule(index)}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add Rule Form */}
      <div className="flex gap-3 items-center border-t pt-4">
        <input
          type="text"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          placeholder="e.g., api.example.com or *.example.com"
          className="flex-1 px-3 py-2 border rounded text-sm"
          onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
        />
        <select
          value={newAction}
          onChange={(e) => setNewAction(e.target.value as 'allow' | 'deny')}
          className="px-3 py-2 border rounded text-sm"
        >
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </select>
        <button
          onClick={handleAddRule}
          disabled={!newDomain.trim()}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm disabled:opacity-50"
        >
          Add Rule
        </button>
      </div>
    </div>
  );
}

// Tooltip explaining domain patterns
function DomainPatternHelp() {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-gray-400 hover:text-gray-600"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute right-0 top-8 w-64 bg-white dark:bg-gray-800 border rounded-lg shadow-lg p-4 z-10">
          <h5 className="font-medium mb-2">Domain Patterns</h5>
          <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <li><code className="bg-gray-100 px-1">example.com</code> - exact match</li>
            <li><code className="bg-gray-100 px-1">*.example.com</code> - subdomains</li>
            <li><code className="bg-gray-100 px-1">*</code> - all domains (catch-all)</li>
          </ul>
          <p className="text-xs text-gray-500 mt-2">Rules are evaluated in order; first match wins.</p>
        </div>
      )}
    </div>
  );
}
```

Features:
- Sortable list with drag handles
- Visual indicator of rule order (numbered)
- Allow/deny badges with color coding
- Remove button appears on hover
- Add rule form with domain input and action dropdown
- Domain pattern help tooltip
- Insert new rules before catch-all if exists

**Test Strategy:**

1. Test rules render in correct order with numbers
2. Test drag-and-drop reorders rules and calls onChange
3. Test remove button removes rule at correct index
4. Test add rule form creates new rule with entered domain and action
5. Test add rule inserts before catch-all rule if present
6. Test add rule button disabled when domain is empty
7. Test Enter key in domain input triggers add
8. Test domain pattern help tooltip opens/closes
9. Test allow/deny visual badges display correct colors
