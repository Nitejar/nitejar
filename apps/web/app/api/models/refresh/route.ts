import { NextResponse } from 'next/server'
import { refreshModelCatalog } from '../../../../server/services/model-catalog'
import { requireApiRole } from '@/lib/api-auth'

/**
 * POST /api/models/refresh
 * Refresh cached model catalog from OpenRouter.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const unauthorized = await requireApiRole(request)
  if (unauthorized) return unauthorized

  const result = await refreshModelCatalog()

  return NextResponse.json({
    source: result.source,
    count: result.models.length,
    error: result.error ?? null,
  })
}
