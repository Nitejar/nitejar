import { Kysely, Migrator, PostgresDialect, SqliteDialect } from 'kysely'
import { createRequire } from 'module'
import { Pool } from 'pg'
import { existsSync, mkdirSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Database } from './types'

// Resolve default SQLite path relative to this package, not CWD
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SQLITE_PATH = path.resolve(__dirname, '..', 'data', 'nitejar.db')

// Use createRequire to load better-sqlite3 dynamically
const require = createRequire(import.meta.url)

type SqliteStatement = {
  readonly reader: boolean
  all(parameters: ReadonlyArray<unknown>): unknown[]
  run(parameters: ReadonlyArray<unknown>): {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }
  iterate(parameters: ReadonlyArray<unknown>): IterableIterator<unknown>
}

// Type for better-sqlite3 database instance
type BetterSqlite3Database = {
  close(): void
  prepare(sql: string): SqliteStatement
  pragma(source: string): unknown
}

/**
 * Run database migrations
 * Applies any pending migration files in order.
 */
export async function runMigrations(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL || DEFAULT_SQLITE_PATH
  const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')

  console.log(`Running migrations for ${isPostgres ? 'PostgreSQL' : 'SQLite'}...`)
  console.log(`Database: ${isPostgres ? '[postgres connection]' : dbUrl}`)

  let db: Kysely<Database>
  let pool: Pool | null = null
  let sqlite: BetterSqlite3Database | null = null

  if (isPostgres) {
    pool = new Pool({ connectionString: dbUrl })
    db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool }),
    })
  } else {
    const dir = path.dirname(dbUrl)
    if (dir && dir !== '.' && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const Database = require('better-sqlite3') as new (dbPath: string) => BetterSqlite3Database
    sqlite = new Database(dbUrl)
    sqlite.pragma('journal_mode = WAL')
    db = new Kysely<Database>({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dialect: new SqliteDialect({ database: sqlite }),
    })
  }

  try {
    const baseDir = path.dirname(fileURLToPath(import.meta.url))
    const migrationFolderCandidates = [
      path.join(baseDir, '../migrations'),
      path.join(baseDir, '../../migrations'),
    ]
    const migrationFolder = migrationFolderCandidates.find((candidate) => existsSync(candidate))

    if (!migrationFolder) {
      throw new Error(`Migration folder not found. Tried: ${migrationFolderCandidates.join(', ')}`)
    }

    const migrator = new Migrator({
      db,
      provider: createMigrationProvider(migrationFolder),
    })

    const { error, results } = await migrator.migrateToLatest()

    if (results && results.length > 0) {
      results.forEach((result) => {
        if (result.status === 'Success') {
          console.log(`  ✓ ${result.migrationName}`)
        } else if (result.status === 'Error') {
          console.error(`  ✗ ${result.migrationName}`)
        }
      })
    } else {
      console.log('  ✓ No pending migrations')
    }

    if (error) {
      console.error('Migration failed:', error)
      throw error instanceof Error ? error : new Error(formatUnknownError(error))
    }

    console.log('Migrations complete!')
  } finally {
    await db.destroy()
    if (pool) await pool.end()
    if (sqlite) sqlite.close()
  }
}

type MigrationModule = {
  up: (db: Kysely<Database>) => Promise<void>
  down?: (db: Kysely<Database>) => Promise<void>
}

type ModuleNamespace = {
  default?: unknown
}

type TsImportFn = (specifier: string, parentUrl: string) => Promise<unknown>

type TsxEsmApiModule = {
  tsImport?: unknown
}

function isMigrationModule(value: unknown): value is MigrationModule {
  return Boolean(value && typeof (value as MigrationModule).up === 'function')
}

function resolveModuleCandidate(moduleNamespace: unknown): unknown {
  if (moduleNamespace && typeof moduleNamespace === 'object' && 'default' in moduleNamespace) {
    const defaultExport = (moduleNamespace as ModuleNamespace).default
    return defaultExport ?? moduleNamespace
  }

  return moduleNamespace
}

function isTsImportFn(value: unknown): value is TsImportFn {
  return typeof value === 'function'
}

function createMigrationProvider(migrationFolder: string) {
  return {
    async getMigrations(): Promise<Record<string, MigrationModule>> {
      const migrations: Record<string, MigrationModule> = {}
      const files = await fs.readdir(migrationFolder)

      for (const fileName of files) {
        if (
          fileName.endsWith('.js') ||
          (fileName.endsWith('.ts') && !fileName.endsWith('.d.ts')) ||
          fileName.endsWith('.mjs') ||
          (fileName.endsWith('.mts') && !fileName.endsWith('.d.mts'))
        ) {
          const filePath = path.join(migrationFolder, fileName)
          const migration = await loadMigrationModule(filePath)
          if (!migration) continue

          const migrationKey = fileName.substring(0, fileName.lastIndexOf('.'))
          migrations[migrationKey] = migration
        }
      }

      return migrations
    },
  }
}

async function loadMigrationModule(filePath: string): Promise<MigrationModule | null> {
  const url = pathToFileURL(filePath).href

  try {
    const migrationModule = (await import(/* webpackIgnore: true */ url)) as unknown
    const candidate = resolveModuleCandidate(migrationModule)
    return isMigrationModule(candidate) ? candidate : null
  } catch (error) {
    const isTsFile = filePath.endsWith('.ts') || filePath.endsWith('.mts')
    const message = error instanceof Error ? error.message : ''
    const shouldFallback = isTsFile && message.includes('Unknown file extension')
    if (!shouldFallback) {
      throw error
    }

    try {
      const tsxEsmApi = (await import('tsx/esm/api')) as unknown
      const tsImport = (tsxEsmApi as TsxEsmApiModule).tsImport
      if (!isTsImportFn(tsImport)) {
        throw error
      }

      const migrationModule = await tsImport(url, import.meta.url)
      const candidate = resolveModuleCandidate(migrationModule)
      return isMigrationModule(candidate) ? candidate : null
    } catch {
      throw error
    }
  }
}

function formatUnknownError(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    return value.message
  }
  try {
    return JSON.stringify(value)
  } catch {
    return 'Unknown migration error'
  }
}

const isDirectRun =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  runMigrations().catch(() => process.exit(1))
}
