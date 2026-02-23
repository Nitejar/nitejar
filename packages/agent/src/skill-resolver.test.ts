import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillEntry } from './tools/types'

const { mockGetSkillAssignmentsForAgent, mockListSkillFiles, mockParseSkillJsonArray } = vi.hoisted(
  () => {
    const getSkillAssignmentsForAgent = vi.fn()
    const listSkillFiles = vi.fn()
    const parseSkillJsonArray = vi.fn((raw: string | null) => {
      if (!raw) return []
      return JSON.parse(raw) as string[]
    })
    return {
      mockGetSkillAssignmentsForAgent: getSkillAssignmentsForAgent,
      mockListSkillFiles: listSkillFiles,
      mockParseSkillJsonArray: parseSkillJsonArray,
    }
  }
)

vi.mock('@nitejar/database', () => ({
  getSkillAssignmentsForAgent: mockGetSkillAssignmentsForAgent,
  listSkillFiles: mockListSkillFiles,
  parseSkillJsonArray: mockParseSkillJsonArray,
}))

import { resolveSkillBySlug, resolveSkillsForAgent } from './skill-resolver'

const repoSkill: SkillEntry = {
  name: 'Shared Skill',
  description: 'repo',
  path: 'skills/shared/SKILL.md',
  absolutePath: '/repo/skills/shared/SKILL.md',
}

describe('skill resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers DB/admin over plugin and repo on slug collisions', async () => {
    mockGetSkillAssignmentsForAgent.mockResolvedValue([
      {
        id: 'assign-plugin',
        skill_id: 'skill-plugin',
        skill_slug: 'shared-skill',
        scope: 'agent',
        scope_id: 'agent-1',
        priority: 2,
        auto_inject: 0,
        enabled: 1,
        created_at: 1,
        updated_at: 1,
        skill: {
          id: 'skill-plugin',
          name: 'Plugin Shared Skill',
          slug: 'shared-skill',
          description: 'plugin variant',
          category: 'general',
          source_kind: 'plugin',
          plugin_id: 'plugin-1',
          source_ref: null,
          content: '# Plugin',
          is_directory: 1,
          version: '1.0.0',
          checksum: 'c1',
          enabled: 1,
          tags_json: '["plugin"]',
          requires_tools_json: '["read_file"]',
          metadata_json: null,
          created_at: 1,
          updated_at: 1,
        },
      },
      {
        id: 'assign-db',
        skill_id: 'skill-db',
        skill_slug: 'shared-skill',
        scope: 'agent',
        scope_id: 'agent-1',
        priority: 5,
        auto_inject: 1,
        enabled: 1,
        created_at: 1,
        updated_at: 1,
        skill: {
          id: 'skill-db',
          name: 'DB Shared Skill',
          slug: 'shared-skill',
          description: 'db variant',
          category: 'general',
          source_kind: 'admin',
          plugin_id: null,
          source_ref: null,
          content: '# DB',
          is_directory: 1,
          version: '2.0.0',
          checksum: 'c2',
          enabled: 1,
          tags_json: '["db"]',
          requires_tools_json: '["read_file","bash"]',
          metadata_json: null,
          created_at: 1,
          updated_at: 1,
        },
      },
    ])

    mockListSkillFiles.mockImplementation((skillId: string) => {
      if (skillId === 'skill-db') {
        return [
          {
            id: 'f-db',
            skill_id: 'skill-db',
            relative_path: 'references/notes.md',
            content: 'db notes',
            content_type: 'text/markdown',
            size_bytes: 8,
            checksum: 'f1',
            created_at: 1,
            updated_at: 1,
          },
        ]
      }
      return [
        {
          id: 'f-plugin',
          skill_id: 'skill-plugin',
          relative_path: 'references/plugin.md',
          content: 'plugin notes',
          content_type: 'text/markdown',
          size_bytes: 12,
          checksum: 'f2',
          created_at: 1,
          updated_at: 1,
        },
      ]
    })

    const resolved = await resolveSkillsForAgent('agent-1', null, [repoSkill])
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({
      id: 'shared-skill',
      name: 'DB Shared Skill',
      source: 'db',
      sourceRef: 'skill-db',
      sandboxPath: '/home/sprite/.skills/shared-skill',
      autoInject: true,
      priority: 5,
      supportingFiles: [{ relativePath: 'references/notes.md', contentType: 'text/markdown' }],
    })
  })

  it('resolveSkillBySlug returns DB sandbox metadata with supporting files', async () => {
    mockGetSkillAssignmentsForAgent.mockResolvedValue([
      {
        id: 'assign-db',
        skill_id: 'skill-db',
        skill_slug: 'team-playbook',
        scope: 'agent',
        scope_id: 'agent-1',
        priority: 3,
        auto_inject: 0,
        enabled: 1,
        created_at: 1,
        updated_at: 1,
        skill: {
          id: 'skill-db',
          name: 'Team Playbook',
          slug: 'team-playbook',
          description: 'playbook',
          category: 'ops',
          source_kind: 'admin',
          plugin_id: null,
          source_ref: null,
          content: '# Playbook',
          is_directory: 1,
          version: null,
          checksum: 'c3',
          enabled: 1,
          tags_json: '["ops"]',
          requires_tools_json: null,
          metadata_json: null,
          created_at: 1,
          updated_at: 1,
        },
      },
    ])
    mockListSkillFiles.mockResolvedValue([
      {
        id: 'f-a',
        skill_id: 'skill-db',
        relative_path: 'checklists/deploy.md',
        content: 'deploy checklist',
        content_type: 'text/markdown',
        size_bytes: 15,
        checksum: 'f3',
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 'f-b',
        skill_id: 'skill-db',
        relative_path: 'templates/rollback.md',
        content: 'rollback template',
        content_type: 'text/markdown',
        size_bytes: 16,
        checksum: 'f4',
        created_at: 1,
        updated_at: 1,
      },
    ])

    const skill = await resolveSkillBySlug('TEAM-PLAYBOOK', 'agent-1')

    expect(skill).not.toBeNull()
    expect(skill).toMatchObject({
      id: 'team-playbook',
      sandboxPath: '/home/sprite/.skills/team-playbook',
      supportingFiles: [
        { relativePath: 'checklists/deploy.md', contentType: 'text/markdown' },
        { relativePath: 'templates/rollback.md', contentType: 'text/markdown' },
      ],
    })
  })
})
