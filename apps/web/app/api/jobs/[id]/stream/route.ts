import { createSSEStream } from '@nitejar/agent/streaming'
import { requireApiAuth } from '@/lib/api-auth'

interface RouteParams {
  params: Promise<{
    id: string
  }>
}

export async function GET(request: Request, context: RouteParams) {
  const unauthorized = await requireApiAuth(request)
  if (unauthorized) return unauthorized

  const { id: jobId } = await context.params

  // Get start index from query params (for replay from a specific point)
  const url = new URL(request.url)
  const startIndex = parseInt(url.searchParams.get('startIndex') ?? '0', 10)

  // Create SSE stream
  const stream = createSSEStream(jobId, startIndex)

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
