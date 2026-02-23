import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSkillAssignmentsForAgent,
  mockFindSkillById,
  mockListSkillFiles,
  mockWriteFile,
  mockMkdir,
  mockRemove,
  mockListDir,
  mockMaterializeSkill,
} = vi.hoisted(() => {
  const getSkillAssignmentsForAgent = vi.fn()
  const findSkillById = vi.fn()
  const listSkillFiles = vi.fn()
  const writeFile = vi.fn()
  const mkdir = vi.fn()
  const remove = vi.fn()
  const listDir = vi.fn()
  const materializeSkill = vi.fn()
  return {
    mockGetSkillAssignmentsForAgent: getSkillAssignmentsForAgent,
    mockFindSkillById: findSkillById,
    mockListSkillFiles: listSkillFiles,
    mockWriteFile: writeFile,
    mockMkdir: mkdir,
    mockRemove: remove,
    mockListDir: listDir,
    mockMaterializeSkill: materializeSkill,
  }
})

vi.mock('@nitejar/database', () => ({
  getSkillAssignmentsForAgent: mockGetSkillAssignmentsForAgent,
  findSkillById: mockFindSkillById,
  listSkillFiles: mockListSkillFiles,
}))

vi.mock('@nitejar/sprites', () => ({
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  remove: mockRemove,
  listDir: mockListDir,
}))

vi.mock('./skill-materialize', () => ({
  materializeSkill: mockMaterializeSkill,
}))

import { syncSkillsToSandbox } from './skill-sync'

describe('syncSkillsToSandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockRemove.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockMaterializeSkill.mockResolvedValue('/tmp/skills/skill-1')
  })

  it('writes SKILL.md + supporting files and removes unassigned directories', async () => {
    mockGetSkillAssignmentsForAgent.mockResolvedValue([
      {
        id: 'assign-1',
        skill_id: 'skill-1',
        skill_slug: 'release-playbook',
        scope: 'agent',
        scope_id: 'agent-1',
        priority: 0,
        auto_inject: 0,
        enabled: 1,
        created_at: 1,
        updated_at: 1,
      },
    ])
    mockListDir.mockResolvedValue(['release-playbook', 'stale-skill'])
    mockFindSkillById.mockResolvedValue({
      id: 'skill-1',
      name: 'Release Playbook',
      slug: 'release-playbook',
      description: 'release docs',
      category: 'ops',
      source_kind: 'admin',
      plugin_id: null,
      source_ref: null,
      content: '# Release Playbook',
      is_directory: 1,
      version: '1.0.0',
      checksum: 'abc',
      enabled: 1,
      tags_json: null,
      requires_tools_json: null,
      metadata_json: null,
      created_at: 1,
      updated_at: 1,
    })
    mockListSkillFiles.mockResolvedValue([
      {
        id: 'file-1',
        skill_id: 'skill-1',
        relative_path: 'references/checklist.md',
        content: 'checklist',
        content_type: 'text/markdown',
        size_bytes: 9,
        checksum: 'f1',
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 'file-2',
        skill_id: 'skill-1',
        relative_path: 'scripts/verify.sh',
        content: 'echo verify',
        content_type: 'text/plain',
        size_bytes: 11,
        checksum: 'f2',
        created_at: 1,
        updated_at: 1,
      },
    ])

    const result = await syncSkillsToSandbox('agent-1', 'sprite-a')

    expect(result).toEqual({
      synced: ['release-playbook'],
      removed: ['stale-skill'],
      errors: [],
    })
    expect(mockMaterializeSkill).toHaveBeenCalledWith('skill-1')
    expect(mockWriteFile).toHaveBeenCalledWith(
      'sprite-a',
      '/home/sprite/.skills/release-playbook/SKILL.md',
      '# Release Playbook'
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      'sprite-a',
      '/home/sprite/.skills/release-playbook/references/checklist.md',
      'checklist'
    )
    expect(mockWriteFile).toHaveBeenCalledWith(
      'sprite-a',
      '/home/sprite/.skills/release-playbook/scripts/verify.sh',
      'echo verify'
    )
    expect(mockRemove).toHaveBeenCalledWith('sprite-a', '/home/sprite/.skills/stale-skill', {
      recursive: true,
    })
  })

  it('removes all existing skill directories when no assignments remain', async () => {
    mockGetSkillAssignmentsForAgent.mockResolvedValue([])
    mockListDir.mockResolvedValue(['legacy-a', 'legacy-b'])

    const result = await syncSkillsToSandbox('agent-1', 'sprite-a')

    expect(result).toEqual({
      synced: [],
      removed: ['legacy-a', 'legacy-b'],
      errors: [],
    })
    expect(mockRemove).toHaveBeenCalledWith('sprite-a', '/home/sprite/.skills/legacy-a', {
      recursive: true,
    })
    expect(mockRemove).toHaveBeenCalledWith('sprite-a', '/home/sprite/.skills/legacy-b', {
      recursive: true,
    })
  })
})
