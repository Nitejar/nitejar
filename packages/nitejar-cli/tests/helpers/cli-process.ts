import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDir, '../../../..')
const CLI_DIST = path.resolve(repoRoot, 'packages/nitejar-cli/dist/index.js')

export function buildCliSync(): void {
  const run = spawnSync('pnpm', ['--filter', '@nitejar/cli', 'build'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })

  if (run.status !== 0) {
    throw new Error(`Failed to build CLI: ${run.stderr || run.stdout}`)
  }
}

export async function runCli(
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv
    cwd?: string
    timeoutMs?: number
  }
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [CLI_DIST, ...args], {
    cwd: options?.cwd ?? repoRoot,
    env: {
      ...process.env,
      ...options?.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })

  const timeoutMs = options?.timeoutMs ?? 30_000

  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`CLI command timed out after ${timeoutMs}ms: ${args.join(' ')}`))
    }, timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

export function spawnCliLongRunning(
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv
    cwd?: string
  }
): {
  child: ReturnType<typeof spawn>
  waitForOutput: (pattern: RegExp, timeoutMs?: number) => Promise<void>
  stop: () => Promise<void>
} {
  const child = spawn(process.execPath, [CLI_DIST, ...args], {
    cwd: options?.cwd ?? repoRoot,
    env: {
      ...process.env,
      ...options?.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  const onData = (chunk: Buffer) => {
    output += chunk.toString('utf8')
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)

  const waitForOutput = async (pattern: RegExp, timeoutMs = 10_000): Promise<void> => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (pattern.test(output)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Timed out waiting for output pattern ${pattern}. Output: ${output}`)
  }

  const stop = async (): Promise<void> => {
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
      setTimeout(() => {
        child.kill('SIGKILL')
      }, 2_000)
    })
  }

  return { child, waitForOutput, stop }
}
