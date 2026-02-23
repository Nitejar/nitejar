import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runMigrationsMock = vi.fn(async () => {})
const cutoverMock = vi.fn()

vi.mock('./migrate.js', () => ({
  runMigrations: runMigrationsMock,
}))

vi.mock('../scripts/manual/migrate-integrations-to-plugin-instances.js', () => ({
  migrateIntegrationsToPluginInstances: cutoverMock,
}))

const tempDirs: string[] = []

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  process.env = { ...ORIGINAL_ENV }
})

async function loadRuntimeMigrator() {
  return await import('./runtime-migrate.js')
}

describe('runRuntimeMigrations', () => {
  it('writes success receipt when migrations and cutover complete', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-runtime-migrate-ok-'))
    tempDirs.push(dir)
    const receiptPath = path.join(dir, 'receipts', 'ok.json')

    process.env.DATABASE_URL = path.join(dir, 'nitejar.db')
    process.env.MIGRATION_RECEIPT_PATH = receiptPath

    runMigrationsMock.mockResolvedValue(undefined)
    cutoverMock.mockReturnValue({ status: 'completed', report: { reportPath: 'x' } })

    const { runRuntimeMigrations } = await loadRuntimeMigrator()
    await runRuntimeMigrations()

    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      migrationStatus: string
      cutoverStatus: string
    }

    expect(runMigrationsMock).toHaveBeenCalledTimes(1)
    expect(cutoverMock).toHaveBeenCalledTimes(1)
    expect(receipt.migrationStatus).toBe('ok')
    expect(receipt.cutoverStatus).toBe('completed')
  })

  it('writes failure receipt when migrations throw', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-runtime-migrate-fail-'))
    tempDirs.push(dir)
    const receiptPath = path.join(dir, 'receipts', 'fail.json')

    process.env.DATABASE_URL = path.join(dir, 'nitejar.db')
    process.env.MIGRATION_RECEIPT_PATH = receiptPath

    runMigrationsMock.mockRejectedValue(new Error('migration exploded'))

    const { runRuntimeMigrations } = await loadRuntimeMigrator()

    await expect(runRuntimeMigrations()).rejects.toThrow('migration exploded')

    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      migrationStatus: string
      cutoverStatus: string
      error: string
    }

    expect(receipt.migrationStatus).toBe('error')
    expect(receipt.cutoverStatus).toBe('failed')
    expect(receipt.error).toContain('migration exploded')
  })

  it('records skipped cutover result when cutover is not needed', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-runtime-migrate-skip-'))
    tempDirs.push(dir)
    const receiptPath = path.join(dir, 'receipts', 'skip.json')

    process.env.DATABASE_URL = path.join(dir, 'nitejar.db')
    process.env.MIGRATION_RECEIPT_PATH = receiptPath

    runMigrationsMock.mockResolvedValue(undefined)
    cutoverMock.mockReturnValue({
      status: 'skipped',
      reason: 'no-legacy-integrations',
      database: process.env.DATABASE_URL,
    })

    const { runRuntimeMigrations } = await loadRuntimeMigrator()
    await runRuntimeMigrations()

    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      cutoverStatus: string
      cutoverReason?: string
    }

    expect(receipt.cutoverStatus).toBe('skipped')
    expect(receipt.cutoverReason).toBe('no-legacy-integrations')
  })

  it('respects NITEJAR_AUTO_CUTOVER=0', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'nitejar-runtime-migrate-disabled-'))
    tempDirs.push(dir)
    const receiptPath = path.join(dir, 'receipts', 'disabled.json')

    process.env.DATABASE_URL = path.join(dir, 'nitejar.db')
    process.env.MIGRATION_RECEIPT_PATH = receiptPath
    process.env.NITEJAR_AUTO_CUTOVER = '0'

    runMigrationsMock.mockResolvedValue(undefined)

    const { runRuntimeMigrations } = await loadRuntimeMigrator()
    await runRuntimeMigrations()

    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      cutoverStatus: string
      cutoverReason?: string
    }

    expect(cutoverMock).not.toHaveBeenCalled()
    expect(receipt.cutoverStatus).toBe('skipped')
    expect(receipt.cutoverReason).toBe('disabled')
  })
})
