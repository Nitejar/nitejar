import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  readFile,
  writeFile,
  appendFile,
  fileExists,
  isDirectory,
  mkdir,
  remove,
  listDir,
  stat,
  gitClone,
} from '../src/filesystem'
import { spriteExec } from '../src/exec'

vi.mock('../src/exec', () => ({
  spriteExec: vi.fn(),
}))

const spriteExecMock = vi.mocked(spriteExec)

const okResult = (stdout = '') => ({
  exitCode: 0,
  stdout,
  stderr: '',
  duration: 1,
})

const errorResult = (stderr = 'error') => ({
  exitCode: 1,
  stdout: '',
  stderr,
  duration: 1,
})

beforeEach(() => {
  spriteExecMock.mockReset()
})

describe('filesystem helpers', () => {
  it('reads file contents', async () => {
    spriteExecMock.mockResolvedValue(okResult('hello'))
    const result = await readFile('sprite-1', "/tmp/it's.txt")

    expect(result).toBe('hello')
    expect(spriteExecMock).toHaveBeenCalledWith('sprite-1', "cat '/tmp/it'\\''s.txt'")
  })

  it('throws when readFile fails', async () => {
    spriteExecMock.mockResolvedValue(errorResult('boom'))
    await expect(readFile('sprite-1', '/tmp/nope')).rejects.toThrow('Failed to read file: boom')
  })

  it('writes file contents with heredoc', async () => {
    spriteExecMock.mockResolvedValue(okResult())
    await writeFile('sprite-1', '/tmp/file.txt', 'line1\nline2')

    const command = spriteExecMock.mock.calls[0]?.[1]
    expect(command).toContain("cat > '/tmp/file.txt' << 'SLOPBOT_EOF'")
    expect(command).toContain('line1\nline2')
    expect(command).toContain('SLOPBOT_EOF')
  })

  it('appends file contents with heredoc', async () => {
    spriteExecMock.mockResolvedValue(okResult())
    await appendFile('sprite-1', '/tmp/file.txt', 'append')

    const command = spriteExecMock.mock.calls[0]?.[1]
    expect(command).toContain("cat >> '/tmp/file.txt' << 'SLOPBOT_EOF'")
    expect(command).toContain('append')
    expect(command).toContain('SLOPBOT_EOF')
  })

  it('returns true when file exists', async () => {
    spriteExecMock.mockResolvedValue(okResult())
    const result = await fileExists('sprite-1', '/tmp/file.txt')
    expect(result).toBe(true)
  })

  it('returns false when file does not exist', async () => {
    spriteExecMock.mockResolvedValue(errorResult())
    const result = await fileExists('sprite-1', '/tmp/missing.txt')
    expect(result).toBe(false)
  })

  it('checks directory existence', async () => {
    spriteExecMock.mockResolvedValue(okResult())
    const result = await isDirectory('sprite-1', '/tmp/dir')
    expect(result).toBe(true)
  })

  it('creates directories', async () => {
    spriteExecMock.mockResolvedValue(okResult())
    await mkdir('sprite-1', '/tmp/dir')
    expect(spriteExecMock).toHaveBeenCalledWith('sprite-1', "mkdir -p '/tmp/dir'")
  })

  it('removes files with recursive option', async () => {
    spriteExecMock.mockResolvedValue(okResult())
    await remove('sprite-1', '/tmp/dir', { recursive: true })
    expect(spriteExecMock).toHaveBeenCalledWith('sprite-1', "rm -rf '/tmp/dir'")
  })

  it('lists directory contents', async () => {
    spriteExecMock.mockResolvedValue(okResult('a\nb\n'))
    const result = await listDir('sprite-1', '/tmp/dir')
    expect(result).toEqual(['a', 'b'])
  })

  it('parses stat output for files', async () => {
    spriteExecMock.mockResolvedValue(okResult('12 1700000000 regular file'))
    const result = await stat('sprite-1', '/tmp/file.txt')

    expect(result.size).toBe(12)
    expect(result.isDirectory).toBe(false)
    expect(result.modifiedAt.getTime()).toBe(1700000000 * 1000)
  })

  it('parses stat output for directories', async () => {
    spriteExecMock.mockResolvedValue(okResult('4 1700000001 directory'))
    const result = await stat('sprite-1', '/tmp/dir')

    expect(result.isDirectory).toBe(true)
    expect(result.modifiedAt.getTime()).toBe(1700000001 * 1000)
  })

  it('clones git repositories', async () => {
    spriteExecMock.mockResolvedValue(okResult())
    await gitClone('sprite-1', 'https://example.com/repo.git', '/tmp/repo')

    expect(spriteExecMock).toHaveBeenCalledWith(
      'sprite-1',
      "git clone 'https://example.com/repo.git' '/tmp/repo'",
      { timeout: undefined }
    )
  })
})
