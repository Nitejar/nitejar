'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

export function RuntimeControlClient() {
  const [reason, setReason] = useState('')
  const [maxConcurrent, setMaxConcurrent] = useState<string>('')
  const seededRef = useRef(false)
  const runtimeQuery = trpc.runtimeControl.get.useQuery(undefined, { refetchInterval: 3000 })
  const utils = trpc.useUtils()

  // Seed local state from the first successful fetch
  useEffect(() => {
    if (runtimeQuery.data && !seededRef.current) {
      setMaxConcurrent(String(runtimeQuery.data.maxConcurrentDispatches))
      seededRef.current = true
    }
  }, [runtimeQuery.data])

  const pauseMutation = trpc.runtimeControl.pause.useMutation({
    onSuccess: async () => {
      await utils.runtimeControl.get.invalidate()
    },
  })

  const resumeMutation = trpc.runtimeControl.resume.useMutation({
    onSuccess: async () => {
      await utils.runtimeControl.get.invalidate()
    },
  })

  const emergencyMutation = trpc.runtimeControl.emergencyStop.useMutation({
    onSuccess: async () => {
      await utils.runtimeControl.get.invalidate()
    },
  })

  const concurrencyMutation = trpc.runtimeControl.setMaxConcurrentDispatches.useMutation({
    onSuccess: async (result) => {
      setMaxConcurrent(String(result.maxConcurrentDispatches))
      await utils.runtimeControl.get.invalidate()
    },
  })

  const data = runtimeQuery.data
  const isPaused = data ? !data.processingEnabled : false

  const statusText = useMemo(() => {
    if (!data) return 'Loading...'
    return data.processingEnabled ? 'Processing enabled' : `Paused (${data.pauseMode})`
  }, [data])

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <CardTitle className="text-base">Global Runtime Control</CardTitle>
          <CardDescription>
            Soft pause stops new claims and drains in-flight runs. Emergency stop force-terminates
            active runtime work.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                isPaused
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              }
            >
              {statusText}
            </Badge>
            {data?.pauseReason && (
              <span className="text-xs text-muted-foreground">{data.pauseReason}</span>
            )}
          </div>

          <div className="space-y-2">
            <Label>Reason</Label>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Optional reason for pause/emergency actions"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isPaused ? (
              <Button onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
                {resumeMutation.isPending ? 'Resuming...' : 'Resume Processing'}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => pauseMutation.mutate({ mode: 'soft', reason: reason || undefined })}
                disabled={pauseMutation.isPending}
              >
                {pauseMutation.isPending ? 'Pausing...' : 'Pause Processing'}
              </Button>
            )}

            <Button
              variant="destructive"
              onClick={() => {
                const confirmed = window.confirm(
                  'Emergency stop will force-terminate active runtime work. Continue?'
                )
                if (!confirmed) return
                emergencyMutation.mutate({ reason: reason || undefined })
              }}
              disabled={emergencyMutation.isPending}
            >
              {emergencyMutation.isPending ? 'Stopping...' : 'Emergency Stop'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/[0.02]">
        <CardHeader>
          <CardTitle className="text-base">Runtime Stats</CardTitle>
          <CardDescription>Current durable queue and outbox health snapshot.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="space-y-2">
            <div>Running dispatches: {data?.stats.runningDispatches ?? 0}</div>
            <div>Queued dispatches: {data?.stats.queuedDispatches ?? 0}</div>
            <div>Paused dispatches: {data?.stats.pausedDispatches ?? 0}</div>
            <div>Pending effects: {data?.stats.pendingEffects ?? 0}</div>
            <div>Unknown effects: {data?.stats.unknownEffects ?? 0}</div>
          </div>

          <div className="space-y-2 border-t border-white/5 pt-3">
            <Label className="text-xs text-muted-foreground">Max concurrent dispatches</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={100}
                className="h-8 w-20 text-xs"
                value={maxConcurrent}
                onChange={(event) => setMaxConcurrent(event.target.value)}
                onBlur={() => {
                  const num = parseInt(maxConcurrent, 10)
                  if (!isNaN(num) && num >= 1 && num <= 100) {
                    concurrencyMutation.mutate({ value: num })
                  } else {
                    setMaxConcurrent(String(data?.maxConcurrentDispatches ?? 20))
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    ;(event.target as HTMLInputElement).blur()
                  }
                }}
              />
              <span className="text-[11px] text-white/40">1 – 100</span>
            </div>
          </div>

          <div className="text-[11px] text-white/50">Control epoch: {data?.controlEpoch ?? 0}</div>
        </CardContent>
      </Card>
    </div>
  )
}
