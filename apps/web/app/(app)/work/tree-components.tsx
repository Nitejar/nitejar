'use client'

import React, { useRef, useState, useMemo, useEffect } from 'react'
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Plus,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { DropPosition } from './tree-hooks'

// ---------------------------------------------------------------------------
// 1. TreeRootDropZone
// ---------------------------------------------------------------------------

export interface TreeRootDropZoneProps {
  active: boolean
  isOver: boolean
  handlers?: {
    onDragOver?: React.DragEventHandler
    onDragEnter?: React.DragEventHandler
    onDragLeave?: React.DragEventHandler
    onDrop?: React.DragEventHandler
  }
}

export function TreeRootDropZone({ active, isOver, handlers }: TreeRootDropZoneProps) {
  return (
    <div
      className={cn(
        'h-1 transition-colors',
        active && isOver ? 'bg-blue-400' : 'bg-transparent'
      )}
      onDragOver={active ? handlers?.onDragOver : undefined}
      onDragEnter={active ? handlers?.onDragEnter : undefined}
      onDragLeave={active ? handlers?.onDragLeave : undefined}
      onDrop={active ? handlers?.onDrop : undefined}
    />
  )
}

// ---------------------------------------------------------------------------
// 1b. TreeGroupEndDropZone — thin zone after expanded group's last child
// ---------------------------------------------------------------------------

export interface TreeGroupEndDropZoneProps {
  active: boolean
  depth: number
  depthOffset?: number
  baseIndent?: number
  handlers?: {
    onDragOver?: React.DragEventHandler
    onDragEnter?: React.DragEventHandler
    onDragLeave?: React.DragEventHandler
    onDrop?: React.DragEventHandler
  }
}

export function TreeGroupEndDropZone({
  active,
  depth,
  depthOffset = 24,
  baseIndent = 32,
  handlers,
}: TreeGroupEndDropZoneProps) {
  const [isOver, setIsOver] = useState(false)
  const indent = baseIndent + depth * depthOffset

  if (!active) return null

  // Zero layout height — hit area is an absolutely positioned overlay
  // so stacked zones don't add visible spacing
  return (
    <div className="relative h-0">
      <div
        className="absolute left-0 right-0 top-0 z-10 h-1.5"
        onDragOver={(e) => { handlers?.onDragOver?.(e) }}
        onDragEnter={(e) => { setIsOver(true); handlers?.onDragEnter?.(e) }}
        onDragLeave={() => { setIsOver(false); handlers?.onDragLeave?.({} as React.DragEvent) }}
        onDrop={(e) => { setIsOver(false); handlers?.onDrop?.(e) }}
      />
      {isOver && (
        <div
          className="pointer-events-none absolute right-0 top-0 z-20 h-0.5 bg-blue-400"
          style={{ left: indent }}
        >
          <div className="absolute -top-[3px] left-0 h-1.5 w-1.5 rounded-full bg-blue-400" />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2. TreeToolbar
// ---------------------------------------------------------------------------

export interface TreeToolbarView {
  id: string
  name: string
  icon?: LucideIcon
}

export interface TreeToolbarProps {
  views?: TreeToolbarView[]
  activeViewId?: string
  onViewChange?: (viewId: string) => void
  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  filterSlot?: React.ReactNode
  onCreateClick?: () => void
}

export function TreeToolbar({
  views,
  activeViewId,
  onViewChange,
  search,
  onSearchChange,
  searchPlaceholder = 'Search...',
  filterSlot,
  onCreateClick,
}: TreeToolbarProps) {
  const activeView = views?.find((v) => v.id === activeViewId) ?? views?.[0]

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-1.5">
      {/* View selector */}
      {views && views.length > 0 && onViewChange ? (
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1 text-sm font-medium text-zinc-200 hover:text-white transition">
            {activeView?.name ?? 'View'}
            <ChevronDown className="h-3 w-3 text-zinc-500" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {views.map((view) => (
              <DropdownMenuItem
                key={view.id}
                onClick={() => onViewChange(view.id)}
                className={cn(activeViewId === view.id && 'bg-white/[0.06]')}
              >
                {view.icon && <view.icon className="mr-1.5 h-3.5 w-3.5 text-zinc-500" />}
                {view.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <div className="hidden flex-1 sm:block" />

      {/* Search input */}
      <div className="relative order-3 w-full sm:order-none sm:w-48">
        <Search className="pointer-events-none absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-7 border-zinc-800 bg-white/[0.03] pl-7 text-xs placeholder:text-zinc-500"
        />
      </div>

      {/* Filter slot */}
      {filterSlot}

      {/* Create button */}
      {onCreateClick && (
        <button
          type="button"
          onClick={onCreateClick}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 text-zinc-400 transition hover:border-zinc-700 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 3. TreeBreadcrumb
// ---------------------------------------------------------------------------

export interface TreeBreadcrumbSegment {
  label: string
  onClear?: () => void
}

export interface TreeBreadcrumbProps {
  root: string
  onRootClick?: () => void
  segments?: TreeBreadcrumbSegment[]
  trailingContent?: React.ReactNode
}

export function TreeBreadcrumb({
  root,
  onRootClick,
  segments,
  trailingContent,
}: TreeBreadcrumbProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-zinc-800/50 px-4 py-1 text-xs text-zinc-500">
      <span
        className={cn(onRootClick && 'cursor-pointer hover:text-white transition-colors')}
        onClick={onRootClick}
      >
        {root}
      </span>
      {segments?.map((segment, i) => (
        <React.Fragment key={i}>
          <span className="text-zinc-600"> / </span>
          <span
            className={cn(
              'inline-flex items-center gap-1',
              segment.onClear ? 'text-zinc-400' : 'text-zinc-400'
            )}
          >
            {segment.label}
            {segment.onClear && (
              <button
                type="button"
                onClick={segment.onClear}
                className="rounded p-0.5 text-zinc-500 hover:text-white transition"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        </React.Fragment>
      ))}
      {trailingContent && <div className="ml-auto">{trailingContent}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 4. TreeDetailLayout
// ---------------------------------------------------------------------------

export interface TreeDetailLayoutProps {
  tree: React.ReactNode
  detail: React.ReactNode | null
  detailWidth?: string
}

export function TreeDetailLayout({
  tree,
  detail,
  detailWidth = '400px',
}: TreeDetailLayoutProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Left: tree content */}
      <ScrollArea className="min-h-0 flex-1">{tree}</ScrollArea>

      {/* Right: detail panel */}
      {detail && (
        <div
          className="flex w-full max-h-[60vh] flex-col border-t border-zinc-800 lg:min-h-0 lg:max-h-none lg:border-l lg:border-t-0"
          style={{ maxWidth: undefined }}
        >
          <div className={cn('flex w-full flex-col')} style={{ width: undefined }}>
            <style jsx>{`
              @media (min-width: 1024px) {
                div:has(> [data-tree-detail]) {
                  width: ${detailWidth};
                }
              }
            `}</style>
            <div data-tree-detail className="flex h-full w-full flex-col">
              {detail}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 5. TreeRow
// ---------------------------------------------------------------------------

export interface TreeRowDragHandlers {
  onDragOver?: React.DragEventHandler
  onDragEnter?: React.DragEventHandler
  onDragLeave?: React.DragEventHandler
  onDrop?: React.DragEventHandler
}

export interface TreeRowProps {
  id: string
  depth: number
  isSelected: boolean
  isExpanded: boolean
  hasChildren: boolean
  isDragging: boolean
  isDragTarget?: boolean
  dropPosition?: DropPosition
  isEditing?: boolean
  onToggle: () => void
  onSelect: () => void
  onDoubleClick?: () => void
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  dragHandlers?: TreeRowDragHandlers
  onAddChild?: () => void
  depthOffset?: number
  baseIndent?: number
  children: React.ReactNode
  rowRef?: React.RefObject<HTMLDivElement | null>
}

export function TreeRow({
  id,
  depth,
  isSelected,
  isExpanded,
  hasChildren,
  isDragging,
  isDragTarget,
  dropPosition,
  isEditing,
  onToggle,
  onSelect,
  onDoubleClick,
  onDragStart,
  onDragEnd,
  dragHandlers,
  onAddChild,
  depthOffset = 24,
  baseIndent = 32,
  children,
  rowRef: externalRef,
}: TreeRowProps) {
  const internalRef = useRef<HTMLDivElement | null>(null)
  const rowRef = externalRef ?? internalRef
  const paddingLeft = baseIndent + depth * depthOffset
  const lineIndent = baseIndent + depth * depthOffset

  const showDragHandle = onDragStart && !isEditing

  return (
    <div
      ref={rowRef}
      data-tree-row={id}
      onDragOver={dragHandlers?.onDragOver}
      onDragEnter={dragHandlers?.onDragEnter}
      onDragLeave={dragHandlers?.onDragLeave}
      onDrop={dragHandlers?.onDrop}
      className={cn(
        'group relative flex w-full items-center border-b border-zinc-800/40 border-l-2 border-l-transparent transition',
        isSelected
          ? 'bg-white/[0.08] ring-1 ring-inset ring-white/10'
          : 'hover:bg-white/[0.03]',
        isDragging && 'opacity-50',
        isDragTarget && dropPosition === 'on' && 'border-l-blue-400'
      )}
    >
      {/* Positional drop indicator: before */}
      {isDragTarget && dropPosition === 'before' && (
        <div
          className="pointer-events-none absolute right-0 top-0 z-20 h-0.5 bg-blue-400"
          style={{ left: lineIndent }}
        >
          <div className="absolute -top-[3px] left-0 h-1.5 w-1.5 rounded-full bg-blue-400" />
        </div>
      )}

      {/* Positional drop indicator: after */}
      {isDragTarget && dropPosition === 'after' && (
        <div
          className="pointer-events-none absolute right-0 bottom-0 z-20 h-0.5 bg-blue-400"
          style={{ left: lineIndent }}
        >
          <div className="absolute -bottom-[3px] left-0 h-1.5 w-1.5 rounded-full bg-blue-400" />
        </div>
      )}

      {/* Drag handle */}
      {showDragHandle && (
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="absolute left-2 top-1/2 z-10 inline-flex -translate-y-1/2 cursor-grab rounded p-0.5 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-300 active:cursor-grabbing"
          title="Drag to move"
        >
          <GripVertical className="h-3 w-3" />
        </span>
      )}

      {/* Expand/collapse toggle */}
      <button
        type="button"
        onClick={onToggle}
        style={{ paddingLeft }}
        className="flex shrink-0 items-center py-2.5 pr-1.5"
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="h-3 w-3 text-zinc-500" />
          ) : (
            <ChevronRight className="h-3 w-3 text-zinc-500" />
          )
        ) : (
          <span className="inline-block h-3 w-3" />
        )}
      </button>

      {/* Main row content */}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onDoubleClick={!isEditing ? onDoubleClick : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect()
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pr-3 text-left"
      >
        {children}
        {onAddChild && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAddChild(); }}
            className="inline-flex shrink-0 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 6. InlineEditInput
// ---------------------------------------------------------------------------

export function InlineEditInput({
  id,
  defaultValue,
  onCommit,
  onCancel,
  className,
}: {
  id: string
  defaultValue: string
  onCommit: (id: string, value: string) => void
  onCancel: () => void
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = () => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== defaultValue) {
      onCommit(id, trimmed)
    } else {
      onCancel()
    }
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onCancel()
        // Prevent keyboard nav from firing while editing
        e.stopPropagation()
      }}
      onBlur={commit}
      className={cn(
        'block h-5 w-full border-0 bg-transparent p-0 text-sm leading-5 text-white outline-none placeholder:text-zinc-600',
        className
      )}
    />
  )
}
