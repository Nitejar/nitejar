import { getDb } from '../db'

export async function upsertPluginArtifact(data: {
  pluginId: string
  version: string
  tgzBlob: Buffer
  sizeBytes: number
  checksum: string
}): Promise<void> {
  const db = getDb()
  await db
    .insertInto('plugin_artifacts')
    .values({
      plugin_id: data.pluginId,
      version: data.version,
      tgz_blob: data.tgzBlob,
      size_bytes: data.sizeBytes,
      checksum: data.checksum,
    })
    .onConflict((oc) =>
      oc.columns(['plugin_id', 'version']).doUpdateSet({
        tgz_blob: data.tgzBlob,
        size_bytes: data.sizeBytes,
        checksum: data.checksum,
      })
    )
    .execute()
}

export async function getPluginArtifact(
  pluginId: string,
  version: string
): Promise<{
  plugin_id: string
  version: string
  tgz_blob: Buffer
  size_bytes: number
  checksum: string
  created_at: number
} | null> {
  const db = getDb()
  const row = await db
    .selectFrom('plugin_artifacts')
    .selectAll()
    .where('plugin_id', '=', pluginId)
    .where('version', '=', version)
    .executeTakeFirst()
  return row ?? null
}

export async function deletePluginArtifact(pluginId: string, version: string): Promise<boolean> {
  const db = getDb()
  const result = await db
    .deleteFrom('plugin_artifacts')
    .where('plugin_id', '=', pluginId)
    .where('version', '=', version)
    .executeTakeFirst()
  return (result.numDeletedRows ?? 0n) > 0n
}
