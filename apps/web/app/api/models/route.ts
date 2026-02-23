import { NextResponse } from 'next/server'
import {
  ensureModelCatalogRefresh,
  listModelCatalog,
  refreshModelCatalog,
} from '../../../server/services/model-catalog'
import { requireApiAuth } from '@/lib/api-auth'

/**
 * GET /api/models
 * Returns cached model catalog; triggers async refresh if stale.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const unauthorized = await requireApiAuth(request)
  if (unauthorized) return unauthorized

  ensureModelCatalogRefresh()
  const { models, isStale } = await listModelCatalog()

  if (isStale) {
    refreshModelCatalog().catch((error) => {
      console.warn('[ModelCatalog] Refresh failed', error)
    })
  }

  return NextResponse.json({
    models,
    refreshing: isStale,
  })
}
