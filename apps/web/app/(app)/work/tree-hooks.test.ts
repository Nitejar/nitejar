import { describe, it, expect } from 'vitest'
import {
  computeDropZone,
  computeDropResult,
  isInvalidDropTarget,
  applyOptimisticReorder,
  shouldIgnoreTreeKeyboardTarget,
  type SiblingEntry,
} from './tree-hooks'

// ---------------------------------------------------------------------------
// Test tree structure (contiguous sort_orders):
//
//   root (null parent)
//   ├── A  (sortOrder: 0)
//   │   ├── A1 (sortOrder: 0)
//   │   └── A2 (sortOrder: 1)
//   ├── B  (sortOrder: 1)
//   │   └── B1 (sortOrder: 0)
//   │       └── B1a (sortOrder: 0)
//   └── C  (sortOrder: 2)
//
// ---------------------------------------------------------------------------

const parentOf: Record<string, string | null> = {
  A: null,
  B: null,
  C: null,
  A1: 'A',
  A2: 'A',
  B1: 'B',
  B1a: 'B1',
}

const childrenOf: Record<string, SiblingEntry[]> = {
  __root__: [
    { id: 'A', sortOrder: 0 },
    { id: 'B', sortOrder: 1 },
    { id: 'C', sortOrder: 2 },
  ],
  A: [
    { id: 'A1', sortOrder: 0 },
    { id: 'A2', sortOrder: 1 },
  ],
  B: [{ id: 'B1', sortOrder: 0 }],
  B1: [{ id: 'B1a', sortOrder: 0 }],
  C: [],
  A1: [],
  A2: [],
  B1a: [],
}

function getParentId(id: string): string | null {
  return parentOf[id] ?? null
}

function getSiblingOrder(parentId: string | null): SiblingEntry[] {
  return childrenOf[parentId ?? '__root__'] ?? []
}

// Descendants map (transitive)
const descendantMap = new Map<string, Set<string>>([
  ['A', new Set(['A1', 'A2'])],
  ['B', new Set(['B1', 'B1a'])],
  ['B1', new Set(['B1a'])],
  ['C', new Set()],
  ['A1', new Set()],
  ['A2', new Set()],
  ['B1a', new Set()],
])

function asEventTarget<T extends object>(value: T): EventTarget {
  return value as unknown as EventTarget
}

// ---------------------------------------------------------------------------
// computeDropZone
// ---------------------------------------------------------------------------

describe('computeDropZone', () => {
  const TOP = 100
  const HEIGHT = 40

  it('returns "before" for top 25% of row', () => {
    expect(computeDropZone(100, TOP, HEIGHT)).toBe('before') // 0%
    expect(computeDropZone(105, TOP, HEIGHT)).toBe('before') // 12.5%
    expect(computeDropZone(109, TOP, HEIGHT)).toBe('before') // 22.5%
  })

  it('returns "on" for middle 50% of row', () => {
    expect(computeDropZone(111, TOP, HEIGHT)).toBe('on') // 27.5%
    expect(computeDropZone(120, TOP, HEIGHT)).toBe('on') // 50%
    expect(computeDropZone(129, TOP, HEIGHT)).toBe('on') // 72.5%
  })

  it('returns "after" for bottom 25% of row', () => {
    expect(computeDropZone(131, TOP, HEIGHT)).toBe('after') // 77.5%
    expect(computeDropZone(135, TOP, HEIGHT)).toBe('after') // 87.5%
    expect(computeDropZone(140, TOP, HEIGHT)).toBe('after') // 100%
  })

  it('handles exact boundaries', () => {
    expect(computeDropZone(110, TOP, HEIGHT)).toBe('on') // ratio = 0.25
    expect(computeDropZone(130, TOP, HEIGHT)).toBe('on') // ratio = 0.75
  })
})

describe('shouldIgnoreTreeKeyboardTarget', () => {
  it('ignores standard form controls', () => {
    expect(shouldIgnoreTreeKeyboardTarget(asEventTarget({ tagName: 'INPUT' }))).toBe(true)
    expect(shouldIgnoreTreeKeyboardTarget(asEventTarget({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(shouldIgnoreTreeKeyboardTarget(asEventTarget({ tagName: 'SELECT' }))).toBe(true)
  })

  it('ignores contenteditable elements and descendants', () => {
    expect(shouldIgnoreTreeKeyboardTarget(asEventTarget({ isContentEditable: true }))).toBe(true)
    expect(
      shouldIgnoreTreeKeyboardTarget(
        asEventTarget({
          isContentEditable: false,
          closest: (selector: string) => (selector === '[contenteditable="true"]' ? {} : null),
        })
      )
    ).toBe(true)
  })

  it('does not ignore plain non-editable elements', () => {
    expect(
      shouldIgnoreTreeKeyboardTarget(
        asEventTarget({
          tagName: 'DIV',
          isContentEditable: false,
          closest: () => null,
        })
      )
    ).toBe(false)
    expect(shouldIgnoreTreeKeyboardTarget(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isInvalidDropTarget
// ---------------------------------------------------------------------------

describe('isInvalidDropTarget', () => {
  it('rejects dropping on self', () => {
    expect(isInvalidDropTarget('A', 'A', descendantMap)).toBe(true)
  })

  it('rejects dropping on own child', () => {
    expect(isInvalidDropTarget('A', 'A1', descendantMap)).toBe(true)
  })

  it('rejects dropping on own grandchild', () => {
    expect(isInvalidDropTarget('B', 'B1a', descendantMap)).toBe(true)
  })

  it('allows dropping on sibling', () => {
    expect(isInvalidDropTarget('A', 'B', descendantMap)).toBe(false)
  })

  it('allows dropping on unrelated node', () => {
    expect(isInvalidDropTarget('A1', 'B1', descendantMap)).toBe(false)
  })

  it('allows dropping on parent', () => {
    expect(isInvalidDropTarget('A1', 'A', descendantMap)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// computeDropResult — contiguous sort_orders
// ---------------------------------------------------------------------------

describe('computeDropResult (contiguous)', () => {
  describe('drop position = "on"', () => {
    it('makes dragged item a child of target (sortOrder null)', () => {
      expect(computeDropResult('on', 'A', getParentId, getSiblingOrder)).toEqual({
        targetParentId: 'A',
        sortOrder: null,
      })
    })

    it('works for leaf nodes', () => {
      expect(computeDropResult('on', 'C', getParentId, getSiblingOrder)).toEqual({
        targetParentId: 'C',
        sortOrder: null,
      })
    })
  })

  describe('drop position = null (fallback)', () => {
    it('treated same as "on"', () => {
      expect(computeDropResult(null, 'B', getParentId, getSiblingOrder)).toEqual({
        targetParentId: 'B',
        sortOrder: null,
      })
    })
  })

  describe('drop position = "before"', () => {
    it('before first root sibling → uses target sortOrder (0)', () => {
      expect(computeDropResult('before', 'A', getParentId, getSiblingOrder)).toEqual({
        targetParentId: null,
        sortOrder: 0,
      })
    })

    it('before second root sibling → uses target sortOrder (1)', () => {
      expect(computeDropResult('before', 'B', getParentId, getSiblingOrder)).toEqual({
        targetParentId: null,
        sortOrder: 1,
      })
    })

    it('before first child → sortOrder 0, parent is the parent node', () => {
      expect(computeDropResult('before', 'A1', getParentId, getSiblingOrder)).toEqual({
        targetParentId: 'A',
        sortOrder: 0,
      })
    })
  })

  describe('drop position = "after"', () => {
    it('after first root sibling → target sortOrder + 1 (1)', () => {
      expect(computeDropResult('after', 'A', getParentId, getSiblingOrder)).toEqual({
        targetParentId: null,
        sortOrder: 1,
      })
    })

    it('after last root sibling → target sortOrder + 1 (3)', () => {
      expect(computeDropResult('after', 'C', getParentId, getSiblingOrder)).toEqual({
        targetParentId: null,
        sortOrder: 3,
      })
    })

    it('after first child → sortOrder 1, parent preserved', () => {
      expect(computeDropResult('after', 'A1', getParentId, getSiblingOrder)).toEqual({
        targetParentId: 'A',
        sortOrder: 1,
      })
    })
  })
})

// ---------------------------------------------------------------------------
// computeDropResult — sparse sort_orders (the actual bug scenario)
//
// After several drag operations, sort_orders become non-contiguous.
// The backend uses the actual sort_order value for shifting, so we MUST
// send real values, not array indices.
// ---------------------------------------------------------------------------

describe('computeDropResult (sparse sort_orders)', () => {
  // Simulates a tree where sort_orders have gaps: [0, 3, 7]
  const sparseChildren: Record<string, SiblingEntry[]> = {
    __root__: [
      { id: 'X', sortOrder: 0 },
      { id: 'Y', sortOrder: 3 },
      { id: 'Z', sortOrder: 7 },
    ],
  }
  const sparseParent = (_id: string) => null
  const sparseSiblings = (parentId: string | null) => sparseChildren[parentId ?? '__root__'] ?? []

  it("before Y → sortOrder 3 (Y's actual value), NOT 1 (array index)", () => {
    expect(computeDropResult('before', 'Y', sparseParent, sparseSiblings)).toEqual({
      targetParentId: null,
      sortOrder: 3,
    })
  })

  it("after Y → sortOrder 4 (Y's value + 1), NOT 2 (index + 1)", () => {
    expect(computeDropResult('after', 'Y', sparseParent, sparseSiblings)).toEqual({
      targetParentId: null,
      sortOrder: 4,
    })
  })

  it('before Z → sortOrder 7, NOT 2', () => {
    expect(computeDropResult('before', 'Z', sparseParent, sparseSiblings)).toEqual({
      targetParentId: null,
      sortOrder: 7,
    })
  })

  it('after Z → sortOrder 8 (appending after last)', () => {
    expect(computeDropResult('after', 'Z', sparseParent, sparseSiblings)).toEqual({
      targetParentId: null,
      sortOrder: 8,
    })
  })

  it('before X → sortOrder 0 (first item)', () => {
    expect(computeDropResult('before', 'X', sparseParent, sparseSiblings)).toEqual({
      targetParentId: null,
      sortOrder: 0,
    })
  })

  it('after X → sortOrder 1 (X value + 1, inserts between X=0 and Y=3)', () => {
    expect(computeDropResult('after', 'X', sparseParent, sparseSiblings)).toEqual({
      targetParentId: null,
      sortOrder: 1,
    })
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('computeDropResult edge cases', () => {
  it('target not in sibling list → sortOrder null', () => {
    expect(
      computeDropResult(
        'before',
        'UNKNOWN',
        () => null,
        () => [{ id: 'A', sortOrder: 0 }]
      )
    ).toEqual({ targetParentId: null, sortOrder: null })
  })

  it('empty sibling list → sortOrder null', () => {
    expect(
      computeDropResult(
        'after',
        'A',
        () => null,
        () => []
      )
    ).toEqual({
      targetParentId: null,
      sortOrder: null,
    })
  })
})

// ---------------------------------------------------------------------------
// applyOptimisticReorder
// ---------------------------------------------------------------------------

type TestItem = { id: string; parentId: string | null; sortOrder: number }

const getId = (i: TestItem) => i.id
const getParent = (i: TestItem) => i.parentId
const getSort = (i: TestItem) => i.sortOrder
const setParent = (i: TestItem, pid: string | null): TestItem => ({ ...i, parentId: pid })
const setSort = (i: TestItem, so: number): TestItem => ({ ...i, sortOrder: so })

describe('applyOptimisticReorder', () => {
  const items: TestItem[] = [
    { id: 'A', parentId: null, sortOrder: 0 },
    { id: 'B', parentId: null, sortOrder: 1 },
    { id: 'C', parentId: null, sortOrder: 2 },
    { id: 'A1', parentId: 'A', sortOrder: 0 },
    { id: 'A2', parentId: 'A', sortOrder: 1 },
  ]

  it('moves item to new parent with sortOrder null (append)', () => {
    const result = applyOptimisticReorder(
      items,
      'C',
      'A',
      null,
      getId,
      getParent,
      getSort,
      setParent,
      setSort
    )
    const c = result.find((i) => i.id === 'C')!
    expect(c.parentId).toBe('A')
    expect(c.sortOrder).toBe(2) // after A1(0) and A2(1)
  })

  it('moves item before a sibling (shifts others)', () => {
    // Move C before B (sortOrder 1 at root)
    const result = applyOptimisticReorder(
      items,
      'C',
      null,
      1,
      getId,
      getParent,
      getSort,
      setParent,
      setSort
    )
    const c = result.find((i) => i.id === 'C')!
    const b = result.find((i) => i.id === 'B')!
    expect(c.sortOrder).toBe(1)
    expect(b.sortOrder).toBe(2) // shifted from 1 → 2
  })

  it('does not shift items below the target sortOrder', () => {
    // Move C to sortOrder 1 at root — A(0) should be untouched
    const result = applyOptimisticReorder(
      items,
      'C',
      null,
      1,
      getId,
      getParent,
      getSort,
      setParent,
      setSort
    )
    const a = result.find((i) => i.id === 'A')!
    expect(a.sortOrder).toBe(0)
  })

  it('handles sparse sort orders correctly', () => {
    const sparse: TestItem[] = [
      { id: 'X', parentId: null, sortOrder: 0 },
      { id: 'Y', parentId: null, sortOrder: 5 },
      { id: 'Z', parentId: null, sortOrder: 10 },
    ]
    // Move Z before Y (sortOrder 5)
    const result = applyOptimisticReorder(
      sparse,
      'Z',
      null,
      5,
      getId,
      getParent,
      getSort,
      setParent,
      setSort
    )
    expect(result.find((i) => i.id === 'Z')!.sortOrder).toBe(5)
    expect(result.find((i) => i.id === 'Y')!.sortOrder).toBe(6) // shifted
    expect(result.find((i) => i.id === 'X')!.sortOrder).toBe(0) // untouched
  })
})
