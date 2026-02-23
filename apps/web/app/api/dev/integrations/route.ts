import { type NextRequest, NextResponse } from 'next/server'
import { createPluginInstance } from '@nitejar/database'
import { devGuard } from '@/lib/dev-guard'

/**
 * POST /api/dev/integrations
 *
 * Compatibility endpoint that creates a plugin instance for development/testing.
 */
export async function POST(request: NextRequest) {
  const guard = devGuard()
  if (guard) return guard

  const body = (await request.json()) as {
    type: string
    name: string
    config: string
    scope?: string
  }

  const pluginInstance = await createPluginInstance({
    type: body.type,
    name: body.name,
    config: body.config,
    scope: body.scope || 'global',
  })

  return NextResponse.json({
    ok: true,
    pluginInstance: {
      id: pluginInstance.id,
      type: pluginInstance.type,
      name: pluginInstance.name,
    },
    // Legacy response key for existing local scripts.
    integration: {
      id: pluginInstance.id,
      type: pluginInstance.type,
      name: pluginInstance.name,
    },
  })
}
