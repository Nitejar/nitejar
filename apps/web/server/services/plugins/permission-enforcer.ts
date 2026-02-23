import { createPluginEvent, findPluginById } from '@nitejar/database'
import { parsePluginManifest } from './manifest'

/**
 * Check if a plugin has declared a specific permission.
 * Returns true if permitted, false if denied.
 *
 * When denied, emits a `plugin_events` row with kind='permission_denied'.
 */
export async function checkPluginPermission(params: {
  pluginId: string
  permission: 'secret' | 'network' | 'filesystem_read' | 'filesystem_write' | 'process_spawn'
  scope?: string
}): Promise<boolean> {
  const plugin = await findPluginById(params.pluginId)
  if (!plugin) return false

  const manifest = parsePluginManifest(plugin.manifest_json)
  if (!manifest) return false

  // Builtins are always allowed
  if (plugin.source_kind === 'builtin') return true

  const perms = manifest.permissions
  let allowed = false

  switch (params.permission) {
    case 'secret': {
      const declaredSecrets = perms?.secrets ?? []
      allowed = declaredSecrets.includes('*') || declaredSecrets.includes(params.scope ?? '')
      break
    }
    case 'network': {
      const declaredHosts = perms?.network ?? []
      allowed = declaredHosts.includes('*') || declaredHosts.includes(params.scope ?? '')
      break
    }
    case 'filesystem_read': {
      const declaredPaths = perms?.filesystemRead ?? []
      allowed =
        declaredPaths.includes('*') || declaredPaths.some((p) => (params.scope ?? '').startsWith(p))
      break
    }
    case 'filesystem_write': {
      const declaredPaths = perms?.filesystemWrite ?? []
      allowed =
        declaredPaths.includes('*') || declaredPaths.some((p) => (params.scope ?? '').startsWith(p))
      break
    }
    case 'process_spawn': {
      allowed = perms?.allowProcessSpawn === true
      break
    }
  }

  if (!allowed) {
    // Emit a permission denied receipt
    try {
      await createPluginEvent({
        plugin_id: params.pluginId,
        kind: 'permission_denied',
        status: 'blocked',
        detail_json: JSON.stringify({
          permission: params.permission,
          scope: params.scope ?? null,
          enforcement: 'host_boundary',
        }),
      })
    } catch {
      // Non-fatal
    }
  }

  return allowed
}

/**
 * Assert a plugin has a specific permission, throwing if denied.
 */
export async function assertPluginPermission(params: {
  pluginId: string
  permission: 'secret' | 'network' | 'filesystem_read' | 'filesystem_write' | 'process_spawn'
  scope?: string
}): Promise<void> {
  const allowed = await checkPluginPermission(params)
  if (!allowed) {
    throw new Error(
      `Plugin ${params.pluginId} denied: permission '${params.permission}' scope '${params.scope ?? '*'}' not declared in manifest`
    )
  }
}
