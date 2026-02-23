'use client'

import {
  IconWorld,
  IconKey,
  IconFolder,
  IconFolderOpen,
  IconTerminal,
  IconShieldCheck,
} from '@tabler/icons-react'

interface PluginPermissions {
  network?: string[]
  secrets?: string[]
  filesystemRead?: string[]
  filesystemWrite?: string[]
  allowProcessSpawn?: boolean
}

interface PermissionsListProps {
  permissions: PluginPermissions | undefined | null
  className?: string
}

interface PermissionItem {
  icon: React.ComponentType<{ className?: string }>
  label: string
  variant: 'default' | 'warning'
}

function buildPermissionItems(permissions: PluginPermissions): PermissionItem[] {
  const items: PermissionItem[] = []

  for (const host of permissions.network ?? []) {
    items.push({
      icon: IconWorld,
      label: `Can make requests to ${host}`,
      variant: 'default',
    })
  }

  for (const key of permissions.secrets ?? []) {
    items.push({
      icon: IconKey,
      label: `Can access the secret: ${key}`,
      variant: 'warning',
    })
  }

  for (const dir of permissions.filesystemRead ?? []) {
    items.push({
      icon: IconFolder,
      label: `Can read files in ${dir}`,
      variant: 'default',
    })
  }

  for (const dir of permissions.filesystemWrite ?? []) {
    items.push({
      icon: IconFolderOpen,
      label: `Can write files in ${dir}`,
      variant: 'warning',
    })
  }

  if (permissions.allowProcessSpawn) {
    items.push({
      icon: IconTerminal,
      label: 'Can run system commands',
      variant: 'warning',
    })
  }

  return items
}

export function PermissionsList({ permissions, className }: PermissionsListProps) {
  if (!permissions) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 text-xs text-emerald-400/80">
          <IconShieldCheck className="h-3.5 w-3.5" />
          <span>No special permissions needed</span>
        </div>
      </div>
    )
  }

  const items = buildPermissionItems(permissions)

  if (items.length === 0) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 text-xs text-emerald-400/80">
          <IconShieldCheck className="h-3.5 w-3.5" />
          <span>No special permissions needed</span>
        </div>
      </div>
    )
  }

  return (
    <ul className={`space-y-1.5 ${className ?? ''}`}>
      {items.map((item, i) => {
        const Icon = item.icon
        return (
          <li key={i} className="flex items-start gap-2 text-xs">
            <Icon
              className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                item.variant === 'warning' ? 'text-amber-400' : 'text-muted-foreground'
              }`}
            />
            <span className="text-white/80">{item.label}</span>
          </li>
        )
      })}
    </ul>
  )
}

export type { PluginPermissions }
