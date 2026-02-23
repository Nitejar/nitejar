#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')

export function parseArgs(argv = process.argv, env = process.env, defaultRoot = repoRoot) {
  const args = {
    platform: '',
    output: '',
    version: env.NITEJAR_VERSION ?? env.GITHUB_REF_NAME ?? 'dev',
    root: defaultRoot,
    skipBuild: false,
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--platform') {
      args.platform = argv[i + 1] ?? ''
      i += 1
      continue
    }
    if (token === '--output') {
      args.output = argv[i + 1] ?? ''
      i += 1
      continue
    }
    if (token === '--version') {
      args.version = argv[i + 1] ?? args.version
      i += 1
      continue
    }
    if (token === '--repo-root') {
      args.root = path.resolve(argv[i + 1] ?? args.root)
      i += 1
      continue
    }
    if (token === '--skip-build') {
      args.skipBuild = true
    }
  }

  if (!args.platform) {
    throw new Error('Missing required --platform argument')
  }
  if (!args.output) {
    throw new Error('Missing required --output argument')
  }

  return args
}

export function runCommand(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
}

function assertExists(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing required ${label}: ${filePath}`)
  }
}

export function stageRuntimeBundle(options) {
  const outputPath = path.resolve(options.root, options.output)
  const outputDir = path.dirname(outputPath)
  const stageDir = path.resolve(options.root, '.tmp', 'release-stage', options.platform)

  mkdirSync(outputDir, { recursive: true })
  rmSync(stageDir, { recursive: true, force: true })
  rmSync(outputPath, { force: true })
  mkdirSync(stageDir, { recursive: true })

  const standaloneDir = path.join(options.root, 'apps/web/.next/standalone')
  const staticDir = path.join(options.root, 'apps/web/.next/static')
  const publicDir = path.join(options.root, 'apps/web/public')
  const dbDistDir = path.join(options.root, 'packages/database/dist')
  const dbMigrationsDir = path.join(options.root, 'packages/database/migrations')
  const deployedDatabaseDir = path.join(stageDir, 'packages', 'database')

  if (!options.skipBuild) {
    runCommand('pnpm', ['--filter', '@nitejar/database', 'build'], options.root)
    runCommand('pnpm', ['--filter', '@nitejar/web', 'build'], options.root)
    runCommand(
      'pnpm',
      ['--filter', '@nitejar/database', 'deploy', '--prod', deployedDatabaseDir, '--force'],
      options.root
    )
  }

  assertExists(standaloneDir, 'Next.js standalone build')
  assertExists(staticDir, 'Next.js static build assets')
  assertExists(publicDir, 'web public assets')

  cpSync(standaloneDir, stageDir, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  })

  mkdirSync(path.join(stageDir, 'apps/web/.next'), { recursive: true })
  mkdirSync(path.join(stageDir, 'apps/web'), { recursive: true })

  cpSync(staticDir, path.join(stageDir, 'apps/web/.next/static'), {
    recursive: true,
    force: true,
  })

  cpSync(publicDir, path.join(stageDir, 'apps/web/public'), {
    recursive: true,
    force: true,
  })

  if (options.skipBuild) {
    assertExists(dbDistDir, 'database dist output')
    assertExists(dbMigrationsDir, 'database migrations')
    cpSync(dbDistDir, path.join(stageDir, 'packages/database/dist'), {
      recursive: true,
      force: true,
    })
    cpSync(dbMigrationsDir, path.join(stageDir, 'packages/database/migrations'), {
      recursive: true,
      force: true,
    })
  } else {
    assertExists(deployedDatabaseDir, 'deployed database runtime package')
    assertExists(
      path.join(deployedDatabaseDir, 'dist', 'src', 'runtime-migrate.js'),
      'deployed runtime migrator'
    )
    assertExists(path.join(deployedDatabaseDir, 'migrations'), 'deployed database migrations')
  }

  writeFileSync(
    path.join(stageDir, 'RELEASE.json'),
    `${JSON.stringify(
      {
        version: options.version,
        platform: options.platform,
        builtAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    'utf8'
  )

  return { stageDir, outputPath }
}

export function packRuntimeBundle(stageDir, outputPath) {
  runCommand('tar', ['-czf', outputPath, '-C', stageDir, '.'], process.cwd())
}

export function runBuildRuntimeBundle(argv = process.argv) {
  const args = parseArgs(argv)
  const { stageDir, outputPath } = stageRuntimeBundle({
    platform: args.platform,
    output: args.output,
    version: args.version,
    root: args.root,
    skipBuild: args.skipBuild,
  })

  packRuntimeBundle(stageDir, outputPath)
  console.log(`Created runtime bundle: ${outputPath}`)
}

const isDirectRun =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  runBuildRuntimeBundle(process.argv)
}
