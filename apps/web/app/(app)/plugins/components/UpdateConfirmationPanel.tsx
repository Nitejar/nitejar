'use client'

import { IconAlertTriangle } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'

interface PluginInfo {
  name: string
  version: string
  description: string
  permissions: Record<string, unknown> | undefined
}

interface UpdateConfirmationPanelProps {
  newPlugin: PluginInfo
  existingPlugin: PluginInfo
  onConfirm: () => void
  onCancel: () => void
  isConfirming?: boolean
}

function DiffRow({
  label,
  oldValue,
  newValue,
}: {
  label: string
  oldValue: string
  newValue: string
}) {
  if (oldValue === newValue) return null
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="w-20 shrink-0 text-white/50">{label}</span>
      <span className="text-red-400/80 line-through">{oldValue || '(empty)'}</span>
      <span className="text-white/40">&rarr;</span>
      <span className="text-emerald-400">{newValue || '(empty)'}</span>
    </div>
  )
}

function PermissionsDiff({
  oldPerms,
  newPerms,
}: {
  oldPerms: Record<string, unknown> | undefined
  newPerms: Record<string, unknown> | undefined
}) {
  const oldSet = flattenPermissions(oldPerms)
  const newSet = flattenPermissions(newPerms)

  const added = [...newSet].filter((p) => !oldSet.has(p))
  const removed = [...oldSet].filter((p) => !newSet.has(p))
  const unchanged = [...newSet].filter((p) => oldSet.has(p))

  if (added.length === 0 && removed.length === 0) return null

  return (
    <div className="space-y-1">
      <span className="text-xs text-white/50">Permissions</span>
      <div className="space-y-0.5 pl-2">
        {added.map((p) => (
          <div key={`+${p}`} className="text-xs text-emerald-400">
            + {p}
          </div>
        ))}
        {removed.map((p) => (
          <div key={`-${p}`} className="text-xs text-red-400">
            - {p}
          </div>
        ))}
        {unchanged.map((p) => (
          <div key={`=${p}`} className="text-xs text-white/30">
            {p}
          </div>
        ))}
      </div>
    </div>
  )
}

function flattenPermissions(perms: Record<string, unknown> | undefined): Set<string> {
  if (!perms) return new Set()
  const set = new Set<string>()

  const network = perms.network
  if (Array.isArray(network)) {
    for (const host of network) set.add(`network: ${host}`)
  }
  const secrets = perms.secrets
  if (Array.isArray(secrets)) {
    for (const key of secrets) set.add(`secret: ${key}`)
  }
  const fsRead = perms.filesystemRead
  if (Array.isArray(fsRead)) {
    for (const dir of fsRead) set.add(`filesystem_read: ${dir}`)
  }
  const fsWrite = perms.filesystemWrite
  if (Array.isArray(fsWrite)) {
    for (const dir of fsWrite) set.add(`filesystem_write: ${dir}`)
  }
  if (perms.allowProcessSpawn) {
    set.add('process_spawn')
  }

  return set
}

export function UpdateConfirmationPanel({
  newPlugin,
  existingPlugin,
  onConfirm,
  onCancel,
  isConfirming,
}: UpdateConfirmationPanelProps) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <IconAlertTriangle className="h-4 w-4 text-amber-400" />
        <h4 className="text-sm font-medium text-amber-300">Updating {existingPlugin.name}</h4>
      </div>

      <div className="space-y-2">
        <DiffRow label="Version" oldValue={existingPlugin.version} newValue={newPlugin.version} />
        <DiffRow label="Name" oldValue={existingPlugin.name} newValue={newPlugin.name} />
        <DiffRow
          label="Description"
          oldValue={truncate(existingPlugin.description, 100)}
          newValue={truncate(newPlugin.description, 100)}
        />
        <PermissionsDiff oldPerms={existingPlugin.permissions} newPerms={newPlugin.permissions} />
      </div>

      <p className="text-xs text-white/50">
        This will replace the current version. Existing connections will use the updated plugin
        code.
      </p>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={onConfirm} disabled={isConfirming}>
          {isConfirming ? 'Updating...' : 'Confirm Update'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={isConfirming}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '...'
}
