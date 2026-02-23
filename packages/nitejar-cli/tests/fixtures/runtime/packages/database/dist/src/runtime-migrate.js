import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const receiptPath = process.env.MIGRATION_RECEIPT_PATH
const dbPath = process.env.DATABASE_URL || ''
const startedAt = new Date().toISOString()

function writeReceipt(migrationStatus, cutoverStatus, error) {
  if (!receiptPath) return
  mkdirSync(dirname(receiptPath), { recursive: true })
  writeFileSync(
    receiptPath,
    `${JSON.stringify(
      {
        startedAt,
        finishedAt: new Date().toISOString(),
        dbPath,
        migrationStatus,
        cutoverStatus,
        ...(error ? { error } : {}),
      },
      null,
      2
    )}\n`,
    'utf8'
  )
}

if (process.env.NITEJAR_TEST_MIGRATION_FAIL === '1') {
  writeReceipt('error', 'failed', 'fixture migration failed')
  console.error('fixture migration failed')
  process.exit(1)
}

writeReceipt('ok', 'completed')
process.exit(0)
