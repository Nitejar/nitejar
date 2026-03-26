'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// 0. useIsDesktop — matches lg breakpoint (1024px) for inbox layout
// ---------------------------------------------------------------------------

const LG_BREAKPOINT = 1024

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(true)

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`)
    setIsDesktop(mq.matches)
    const handler = () => setIsDesktop(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return isDesktop
}

// ---------------------------------------------------------------------------
// 1. useTreeSelection
// ---------------------------------------------------------------------------

export function useTreeSelection<T extends string = string>() {
  const [selectedId, setSelectedId] = useState<T | null>(null)
  const clearSelection = useCallback(() => setSelectedId(null), [])
  return { selectedId, setSelectedId, clearSelection } as const
}

/**
 * Auto-select the first item in a list on desktop when nothing is selected.
 * Call after data loads. Only fires once.
 */
export function useAutoSelectFirst(
  firstId: string | undefined,
  selectedId: string | null,
  setSelectedId: (id: string) => void
) {
  const isDesktop = useIsDesktop()
  const didAutoSelect = useRef(false)

  useEffect(() => {
    if (didAutoSelect.current || !isDesktop || selectedId || !firstId) return
    didAutoSelect.current = true
    setSelectedId(firstId)
  }, [isDesktop, selectedId, firstId, setSelectedId])
}

// ---------------------------------------------------------------------------
// 2. useTreeExpand
// ---------------------------------------------------------------------------

export function useTreeExpand(options?: { autoExpandIds?: string[] }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const didAutoExpand = useRef(false)

  // One-time auto-expand on mount when autoExpandIds are provided
  useEffect(() => {
    if (didAutoExpand.current) return
    if (options?.autoExpandIds && options.autoExpandIds.length > 0) {
      didAutoExpand.current = true
      setExpandedIds(new Set(options.autoExpandIds))
    }
  }, [options?.autoExpandIds])

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const expandAll = useCallback((ids: string[]) => {
    setExpandedIds(new Set(ids))
  }, [])

  const collapseAll = useCallback(() => {
    setExpandedIds(new Set())
  }, [])

  const isExpanded = useCallback((id: string) => expandedIds.has(id), [expandedIds])

  return { expandedIds, setExpandedIds, toggle, expandAll, collapseAll, isExpanded } as const
}

// ---------------------------------------------------------------------------
// 3. useTreeDragDrop
// ---------------------------------------------------------------------------

export type DropPosition = 'before' | 'after' | 'on' | null

// ---------------------------------------------------------------------------
// Pure helpers — extracted for testability
// ---------------------------------------------------------------------------

/** Detect which drop zone the cursor is in (top 25% / middle 50% / bottom 25%). */
export function computeDropZone(cursorY: number, rowTop: number, rowHeight: number): DropPosition {
  const ratio = (cursorY - rowTop) / rowHeight
  if (ratio < 0.25) return 'before'
  if (ratio > 0.75) return 'after'
  return 'on'
}

/** Check whether a drag target is invalid (self or own descendant). */
export function isInvalidDropTarget(
  draggedId: string,
  targetId: string,
  descendantMap: Map<string, Set<string>>
): boolean {
  return draggedId === targetId || (descendantMap.get(draggedId)?.has(targetId) ?? false)
}

export type SiblingEntry = { id: string; sortOrder: number }

/**
 * Given a drop position and target row, compute the parent ID and sort order
 * that should be passed to the move/reorder mutation.
 *
 * Uses actual sort_order values from siblings (not array indices) so the
 * backend shift logic works correctly even when sort_orders are sparse.
 */
export function computeDropResult(
  dropPos: DropPosition,
  targetRowId: string,
  getParentId: (id: string) => string | null,
  getSiblingOrder: (parentId: string | null) => SiblingEntry[]
): { targetParentId: string | null; sortOrder: number | null } {
  if (dropPos === 'on' || !dropPos) {
    // Make child of this row
    return { targetParentId: targetRowId, sortOrder: null }
  }

  // before/after: insert at same level as target row
  const targetParent = getParentId(targetRowId)
  const siblings = getSiblingOrder(targetParent)
  const targetEntry = siblings.find((s) => s.id === targetRowId)

  if (!targetEntry) {
    return { targetParentId: targetParent, sortOrder: null }
  }

  // Use the target's real sort_order value:
  // "before" → use the target's sort_order (backend shifts target and everything after)
  // "after"  → use target's sort_order + 1 (backend shifts everything after)
  const sortOrder = dropPos === 'before' ? targetEntry.sortOrder : targetEntry.sortOrder + 1
  return { targetParentId: targetParent, sortOrder }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTreeDragDrop(options: {
  descendantMap: Map<string, Set<string>>
  onDrop: (draggedId: string, targetParentId: string | null, sortOrder: number | null) => void
  toastErrorMessage?: string
  getSiblingOrder?: (parentId: string | null) => SiblingEntry[]
  getParentId?: (itemId: string) => string | null
  isExpandedWithChildren?: (id: string) => boolean
}) {
  const {
    descendantMap,
    onDrop,
    toastErrorMessage,
    getSiblingOrder,
    getParentId,
    isExpandedWithChildren,
  } = options

  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragTargetId, setDragTargetId] = useState<string | null>(null)
  const [rootDropOver, setRootDropOver] = useState(false)
  const [dropPosition, setDropPosition] = useState<DropPosition>(null)

  // Ref mirrors dropPosition to avoid stale closures in onDrop handlers.
  // React may not re-render between the last onDragOver and onDrop, so the
  // state value captured in the handler closure can be outdated.
  const dropPositionRef = useRef<DropPosition>(null)

  // Counter refs for drag enter/leave balancing
  const rowCounterRef = useRef(0)
  const rootDropCounterRef = useRef(0)

  const clearDragState = useCallback(() => {
    rowCounterRef.current = 0
    rootDropCounterRef.current = 0
    setDraggedId(null)
    setDragTargetId(null)
    setRootDropOver(false)
    setDropPosition(null)
    dropPositionRef.current = null
  }, [])

  const startDrag = useCallback((id: string, event: React.DragEvent) => {
    event.dataTransfer.setData('text/plain', id)
    event.dataTransfer.effectAllowed = 'move'
    // Try to set drag image from the closest row element
    const rowEl =
      event.target instanceof HTMLElement ? event.target.closest('[data-tree-row]') : null
    if (rowEl instanceof HTMLElement) {
      event.dataTransfer.setDragImage(rowEl, 24, 20)
    }
    // Defer state update so browser commits the drag before React re-renders
    setTimeout(() => setDraggedId(id), 0)
  }, [])

  const endDrag = useCallback(() => {
    clearDragState()
  }, [clearDragState])

  const getRowDragHandlers = useCallback(
    (rowId: string) => {
      if (!draggedId) return undefined

      const isInvalidTarget =
        draggedId === rowId || (descendantMap.get(draggedId)?.has(rowId) ?? false)

      return {
        onDragOver: (event: React.DragEvent) => {
          if (isInvalidTarget) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'

          // Detect cursor position within the row for positional drops
          const rect = event.currentTarget.getBoundingClientRect()
          const y = event.clientY - rect.top
          const ratio = y / rect.height

          let pos: DropPosition
          if (ratio < 0.25) {
            pos = 'before'
          } else if (ratio > 0.75) {
            pos = 'after'
          } else {
            pos = 'on'
          }

          // For expanded rows with children, "after" becomes "on" (make child).
          // The real "after sibling" drop target is the group-end zone rendered
          // after the last visible descendant.
          if (pos === 'after' && isExpandedWithChildren?.(rowId)) {
            pos = 'on'
          }

          dropPositionRef.current = pos
          setDropPosition(pos)
          setDragTargetId(rowId)
        },
        onDragEnter: (event: React.DragEvent) => {
          if (isInvalidTarget) return
          event.preventDefault()
          rowCounterRef.current++
          setDragTargetId(rowId)
        },
        onDragLeave: () => {
          rowCounterRef.current--
          if (rowCounterRef.current <= 0) {
            rowCounterRef.current = 0
            setDragTargetId((current) => {
              if (current === rowId) {
                dropPositionRef.current = null
                setDropPosition(null)
                return null
              }
              return current
            })
          }
        },
        onDrop: (event: React.DragEvent) => {
          event.preventDefault()
          rowCounterRef.current = 0
          if (isInvalidTarget) {
            if (toastErrorMessage) {
              toast.error(toastErrorMessage)
            }
            clearDragState()
            return
          }

          // Read from ref — state may be stale if React hasn't re-rendered
          // since the last onDragOver event
          const dropPos = dropPositionRef.current
          const { targetParentId, sortOrder } = computeDropResult(
            dropPos,
            rowId,
            getParentId ?? (() => null),
            getSiblingOrder ?? (() => [])
          )
          onDrop(draggedId, targetParentId, sortOrder)
          clearDragState()
        },
      }
    },
    [
      draggedId,
      descendantMap,
      onDrop,
      toastErrorMessage,
      clearDragState,
      getSiblingOrder,
      getParentId,
      isExpandedWithChildren,
    ]
  )

  // Handlers for the thin drop zone after the last child of an expanded group.
  // Dropping here means "after this parent, as a sibling of the parent."
  const getGroupEndDropHandlers = useCallback(
    (parentRowId: string) => {
      if (!draggedId) return undefined

      const isInvalid =
        draggedId === parentRowId || (descendantMap.get(draggedId)?.has(parentRowId) ?? false)

      return {
        onDragOver: (event: React.DragEvent) => {
          if (isInvalid) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        },
        onDragEnter: (event: React.DragEvent) => {
          if (isInvalid) return
          event.preventDefault()
        },
        onDragLeave: () => {},
        onDrop: (event: React.DragEvent) => {
          event.preventDefault()
          if (isInvalid) {
            clearDragState()
            return
          }
          // "after parentRowId" at the parent's sibling level
          const { targetParentId, sortOrder } = computeDropResult(
            'after',
            parentRowId,
            getParentId ?? (() => null),
            getSiblingOrder ?? (() => [])
          )
          onDrop(draggedId, targetParentId, sortOrder)
          clearDragState()
        },
      }
    },
    [draggedId, descendantMap, onDrop, clearDragState, getSiblingOrder, getParentId]
  )

  const getRootDropHandlers = useCallback(() => {
    if (!draggedId) return undefined

    return {
      onDragOver: (event: React.DragEvent) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      },
      onDragEnter: (event: React.DragEvent) => {
        event.preventDefault()
        rootDropCounterRef.current++
        setRootDropOver(true)
      },
      onDragLeave: () => {
        rootDropCounterRef.current--
        if (rootDropCounterRef.current <= 0) {
          rootDropCounterRef.current = 0
          setRootDropOver(false)
        }
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault()
        rootDropCounterRef.current = 0
        // sortOrder 0 = insert at top of root (the zone is visually above the tree)
        onDrop(draggedId, null, 0)
        clearDragState()
      },
    }
  }, [draggedId, onDrop, clearDragState])

  return {
    draggedId,
    dragTargetId,
    rootDropOver,
    dropPosition,
    startDrag,
    endDrag,
    getRowDragHandlers,
    getGroupEndDropHandlers,
    getRootDropHandlers,
  } as const
}

// ---------------------------------------------------------------------------
// 4. useTreeKeyboardNav
// ---------------------------------------------------------------------------

export function useTreeKeyboardNav(options: {
  flatIds: string[]
  selectedId: string | null
  onSelect: (id: string) => void
  onClear: () => void
  onStartEdit?: (id: string) => void
  onOpen?: (id: string) => void
  onCreate?: () => void
  extraKeys?: Record<string, (id: string) => void>
}) {
  const { flatIds, selectedId, onSelect, onClear, onStartEdit, onOpen, onCreate, extraKeys } =
    options

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        const currentIdx = flatIds.findIndex((id) => id === selectedId)
        let nextIdx: number
        if (e.key === 'j') {
          nextIdx = currentIdx < flatIds.length - 1 ? currentIdx + 1 : currentIdx
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : 0
        }
        const nextId = flatIds[nextIdx]
        if (nextId) onSelect(nextId)
      } else if (e.key === 'Escape') {
        onClear()
      } else if (e.key === 'Enter' && selectedId) {
        e.preventDefault()
        onStartEdit?.(selectedId)
      } else if (e.key === 'o' && selectedId && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        onOpen?.(selectedId)
      } else if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        onCreate?.()
      } else if (extraKeys && selectedId) {
        const handler = extraKeys[e.key]
        if (handler) {
          e.preventDefault()
          handler(selectedId)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flatIds, selectedId, onSelect, onClear, onStartEdit, onOpen, onCreate, extraKeys])
}

// ---------------------------------------------------------------------------
// 5. useTreeInlineEdit
// ---------------------------------------------------------------------------

export function useTreeInlineEdit(options: { onCommit: (id: string, value: string) => void }) {
  const onCommitRef = useRef(options.onCommit)
  onCommitRef.current = options.onCommit

  const [editingId, setEditingId] = useState<string | null>(null)

  const startEdit = useCallback((id: string) => setEditingId(id), [])
  const cancelEdit = useCallback(() => setEditingId(null), [])
  const commitEdit = useCallback((id: string, value: string) => {
    onCommitRef.current(id, value)
    setEditingId(null)
  }, [])

  return { editingId, startEdit, cancelEdit, commitEdit } as const
}

// ---------------------------------------------------------------------------
// 6. applyOptimisticReorder — shared optimistic cache update for tree DnD
// ---------------------------------------------------------------------------

/**
 * Produces an optimistically-updated copy of a flat item list after a
 * drag-drop reorder. Mirrors the backend shift logic:
 *   1. Shift siblings at target parent where sortOrder >= newSortOrder by +1
 *   2. Set dragged item's parent and sortOrder
 *
 * Accessors let each surface provide its own field names.
 */
export function applyOptimisticReorder<T>(
  items: T[],
  draggedId: string,
  newParentId: string | null,
  newSortOrder: number | null,
  getId: (item: T) => string,
  getParentId: (item: T) => string | null,
  getSortOrder: (item: T) => number,
  withParentId: (item: T, parentId: string | null) => T,
  withSortOrder: (item: T, sortOrder: number) => T
): T[] {
  // If sortOrder is null, append at end of new parent's children
  const effectiveSortOrder =
    newSortOrder ??
    (() => {
      const maxSibling = items
        .filter((i) => getId(i) !== draggedId && getParentId(i) === newParentId)
        .reduce((max, i) => Math.max(max, getSortOrder(i)), -1)
      return maxSibling + 1
    })()

  return items.map((item) => {
    const id = getId(item)

    // The dragged item: update parent + sortOrder
    if (id === draggedId) {
      return withSortOrder(withParentId(item, newParentId), effectiveSortOrder)
    }

    // Siblings at the target parent: shift if sortOrder >= new position
    if (getParentId(item) === newParentId && getSortOrder(item) >= effectiveSortOrder) {
      return withSortOrder(item, getSortOrder(item) + 1)
    }

    return item
  })
}
