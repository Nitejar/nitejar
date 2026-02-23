import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Sprites from '@nitejar/sprites'
import {
  parseInstructionFiles,
  parseSkillFiles,
  formatContextInjection,
  loadSpriteEnvironmentContext,
  type DirectoryContext,
} from './context-loader'

vi.mock('@nitejar/sprites', async () => {
  const actual = await vi.importActual<typeof Sprites>('@nitejar/sprites')
  return {
    ...actual,
    spriteExec: vi.fn(),
  }
})

const mockedSpriteExec = vi.mocked(Sprites.spriteExec)

const INSTRUCTION_DELIM = '___SLOPBOT_INSTR___'
const SKILL_SECTION_DELIM = '___SLOPBOT_SKILLS___'
const SKILL_FILE_DELIM = '___SLOPBOT_SKILL_FILE___'

describe('parseInstructionFiles', () => {
  it('parses a single instruction file', () => {
    const stdout = `${INSTRUCTION_DELIM}/home/sprite/project/AGENTS.md\n# My Agent\n\nDo stuff.\n${SKILL_SECTION_DELIM}\n`

    const result = parseInstructionFiles(stdout)

    expect(result).toContain('# My Agent')
    expect(result).toContain('Do stuff.')
    expect(result).toContain('From /home/sprite/project/AGENTS.md')
  })

  it('parses multiple instruction files in root-first order', () => {
    // Walk order is child → parent, so project appears first
    const stdout = [
      `${INSTRUCTION_DELIM}/home/sprite/project/subdir/AGENTS.md`,
      'Child instructions.',
      `${INSTRUCTION_DELIM}/home/sprite/project/AGENTS.md`,
      'Parent instructions.',
      SKILL_SECTION_DELIM,
    ].join('\n')

    const result = parseInstructionFiles(stdout)!

    // After reversal, parent should come first
    const parentIdx = result.indexOf('Parent instructions.')
    const childIdx = result.indexOf('Child instructions.')
    expect(parentIdx).toBeLessThan(childIdx)
  })

  it('returns null when no instruction files found', () => {
    const stdout = `${SKILL_SECTION_DELIM}\nsome skill stuff`
    expect(parseInstructionFiles(stdout)).toBeNull()
  })

  it('returns null for empty stdout', () => {
    expect(parseInstructionFiles('')).toBeNull()
  })

  it('handles .nitejar.md files', () => {
    const stdout = `${INSTRUCTION_DELIM}/home/sprite/project/.nitejar.md\nCustom config.\n${SKILL_SECTION_DELIM}\n`
    const result = parseInstructionFiles(stdout)
    expect(result).toContain('Custom config.')
    expect(result).toContain('.nitejar.md')
  })

  it('excludes interleaved skill file content from instructions', () => {
    const stdout = [
      `${INSTRUCTION_DELIM}/home/sprite/project/AGENTS.md`,
      'Project instructions here.',
      `${SKILL_FILE_DELIM}/home/sprite/project/skills/deploy/SKILL.md`,
      '---',
      'name: deploy',
      '---',
      `${INSTRUCTION_DELIM}/home/sprite/AGENTS.md`,
      'Root instructions.',
      SKILL_SECTION_DELIM,
    ].join('\n')

    const result = parseInstructionFiles(stdout)!

    expect(result).toContain('Project instructions here.')
    expect(result).toContain('Root instructions.')
    // Skill content should NOT leak into instructions
    expect(result).not.toContain('deploy')
    expect(result).not.toContain('SKILL_FILE')
  })
})

describe('parseSkillFiles', () => {
  it('parses skill with YAML frontmatter', () => {
    // Skills appear during the upward walk, before SKILL_SECTION_DELIM
    const stdout = [
      `${SKILL_FILE_DELIM}/home/sprite/project/tools/deploy/SKILL.md`,
      '---',
      'name: deploy',
      'description: Deploy the application to production',
      '---',
      '',
      '# Deploy Skill',
      'Full instructions here...',
      SKILL_SECTION_DELIM,
    ].join('\n')

    const skills = parseSkillFiles('/home/sprite/project', stdout)

    expect(skills).toHaveLength(1)
    expect(skills[0]!.name).toBe('deploy')
    expect(skills[0]!.description).toBe('Deploy the application to production')
    expect(skills[0]!.path).toBe('tools/deploy/SKILL.md')
    expect(skills[0]!.absolutePath).toBe('/home/sprite/project/tools/deploy/SKILL.md')
  })

  it('derives name from directory when frontmatter lacks name', () => {
    const stdout = [
      `${SKILL_FILE_DELIM}/home/sprite/project/testing/SKILL.md`,
      'No frontmatter here, just content.',
      SKILL_SECTION_DELIM,
    ].join('\n')

    const skills = parseSkillFiles('/home/sprite/project', stdout)

    expect(skills).toHaveLength(1)
    expect(skills[0]!.name).toBe('testing')
  })

  it('parses multiple skills from same directory level', () => {
    const stdout = [
      `${SKILL_FILE_DELIM}/home/sprite/project/skills/lint/SKILL.md`,
      '---',
      'name: lint',
      'description: Run linting',
      '---',
      `${SKILL_FILE_DELIM}/home/sprite/project/skills/test/SKILL.md`,
      '---',
      'name: test',
      'description: Run tests',
      '---',
      SKILL_SECTION_DELIM,
    ].join('\n')

    const skills = parseSkillFiles('/home/sprite/project', stdout)
    expect(skills).toHaveLength(2)
    expect(skills[0]!.name).toBe('lint')
    expect(skills[1]!.name).toBe('test')
  })

  it('parses skills interleaved with instruction entries', () => {
    // Realistic output: subdir has skills, parent dir has instructions
    const stdout = [
      `${INSTRUCTION_DELIM}/home/sprite/project/subdir/AGENTS.md`,
      'Subdir instructions.',
      `${SKILL_FILE_DELIM}/home/sprite/project/subdir/skills/deploy/SKILL.md`,
      '---',
      'name: deploy',
      'description: Deploy stuff',
      '---',
      `${INSTRUCTION_DELIM}/home/sprite/project/AGENTS.md`,
      'Root instructions.',
      `${SKILL_FILE_DELIM}/home/sprite/project/.agents/skills/test/SKILL.md`,
      '---',
      'name: test',
      'description: Run tests',
      '---',
      SKILL_SECTION_DELIM,
    ].join('\n')

    const skills = parseSkillFiles('/home/sprite/project', stdout)
    expect(skills).toHaveLength(2)
    expect(skills[0]!.name).toBe('deploy')
    expect(skills[1]!.name).toBe('test')
  })

  it('returns empty array when no skill delimiters present', () => {
    const stdout = `${INSTRUCTION_DELIM}/path/AGENTS.md\ncontent\n${SKILL_SECTION_DELIM}`
    expect(parseSkillFiles('/home/sprite/project', stdout)).toEqual([])
  })

  it('returns empty array for empty stdout', () => {
    expect(parseSkillFiles('/home/sprite/project', '')).toEqual([])
  })

  it('skips command echo fragments from session output', () => {
    // When executed through a tmux session, the shell echoes the command text.
    // The delimiter appears inside the echoed text (e.g. echo "___SLOPBOT_SKILL_FILE___$_sf").
    // These fragments have non-absolute paths like '$_sf"' and should be skipped.
    const stdout = [
      // Echoed command fragments (from tmux session echo)
      `${SKILL_FILE_DELIM}$_sf"`,
      '    head -50 "$_sf"',
      '  done',
      `${SKILL_FILE_DELIM}$_sf"`,
      '    head -50 "$_sf"',
      '  done',
      // Actual skill output (absolute path)
      `${SKILL_FILE_DELIM}/home/sprite/repos/myproject/.agents/skills/agent-browser/SKILL.md`,
      '---',
      'name: agent-browser',
      'description: Automate browser interactions',
      '---',
      SKILL_SECTION_DELIM,
    ].join('\n')

    const skills = parseSkillFiles('/home/sprite/repos/myproject', stdout)

    // Should only pick up the real skill, not the echoed fragments
    expect(skills).toHaveLength(1)
    expect(skills[0]!.name).toBe('agent-browser')
    expect(skills[0]!.description).toBe('Automate browser interactions')
  })

  it('skips echo fragments with absolute paths that are not SKILL.md files', () => {
    // Tmux session echo can produce fragments where the "path" portion
    // starts with / but isn't a real SKILL.md path (e.g. from script text
    // like [ "$_dir" = "/home/sprite" ]).
    const stdout = [
      `${SKILL_FILE_DELIM}/home/sprite" ] && break`,
      '  _parent=$(dirname "$_dir")',
      `${SKILL_FILE_DELIM}/home/sprite/some-random-file.txt`,
      'not a skill',
      // Actual skill
      `${SKILL_FILE_DELIM}/home/sprite/project/skills/deploy/SKILL.md`,
      '---',
      'name: deploy',
      'description: Deploy the app',
      '---',
      SKILL_SECTION_DELIM,
    ].join('\n')

    const skills = parseSkillFiles('/home/sprite/project', stdout)

    expect(skills).toHaveLength(1)
    expect(skills[0]!.name).toBe('deploy')
  })

  it('handles quoted frontmatter values', () => {
    const stdout = [
      `${SKILL_FILE_DELIM}/home/sprite/project/my-skill/SKILL.md`,
      '---',
      'name: "quoted-skill"',
      "description: 'A quoted description'",
      '---',
      SKILL_SECTION_DELIM,
    ].join('\n')

    const skills = parseSkillFiles('/home/sprite/project', stdout)
    expect(skills[0]!.name).toBe('quoted-skill')
    expect(skills[0]!.description).toBe('A quoted description')
  })
})

describe('formatContextInjection', () => {
  it('formats instructions only', () => {
    const context: DirectoryContext = {
      cwd: '/home/sprite/project',
      instructions: '# Agent Rules\n\nBe helpful.',
      skills: [],
    }

    const result = formatContextInjection(context)!

    expect(result).toContain('Project Instructions')
    expect(result).toContain('# Agent Rules')
    expect(result).toContain('Be helpful.')
    expect(result).not.toContain('Available Skills')
  })

  it('formats skills only', () => {
    const context: DirectoryContext = {
      cwd: '/home/sprite/project',
      instructions: null,
      skills: [
        {
          name: 'deploy',
          description: 'Deploy to prod',
          path: 'tools/deploy/SKILL.md',
          absolutePath: '/home/sprite/project/tools/deploy/SKILL.md',
        },
      ],
    }

    const result = formatContextInjection(context)!

    expect(result).toContain('Available Skills')
    expect(result).toContain('**deploy**')
    expect(result).toContain('Deploy to prod')
    expect(result).toContain('use_skill')
    expect(result).not.toContain('Project Instructions')
  })

  it('formats both instructions and skills', () => {
    const context: DirectoryContext = {
      cwd: '/home/sprite/project',
      instructions: 'Do the thing.',
      skills: [
        {
          name: 'test',
          description: 'Run tests',
          path: 'SKILL.md',
          absolutePath: '/home/sprite/project/SKILL.md',
        },
      ],
    }

    const result = formatContextInjection(context)!
    expect(result).toContain('Project Instructions')
    expect(result).toContain('Available Skills')
  })

  it('returns null when nothing found', () => {
    const context: DirectoryContext = {
      cwd: '/home/sprite/project',
      instructions: null,
      skills: [],
    }

    expect(formatContextInjection(context)).toBeNull()
  })

  it('shows (no description) for skills without description', () => {
    const context: DirectoryContext = {
      cwd: '/home/sprite/project',
      instructions: null,
      skills: [
        {
          name: 'mystery',
          description: '',
          path: 'mystery/SKILL.md',
          absolutePath: '/home/sprite/project/mystery/SKILL.md',
        },
      ],
    }

    const result = formatContextInjection(context)!
    expect(result).toContain('(no description)')
  })
})

describe('loadSpriteEnvironmentContext', () => {
  beforeEach(() => {
    mockedSpriteExec.mockReset()
  })

  it('returns concatenated sprite env docs on success', async () => {
    const envContent = '# Sprite LLM Context\nSee docs below.\n---\n# Agent Context\nOS: Ubuntu...'
    mockedSpriteExec.mockResolvedValue({
      stdout: envContent,
      stderr: '',
      exitCode: 0,
      duration: 50,
    })

    const result = await loadSpriteEnvironmentContext('test-sprite')

    expect(result).toBe(envContent)
    expect(mockedSpriteExec).toHaveBeenCalledWith(
      'test-sprite',
      expect.stringContaining('cat /.sprite/llm.txt'),
      expect.objectContaining({ timeout: 10_000 })
    )
  })

  it('returns null when exec returns empty stdout', async () => {
    mockedSpriteExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 1, duration: 10 })

    const result = await loadSpriteEnvironmentContext('test-sprite')

    expect(result).toBeNull()
  })

  it('returns null when exec returns whitespace-only stdout', async () => {
    mockedSpriteExec.mockResolvedValue({ stdout: '  \n  ', stderr: '', exitCode: 0, duration: 10 })

    const result = await loadSpriteEnvironmentContext('test-sprite')

    expect(result).toBeNull()
  })

  it('returns null on exec failure (e.g. files missing)', async () => {
    mockedSpriteExec.mockRejectedValue(new Error('exec failed'))

    const result = await loadSpriteEnvironmentContext('test-sprite')

    expect(result).toBeNull()
  })

  it('passes session through to spriteExec', async () => {
    const fakeSession = { sessionId: 'sess-1' } as unknown as Sprites.ISpriteSession
    mockedSpriteExec.mockResolvedValue({ stdout: 'docs', stderr: '', exitCode: 0, duration: 20 })

    await loadSpriteEnvironmentContext('test-sprite', fakeSession)

    expect(mockedSpriteExec).toHaveBeenCalledWith(
      'test-sprite',
      expect.any(String),
      expect.objectContaining({ session: fakeSession })
    )
  })
})
