'use client'

import { useState } from 'react'
import { IconLoader2, IconChevronDown } from '@tabler/icons-react'
import { trpc } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { toast } from 'sonner'

interface InstallPluginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InstallPluginDialog({ open, onOpenChange }: InstallPluginDialogProps) {
  const [sourceKind, setSourceKind] = useState<'npm' | 'local'>('npm')
  const [sourceRef, setSourceRef] = useState('')
  const [pluginId, setPluginId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [manifestJson, setManifestJson] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const utils = trpc.useUtils()
  const installMutation = trpc.plugins.installPlugin.useMutation({
    onSuccess: (data) => {
      toast.success(`Plugin "${data.plugin.name}" installed`)
      void utils.plugins.listPlugins.invalidate()
      resetAndClose()
    },
    onError: (err) => {
      setError(err.message)
    },
  })

  function resetAndClose() {
    setSourceKind('npm')
    setSourceRef('')
    setPluginId('')
    setDisplayName('')
    setVersion('1.0.0')
    setManifestJson('')
    setAdvancedOpen(false)
    setError(null)
    onOpenChange(false)
  }

  function suggestPluginId(pkg: string) {
    // Turn "@scope/my-plugin" into "my-plugin", "nitejar-plugin-foo" into "foo"
    const base = pkg.replace(/^@[^/]+\//, '').replace(/^nitejar-plugin-/, '')
    return base || pkg
  }

  function handleSourceRefChange(value: string) {
    setSourceRef(value)
    if (!pluginId || pluginId === suggestPluginId(sourceRef)) {
      setPluginId(suggestPluginId(value))
    }
    if (!displayName) {
      const name = suggestPluginId(value)
      setDisplayName(name.charAt(0).toUpperCase() + name.slice(1))
    }
  }

  function handleSubmit() {
    setError(null)
    installMutation.mutate({
      pluginId: pluginId.trim(),
      name: displayName.trim(),
      sourceKind,
      sourceRef: sourceRef.trim() || undefined,
      version: sourceKind === 'npm' ? version.trim() : '1.0.0',
      manifestJson: manifestJson.trim() || undefined,
      declaredCapabilities: [],
    })
  }

  const canSubmit = pluginId.trim() && displayName.trim() && sourceRef.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Install Custom Plugin</DialogTitle>
          <DialogDescription>Install a plugin from npm or a local path.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Source kind toggle */}
          <div className="space-y-1.5">
            <Label>Source</Label>
            <div className="flex gap-1 rounded-md border border-white/10 bg-white/[0.02] p-0.5">
              <button
                type="button"
                className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition ${
                  sourceKind === 'npm'
                    ? 'bg-white/10 text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setSourceKind('npm')}
              >
                npm
              </button>
              <button
                type="button"
                className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition ${
                  sourceKind === 'local'
                    ? 'bg-white/10 text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setSourceKind('local')}
              >
                Local Path
              </button>
            </div>
          </div>

          {/* Package name / local path */}
          <div className="space-y-1.5">
            <Label htmlFor="install-source-ref">
              {sourceKind === 'npm' ? 'Package Name' : 'Local Path'}
            </Label>
            <Input
              id="install-source-ref"
              placeholder={sourceKind === 'npm' ? '@scope/my-plugin' : '/path/to/plugin'}
              value={sourceRef}
              onChange={(e) => handleSourceRefChange((e.target as HTMLInputElement).value)}
            />
          </div>

          {/* Plugin ID */}
          <div className="space-y-1.5">
            <Label htmlFor="install-plugin-id">Plugin ID</Label>
            <Input
              id="install-plugin-id"
              placeholder="my-plugin"
              value={pluginId}
              onChange={(e) => setPluginId((e.target as HTMLInputElement).value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Unique identifier for this plugin. Auto-suggested from package name.
            </p>
          </div>

          {/* Display name */}
          <div className="space-y-1.5">
            <Label htmlFor="install-display-name">Display Name</Label>
            <Input
              id="install-display-name"
              placeholder="My Plugin"
              value={displayName}
              onChange={(e) => setDisplayName((e.target as HTMLInputElement).value)}
            />
          </div>

          {/* Version (npm only) */}
          {sourceKind === 'npm' && (
            <div className="space-y-1.5">
              <Label htmlFor="install-version">Version</Label>
              <Input
                id="install-version"
                placeholder="1.0.0"
                value={version}
                onChange={(e) => setVersion((e.target as HTMLInputElement).value)}
              />
            </div>
          )}

          {/* Advanced: raw manifest JSON */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <IconChevronDown
                className={`h-3 w-3 transition ${advancedOpen ? 'rotate-0' : '-rotate-90'}`}
              />
              Advanced
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 space-y-1.5">
                <Label htmlFor="install-manifest">Manifest JSON (optional)</Label>
                <textarea
                  id="install-manifest"
                  className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                  rows={5}
                  placeholder='{"schemaVersion": 1, "id": "...", ...}'
                  value={manifestJson}
                  onChange={(e) => setManifestJson(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground">
                  Provide a full plugin manifest to override auto-generated values.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Error */}
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || installMutation.isPending}>
            {installMutation.isPending ? (
              <>
                <IconLoader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Installing...
              </>
            ) : (
              'Install Plugin'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
