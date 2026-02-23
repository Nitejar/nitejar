import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as tar from 'tar'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '../../../..')
const FIXTURE_ROOT = path.resolve(repoRoot, 'packages/nitejar-cli/tests/fixtures/runtime')

export type RuntimeFixtureOptions = {
  missingMigrator?: boolean
  missingServer?: boolean
  breakArchive?: boolean
  contentTag?: string
}

export async function createRuntimeFixtureArchive(
  destinationDir: string,
  fileName: string,
  options?: RuntimeFixtureOptions
): Promise<{
  archivePath: string
  sha256: string
  size: number
  cleanup: () => void
}> {
  const stageRoot = mkdtempSync(path.join(tmpdir(), 'nitejar-runtime-fixture-'))
  const stageRuntime = path.join(stageRoot, 'runtime')
  cpSync(FIXTURE_ROOT, stageRuntime, { recursive: true, force: true })

  if (options?.missingMigrator) {
    unlinkSync(path.join(stageRuntime, 'packages/database/dist/src/runtime-migrate.js'))
  }

  if (options?.missingServer) {
    unlinkSync(path.join(stageRuntime, 'apps/web/server.js'))
  }

  if (options?.contentTag) {
    const serverPath = path.join(stageRuntime, 'apps/web/server.js')
    const original = readFileSync(serverPath, 'utf8')
    writeFileSync(serverPath, `${original}\n// ${options.contentTag}\n`, 'utf8')
  }

  const archivePath = path.join(destinationDir, fileName)
  await tar.c(
    {
      gzip: true,
      cwd: stageRuntime,
      file: archivePath,
    },
    ['.']
  )

  if (options?.breakArchive) {
    writeFileSync(archivePath, 'not-a-real-archive', 'utf8')
  }

  const data = readFileSync(archivePath)
  const sha256 = createHash('sha256').update(data).digest('hex')

  return {
    archivePath,
    sha256,
    size: data.length,
    cleanup: () => {
      rmSync(stageRoot, { recursive: true, force: true })
    },
  }
}
