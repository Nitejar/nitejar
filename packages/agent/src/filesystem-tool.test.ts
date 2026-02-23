import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTool, type ToolContext } from './tools'
import * as Sprites from '@nitejar/sprites'

vi.mock('@nitejar/sprites', async () => {
  const actual = await vi.importActual<typeof Sprites>('@nitejar/sprites')
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    listDir: vi.fn(),
    mkdir: vi.fn(),
  }
})

const mockedReadFile = vi.mocked(Sprites.readFile)
const mockedWriteFile = vi.mocked(Sprites.writeFile)

const baseContext: ToolContext = {
  spriteName: 'sprite-1',
  cwd: '/home/sprite',
}

describe('filesystem tools by edit mode', () => {
  beforeEach(() => {
    mockedReadFile.mockReset()
    mockedWriteFile.mockReset()
  })

  it('formats read_file with hashline anchors by default', async () => {
    mockedReadFile.mockResolvedValue('alpha\nbeta')

    const result = await executeTool('read_file', { path: '/tmp/demo.txt' }, baseContext)
    expect(result.success).toBe(true)
    expect(result.output).toMatch(/^1:[a-z0-9]{3}\|alpha\n2:[a-z0-9]{3}\|beta$/)
  })

  it('formats read_file as classic numbered lines in replace mode', async () => {
    mockedReadFile.mockResolvedValue('alpha\nbeta')

    const result = await executeTool(
      'read_file',
      { path: '/tmp/demo.txt' },
      {
        ...baseContext,
        editToolMode: 'replace',
      }
    )
    expect(result.success).toBe(true)
    expect(result.output).toBe('1: alpha\n2: beta')
  })

  it('applies hashline edit when anchor hash matches', async () => {
    mockedReadFile.mockResolvedValue('alpha\nbeta')

    const readResult = await executeTool('read_file', { path: '/tmp/demo.txt' }, baseContext)
    const hash = readResult.output?.match(/^2:([a-z0-9]{3})\|beta$/m)?.[1]
    expect(hash).toBeDefined()

    const result = await executeTool(
      'edit_file',
      {
        path: '/tmp/demo.txt',
        edits: [{ type: 'replace_line', line: 2, hash, content: 'gamma' }],
      },
      baseContext
    )

    expect(result.success).toBe(true)
    expect(mockedWriteFile).toHaveBeenCalledTimes(1)
    expect(mockedWriteFile.mock.calls[0]?.[2]).toBe('alpha\ngamma')
    expect(result._meta?.editOperation).toBe('replace_line')
  })

  it('rejects hashline edit when anchor hash mismatches', async () => {
    mockedReadFile.mockResolvedValue('alpha\nbeta')

    const result = await executeTool(
      'edit_file',
      {
        path: '/tmp/demo.txt',
        edits: [{ type: 'replace_line', line: 2, hash: 'zzz', content: 'gamma' }],
      },
      baseContext
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Hash mismatch')
    expect(result._meta?.hashMismatch).toBe(true)
    expect(mockedWriteFile).not.toHaveBeenCalled()
  })

  it('keeps legacy replace behavior in replace mode', async () => {
    mockedReadFile.mockResolvedValue('alpha\nbeta')

    const result = await executeTool(
      'edit_file',
      {
        path: '/tmp/demo.txt',
        old_string: 'beta',
        new_string: 'gamma',
      },
      {
        ...baseContext,
        editToolMode: 'replace',
      }
    )

    expect(result.success).toBe(true)
    expect(mockedWriteFile).toHaveBeenCalledTimes(1)
    expect(mockedWriteFile.mock.calls[0]?.[2]).toBe('alpha\ngamma')
    expect(result._meta?.editOperation).toBe('replace_string')
  })

  it('use_skill returns deterministic listing for DB skills', async () => {
    const result = await executeTool(
      'use_skill',
      { skill_name: 'Release Playbook' },
      {
        ...baseContext,
        resolvedDbSkills: [
          {
            id: 'release-playbook',
            name: 'Release Playbook',
            description: 'release docs',
            source: 'db',
            sourceRef: 'skill-1',
            isDirectory: true,
            supportingFiles: [
              { relativePath: 'references/checklist.md', contentType: 'text/markdown' },
              { relativePath: 'scripts/verify.sh', contentType: 'text/plain' },
            ],
            sandboxPath: '/home/sprite/.skills/release-playbook',
            tags: [],
            category: 'ops',
            enabled: true,
          },
        ],
      }
    )

    expect(result.success).toBe(true)
    expect(result.output).toContain('Skill: Release Playbook')
    expect(result.output).toContain('Location: /home/sprite/.skills/release-playbook/')
    expect(result.output).toContain('Entrypoint: /home/sprite/.skills/release-playbook/SKILL.md')
    expect(result.output).toContain('SKILL.md (entrypoint)')
    expect(result.output).toContain('references/checklist.md')
    expect(result.output).toContain('scripts/verify.sh')
    expect(mockedReadFile).not.toHaveBeenCalled()
  })

  it('use_skill miss includes available skill names', async () => {
    const result = await executeTool(
      'use_skill',
      { skill_name: 'missing-skill' },
      {
        ...baseContext,
        discoveredSkills: [
          {
            name: 'Repo Helper',
            description: 'repo helper',
            path: 'skills/repo-helper/SKILL.md',
            absolutePath: '/repo/skills/repo-helper/SKILL.md',
          },
        ],
        resolvedDbSkills: [
          {
            id: 'release-playbook',
            name: 'Release Playbook',
            description: 'release docs',
            source: 'db',
            sourceRef: 'skill-1',
            isDirectory: false,
            sandboxPath: '/home/sprite/.skills/release-playbook',
            tags: [],
            category: 'ops',
            enabled: true,
          },
        ],
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Skill "missing-skill" not found.')
    expect(result.error).toContain('Release Playbook')
    expect(result.error).toContain('Repo Helper')
  })
})
