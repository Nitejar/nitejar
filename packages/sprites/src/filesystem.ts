import { spriteExec } from './exec'

/**
 * Read a file from a sprite's filesystem
 */
export async function readFile(spriteName: string, path: string): Promise<string> {
  const result = await spriteExec(spriteName, `cat ${escapePath(path)}`)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read file: ${result.stderr}`)
  }
  return result.stdout
}

/**
 * Write content to a file on a sprite's filesystem
 */
export async function writeFile(spriteName: string, path: string, content: string): Promise<void> {
  // Use heredoc for safe content writing
  const command = `cat > ${escapePath(path)} << 'SLOPBOT_EOF'\n${content}\nSLOPBOT_EOF`

  const result = await spriteExec(spriteName, command)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to write file: ${result.stderr}`)
  }
}

/**
 * Append content to a file on a sprite's filesystem
 */
export async function appendFile(spriteName: string, path: string, content: string): Promise<void> {
  const command = `cat >> ${escapePath(path)} << 'SLOPBOT_EOF'\n${content}\nSLOPBOT_EOF`

  const result = await spriteExec(spriteName, command)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to append to file: ${result.stderr}`)
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(spriteName: string, path: string): Promise<boolean> {
  const result = await spriteExec(spriteName, `test -e ${escapePath(path)}`)
  return result.exitCode === 0
}

/**
 * Check if a path is a directory
 */
export async function isDirectory(spriteName: string, path: string): Promise<boolean> {
  const result = await spriteExec(spriteName, `test -d ${escapePath(path)}`)
  return result.exitCode === 0
}

/**
 * Create a directory (and parent directories)
 */
export async function mkdir(spriteName: string, path: string): Promise<void> {
  const result = await spriteExec(spriteName, `mkdir -p ${escapePath(path)}`)
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
  options?: { recursive?: boolean }
): Promise<void> {
  const flags = options?.recursive ? '-rf' : '-f'
  const result = await spriteExec(spriteName, `rm ${flags} ${escapePath(path)}`)
  if (result.exitCode !== 0) {
    throw new Error(`Failed to remove: ${result.stderr}`)
  }
}

/**
 * List directory contents
 */
export async function listDir(spriteName: string, path: string): Promise<string[]> {
  const result = await spriteExec(spriteName, `ls -1 ${escapePath(path)}`)
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

export async function stat(spriteName: string, path: string): Promise<FileInfo> {
  // Use stat with a specific format for parsing
  const result = await spriteExec(spriteName, `stat -c '%s %Y %F' ${escapePath(path)}`)
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
  options?: { timeout?: number }
): Promise<void> {
  const result = await spriteExec(spriteName, `git clone ${escapePath(url)} ${escapePath(dest)}`, {
    timeout: options?.timeout,
  })
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
