#!/usr/bin/env node

import { Command } from 'commander'
import { realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'

import {
  commandDoctor,
  commandDown,
  commandLogs,
  commandMigrate,
  commandStatus,
  commandUp,
} from './commands.js'

export function createProgram(): Command {
  const program = new Command().name('nitejar').description('Nitejar installer and runtime manager')

  program
    .command('up')
    .description('Download runtime, run migrations, and start Nitejar')
    .option('--version <version>', 'Runtime version to install/start', 'latest')
    .option('--port <port>', 'Port to bind (number or "auto")', '3000')
    .option('--foreground', 'Run in foreground instead of daemon mode')
    .option('--data-dir <path>', 'Override data directory (default: ~/.nitejar)')
    .option('--no-wizard', 'Skip the first-boot setup wizard')
    .action(
      async (opts: {
        version: string
        port: string
        foreground?: boolean
        dataDir?: string
        noWizard?: boolean
      }) => {
        await commandUp(opts)
      }
    )

  program
    .command('down')
    .description('Stop running Nitejar daemon')
    .option('--data-dir <path>', 'Override data directory (default: ~/.nitejar)')
    .action(async (opts: { dataDir?: string }) => {
      await commandDown(opts)
    })

  program
    .command('status')
    .description('Show daemon and runtime status')
    .option('--json', 'Emit JSON output')
    .option('--data-dir <path>', 'Override data directory (default: ~/.nitejar)')
    .action((opts: { json?: boolean; dataDir?: string }) => {
      commandStatus(opts)
    })

  program
    .command('logs')
    .description('Print or follow runtime logs')
    .option('--follow', 'Follow log output')
    .option('--lines <n>', 'Number of lines to print', '100')
    .option('--data-dir <path>', 'Override data directory (default: ~/.nitejar)')
    .action(async (opts: { follow?: boolean; lines?: string; dataDir?: string }) => {
      await commandLogs(opts)
    })

  program
    .command('migrate')
    .description('Run migration preflight only')
    .option('--data-dir <path>', 'Override data directory (default: ~/.nitejar)')
    .action((opts: { dataDir?: string }) => {
      commandMigrate(opts)
    })

  program
    .command('doctor')
    .description('Run basic local diagnostics')
    .option('--data-dir <path>', 'Override data directory (default: ~/.nitejar)')
    .action((opts: { dataDir?: string }) => {
      commandDoctor(opts)
    })

  return program
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  await createProgram().parseAsync(argv)
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
  runCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`error: ${message}`)
    process.exit(1)
  })
}

export const __filename = fileURLToPath(import.meta.url)
