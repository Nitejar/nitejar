'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { IconRefresh, IconCheck, IconChevronDown } from '@tabler/icons-react'

interface Props {
  dispatchId: string
}

type ReplayMode = 'restart' | 'resume'

export function RetryRunButton({ dispatchId }: Props) {
  const router = useRouter()
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [lastMode, setLastMode] = useState<ReplayMode>('restart')
  const [menuOpen, setMenuOpen] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'queued' | 'error'>('idle')
  const replay = trpc.dispatches.replay.useMutation({
    onSuccess: (data) => {
      if (data.ok) {
        setStatus('queued')
        router.refresh()
      } else {
        setStatus('error')
      }
    },
    onError: () => {
      setStatus('error')
    },
  })

  useEffect(() => {
    if (!menuOpen) return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => window.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [menuOpen])

  const triggerReplay = (mode: ReplayMode) => {
    if (status === 'loading' || status === 'queued') return
    setLastMode(mode)
    setMenuOpen(false)
    setStatus('loading')
    replay.mutate({ dispatchId, mode })
  }

  const stopSummaryToggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const stopSummaryPropagation = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const handlePrimaryRestart = (e: React.MouseEvent) => {
    stopSummaryToggle(e)
    triggerReplay('restart')
  }

  const handleMenuAction = (mode: ReplayMode) => (e: React.MouseEvent<HTMLButtonElement>) => {
    stopSummaryToggle(e)
    triggerReplay(mode)
  }

  const handleMenuToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    stopSummaryToggle(e)
    if (isLoading) return
    setMenuOpen((open) => !open)
  }

  if (status === 'queued') {
    return (
      <span className="flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-400">
        <IconCheck className="h-3 w-3" />
        Queued
      </span>
    )
  }

  const isLoading = status === 'loading'
  const loadingLabel = lastMode === 'resume' ? 'Resuming…' : 'Restarting…'
  const errorLabel = lastMode === 'resume' ? 'Failed — Resume' : 'Failed — Restart'

  return (
    <div ref={menuRef} className="relative flex items-center">
      <button
        onClick={handlePrimaryRestart}
        disabled={isLoading}
        type="button"
        className="flex h-6 cursor-pointer items-center gap-1 rounded-l border border-white/10 bg-white/5 px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <IconRefresh className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
        {isLoading ? loadingLabel : status === 'error' ? errorLabel : 'Restart'}
      </button>

      <button
        onClick={handleMenuToggle}
        disabled={isLoading}
        type="button"
        className="flex h-6 w-7 cursor-pointer items-center justify-center rounded-r border border-l-0 border-white/10 bg-white/5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Replay options"
      >
        <IconChevronDown className="h-3 w-3" />
      </button>

      {menuOpen && !isLoading && (
        <div
          className="absolute top-full right-0 z-50 mt-1 w-52 rounded-lg border border-white/10 bg-black/95 p-1 shadow-lg"
          onClick={stopSummaryPropagation}
        >
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-white/50">
            Replay Mode
          </p>
          <button
            type="button"
            className="w-full cursor-pointer rounded px-2 py-1 text-left text-xs text-white/80 hover:bg-white/10"
            onClick={handleMenuAction('resume')}
          >
            Resume from last good turn
          </button>
          <button
            type="button"
            className="mt-0.5 w-full cursor-pointer rounded px-2 py-1 text-left text-xs text-white/80 hover:bg-white/10"
            onClick={handleMenuAction('restart')}
          >
            Restart from scratch
          </button>
        </div>
      )}
    </div>
  )
}
