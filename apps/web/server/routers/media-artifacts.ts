import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import {
  findMediaArtifactBlobByArtifactId,
  listMediaArtifactDeliveriesByArtifactIds,
  listMediaArtifactsForWorkItem,
} from '@nitejar/database'
import { protectedProcedure, router } from '../trpc'

const MAX_MEDIA_CONTENT_BYTES = 8 * 1024 * 1024

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export const mediaArtifactsRouter = router({
  listByWorkItem: protectedProcedure
    .input(z.object({ workItemId: z.string() }))
    .query(async ({ input }) => {
      const artifacts = await listMediaArtifactsForWorkItem(input.workItemId)
      const deliveries = await listMediaArtifactDeliveriesByArtifactIds(artifacts.map((a) => a.id))
      const deliveriesByArtifact = new Map<string, typeof deliveries>()
      for (const delivery of deliveries) {
        const existing = deliveriesByArtifact.get(delivery.media_artifact_id) ?? []
        existing.push(delivery)
        deliveriesByArtifact.set(delivery.media_artifact_id, existing)
      }

      return artifacts.map((artifact) => ({
        ...artifact,
        metadata: parseMetadata(artifact.metadata),
        deliveries: deliveriesByArtifact.get(artifact.id) ?? [],
      }))
    }),

  getContent: protectedProcedure
    .input(z.object({ artifactId: z.string() }))
    .query(async ({ input }) => {
      const blob = await findMediaArtifactBlobByArtifactId(input.artifactId)
      if (!blob) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Media artifact content not found.' })
      }

      const buffer = Buffer.from(blob.blob_data)
      if (buffer.byteLength > MAX_MEDIA_CONTENT_BYTES) {
        throw new TRPCError({
          code: 'PAYLOAD_TOO_LARGE',
          message: `Artifact exceeds ${MAX_MEDIA_CONTENT_BYTES} bytes.`,
        })
      }

      return {
        artifactId: input.artifactId,
        sha256: blob.sha256,
        byteLength: buffer.byteLength,
        dataBase64: buffer.toString('base64'),
      }
    }),
})
