import { NextResponse, type NextRequest } from 'next/server'
import {
  getGatewaySettings,
  updateGatewaySettings,
} from '../../../../server/services/gateway-settings'
import { requireApiAuth, requireApiRole } from '@/lib/api-auth'

function parseBody(request: NextRequest): Promise<Record<string, unknown>> {
  return request.json() as Promise<Record<string, unknown>>
}

/**
 * GET /api/settings/gateway
 * Returns gateway settings without exposing the full API key.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = await requireApiAuth(request)
  if (unauthorized) return unauthorized

  const settings = await getGatewaySettings()
  return NextResponse.json(settings)
}

/**
 * POST /api/settings/gateway
 * Updates gateway settings.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const unauthorized = await requireApiRole(request)
  if (unauthorized) return unauthorized

  let body: Record<string, unknown>
  try {
    body = await parseBody(request)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const provider = typeof body.provider === 'string' ? body.provider : undefined
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl : undefined
  const apiKeyInput = Object.prototype.hasOwnProperty.call(body, 'apiKey') ? body.apiKey : undefined

  try {
    const settings = await updateGatewaySettings({
      provider,
      baseUrl,
      apiKey: typeof apiKeyInput === 'string' ? apiKeyInput : undefined,
    })
    return NextResponse.json(settings)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update gateway settings' },
      { status: 400 }
    )
  }
}
