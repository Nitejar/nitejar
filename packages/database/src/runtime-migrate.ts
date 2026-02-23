import { pathToFileURL } from 'node:url'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { runMigrations } from './migrate.js'
import { migrateIntegrationsToPluginInstances } from '../scripts/manual/migrate-integrations-to-plugin-instances.js'

type RuntimeMigrationReceipt = {
  startedAt: string
  finishedAt: string
  dbPath: string
  migrationStatus: 'ok' | 'error'
  cutoverStatus: 'completed' | 'skipped' | 'failed'
  cutoverReason?: string
  error?: string
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function writeReceipt(receipt: RuntimeMigrationReceipt): void {
  const receiptPath = process.env.MIGRATION_RECEIPT_PATH
  if (!receiptPath) return

  mkdirSync(dirname(receiptPath), { recursive: true })
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
}

export async function runRuntimeMigrations(): Promise<void> {
  const startedAt = new Date().toISOString()
  const dbPath = process.env.DATABASE_URL ?? ''

  try {
    await runMigrations()

    let cutoverStatus: RuntimeMigrationReceipt['cutoverStatus'] = 'skipped'
    let cutoverReason: string | undefined = 'disabled'

    if (process.env.NITEJAR_AUTO_CUTOVER !== '0') {
      const result = migrateIntegrationsToPluginInstances({
        dbPath: process.env.DATABASE_URL,
        backupMode:
          process.env.NITEJAR_CUTOVER_BACKUP_MODE === 'sql-dump' ? 'sql-dump' : 'file-copy',
      })
      if (result.status === 'completed') {
        cutoverStatus = 'completed'
        cutoverReason = undefined
      } else {
        cutoverStatus = 'skipped'
        cutoverReason = result.reason
      }
    }

    writeReceipt({
      startedAt,
      finishedAt: new Date().toISOString(),
      dbPath,
      migrationStatus: 'ok',
      cutoverStatus,
      cutoverReason,
    })
  } catch (error) {
    const message = formatError(error)
    writeReceipt({
      startedAt,
      finishedAt: new Date().toISOString(),
      dbPath,
      migrationStatus: 'error',
      cutoverStatus: 'failed',
      error: message,
    })
    throw error
  }
}

const isDirectRun = (() => {
  if (typeof process.argv[1] !== 'string') return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  }
})()

if (isDirectRun) {
  runRuntimeMigrations().catch((error) => {
    console.error(formatError(error))
    process.exit(1)
  })
}
