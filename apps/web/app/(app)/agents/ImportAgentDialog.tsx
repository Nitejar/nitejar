'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { IconAlertTriangle, IconCheck, IconLoader2, IconUpload, IconX } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

type FlowState = 'idle' | 'validating' | 'preview' | 'importing'

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  handleConflict: boolean
  modelAvailable: boolean
  pluginStatus: Array<{ pluginId: string; installed: boolean; hasInstance: boolean }>
  skillStatus: Array<{ skillSlug: string; available: boolean }>
}

export function ImportAgentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [flowState, setFlowState] = useState<FlowState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [handleOverride, setHandleOverride] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const validateMutation = trpc.org.validateAgentProfile.useMutation()
  const importMutation = trpc.org.importAgentProfile.useMutation()

  const reset = useCallback(() => {
    setFlowState('idle')
    setError(null)
    setProfile(null)
    setValidation(null)
    setHandleOverride('')
  }, [])

  const handleClose = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  const processFile = useCallback(
    async (file: File) => {
      setError(null)
      setFlowState('validating')

      try {
        const text = await file.text()
        const parsed = JSON.parse(text) as Record<string, unknown>

        // Check format version
        if (typeof parsed.formatVersion !== 'number') {
          setError('Invalid file: missing formatVersion field.')
          setFlowState('idle')
          return
        }

        setProfile(parsed)

        // Validate via server
        const result = await validateMutation.mutateAsync({ profile: parsed })
        setValidation(result)

        if (!result.valid) {
          setError(result.errors.join('; '))
          setFlowState('idle')
          return
        }

        // Pre-fill handle override if conflict
        if (result.handleConflict) {
          const identity = parsed.identity as { handle?: string } | undefined
          const baseHandle = identity?.handle || 'agent'
          setHandleOverride(`${baseHandle}-2`)
        }

        setFlowState('preview')
      } catch (err) {
        if (err instanceof SyntaxError) {
          setError('Invalid JSON file.')
        } else {
          setError(err instanceof Error ? err.message : 'Validation failed.')
        }
        setFlowState('idle')
      }
    },
    [validateMutation]
  )

  const handleFileSelect = useCallback(
    (file: File | null) => {
      if (!file) return
      if (!file.name.endsWith('.json')) {
        setError('File must be a .nitejar-agent.json file.')
        return
      }
      void processFile(file)
    },
    [processFile]
  )

  const handleImport = useCallback(async () => {
    if (!profile) return
    setFlowState('importing')
    setError(null)

    try {
      const result = await importMutation.mutateAsync({
        profile: profile as Parameters<typeof importMutation.mutateAsync>[0]['profile'],
        handleOverride: handleOverride || undefined,
      })

      toast.success('Agent imported')
      handleClose()
      router.push(`/agents/${result.agentId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.')
      setFlowState('preview')
    }
  }, [profile, handleOverride, importMutation, handleClose, router])

  if (!open) return null

  const identity = profile?.identity as
    | { name?: string; handle?: string; emoji?: string; title?: string }
    | undefined

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-lg rounded-lg border border-white/10 bg-card p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Import Agent</h3>
          <button
            type="button"
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        {/* File picker */}
        {(flowState === 'idle' || flowState === 'validating') && (
          <div className="space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                setIsDragging(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                const file = e.dataTransfer.files[0]
                if (file) handleFileSelect(file)
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 transition ${
                isDragging
                  ? 'border-emerald-500/50 bg-emerald-500/5'
                  : 'border-white/15 hover:border-white/30'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = (e.target as HTMLInputElement).files?.[0]
                  if (file) handleFileSelect(file)
                }}
              />
              {flowState === 'validating' ? (
                <>
                  <IconLoader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Validating...</p>
                </>
              ) : (
                <>
                  <IconUpload className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">Drop a .nitejar-agent.json file here</p>
                  <p className="text-xs text-muted-foreground">or click to browse</p>
                </>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Preview panel */}
        {flowState === 'preview' && profile && validation && (
          <div className="space-y-4">
            {/* Agent info */}
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center gap-3">
                {identity?.emoji && <span className="text-2xl">{identity.emoji}</span>}
                <div>
                  <p className="font-medium">{identity?.name ?? 'Unknown'}</p>
                  <p className="text-xs text-muted-foreground">
                    @{identity?.handle ?? 'unknown'}
                    {identity?.title && ` -- ${identity.title}`}
                  </p>
                </div>
              </div>
            </div>

            {/* Model info */}
            <div className="text-xs">
              <span className="text-muted-foreground">Model: </span>
              <span className="font-mono">
                {(profile.model as { preferred?: string } | undefined)?.preferred ?? '(default)'}
              </span>
              {!validation.modelAvailable && (
                <Badge variant="outline" className="ml-2 text-[10px] text-amber-300">
                  Not available
                </Badge>
              )}
            </div>

            {/* Handle conflict */}
            {validation.handleConflict && (
              <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="flex items-center gap-2">
                  <IconAlertTriangle className="h-4 w-4 text-amber-400" />
                  <span className="text-sm text-amber-300">
                    Handle &quot;{identity?.handle}&quot; is already in use.
                  </span>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="handle-override" className="text-xs">
                    New handle
                  </Label>
                  <Input
                    id="handle-override"
                    value={handleOverride}
                    onChange={(e) => setHandleOverride((e.target as HTMLInputElement).value)}
                    placeholder={`${identity?.handle}-2`}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            )}

            {/* Plugin status */}
            {validation.pluginStatus.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Plugins</p>
                <div className="space-y-1">
                  {validation.pluginStatus.map((ps) => (
                    <div key={ps.pluginId} className="flex items-center gap-2 text-xs">
                      {ps.installed && ps.hasInstance ? (
                        <IconCheck className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <IconAlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                      )}
                      <span>{ps.pluginId}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {ps.installed
                          ? ps.hasInstance
                            ? 'ready'
                            : 'no instance'
                          : 'not installed'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Skill status */}
            {validation.skillStatus.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Skills</p>
                <div className="space-y-1">
                  {validation.skillStatus.map((ss) => (
                    <div key={ss.skillSlug} className="flex items-center gap-2 text-xs">
                      {ss.available ? (
                        <IconCheck className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <IconAlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                      )}
                      <span>{ss.skillSlug}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {ss.available ? 'available' : 'not found'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Warnings */}
            {validation.warnings.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                {validation.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-300">
                    {w}
                  </p>
                ))}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={() => void handleImport()}
                disabled={
                  (flowState as FlowState) === 'importing' ||
                  (validation.handleConflict && !handleOverride.trim())
                }
              >
                {(flowState as FlowState) === 'importing' ? (
                  <>
                    <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Importing...
                  </>
                ) : (
                  'Import Agent'
                )}
              </Button>
              <Button variant="outline" onClick={reset}>
                Choose Different File
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
