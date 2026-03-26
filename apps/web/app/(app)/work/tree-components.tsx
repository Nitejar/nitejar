'use client'

import Link from 'next/link'
import React, { useRef, useState, useEffect, useCallback } from 'react'
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
  if (!active) return null

  return (
    <div className="relative h-0">
      <div
        className="absolute left-0 right-0 top-0 z-10 h-2"
        onDragOver={handlers?.onDragOver}
        onDragEnter={handlers?.onDragEnter}
        onDragLeave={handlers?.onDragLeave}
        onDrop={handlers?.onDrop}
      />
      {isOver && (
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-0.5 bg-blue-400" />
      )}
    </div>
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
  depthOffset = 16,
  baseIndent = 16,
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
        onDragOver={(e) => {
          handlers?.onDragOver?.(e)
        }}
        onDragEnter={(e) => {
          setIsOver(true)
          handlers?.onDragEnter?.(e)
        }}
        onDragLeave={() => {
          setIsOver(false)
          handlers?.onDragLeave?.({} as React.DragEvent)
        }}
        onDrop={(e) => {
          setIsOver(false)
          handlers?.onDrop?.(e)
        }}
      />
      {isOver && (
        <div
          className="pointer-events-none absolute right-0 top-0 z-20 h-0.5 bg-blue-400"
          style={{ left: indent }}
        />
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
  href?: string
}

export interface TreeToolbarProps {
  title?: string
  views?: TreeToolbarView[]
  activeViewId?: string
  onViewChange?: (viewId: string) => void
  viewStyle?: 'dropdown' | 'pills'
  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder?: string
  filterSlot?: React.ReactNode
  onCreateClick?: () => void
}

export function TreeToolbar({
  title,
  views,
  activeViewId,
  onViewChange,
  viewStyle = 'dropdown',
  search,
  onSearchChange,
  searchPlaceholder = 'Search...',
  filterSlot,
  onCreateClick,
}: TreeToolbarProps) {
  const activeView = views?.find((v) => v.id === activeViewId) ?? views?.[0]

  return (
    <div className="flex h-11 items-center gap-2 border-b border-zinc-800 px-4">
      {/* Page title */}
      {title && <span className="text-sm font-semibold text-zinc-200">{title}</span>}

      {/* View selector */}
      {views && views.length > 0 ? (
        viewStyle === 'pills' ? (
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-white/[0.02] p-1">
            {views.map((view) => {
              const content = (
                <>
                  {view.icon && <view.icon className="h-3.5 w-3.5" />}
                  <span>{view.name}</span>
                </>
              )

              const className = cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition',
                activeViewId === view.id
                  ? 'bg-white/[0.08] text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              )

              if (view.href) {
                return (
                  <Link key={view.id} href={view.href} className={className}>
                    {content}
                  </Link>
                )
              }

              return (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => onViewChange?.(view.id)}
                  className={className}
                >
                  {content}
                </button>
              )
            })}
          </div>
        ) : onViewChange ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-1 text-xs text-zinc-400 transition hover:text-zinc-200">
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
        ) : null
      ) : null}

      <div className="flex-1" />

      {/* Search input */}
      <div className="relative w-32 sm:w-48">
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
    <div className="flex shrink-0 flex-wrap items-center gap-1 px-4 py-1 text-xs text-zinc-500">
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
  /** Controls that sit above the list (toolbar, breadcrumb, etc.) */
  header?: React.ReactNode
  tree: React.ReactNode
  detail: React.ReactNode | null
  detailWidth?: string
  treeScrollable?: boolean
}

export function TreeDetailLayout({
  header,
  tree,
  detail,
  detailWidth = '440px',
  treeScrollable = true,
}: TreeDetailLayoutProps) {
  const isOpen = detail !== null
  // Keep the last non-null detail around so the exit animation shows content
  const [renderedDetail, setRenderedDetail] = useState<React.ReactNode>(detail)
  const [animState, setAnimState] = useState<'closed' | 'opening' | 'open' | 'closing'>(
    isOpen ? 'open' : 'closed'
  )

  useEffect(() => {
    if (isOpen) {
      setRenderedDetail(detail)
      if (animState === 'closed') {
        // Mount at width:0 first, then animate open on next frame
        setAnimState('opening')
      } else if (animState === 'closing') {
        // Interrupt close — snap to opening so next rAF triggers open
        setAnimState('opening')
      } else {
        // Already open — just update content
        setAnimState('open')
      }
    } else if (animState === 'open') {
      setAnimState('closing')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, detail])

  // Second frame: flip opening → open so the browser sees the 0→440px transition
  useEffect(() => {
    if (animState === 'opening') {
      const raf = requestAnimationFrame(() => {
        setAnimState('open')
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [animState])

  const handleTransitionEnd = useCallback(() => {
    if (animState === 'closing') {
      setAnimState('closed')
      setRenderedDetail(null)
    }
  }, [animState])

  const showPanel = animState !== 'closed'
  const expanded = animState === 'open'

  return (
    // Negative margins cancel AdminShell padding so the layout goes edge-to-edge
    <div className="-mx-2 -mt-2 -mb-4 flex min-h-0 flex-1 overflow-hidden sm:-mx-6 sm:-mt-4 sm:-mb-6">
      {/* Left: inbox list column — header + scrollable rows */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0">{header}</div>
        {treeScrollable ? (
          <ScrollArea className="min-h-0 flex-1">{tree}</ScrollArea>
        ) : (
          <div className="min-h-0 flex-1">{tree}</div>
        )}
      </div>

      {/* Right: detail panel — animated slide + fade */}
      {showPanel && (
        <div
          onTransitionEnd={handleTransitionEnd}
          className={cn(
            'hidden shrink-0 overflow-hidden border-l border-zinc-800 lg:flex lg:min-h-0 lg:flex-col',
            'transition-[width,opacity] duration-200 ease-out'
          )}
          style={{
            width: expanded ? detailWidth : '0px',
            opacity: expanded ? 1 : 0,
          }}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ width: detailWidth }}>
            {renderedDetail}
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
  /** Secondary content hidden on mobile, shown on sm+ */
  secondaryContent?: React.ReactNode
  /** Row-level actions rendered vertically centered at the right edge */
  actions?: React.ReactNode
  /** When true, secondary content renders on a second line below the title */
  twoLine?: boolean
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
  depthOffset = 16,
  baseIndent = 16,
  secondaryContent,
  actions,
  twoLine,
  children,
  rowRef: externalRef,
}: TreeRowProps) {
  const internalRef = useRef<HTMLDivElement | null>(null)
  const rowRef = externalRef ?? internalRef
  // Use CSS custom properties so we can reduce indent on small screens
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
        'group relative flex w-full items-center border-b border-zinc-800/40 transition',
        isSelected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]',
        isDragging && 'opacity-50'
      )}
    >
      {/* Positional drop indicator: on */}
      {isDragTarget && dropPosition === 'on' && (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-0.5 bg-blue-400" />
      )}

      {/* Positional drop indicator: before */}
      {isDragTarget && dropPosition === 'before' && (
        <div
          className="pointer-events-none absolute right-0 top-0 z-20 h-0.5 bg-blue-400"
          style={{ left: lineIndent }}
        />
      )}

      {/* Positional drop indicator: after */}
      {isDragTarget && dropPosition === 'after' && (
        <div
          className="pointer-events-none absolute right-0 bottom-0 z-20 h-0.5 bg-blue-400"
          style={{ left: lineIndent }}
        />
      )}

      {/* Expand/collapse toggle + drag handle */}
      <button
        type="button"
        onClick={onToggle}
        style={{ paddingLeft }}
        className="relative flex shrink-0 items-center py-2.5 pr-1.5"
      >
        {/* Drag handle — overlays the indent gutter on hover */}
        {showDragHandle && (
          <span
            draggable
            onDragStart={(e) => {
              e.stopPropagation()
              onDragStart?.(e)
            }}
            onDragEnd={onDragEnd}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 left-0 z-10 flex w-[--drag-zone] items-center justify-center cursor-grab text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-zinc-300 active:cursor-grabbing"
            style={{ '--drag-zone': `${paddingLeft}px` } as React.CSSProperties}
            title="Drag to move"
          >
            <GripVertical className="h-3 w-3" />
          </span>
        )}
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
        className={cn(
          'flex min-w-0 flex-1 pr-3 text-left',
          twoLine ? 'flex-col gap-0.5 py-1.5' : 'items-center gap-2 py-2.5 sm:gap-2.5'
        )}
      >
        {twoLine ? (
          <>
            {/* Line 1: status + title */}
            <span className="flex min-w-0 items-center gap-2 sm:gap-2.5">{children}</span>
            {/* Line 2: secondary metadata */}
            {secondaryContent && (
              <span className="hidden items-center gap-2.5 sm:flex">{secondaryContent}</span>
            )}
          </>
        ) : (
          <>
            {children}
            {secondaryContent && (
              <span className="hidden shrink-0 items-center gap-2.5 sm:flex">
                {secondaryContent}
              </span>
            )}
          </>
        )}
      </div>

      {/* Row-level actions — vertically centered */}
      {onAddChild && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onAddChild()
          }}
          className="inline-flex shrink-0 rounded p-0.5 mr-2 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      {actions}
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
