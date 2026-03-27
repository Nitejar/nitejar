import type { ISpriteSession } from './session'
import { spriteExec } from './exec'

export interface FilesystemOptions {
  session?: ISpriteSession
  timeout?: number
}

async function runFilesystemCommand(
  spriteName: string,
  command: string,
  options?: FilesystemOptions
) {
  if (options) {
    return spriteExec(spriteName, command, options)
  }
  return spriteExec(spriteName, command)
}

/**
 * Read a file from a sprite's filesystem
 */
export async function readFile(
  spriteName: string,
  path: string,
  options?: FilesystemOptions
): Promise<string> {
  const result = await runFilesystemCommand(spriteName, `cat ${escapePath(path)}`, options)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read file: ${result.stderr}`)
  }
  return result.stdout
}

/**
 * Write content to a file on a sprite's filesystem
 */
export async function writeFile(
  spriteName: string,
  path: string,
  content: string,
  options?: FilesystemOptions
): Promise<void> {
  // Use heredoc for safe content writing
  const command = `cat > ${escapePath(path)} << 'SLOPBOT_EOF'\n${content}\nSLOPBOT_EOF`

  const result = await runFilesystemCommand(spriteName, command, options)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to write file: ${result.stderr}`)
  }
}

/**
 * Append content to a file on a sprite's filesystem
 */
export async function appendFile(
  spriteName: string,
  path: string,
  content: string,
  options?: FilesystemOptions
): Promise<void> {
  const command = `cat >> ${escapePath(path)} << 'SLOPBOT_EOF'\n${content}\nSLOPBOT_EOF`

  const result = await runFilesystemCommand(spriteName, command, options)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to append to file: ${result.stderr}`)
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(
  spriteName: string,
  path: string,
  options?: FilesystemOptions
): Promise<boolean> {
  const result = await runFilesystemCommand(spriteName, `test -e ${escapePath(path)}`, options)
  return result.exitCode === 0
}

/**
 * Check if a path is a directory
 */
export async function isDirectory(
  spriteName: string,
  path: string,
  options?: FilesystemOptions
): Promise<boolean> {
  const result = await runFilesystemCommand(spriteName, `test -d ${escapePath(path)}`, options)
  return result.exitCode === 0
}

/**
 * Create a directory (and parent directories)
 */
export async function mkdir(
  spriteName: string,
  path: string,
  options?: FilesystemOptions
): Promise<void> {
  const result = await runFilesystemCommand(spriteName, `mkdir -p ${escapePath(path)}`, options)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create directory: ${result.stderr}`)
  }
}

/**
 * Remove a file or directory
 */
export async function remove(
  spriteName: string,
  path: string,
  options?: { recursive?: boolean; session?: ISpriteSession; timeout?: number }
): Promise<void> {
  const flags = options?.recursive ? '-rf' : '-f'
  const result = await runFilesystemCommand(spriteName, `rm ${flags} ${escapePath(path)}`, options)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to remove: ${result.stderr}`)
  }
}

/**
 * List directory contents
 */
export async function listDir(
  spriteName: string,
  path: string,
  options?: FilesystemOptions
): Promise<string[]> {
  const result = await runFilesystemCommand(spriteName, `ls -1 ${escapePath(path)}`, options)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to list directory: ${result.stderr}`)
  }
  return result.stdout.trim().split('\n').filter(Boolean)
}

/**
 * Get file info (size, modified time, etc.)
 */
export interface FileInfo {
  path: string
  size: number
  isDirectory: boolean
  modifiedAt: Date
}

export async function stat(
  spriteName: string,
  path: string,
  options?: FilesystemOptions
): Promise<FileInfo> {
  // Use stat with a specific format for parsing
  const result = await runFilesystemCommand(
    spriteName,
    `stat -c '%s %Y %F' ${escapePath(path)}`,
    options
  )
  if (result.exitCode !== 0) {
    throw new Error(`Failed to stat: ${result.stderr}`)
  }

  const parts = result.stdout.trim().split(' ')
  const size = parseInt(parts[0] ?? '0', 10)
  const mtime = parseInt(parts[1] ?? '0', 10)
  const fileType = parts.slice(2).join(' ')

  return {
    path,
    size,
    isDirectory: fileType.includes('directory'),
    modifiedAt: new Date(mtime * 1000),
  }
}

/**
 * Clone a git repository
 */
export async function gitClone(
  spriteName: string,
  url: string,
  dest: string,
  options?: FilesystemOptions
): Promise<void> {
  const result = await runFilesystemCommand(
    spriteName,
    `git clone ${escapePath(url)} ${escapePath(dest)}`,
    options
  )
  if (result.exitCode !== 0) {
    throw new Error(`Failed to clone repository: ${result.stderr}`)
  }
}

/**
 * Escape a path for shell use
 */
function escapePath(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`
}
